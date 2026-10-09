'use client';

import { useState } from 'react';
import { enregistrerPoste } from '@/app/(app)/chantiers/actions';
import { libelleType } from '@/domain/calculateur';
import { pourcentageVersSaisie } from '@/domain/formats';
import type { TypeProduit } from '@/domain/systemes';
import { SUPPORTS, TYPES_PRODUIT } from '@/lib/validation/chantiers';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { BadgeAVerifier, Champ } from '@/components/ui/Champ';
import { CaseACocher, Selection } from '@/components/ui/Autres';

export const LIBELLES_SUPPORT: Record<string, string> = {
  platre_neuf: 'Plâtre neuf', ancienne_peinture: 'Ancienne peinture', beton: 'Béton', enduit: 'Enduit', bois_brut: 'Bois brut',
  bois_vernis: 'Bois verni', metal: 'Métal', papier_peint: 'Papier peint', carrelage: 'Carrelage', autre: 'Autre',
};

export type PosteSaisi = {
  id?: string; piece_id: string; cible: string; element_id: string | null; support: string; zone_humide: boolean; taches: boolean;
  produit_id: string | null; type_produit: string | null; teinte_id: string | null; finition: string | null; couches: number;
  rendement_force: number | null; marge_perte_bp: number | null; majoration_temps_bp: number; etapes: string[];
};

type Options = {
  pieces: { id: string; nom: string; elements: { id: string; libelle: string }[] }[];
  produits: { id: string; libelle: string; aVerifier: boolean }[];
  teintes: { id: string; nom: string }[];
  etapes: { id: string; libelle: string; aVerifier: boolean }[];
  margeParDefautBp: number;
};

export function FormulairePoste({ chantierId, poste, options }: { chantierId: string; poste: PosteSaisi; options: Options }) {
  const { etat, action, enCours, formRef, garde } = useFormulaire(`poste:${poste.id ?? `nouveau:${chantierId}`}`, enregistrerPoste);
  const e = etat.erreurs ?? {};
  const sv = etat.valeurs;
  const v = (cle: string, defaut: string) => sv?.[cle] ?? defaut;
  const [pieceId, setPieceId] = useState(v('piece_id', poste.piece_id));
  const [cible, setCible] = useState(v('cible', poste.cible));
  const [produitId, setProduitId] = useState(v('produit_id', poste.produit_id ?? ''));
  const elements = options.pieces.find((p) => p.id === pieceId)?.elements ?? [];

  return (
    <form ref={formRef} action={action} onSubmit={garde.surEnvoi} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="chantier_id" value={chantierId} />
      {poste.id ? <input type="hidden" name="id" value={poste.id} /> : null}
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />

      <Selection libelle="Pièce" nom="piece_id" value={pieceId} onChange={(ev) => setPieceId(ev.target.value)} erreur={e.piece_id}>
        <option value="">Choisir…</option>
        {options.pieces.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
      </Selection>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">À peindre</legend>
        <div className="grid grid-cols-3 gap-2">
          {([['murs', 'Murs'], ['plafond', 'Plafond'], ['element', 'Élément']] as const).map(([c, l]) => (
            <label key={c} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 px-2 font-semibold ${cible === c ? 'border-anthracite bg-anthracite text-creme' : 'border-trait bg-white'}`}>
              <input type="radio" name="cible" value={c} defaultChecked={cible === c} onChange={() => setCible(c)} className="sr-only" />
              {l}
            </label>
          ))}
        </div>
        {e.cible ? <p className="text-sm font-semibold text-danger">{e.cible}</p> : null}
      </fieldset>
      {cible === 'element' ? (
        <Selection libelle="Élément" nom="element_id" defaultValue={v('element_id', poste.element_id ?? '')} erreur={e.element_id}>
          <option value="">{elements.length ? 'Choisir…' : 'Aucun élément dans cette pièce'}</option>
          {elements.map((el) => <option key={el.id} value={el.id}>{el.libelle}</option>)}
        </Selection>
      ) : null}

      <Selection libelle="Support" nom="support" defaultValue={v('support', poste.support)} erreur={e.support}>
        {SUPPORTS.map((s) => <option key={s} value={s}>{LIBELLES_SUPPORT[s]}</option>)}
      </Selection>
      <div className="grid grid-cols-2 gap-2">
        <CaseACocher nom="zone_humide" libelle="Pièce humide" defaultChecked={sv ? sv.zone_humide === 'on' : poste.zone_humide} />
        <CaseACocher nom="taches" libelle="Taches (eau, fumée…)" defaultChecked={sv ? sv.taches === 'on' : poste.taches} />
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-semibold">Préparation</legend>
        {options.etapes.map((et) => (
          <CaseACocher key={et.id} nom="etapes" valeur={et.id} defaultChecked={poste.etapes.includes(et.id)}
            libelle={<span className="flex flex-wrap items-center gap-2">{et.libelle}{et.aVerifier ? <BadgeAVerifier /> : null}</span>} />
        ))}
      </fieldset>

      <Selection libelle="Produit du catalogue" nom="produit_id" value={produitId} onChange={(ev) => setProduitId(ev.target.value)} erreur={e.produit_id}>
        <option value="">Aucun (choisir un type ci-dessous)</option>
        {options.produits.map((p) => <option key={p.id} value={p.id}>{p.libelle}{p.aVerifier ? ' (À VÉRIFIER)' : ''}</option>)}
      </Selection>
      {produitId ? null : (
        <Selection libelle="Type de produit" nom="type_produit" defaultValue={v('type_produit', poste.type_produit ?? '')} erreur={e.type_produit}>
          <option value="">Choisir…</option>
          {TYPES_PRODUIT.map((t) => <option key={t} value={t}>{libelleType(t as TypeProduit)}</option>)}
        </Selection>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Selection libelle="Teinte" nom="teinte_id" defaultValue={v('teinte_id', poste.teinte_id ?? '')}>
          <option value="">Non précisée</option>
          {options.teintes.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
        </Selection>
        <Selection libelle="Finition" nom="finition" defaultValue={v('finition', poste.finition ?? '')}>
          <option value="">Non précisée</option>
          <option value="mat">Mat</option>
          <option value="velours">Velours</option>
          <option value="satin">Satin</option>
          <option value="brillant">Brillant</option>
        </Selection>
      </div>
      <Champ libelle="Nombre de couches" nom="couches" inputMode="numeric" defaultValue={v('couches', String(poste.couches))} erreur={e.couches} />

      <details>
        <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">Réglages avancés</summary>
        <div className="mt-2 flex flex-col gap-3">
          <Champ libelle="Rendement forcé (m²/L par couche)" nom="rendement_force" inputMode="decimal" erreur={e.rendement_force}
            defaultValue={v('rendement_force', poste.rendement_force === null ? '' : String(poste.rendement_force).replace('.', ','))}
            aide="Laisser vide : fiche produit, sinon fourchette indicative." />
          <Champ libelle="Marge de perte (%)" nom="marge_perte_bp" inputMode="decimal" erreur={e.marge_perte_bp}
            defaultValue={v('marge_perte_bp', pourcentageVersSaisie(poste.marge_perte_bp))}
            aide={`Laisser vide : valeur des paramètres (${pourcentageVersSaisie(options.margeParDefautBp)} %).`} />
          <Champ libelle="Majoration du temps (%)" nom="majoration_temps_bp" inputMode="decimal" erreur={e.majoration_temps_bp}
            defaultValue={v('majoration_temps_bp', pourcentageVersSaisie(poste.majoration_temps_bp))}
            aide="Grande hauteur, mobilier à déplacer, support abîmé…" />
        </div>
      </details>

      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Calcul…' : 'Enregistrer et calculer'}</Bouton>
    </form>
  );
}
