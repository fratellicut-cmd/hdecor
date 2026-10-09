'use client';

import { useState } from 'react';
import {
  ajouterEcheance, creerDevis, deplacerLigne, emettreDevis, enregistrerEntete, enregistrerLigne, envoyerDevis, refuserDevis,
} from '@/app/(app)/devis/actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher, Selection, TexteLong } from '@/components/ui/Autres';
import { Message } from '@/components/ui/Message';

// --------------------------------------------------------------------------
// Nouveau devis
// --------------------------------------------------------------------------

export function FormulaireNouveauDevis({ chantiers, chantierId }: { chantiers: { id: string; libelle: string }[]; chantierId: string | null }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire('devis:nouveau', creerDevis);
  const e = etat.erreurs ?? {};
  const v = (k: string, d: string) => etat.valeurs?.[k] ?? d;
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Selection libelle="Chantier" nom="chantier_id" defaultValue={v('chantier_id', chantierId ?? '')} erreur={e.chantier_id}>
        <option value="">Choisir…</option>
        {chantiers.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
      </Selection>
      <Champ libelle="Objet (facultatif)" nom="objet" defaultValue={v('objet', '')} erreur={e.objet} placeholder="Exemple : peinture du séjour" />
      <CaseACocher nom="importer_postes" libelle="Reprendre les postes de peinture du chantier (surfaces et prix calculés)"
        defaultChecked={etat.valeurs ? etat.valeurs.importer_postes === 'on' : true} />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Création…' : 'Créer le brouillon'}</Bouton>
    </form>
  );
}

// --------------------------------------------------------------------------
// En-tête du brouillon
// --------------------------------------------------------------------------

export type EnteteSaisie = {
  objet: string; validite_jours: string; date_debut_travaux: string; delai_debut_texte: string; duree_estimee_jours: string;
  conditions_paiement: string; hors_etablissement: boolean; remise_globale_bp: string; acompte_pct_bp: string; notes_client: string;
};

export function FormulaireEntete({ devisId, entete, version, avecEcheancier }: { devisId: string; entete: EnteteSaisie; version: string; avecEcheancier: boolean }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`devis:entete:${devisId}`, enregistrerEntete, { version });
  const e = etat.erreurs ?? {};
  const v = (k: keyof EnteteSaisie) => etat.valeurs?.[k] ?? String(entete[k]);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="devis_id" value={devisId} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Champ libelle="Objet" nom="objet" defaultValue={v('objet')} erreur={e.objet} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Début des travaux" nom="date_debut_travaux" type="date" defaultValue={v('date_debut_travaux')} erreur={e.date_debut_travaux} />
        <Champ libelle="Durée (jours)" nom="duree_estimee_jours" inputMode="decimal" defaultValue={v('duree_estimee_jours')} erreur={e.duree_estimee_jours} />
      </div>
      <Champ libelle="Ou délai de début (texte)" nom="delai_debut_texte" defaultValue={v('delai_debut_texte')} erreur={e.delai_debut_texte}
        placeholder="Exemple : sous 3 semaines après signature" aide="Utilisé si aucune date n’est choisie." />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Validité (jours)" nom="validite_jours" inputMode="numeric" defaultValue={v('validite_jours')} erreur={e.validite_jours} />
        <Champ libelle="Remise globale (%)" nom="remise_globale_bp" inputMode="decimal" defaultValue={v('remise_globale_bp')} erreur={e.remise_globale_bp} />
      </div>
      {avecEcheancier ? (
        <input type="hidden" name="acompte_pct_bp" value={v('acompte_pct_bp')} />
      ) : (
        <Champ libelle="Acompte à la signature (%)" nom="acompte_pct_bp" inputMode="decimal" defaultValue={v('acompte_pct_bp')} erreur={e.acompte_pct_bp}
          aide="Ou détaillez un échéancier plus bas." />
      )}
      <TexteLong libelle="Conditions de paiement" nom="conditions_paiement" defaultValue={v('conditions_paiement')} erreur={e.conditions_paiement} />
      <CaseACocher nom="hors_etablissement" libelle="Signé chez le client (hors établissement) : droit de rétractation de 14 jours et formulaire joint"
        defaultChecked={etat.valeurs ? etat.valeurs.hors_etablissement === 'on' : entete.hors_etablissement} />
      <TexteLong libelle="Note au client (facultatif)" nom="notes_client" defaultValue={v('notes_client')} erreur={e.notes_client} />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer l’en-tête'}</Bouton>
    </form>
  );
}

// --------------------------------------------------------------------------
// Ligne (ajout ou modification)
// --------------------------------------------------------------------------

export type LigneSaisie = {
  id?: string; type: 'ligne' | 'section' | 'sous_total' | 'texte'; designation: string; description: string; quantite: string; unite: string;
  prix: string; remise: string; taux: string; optionnelle: boolean;
};

const UNITES = [['m2', 'm²'], ['ml', 'mètre linéaire'], ['u', 'unité'], ['h', 'heure'], ['forfait', 'forfait'], ['L', 'litre'], ['kg', 'kilo']] as const;
const TYPES = [['ligne', 'Prestation chiffrée'], ['section', 'Titre de section'], ['sous_total', 'Sous-total'], ['texte', 'Texte libre']] as const;

export function FormulaireLigne({ devisId, ligne, franchise, taux }: {
  devisId: string; ligne: LigneSaisie; franchise: boolean; taux: { taux_bp: number; libelle: string }[];
}) {
  const nouvelle = !ligne.id;
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`devis:ligne:${ligne.id ?? `nouvelle:${devisId}`}`, enregistrerLigne,
    { viderApresSucces: nouvelle });
  const e = etat.erreurs ?? {};
  const sv = etat.succes && nouvelle ? undefined : etat.valeurs;
  const v = (k: string, d: string) => sv?.[k] ?? d;
  const [type, setType] = useState<LigneSaisie['type']>((sv?.type as LigneSaisie['type']) ?? ligne.type);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="devis_id" value={devisId} />
      {ligne.id ? <input type="hidden" name="id" value={ligne.id} /> : null}
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Selection libelle="Type" nom="type" value={type} onChange={(ev) => setType(ev.target.value as LigneSaisie['type'])}>
        {TYPES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
      </Selection>
      <Champ libelle={type === 'sous_total' ? 'Libellé (facultatif)' : type === 'section' ? 'Titre' : 'Désignation'} nom="designation"
        defaultValue={v('designation', ligne.designation)} erreur={e.designation} />
      {type !== 'sous_total' ? (
        <TexteLong libelle="Détail (facultatif)" nom="description" defaultValue={v('description', ligne.description)} erreur={e.description} />
      ) : null}
      {type === 'ligne' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Champ libelle="Quantité" nom="quantite_e4" inputMode="decimal" defaultValue={v('quantite_e4', ligne.quantite)} erreur={e.quantite_e4} />
            <Selection libelle="Unité" nom="unite" defaultValue={v('unite', ligne.unite || 'm2')} erreur={e.unite}>
              {UNITES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
            </Selection>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Champ libelle="Prix unitaire HT (€)" nom="prix_unitaire_ht_cents" inputMode="decimal" defaultValue={v('prix_unitaire_ht_cents', ligne.prix)}
              erreur={e.prix_unitaire_ht_cents} />
            <Champ libelle="Remise (%)" nom="remise_bp" inputMode="decimal" defaultValue={v('remise_bp', ligne.remise || '0')} erreur={e.remise_bp} />
          </div>
          {franchise ? (
            <p className="text-sm text-encre-douce">Franchise en base de TVA : aucune TVA (0 %).</p>
          ) : (
            <Selection libelle="TVA" nom="taux_tva_bp" defaultValue={v('taux_tva_bp', ligne.taux)} erreur={e.taux_tva_bp}>
              <option value="">Choisir…</option>
              {taux.map((t) => <option key={t.taux_bp} value={t.taux_bp}>{t.libelle}</option>)}
            </Selection>
          )}
          <CaseACocher nom="optionnelle" libelle="Option (proposée au client, hors total)"
            defaultChecked={sv ? sv.optionnelle === 'on' : ligne.optionnelle} />
        </>
      ) : null}
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : nouvelle ? 'Ajouter' : 'Enregistrer la ligne'}</Bouton>
    </form>
  );
}

/** Monter / descendre une ligne (deux boutons de 48 px). */
export function DeplacerLigne({ devisId, id, premier, dernier }: { devisId: string; id: string; premier: boolean; dernier: boolean }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, deplacerLigne);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex items-center gap-1">
      <input type="hidden" name="devis_id" value={devisId} />
      <input type="hidden" name="id" value={id} />
      <Bouton type="submit" name="sens" value="haut" variante="secondaire" className="px-3" disabled={enCours || premier} aria-label="Monter la ligne">↑</Bouton>
      <Bouton type="submit" name="sens" value="bas" variante="secondaire" className="px-3" disabled={enCours || dernier} aria-label="Descendre la ligne">↓</Bouton>
      {etat.message ? <span role="alert" className="text-sm font-semibold text-danger">{etat.message}</span> : null}
    </form>
  );
}

// --------------------------------------------------------------------------
// Échéancier
// --------------------------------------------------------------------------

export function FormulaireEcheance({ devisId }: { devisId: string }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`devis:echeance:${devisId}`, ajouterEcheance, { viderApresSucces: true });
  const e = etat.erreurs ?? {};
  const sv = etat.succes ? undefined : etat.valeurs;
  const [declencheur, setDeclencheur] = useState(sv?.declencheur ?? 'signature');
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="devis_id" value={devisId} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Libellé" nom="libelle" defaultValue={sv?.libelle ?? ''} erreur={e.libelle} placeholder="Acompte, solde…" />
        <Champ libelle="Pourcentage (%)" nom="pourcentage_bp" inputMode="decimal" defaultValue={sv?.pourcentage_bp ?? ''} erreur={e.pourcentage_bp} />
      </div>
      <Selection libelle="Quand" nom="declencheur" value={declencheur} onChange={(ev) => setDeclencheur(ev.target.value)} erreur={e.declencheur}>
        <option value="signature">À la signature</option>
        <option value="debut_travaux">Au début des travaux</option>
        <option value="mi_chantier">À mi-chantier</option>
        <option value="fin_travaux">À la fin des travaux</option>
        <option value="date">À une date</option>
      </Selection>
      {declencheur === 'date' ? <Champ libelle="Date" nom="date_prevue" type="date" defaultValue={sv?.date_prevue ?? ''} erreur={e.date_prevue} /> : null}
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Ajout…' : 'Ajouter l’échéance'}</Bouton>
    </form>
  );
}

// --------------------------------------------------------------------------
// Émission
// --------------------------------------------------------------------------

export function FormulaireEmission({ devisId, textes, bloque }: { devisId: string; textes: string[]; bloque: boolean }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, emettreDevis);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={devisId} />
      <RetourFormulaire etat={etat} />
      <div className="flex flex-col gap-1 rounded-xl border-2 border-alerte bg-alerte-fond p-3 text-alerte">
        <p className="font-semibold">Textes légaux À VÉRIFIER par le comptable, qui figureront sur le devis :</p>
        <ul className="list-disc pl-5 text-sm font-semibold">{textes.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
      <CaseACocher nom="textes_confirmes" libelle="J’émets ce devis avec ces textes, en sachant qu’ils restent à faire valider" />
      <p className="text-sm">Une fois émis, le devis reçoit son numéro et ne se modifie plus (nouvelle version possible).</p>
      <Bouton type="submit" disabled={enCours || bloque}>{enCours ? 'Émission…' : 'Émettre le devis'}</Bouton>
    </form>
  );
}

// --------------------------------------------------------------------------
// Envoi : lien de signature (email ou partage)
// --------------------------------------------------------------------------

export function EnvoiDevis({ devisId, email, emailActif }: { devisId: string; email: string | null; emailActif: boolean }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, envoyerDevis);
  const [copie, setCopie] = useState(false);
  const lien = etat.lien;
  const partager = async () => {
    if (!lien) return;
    if (navigator.share) { try { await navigator.share({ title: 'Devis', url: lien }); } catch { /* partage annulé */ } }
    else { await navigator.clipboard.writeText(lien); setCopie(true); }
  };
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={devisId} />
      <RetourFormulaire etat={etat} />
      {lien ? (
        <div className="flex flex-col gap-2 rounded-xl border-2 border-anthracite bg-white p-3">
          <p className="text-sm font-semibold">Lien de signature (affiché une seule fois) :</p>
          <input readOnly value={lien} aria-label="Lien de signature" className="min-h-12 w-full rounded-xl border-2 border-trait px-3 text-sm"
            onFocus={(ev) => ev.currentTarget.select()} />
          <div className="grid grid-cols-2 gap-2">
            <Bouton type="button" variante="secondaire" onClick={async () => { await navigator.clipboard.writeText(lien); setCopie(true); }}>
              {copie ? 'Copié ✓' : 'Copier'}
            </Bouton>
            <Bouton type="button" variante="secondaire" onClick={partager}>Partager…</Bouton>
          </div>
        </div>
      ) : null}
      {emailActif && email ? (
        <Bouton type="submit" name="canal" value="email" disabled={enCours}>{enCours ? 'Envoi…' : `Envoyer par email à ${email}`}</Bouton>
      ) : (
        <Message type="info">{email ? 'Envoi d’emails non configuré : partagez le lien (SMS, WhatsApp…).' : 'Pas d’email pour ce client : partagez le lien (SMS, WhatsApp…).'}</Message>
      )}
      <Bouton type="submit" name="canal" value="lien" variante="secondaire" disabled={enCours}>Créer un lien à partager</Bouton>
    </form>
  );
}

// --------------------------------------------------------------------------
// Refus du client (motif facultatif)
// --------------------------------------------------------------------------

export function FormulaireRefus({ devisId }: { devisId: string }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, refuserDevis);
  return (
    <details>
      <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">Marquer refusé…</summary>
      <form ref={formRef} action={action} onSubmit={surEnvoi} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="id" value={devisId} />
        <RetourFormulaire etat={etat} />
        <Champ libelle="Motif (facultatif)" nom="motif" maxLength={500} placeholder="Exemple : trop cher, travaux reportés" />
        <CaseACocher nom="confirmation" libelle="Le client a refusé ce devis" required />
        <Bouton type="submit" variante="danger" disabled={enCours}>{enCours ? 'Un instant…' : 'Marquer refusé'}</Bouton>
      </form>
    </details>
  );
}
