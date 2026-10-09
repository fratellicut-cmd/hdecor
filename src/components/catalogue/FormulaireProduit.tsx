'use client';

import { useId, useState } from 'react';
import { enregistrerProduit } from '@/app/(app)/catalogue/actions';
import { FINITIONS, MARQUES_SUGGEREES, TYPES, USAGES } from '@/domain/catalogue';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher, Selection } from '@/components/ui/Autres';

export type ProduitSaisi = {
  id?: string; updated_at?: string; marque: string; gamme: string | null; reference_fabricant: string | null; designation: string;
  type: string; usages: string[]; finition: string | null; unite_mesure: string; rendement_m2_par_unite: number | null;
  couches_recommandees: number | null; sechage_recouvrable_h: number | null; fournisseur: string | null; fiche_technique_url: string | null;
  statut_verification: string; verifie_le: string | null; source_verification: string | null;
};

const num = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));

export function FormulaireProduit({ produit, marques }: { produit: ProduitSaisi; marques: string[] }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`produit:${produit.id ?? 'nouveau'}`, enregistrerProduit,
    { version: produit.id ? (produit.updated_at ?? null) : undefined });
  const e = etat.erreurs ?? {};
  const sv = etat.valeurs;
  const v = (cle: string, defaut: string) => sv?.[cle] ?? defaut;
  const usages = sv ? (sv.usages ?? '').split(',') : produit.usages;
  const [type, setType] = useState(v('type', produit.type));
  const [confirme, setConfirme] = useState(sv ? sv.confirme === 'on' : false);
  const idListe = useId();
  const unite = v('unite_mesure', produit.unite_mesure);

  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      {produit.id ? <input type="hidden" name="id" value={produit.id} /> : null}
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />

      <Champ libelle="Marque" nom="marque" defaultValue={v('marque', produit.marque)} erreur={e.marque} required list={idListe} autoComplete="off" />
      <datalist id={idListe}>{[...new Set([...marques, ...MARQUES_SUGGEREES])].map((m) => <option key={m} value={m} />)}</datalist>
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Gamme" nom="gamme" defaultValue={v('gamme', produit.gamme ?? '')} erreur={e.gamme} />
        <Champ libelle="Référence fabricant" nom="reference_fabricant" defaultValue={v('reference_fabricant', produit.reference_fabricant ?? '')}
          erreur={e.reference_fabricant} autoComplete="off" />
      </div>
      <Champ libelle="Désignation" nom="designation" defaultValue={v('designation', produit.designation)} erreur={e.designation} required
        placeholder="Exemple : Acrylique velours murs et plafonds" />
      <div className="grid grid-cols-2 gap-3">
        <Selection libelle="Type" nom="type" value={type} onChange={(ev) => setType(ev.target.value)} erreur={e.type}>
          <option value="">Choisir…</option>
          {TYPES.map((t) => <option key={t.code} value={t.code}>{t.libelle}</option>)}
        </Selection>
        <Selection libelle="Unité" nom="unite_mesure" key={`unite-${type === 'enduit'}`} defaultValue={produit.id ? unite : type === 'enduit' ? 'kg' : unite}
          erreur={e.unite_mesure}>
          <option value="L">litre (L)</option>
          <option value="kg">kilo (kg)</option>
        </Selection>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-semibold">Usages</legend>
        <div className="grid grid-cols-2 gap-x-3">
          {USAGES.map((u) => <CaseACocher key={u.code} nom="usages" valeur={u.code} libelle={u.libelle} defaultChecked={usages.includes(u.code)} />)}
        </div>
      </fieldset>

      <Selection libelle="Finition" nom="finition" defaultValue={v('finition', produit.finition ?? '')} erreur={e.finition}>
        <option value="">Non précisée</option>
        {FINITIONS.map((f) => <option key={f} value={f}>{f[0]!.toUpperCase() + f.slice(1)}</option>)}
      </Selection>

      <div className="grid grid-cols-2 gap-3">
        <Champ libelle={`Rendement (m²/${type === 'enduit' ? 'kg par passe' : 'L par couche'})`} nom="rendement_m2_par_unite" inputMode="decimal"
          defaultValue={v('rendement_m2_par_unite', num(produit.rendement_m2_par_unite))} erreur={e.rendement_m2_par_unite}
          aide="Celui de la fiche technique. Vide : fourchette indicative des réglages." />
        <Champ libelle="Couches recommandées" nom="couches_recommandees" inputMode="numeric"
          defaultValue={v('couches_recommandees', produit.couches_recommandees === null ? '' : String(produit.couches_recommandees))} erreur={e.couches_recommandees} />
      </div>
      <Champ libelle="Séchage avant recouvrement (h)" nom="sechage_recouvrable_h" inputMode="decimal"
        defaultValue={v('sechage_recouvrable_h', num(produit.sechage_recouvrable_h))} erreur={e.sechage_recouvrable_h} />
      <Champ libelle="Fournisseur" nom="fournisseur" defaultValue={v('fournisseur', produit.fournisseur ?? '')} erreur={e.fournisseur} />
      <Champ libelle="Fiche technique (lien)" nom="fiche_technique_url" type="url" inputMode="url" defaultValue={v('fiche_technique_url', produit.fiche_technique_url ?? '')}
        erreur={e.fiche_technique_url} placeholder="https://…" />

      <fieldset className="flex flex-col gap-2 rounded-xl border-2 border-trait bg-white p-3">
        <legend className="px-1 font-semibold">Vérification</legend>
        <p className="text-sm">
          {produit.statut_verification === 'verifie'
            ? `Vérifié le ${produit.verifie_le ?? '?'} (${produit.source_verification ?? 'source non indiquée'}). Une modification sans nouvelle confirmation le repasse « À VÉRIFIER ».`
            : produit.statut_verification === 'fictif' ? 'Exemple FICTIF : remplacez-le par un vrai produit.' : 'Valeurs À VÉRIFIER sur la fiche technique du fabricant.'}
        </p>
        <CaseACocher nom="confirme" libelle="J’ai vérifié ces valeurs sur la fiche technique" checked={confirme} onChange={(ev) => setConfirme(ev.target.checked)} />
        {confirme ? (
          <div className="grid grid-cols-2 gap-3">
            <Champ libelle="Vérifié le" nom="verifie_le" type="date" defaultValue={v('verifie_le', '')} erreur={e.verifie_le} />
            <Champ libelle="Source" nom="source_verification" defaultValue={v('source_verification', '')} erreur={e.source_verification}
              placeholder="Fiche technique, fournisseur…" />
          </div>
        ) : null}
      </fieldset>

      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer le produit'}</Bouton>
    </form>
  );
}
