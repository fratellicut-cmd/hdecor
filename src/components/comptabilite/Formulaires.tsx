'use client';

import { useState, type ChangeEvent } from 'react';
import { ajouterCategorie, enregistrerDepense, enregistrerMateriel } from '@/app/(app)/comptabilite/actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { Selection, TexteLong } from '@/components/ui/Autres';
import { TAILLE_MAX_JUSTIFICATIF } from '@/lib/validation/comptabilite';

type Option = { id: string; libelle: string };

export type DepenseSaisie = {
  id?: string; date_depense: string; fournisseur: string; libelle: string; categorie_id: string; chantier_id: string;
  montant_ttc_cents: string; tva_cents: string; mode_paiement: string; justificatif: boolean;
};

/** Côté le plus long d'une photo réduite : un ticket reste lisible, le fichier pèse quelques centaines de Ko. */
const COTE_MAX = 2000;

/**
 * Réduit une photo avant l'envoi (une photo de téléphone dépasse souvent la
 * limite d'envoi). Un PDF, ou une image que le navigateur ne sait pas lire
 * (HEIC hors Safari), est envoyé tel quel : le serveur tranche.
 */
async function reduire(fichier: File): Promise<File> {
  if (!fichier.type.startsWith('image/') || typeof createImageBitmap !== 'function') return fichier;
  try {
    const image = await createImageBitmap(fichier);
    const echelle = Math.min(1, COTE_MAX / Math.max(image.width, image.height));
    if (echelle === 1 && fichier.size <= 1_500_000 && fichier.type === 'image/jpeg') return fichier;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * echelle);
    canvas.height = Math.round(image.height * echelle);
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82));
    return blob ? new File([blob], fichier.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : fichier;
  } catch {
    return fichier;
  }
}

function ChoixJustificatif({ existant, erreur }: { existant: boolean; erreur?: string }) {
  const [etat, setEtat] = useState<{ texte: string; trop: boolean } | null>(null);
  const choisir = async (e: ChangeEvent<HTMLInputElement>) => {
    const champ = e.currentTarget;
    const f = champ.files?.[0];
    if (!f) { setEtat(null); return; }
    setEtat({ texte: 'Préparation de la photo…', trop: false });
    const reduit = await reduire(f);
    if (reduit !== f) {
      const dt = new DataTransfer();
      dt.items.add(reduit);
      champ.files = dt.files;
    }
    const ko = Math.ceil(reduit.size / 1024);
    const trop = reduit.size > TAILLE_MAX_JUSTIFICATIF;
    setEtat({ texte: trop ? `Fichier trop lourd (${Math.round(ko / 1024)} Mo, 5 Mo au maximum).` : `${reduit.name} (${ko > 1024 ? `${(ko / 1024).toFixed(1).replace('.', ',')} Mo` : `${ko} Ko`}) prêt à envoyer.`, trop });
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="font-semibold">{existant ? 'Remplacer le justificatif (facultatif)' : 'Photo du ticket ou facture (PDF)'}</span>
      <label className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-anthracite px-4 text-center font-semibold">
        <input type="file" name="justificatif" accept="image/jpeg,image/png,image/webp,application/pdf,image/*"
          onChange={choisir} className="sr-only" aria-invalid={erreur ? true : undefined} />
        {etat ? 'Changer de fichier' : 'Prendre une photo ou choisir un fichier'}
      </label>
      {etat ? <p className={`text-sm ${etat.trop ? 'font-semibold text-danger' : 'text-encre-douce'}`}>{etat.texte}</p> : null}
      {erreur ? <p role="alert" className="text-sm font-semibold text-danger">{erreur}</p> : null}
    </div>
  );
}

export function FormulaireDepense({ depense, categories, chantiers, regime }: {
  depense: DepenseSaisie; categories: Option[]; chantiers: Option[]; regime: 'franchise' | 'assujetti';
}) {
  const nouveau = !depense.id;
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(nouveau ? 'achat:nouveau' : `achat:${depense.id}`, enregistrerDepense);
  const e = etat.erreurs ?? {};
  const v = (k: keyof DepenseSaisie) => (etat.succes ? undefined : etat.valeurs?.[k]) ?? String(depense[k] ?? '');
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      {depense.id ? <input type="hidden" name="id" value={depense.id} /> : null}
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <ChoixJustificatif existant={depense.justificatif} erreur={e.justificatif} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Montant TTC" nom="montant_ttc_cents" inputMode="decimal" defaultValue={v('montant_ttc_cents')} erreur={e.montant_ttc_cents} placeholder="0,00" />
        <Champ libelle="Dont TVA" nom="tva_cents" inputMode="decimal" defaultValue={v('tva_cents')} erreur={e.tva_cents} placeholder="0,00"
          aide={regime === 'franchise' ? 'Telle qu’indiquée sur le ticket (non récupérable en franchise).' : 'Telle qu’indiquée sur le ticket.'} />
      </div>
      <Champ libelle="Fournisseur" nom="fournisseur" defaultValue={v('fournisseur')} erreur={e.fournisseur} placeholder="Exemple : magasin de peinture" autoComplete="organization" />
      <Champ libelle="Date" nom="date_depense" type="date" defaultValue={v('date_depense')} erreur={e.date_depense} />
      <Selection libelle="Catégorie" nom="categorie_id" defaultValue={v('categorie_id')} erreur={e.categorie_id}>
        <option value="">Sans catégorie</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
      </Selection>
      <Selection libelle="Chantier (facultatif)" nom="chantier_id" defaultValue={v('chantier_id')} erreur={e.chantier_id}>
        <option value="">Aucun (frais généraux)</option>
        {chantiers.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
      </Selection>
      <Selection libelle="Payé par" nom="mode_paiement" defaultValue={v('mode_paiement')} erreur={e.mode_paiement}>
        <option value="">Non précisé</option>
        <option value="carte">Carte</option>
        <option value="virement">Virement</option>
        <option value="cheque">Chèque</option>
        <option value="especes">Espèces</option>
      </Selection>
      <Champ libelle="Libellé (facultatif)" nom="libelle" defaultValue={v('libelle')} erreur={e.libelle} placeholder="Exemple : 2 pots de blanc mat, rouleaux" />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Envoi…' : nouveau ? 'Enregistrer l’achat' : 'Enregistrer'}</Bouton>
    </form>
  );
}

export function FormulaireCategorie() {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, ajouterCategorie, { viderApresSucces: true });
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <RetourFormulaire etat={etat} />
      <Champ libelle="Nouvelle catégorie" nom="libelle" defaultValue={etat.succes ? '' : etat.valeurs?.libelle ?? ''} erreur={etat.erreurs?.libelle} />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Un instant…' : 'Ajouter la catégorie'}</Bouton>
    </form>
  );
}

export type MaterielSaisie = { id?: string; libelle: string; date_achat: string; valeur_cents: string; depense_id: string; notes: string };

export function FormulaireMateriel({ materiel, achats }: { materiel: MaterielSaisie; achats: Option[] }) {
  const nouveau = !materiel.id;
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`materiel:${materiel.id ?? 'nouveau'}`, enregistrerMateriel, { viderApresSucces: nouveau });
  const e = etat.erreurs ?? {};
  const sv = etat.succes && nouveau ? undefined : etat.valeurs;
  const v = (k: keyof MaterielSaisie) => sv?.[k] ?? String(materiel[k] ?? '');
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      {materiel.id ? <input type="hidden" name="id" value={materiel.id} /> : null}
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Champ libelle="Désignation" nom="libelle" defaultValue={v('libelle')} erreur={e.libelle} placeholder="Exemple : ponceuse girafe" />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Acheté le (facultatif)" nom="date_achat" type="date" defaultValue={v('date_achat')} erreur={e.date_achat} />
        <Champ libelle="Valeur (facultatif)" nom="valeur_cents" inputMode="decimal" defaultValue={v('valeur_cents')} erreur={e.valeur_cents} placeholder="0,00" />
      </div>
      {achats.length ? (
        <Selection libelle="Achat correspondant (facultatif)" nom="depense_id" defaultValue={v('depense_id')} erreur={e.depense_id}>
          <option value="">Aucun</option>
          {achats.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
        </Selection>
      ) : null}
      <TexteLong libelle="Notes (facultatif)" nom="notes" defaultValue={v('notes')} erreur={e.notes} placeholder="Numéro de série, garantie…" />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" variante={nouveau ? 'principal' : 'secondaire'} disabled={enCours}>{enCours ? 'Un instant…' : nouveau ? 'Ajouter' : 'Enregistrer'}</Bouton>
    </form>
  );
}
