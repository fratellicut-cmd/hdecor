'use client';

import { useState } from 'react';
import {
  annulerPaiement, creerAvoir, creerFacture, deplacerLigneFacture, emettreFacture, enregistrerEnteteFacture, enregistrerLigneFacture,
  enregistrerPaiement, envoyerFacture,
} from '@/app/(app)/factures/actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher, Selection, TexteLong } from '@/components/ui/Autres';
import { Message } from '@/components/ui/Message';

// --------------------------------------------------------------------------
// Nouvelle facture
// --------------------------------------------------------------------------

export type DevisFacturable = {
  id: string; libelle: string;
  /** Échéances du devis (acomptes proposés), avec ce qui est déjà facturé. */
  echeances: { libelle: string; pourcentage_bp: number; saisie: string; facturee: boolean }[];
  /** Pourcentage d'acompte déjà facturé (texte). */
  dejaFacture: string;
  finaleEmise: boolean;
};
type Choix = { id: string; libelle: string };

const TYPES_FACTURE = [
  ['acompte', 'Acompte (sur un devis signé)'], ['situation', 'Situation : avancement des travaux'],
  ['finale', 'Facture finale (solde du devis)'], ['libre', 'Facture libre (sans devis)'],
] as const;

export function FormulaireNouvelleFacture({ devis, clients, chantiers, devisId, type: typeInitial }: {
  devis: DevisFacturable[]; clients: Choix[]; chantiers: (Choix & { client_id: string })[]; devisId: string | null; type: string | null;
}) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire('facture:nouvelle', creerFacture);
  const e = etat.erreurs ?? {};
  const v = (k: string, d: string) => etat.valeurs?.[k] ?? d;
  const [type, setType] = useState(v('type', typeInitial ?? (devis.length ? 'acompte' : 'libre')));
  const [devisChoisi, setDevisChoisi] = useState(v('devis_id', devisId ?? devis[0]?.id ?? ''));
  const [client, setClient] = useState(v('client_id', ''));
  const [pourcentage, setPourcentage] = useState(v('pourcentage_bp', ''));
  const d = devis.find((x) => x.id === devisChoisi);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Selection libelle="Type de facture" nom="type" value={type} onChange={(ev) => setType(ev.target.value)} erreur={e.type}>
        {TYPES_FACTURE.map(([c, l]) => <option key={c} value={c} disabled={c !== 'libre' && !devis.length}>{l}</option>)}
      </Selection>
      {type === 'libre' ? (
        <>
          <Selection libelle="Client" nom="client_id" value={client} onChange={(ev) => setClient(ev.target.value)} erreur={e.client_id}>
            <option value="">Choisir…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
          </Selection>
          <Selection libelle="Chantier (facultatif)" nom="chantier_id" defaultValue={v('chantier_id', '')} erreur={e.chantier_id} key={client}>
            <option value="">Aucun</option>
            {chantiers.filter((c) => c.client_id === client).map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
          </Selection>
        </>
      ) : !devis.length ? (
        <Message type="info">Aucun devis signé à facturer. Faites signer un devis, ou choisissez « Facture libre ».</Message>
      ) : (
        <>
          <Selection libelle="Devis signé" nom="devis_id" value={devisChoisi} onChange={(ev) => setDevisChoisi(ev.target.value)} erreur={e.devis_id}>
            {devis.map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}
          </Selection>
          {d?.finaleEmise ? <Message type="alerte">La facture finale de ce devis est déjà émise.</Message> : null}
          {type === 'acompte' ? (
            <>
              {d?.echeances.length ? (
                <div className="flex flex-col gap-2">
                  <p className="font-semibold">Échéances prévues au devis :</p>
                  <div className="flex flex-wrap gap-2">
                    {d.echeances.map((x, i) => (
                      <Bouton key={i} type="button" variante="secondaire" disabled={x.facturee} onClick={() => setPourcentage(x.saisie)}>
                        {x.libelle} ({x.saisie} %){x.facturee ? ' ✓ facturé' : ''}
                      </Bouton>
                    ))}
                  </div>
                </div>
              ) : null}
              <Champ libelle="Acompte (% du devis signé)" nom="pourcentage_bp" inputMode="decimal" value={pourcentage}
                onChange={(ev) => setPourcentage(ev.target.value)} erreur={e.pourcentage_bp}
                aide={d ? `Déjà facturé en acomptes : ${d.dejaFacture} %.` : undefined} />
            </>
          ) : null}
          {type === 'situation' ? (
            <Champ libelle="Avancement des travaux (%)" nom="pourcentage_bp" inputMode="decimal" value={pourcentage}
              onChange={(ev) => setPourcentage(ev.target.value)} erreur={e.pourcentage_bp}
              aide="Appliqué à chaque ligne du devis ; vous pourrez l’ajuster ligne par ligne avant d’émettre." />
          ) : null}
          {type === 'finale' ? (
            <p className="text-sm">Reprend toutes les lignes du devis signé (options retenues comprises) et déduit les acomptes et situations déjà émis.</p>
          ) : null}
        </>
      )}
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours || (type !== 'libre' && !devis.length)}>{enCours ? 'Création…' : 'Créer le brouillon'}</Bouton>
    </form>
  );
}

// --------------------------------------------------------------------------
// En-tête du brouillon
// --------------------------------------------------------------------------

export type EnteteFactureSaisie = {
  date_prestation_debut: string; date_prestation_fin: string; delai_paiement_jours: string; notes_client: string;
  remise_globale_bp: string; autoliquidation: boolean;
};

export function FormulaireEnteteFacture({ factureId, entete, version, remiseModifiable, autoliquidationPossible }: {
  factureId: string; entete: EnteteFactureSaisie; version: string; remiseModifiable: boolean; autoliquidationPossible: boolean;
}) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`facture:entete:${factureId}`, enregistrerEnteteFacture, { version });
  const e = etat.erreurs ?? {};
  const v = (k: keyof EnteteFactureSaisie) => etat.valeurs?.[k] ?? String(entete[k]);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="facture_id" value={factureId} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Prestation : début" nom="date_prestation_debut" type="date" defaultValue={v('date_prestation_debut')} erreur={e.date_prestation_debut} />
        <Champ libelle="Prestation : fin" nom="date_prestation_fin" type="date" defaultValue={v('date_prestation_fin')} erreur={e.date_prestation_fin} />
      </div>
      <Champ libelle="Délai de paiement (jours)" nom="delai_paiement_jours" inputMode="numeric" defaultValue={v('delai_paiement_jours')}
        erreur={e.delai_paiement_jours} aide="L’échéance est calculée à l’émission." />
      {remiseModifiable ? (
        <Champ libelle="Remise globale (%)" nom="remise_globale_bp" inputMode="decimal" defaultValue={v('remise_globale_bp')} erreur={e.remise_globale_bp} />
      ) : <input type="hidden" name="remise_globale_bp" value={v('remise_globale_bp')} />}
      {autoliquidationPossible ? (
        <CaseACocher nom="autoliquidation" libelle="Autoliquidation (sous-traitance pour une entreprise du BTP) : TVA due par le client (À VÉRIFIER)"
          defaultChecked={etat.valeurs ? etat.valeurs.autoliquidation === 'on' : entete.autoliquidation} />
      ) : null}
      <TexteLong libelle="Note au client (facultatif)" nom="notes_client" defaultValue={v('notes_client')} erreur={e.notes_client} />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</Bouton>
    </form>
  );
}

/** Avancement d'une ligne de situation. */
export function FormulaireAvancement({ factureId, ligneId, avancement }: { factureId: string; ligneId: string; avancement: string }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, enregistrerLigneFacture);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="facture_id" value={factureId} />
      <input type="hidden" name="id" value={ligneId} />
      <div className="w-32">
        <Champ libelle="Avancement (%)" nom="avancement_bp" inputMode="decimal" defaultValue={etat.valeurs?.avancement_bp ?? avancement}
          erreur={etat.erreurs?.avancement_bp} />
      </div>
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? '…' : 'Appliquer'}</Bouton>
      <div className="w-full"><RetourFormulaire etat={etat} /></div>
    </form>
  );
}

/** Monter / descendre une ligne (deux boutons de 48 px). */
export function DeplacerLigneFacture({ factureId, id, premier, dernier }: { factureId: string; id: string; premier: boolean; dernier: boolean }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, deplacerLigneFacture);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex items-center gap-1">
      <input type="hidden" name="facture_id" value={factureId} />
      <input type="hidden" name="id" value={id} />
      <Bouton type="submit" name="sens" value="haut" variante="secondaire" className="px-3" disabled={enCours || premier} aria-label="Monter la ligne">↑</Bouton>
      <Bouton type="submit" name="sens" value="bas" variante="secondaire" className="px-3" disabled={enCours || dernier} aria-label="Descendre la ligne">↓</Bouton>
      {etat.message ? <span role="alert" className="text-sm font-semibold text-danger">{etat.message}</span> : null}
    </form>
  );
}

// --------------------------------------------------------------------------
// Émission
// --------------------------------------------------------------------------

export function FormulaireEmissionFacture({ factureId, textes, bloque, avoir }: { factureId: string; textes: string[]; bloque: boolean; avoir: boolean }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, emettreFacture);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={factureId} />
      <RetourFormulaire etat={etat} />
      <div className="flex flex-col gap-1 rounded-xl border-2 border-alerte bg-alerte-fond p-3 text-alerte">
        <p className="font-semibold">Textes légaux À VÉRIFIER par le comptable, qui figureront sur le document :</p>
        <ul className="list-disc pl-5 text-sm font-semibold">{textes.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
      <CaseACocher nom="textes_confirmes" libelle="J’émets avec ces textes, en sachant qu’ils restent à faire valider" />
      <p className="text-sm">
        Une fois {avoir ? 'émis, l’avoir reçoit son numéro et ne se modifie plus.' : 'émise, la facture reçoit son numéro et ne se modifie plus : toute correction passe par un avoir.'}
      </p>
      <Bouton type="submit" disabled={enCours || bloque}>{enCours ? 'Émission…' : avoir ? 'Émettre l’avoir' : 'Émettre la facture'}</Bouton>
    </form>
  );
}

// --------------------------------------------------------------------------
// Envoi : lien de consultation (email ou partage)
// --------------------------------------------------------------------------

export function EnvoiFacture({ factureId, email, emailActif }: { factureId: string; email: string | null; emailActif: boolean }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, envoyerFacture);
  const [copie, setCopie] = useState(false);
  const lien = etat.lien;
  const partager = async () => {
    if (!lien) return;
    if (navigator.share) { try { await navigator.share({ title: 'Facture', url: lien }); } catch { /* partage annulé */ } }
    else { await navigator.clipboard.writeText(lien); setCopie(true); }
  };
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={factureId} />
      <RetourFormulaire etat={etat} />
      {lien ? (
        <div className="flex flex-col gap-2 rounded-xl border-2 border-anthracite bg-white p-3">
          <p className="text-sm font-semibold">Lien de la facture (affiché une seule fois) :</p>
          <input readOnly value={lien} aria-label="Lien de la facture" className="min-h-12 w-full rounded-xl border-2 border-trait px-3 text-sm"
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
// Paiements
// --------------------------------------------------------------------------

export function FormulairePaiement({ factureId, reste, aujourdhui, remboursement }: { factureId: string; reste: string; aujourdhui: string; remboursement: boolean }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`facture:paiement:${factureId}`, enregistrerPaiement, { viderApresSucces: true });
  const e = etat.erreurs ?? {};
  const sv = etat.succes ? undefined : etat.valeurs;
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="facture_id" value={factureId} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle={remboursement ? 'Montant remboursé (€)' : 'Montant reçu (€)'} nom="montant_cents" inputMode="decimal"
          defaultValue={sv?.montant_cents ?? reste} erreur={e.montant_cents} />
        <Champ libelle="Date" nom="date_paiement" type="date" defaultValue={sv?.date_paiement ?? aujourdhui} erreur={e.date_paiement} />
      </div>
      <Selection libelle="Mode" nom="mode" defaultValue={sv?.mode ?? 'virement'} erreur={e.mode}>
        <option value="virement">Virement</option>
        <option value="cheque">Chèque</option>
        <option value="especes">Espèces</option>
        <option value="carte">Carte (terminal)</option>
      </Selection>
      <Champ libelle="Référence (facultatif)" nom="reference" defaultValue={sv?.reference ?? ''} erreur={e.reference} placeholder="N° de chèque, libellé du virement…" />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : remboursement ? 'Enregistrer le remboursement' : 'Enregistrer le paiement'}</Bouton>
    </form>
  );
}

/** Annulation d'un paiement saisi par erreur (écriture opposée, confirmée). */
export function AnnulerPaiement({ factureId, paiementId }: { factureId: string; paiementId: string }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, annulerPaiement);
  return (
    <details>
      <summary className="inline-flex min-h-12 cursor-pointer items-center text-sm font-semibold underline underline-offset-4">Annuler ce paiement…</summary>
      <form ref={formRef} action={action} onSubmit={surEnvoi} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="facture_id" value={factureId} />
        <input type="hidden" name="paiement_id" value={paiementId} />
        <RetourFormulaire etat={etat} />
        <CaseACocher nom="confirmation" libelle="Ce paiement a été saisi par erreur (une écriture d’annulation est ajoutée, rien n’est effacé)" required />
        <Bouton type="submit" variante="danger" disabled={enCours}>{enCours ? 'Un instant…' : 'Annuler le paiement'}</Bouton>
      </form>
    </details>
  );
}

// --------------------------------------------------------------------------
// Avoir
// --------------------------------------------------------------------------

export function FormulaireAvoir({ factureId, reste }: { factureId: string; reste: string }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`facture:avoir:${factureId}`, creerAvoir);
  const e = etat.erreurs ?? {};
  const v = (k: string, d: string) => etat.valeurs?.[k] ?? d;
  const [mode, setMode] = useState(v('mode', 'total'));
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="facture_id" value={factureId} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Selection libelle="Nature" nom="nature" defaultValue={v('nature', 'correction')} erreur={e.nature}>
        <option value="correction">Correction ou annulation (erreur, travaux non réalisés)</option>
        <option value="reduction">Réduction de prix accordée après coup (geste commercial)</option>
      </Selection>
      <Selection libelle="Montant" nom="mode" value={mode} onChange={(ev) => setMode(ev.target.value)} erreur={e.mode}>
        <option value="total">Tout le reste dû ({reste})</option>
        <option value="montant">Un montant précis</option>
      </Selection>
      {mode === 'montant' ? (
        <Champ libelle="Montant de l’avoir, TTC (€)" nom="montant_ttc_cents" inputMode="decimal" defaultValue={v('montant_ttc_cents', '')}
          erreur={e.montant_ttc_cents} aide="Réparti sur les taux de TVA de la facture, au prorata." />
      ) : null}
      <TexteLong libelle="Motif (imprimé sur l’avoir)" nom="motif" defaultValue={v('motif', '')} erreur={e.motif} />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Création…' : 'Créer l’avoir (brouillon)'}</Bouton>
    </form>
  );
}
