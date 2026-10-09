'use client';

import { useActionState, startTransition, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ajouterFormat, apercuImport, enregistrerMatiereEtape, enregistrerPrestation, enregistrerTeinte, modifierPrixFormat, validerImport,
  type EtatImport,
} from '@/app/(app)/catalogue/actions';
import { decoderCsv, TAILLE_MAX_CSV } from '@/domain/csv';
import { formaterDate } from '@/domain/formats';
import { UNITES_PRESTATION } from '@/lib/validation/catalogue';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { AlerteHorsLigne, MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher, Selection, TexteLong } from '@/components/ui/Autres';
import { Message } from '@/components/ui/Message';

// --------------------------------------------------------------------------
// Formats d'un produit
// --------------------------------------------------------------------------

export function FormulaireAjoutFormat({ produitId, unite }: { produitId: string; unite: string }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`format:${produitId}`, ajouterFormat, { viderApresSucces: true });
  const e = etat.erreurs ?? {};
  const v = etat.succes ? {} : (etat.valeurs ?? {});
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="produit_id" value={produitId} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle={`Contenance (${unite})`} nom="contenance" inputMode="decimal" defaultValue={v.contenance} erreur={e.contenance} placeholder="2,5" />
        <Champ libelle="Prix d’achat HT (€)" nom="prix_achat_ht_cents" inputMode="decimal" defaultValue={v.prix_achat_ht_cents} erreur={e.prix_achat_ht_cents}
          aide="Vide : prix à renseigner." />
      </div>
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Ajout…' : 'Ajouter le format'}</Bouton>
    </form>
  );
}

/** Prix d'un format : chaque changement est daté dans l'historique. */
export function FormulairePrixFormat({ id, libelle, prix }: { id: string; libelle: string; prix: string }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(null, modifierPrixFormat);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <Champ className="min-w-0 flex-1" libelle={`Prix HT du ${libelle} (€)`} nom="prix_achat_ht_cents" inputMode="decimal"
        defaultValue={etat.valeurs?.prix_achat_ht_cents ?? prix} erreur={etat.erreurs?.prix_achat_ht_cents} />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? '…' : 'Enregistrer'}</Bouton>
      <div className="w-full">
        {garde.horsLigne ? <AlerteHorsLigne sansBrouillon /> : null}
        {etat.message ? <Message type="erreur">{etat.message}</Message> : null}
        {etat.succes ? <p role="status" className="text-sm font-semibold text-succes">{etat.succes}</p> : null}
      </div>
    </form>
  );
}

// --------------------------------------------------------------------------
// Teintes
// --------------------------------------------------------------------------

export type TeinteSaisie = {
  id?: string; nom: string; marque: string | null; code_ral: string | null; code_ncs: string | null; code_fabricant: string | null;
  apercu_hex: string | null; statut_verification: string; verifie_le?: string | null; source_verification?: string | null;
};

export function FormulaireTeinte({ teinte }: { teinte: TeinteSaisie }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`teinte:${teinte.id ?? 'nouvelle'}`, enregistrerTeinte,
    { viderApresSucces: !teinte.id });
  const e = etat.erreurs ?? {};
  const v = (cle: keyof TeinteSaisie) => (etat.succes ? null : etat.valeurs?.[cle]) ?? (teinte[cle] as string | null) ?? '';
  const [couleur, setCouleur] = useState(v('apercu_hex') || '');
  const [confirme, setConfirme] = useState(etat.valeurs?.confirme === 'on');
  // Après un ajout, le formulaire est vidé : la couleur et la case suivent (état suivi pendant le rendu).
  const [vu, setVu] = useState(etat);
  if (vu !== etat) {
    setVu(etat);
    if (etat.succes && !teinte.id) { setCouleur(''); setConfirme(false); }
  }
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      {teinte.id ? <input type="hidden" name="id" value={teinte.id} /> : null}
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Champ libelle="Nom" nom="nom" defaultValue={v('nom')} erreur={e.nom} required placeholder="Exemple : Blanc cassé" />
      <Champ libelle="Marque" nom="marque" defaultValue={v('marque')} erreur={e.marque} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Code RAL" nom="code_ral" defaultValue={v('code_ral')} erreur={e.code_ral} placeholder="RAL 9010" autoComplete="off" />
        <Champ libelle="Code NCS" nom="code_ncs" defaultValue={v('code_ncs')} erreur={e.code_ncs} placeholder="S 0502-Y" autoComplete="off" />
      </div>
      <Champ libelle="Code fabricant" nom="code_fabricant" defaultValue={v('code_fabricant')} erreur={e.code_fabricant} autoComplete="off" />
      <div className="flex items-end gap-3">
        <Champ className="flex-1" libelle="Aperçu (code couleur)" nom="apercu_hex" value={couleur} onChange={(ev) => setCouleur(ev.target.value)}
          erreur={e.apercu_hex} placeholder="#F4F1EA" autoComplete="off" aide="Indicatif : l’écran ne rend pas la teinte réelle." />
        <label className="mb-7 flex min-h-12 min-w-12 cursor-pointer items-center justify-center rounded-xl border-2 border-trait has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-or-fonce">
          <span className="sr-only">Choisir la couleur d’aperçu</span>
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(couleur) ? couleur : '#ffffff'} onChange={(ev) => setCouleur(ev.target.value.toUpperCase())}
            className="h-10 w-10 cursor-pointer border-0 bg-transparent" />
        </label>
      </div>
      <p className="text-sm text-encre-douce">
        {teinte.statut_verification === 'verifie' && teinte.verifie_le
          ? `Codes vérifiés le ${formaterDate(teinte.verifie_le)} (${teinte.source_verification ?? 'source non indiquée'}).`
          : 'Codes À VÉRIFIER sur le nuancier du fabricant.'}
      </p>
      <CaseACocher nom="confirme" libelle="Codes vérifiés sur le nuancier du fabricant" checked={confirme} onChange={(ev) => setConfirme(ev.target.checked)} />
      {confirme ? (
        <div className="grid grid-cols-2 gap-3">
          <Champ libelle="Vérifié le" nom="verifie_le" type="date" defaultValue={etat.valeurs?.verifie_le ?? ''} erreur={e.verifie_le} />
          <Champ libelle="Source" nom="source_verification" defaultValue={etat.valeurs?.source_verification ?? ''} erreur={e.source_verification}
            placeholder="Nuancier, fiche fabricant…" />
        </div>
      ) : null}
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" variante={teinte.id ? 'principal' : 'secondaire'} disabled={enCours}>{enCours ? 'Enregistrement…' : teinte.id ? 'Enregistrer' : 'Ajouter la teinte'}</Bouton>
    </form>
  );
}

// --------------------------------------------------------------------------
// Prestations
// --------------------------------------------------------------------------

export type PrestationSaisie = {
  id?: string; libelle: string; description: string | null; unite: string; prix: string; taux_tva_bp: number | null;
};

export function FormulairePrestation({ prestation, taux }: { prestation: PrestationSaisie; taux: { taux_bp: number; libelle: string }[] }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`prestation:${prestation.id ?? 'nouvelle'}`, enregistrerPrestation);
  const e = etat.erreurs ?? {};
  const v = (cle: string, defaut: string) => etat.valeurs?.[cle] ?? defaut;
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      {prestation.id ? <input type="hidden" name="id" value={prestation.id} /> : null}
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Champ libelle="Libellé" nom="libelle" defaultValue={v('libelle', prestation.libelle)} erreur={e.libelle} required
        placeholder="Exemple : Peinture murs, 2 couches" />
      <TexteLong libelle="Description (reprise dans les devis)" nom="description" defaultValue={v('description', prestation.description ?? '')} erreur={e.description} />
      <div className="grid grid-cols-2 gap-3">
        <Selection libelle="Unité" nom="unite" defaultValue={v('unite', prestation.unite)} erreur={e.unite}>
          {Object.entries(UNITES_PRESTATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Selection>
        <Champ libelle="Prix unitaire HT (€)" nom="prix_unitaire_ht_cents" inputMode="decimal" defaultValue={v('prix_unitaire_ht_cents', prestation.prix)}
          erreur={e.prix_unitaire_ht_cents} />
      </div>
      <Selection libelle="Taux de TVA" nom="taux_tva_bp" defaultValue={v('taux_tva_bp', prestation.taux_tva_bp === null ? '' : String(prestation.taux_tva_bp))}
        erreur={e.taux_tva_bp}>
        <option value="">Choisir…</option>
        {taux.map((t) => <option key={t.taux_bp} value={t.taux_bp}>{t.libelle}</option>)}
      </Selection>
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer la prestation'}</Bouton>
    </form>
  );
}

// --------------------------------------------------------------------------
// Matière d'une étape de préparation
// --------------------------------------------------------------------------

export function FormulaireMatiereEtape({ id, produitId, consommation, produits }: {
  id: string; produitId: string; consommation: string; produits: { id: string; libelle: string; unite: string }[];
}) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(null, enregistrerMatiereEtape);
  const e = etat.erreurs ?? {};
  const v = etat.valeurs ?? {};
  const [choisi, setChoisi] = useState(v.produit_id ?? produitId);
  const unite = produits.find((p) => p.id === choisi)?.unite ?? 'kg';
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-2 gap-3">
        <Selection libelle="Produit du catalogue" nom="produit_id" value={choisi} onChange={(ev) => setChoisi(ev.target.value)} erreur={e.produit_id}>
          <option value="">Aucun</option>
          {produits.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
        </Selection>
        <Champ libelle={`Consommation (${unite}/m² par passe)`} nom="consommation_par_m2" inputMode="decimal" defaultValue={v.consommation_par_m2 ?? consommation}
          erreur={e.consommation_par_m2} aide="Fiche technique, pertes comprises." />
      </div>
      {garde.horsLigne ? <AlerteHorsLigne sansBrouillon /> : null}
      <RetourFormulaire etat={etat} />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer la matière'}</Bouton>
    </form>
  );
}

// --------------------------------------------------------------------------
// Import CSV : aperçu, puis validation
// --------------------------------------------------------------------------

const MESSAGE_RESEAU_IMPORT = 'Le réseau ne répond pas : rien n’est confirmé. Réessayez dans un instant (un import refait met à jour les mêmes produits, sans doublon).';

function useEtapeImport(action: (e: EtatImport, f: FormData) => Promise<EtatImport>) {
  return useActionState(async (etat: EtatImport, f: FormData) => {
    try { return await action(etat, f); } catch (e) {
      if (!navigator.onLine || e instanceof TypeError) return { message: MESSAGE_RESEAU_IMPORT };
      throw e;
    }
  }, {} as EtatImport);
}

export function ImportCatalogue() {
  const [contenu, setContenu] = useState<string | null>(null);
  const [fichier, setFichier] = useState<{ nom: string; encodage: string; numero: number } | null>(null);
  const [lecture, setLecture] = useState<string | null>(null);
  const [apercu, demanderApercu, enApercu] = useEtapeImport(apercuImport);
  const [resultat, valider, enImport] = useEtapeImport(validerImport);
  const [ignorer, setIgnorer] = useState(false);
  const [horsLigne, setHorsLigne] = useState(false);
  // Numéro du fichier dont le résultat d'import est affiché : un nouveau fichier efface l'ancien message.
  const [importDe, setImportDe] = useState<number | null>(null);

  const choisir = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    setContenu(null);
    setLecture(null);
    setIgnorer(false);
    setImportDe(null);
    if (!f) return;
    if (f.size > TAILLE_MAX_CSV) { setLecture('Fichier trop volumineux (1 Mo au maximum).'); return; }
    // Excel en français enregistre le CSV en Windows-1252 : décodage sans perte des accents.
    const { texte, encodage } = decoderCsv(new Uint8Array(await f.arrayBuffer()));
    // Envoyé en UTF-8 : un accent Windows-1252 y prend 2 octets ; la limite est vérifiée après décodage.
    if (new TextEncoder().encode(texte).length > TAILLE_MAX_CSV) { setLecture('Fichier trop volumineux (1 Mo au maximum).'); return; }
    setFichier((x) => ({ nom: f.name, encodage, numero: (x?.numero ?? 0) + 1 }));
    setContenu(texte);
    const fd = new FormData();
    fd.set('contenu', texte);
    startTransition(() => demanderApercu(fd));
  };
  const envoyer = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!navigator.onLine) { setHorsLigne(true); return; }
    setHorsLigne(false);
    if (contenu === null || !fichier) return;
    const fd = new FormData();
    fd.set('contenu', contenu);
    if (ignorer) fd.set('ignorer_erreurs', 'on');
    setImportDe(fichier.numero);
    startTransition(() => valider(fd));
  };

  const resultatAffiche = importDe !== null && importDe === fichier?.numero ? resultat : {};
  // Après un import réussi, l'aperçu relu par le serveur remplace l'ancien (les créations deviennent des mises à jour).
  const a = resultatAffiche.apercu ?? apercu.apercu;
  const enErreur = a?.lignes.filter((l) => l.erreurs.length) ?? [];
  const valides = a?.lignes.filter((l) => !l.erreurs.length) ?? [];
  const aSurveiller = valides.filter((l) => l.avertissements.length);
  const peutImporter = a && !a.erreursFichier.length && valides.length > 0 && (!enErreur.length || ignorer);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-trait bg-white p-4 text-center has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-or-fonce">
        <span className="font-semibold">{fichier ? `Fichier : ${fichier.nom} (${fichier.encodage})` : 'Choisir le fichier CSV'}</span>
        <span className="text-sm text-encre-douce">Enregistré depuis Excel « CSV (séparateur : point-virgule) » ou « CSV UTF-8 », 1 Mo au maximum</span>
        <input type="file" accept=".csv,text/csv" onChange={choisir} className="sr-only" />
      </label>
      {lecture ? <Message type="erreur">{lecture}</Message> : null}
      {enApercu ? <p role="status">Lecture du fichier…</p> : null}
      {apercu.message ? <Message type="erreur">{apercu.message}</Message> : null}

      {a ? (
        <section aria-labelledby="titre-apercu" className="flex flex-col gap-3">
          <h2 id="titre-apercu" className="text-lg font-bold">Aperçu (rien n’est encore enregistré)</h2>
          {a.erreursFichier.map((m) => <Message key={m} type="erreur">{m}</Message>)}
          {a.colonnesIgnorees.length ? <Message type="info">Colonnes ignorées : {a.colonnesIgnorees.join(', ')}.</Message> : null}
          {a.lignes.length ? (
            <p className="font-semibold">
              {valides.filter((l) => l.action === 'creation').length} création(s), {valides.filter((l) => l.action === 'mise_a_jour').length} mise(s) à jour,{' '}
              <span className={enErreur.length ? 'text-danger' : ''}>{enErreur.length} ligne(s) en erreur</span>.
            </p>
          ) : null}
          {enErreur.length ? (
            <ul className="flex flex-col gap-2">
              {enErreur.map((l) => (
                <li key={l.numero} className="rounded-xl border-2 border-danger bg-danger-fond p-3 text-danger">
                  <p className="font-bold">Ligne {l.numero}</p>
                  <ul className="list-disc pl-5 text-sm">{l.erreurs.map((m) => <li key={m}>{m}</li>)}</ul>
                </li>
              ))}
            </ul>
          ) : null}
          {aSurveiller.length ? (
            <ul className="flex flex-col gap-2">
              {aSurveiller.map((l) => (
                <li key={l.numero} className="rounded-xl border-2 border-alerte bg-alerte-fond p-3 text-alerte">
                  <p className="font-bold">Ligne {l.numero} (importable, à vérifier) : {l.libelle}</p>
                  <ul className="list-disc pl-5 text-sm">{l.avertissements.map((m) => <li key={m}>{m}</li>)}</ul>
                </li>
              ))}
            </ul>
          ) : null}
          {valides.length ? (
            <details>
              <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">Voir les {valides.length} ligne(s) valide(s)</summary>
              <ul className="mt-2 flex flex-col divide-y divide-trait rounded-xl border border-trait bg-white">
                {valides.map((l) => (
                  <li key={l.numero} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
                    <span>Ligne {l.numero} : {l.libelle}</span>
                    <span className="font-semibold">{l.action === 'creation' ? 'création' : 'mise à jour'} · {l.formats} format(s)</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <form onSubmit={envoyer} className="flex flex-col gap-3">
            {enErreur.length && valides.length ? (
              <CaseACocher nom="ignorer_erreurs" libelle={`Importer seulement les ${valides.length} ligne(s) valide(s)`} checked={ignorer}
                onChange={(ev) => setIgnorer(ev.target.checked)} />
            ) : null}
            <p className="text-sm text-encre-douce">
              Les produits créés, ou dont une valeur technique change, sont « À VÉRIFIER ». Une mise à jour ne remplace que les cellules remplies : une cellule vide ou une colonne absente
              garde la valeur actuelle (un prix vide garde le prix actuel). Une valeur technique modifiée repasse le produit « À VÉRIFIER ».
              Un prix changé est daté dans l’historique ; un produit archivé réimporté revient au catalogue.
            </p>
            {horsLigne ? <AlerteHorsLigne sansBrouillon /> : null}
            {resultatAffiche.message ? <Message type="erreur">{resultatAffiche.message}</Message> : null}
            {resultatAffiche.succes ? <Message type="succes">{resultatAffiche.succes}</Message> : null}
            <Bouton type="submit" disabled={!peutImporter || enImport || enApercu}>{enImport ? 'Import…' : 'Valider l’import'}</Bouton>
          </form>
        </section>
      ) : null}
    </div>
  );
}
