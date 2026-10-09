'use client';

import type { ReactNode } from 'react';
import {
  ajouterConsommable, enregistrerCoefficient, enregistrerEtape, enregistrerMetre, enregistrerReferentiel,
} from '@/app/(app)/parametres/calcul/actions';
import type { EtatFormulaire } from '@/lib/etat-formulaire';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from './RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { BadgeAVerifier, Champ } from '@/components/ui/Champ';
import { CaseACocher, Selection } from '@/components/ui/Autres';

type Action = (e: EtatFormulaire, f: FormData) => Promise<EtatFormulaire>;

function Ligne({ action, titre, aVerifier, caches, children }: {
  action: Action; titre: string; aVerifier: boolean; caches: Record<string, string>; children: (e: Record<string, string>, v: Record<string, string>) => ReactNode;
}) {
  const { etat, action: envoyer, enCours, formRef, garde, surEnvoi } = useFormulaire(null, action);
  return (
    <form ref={formRef} action={envoyer} onSubmit={surEnvoi} className="flex flex-col gap-2 border-t border-trait py-3 first:border-t-0" noValidate>
      {Object.entries(caches).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <p className="flex flex-wrap items-center gap-2 font-semibold">{titre}{aVerifier ? <BadgeAVerifier /> : null}</p>
      <RetourFormulaire etat={etat} />
      {children(etat.erreurs ?? {}, etat.valeurs ?? {})}
      {/* Jamais pré-cochée : une valeur confirmée puis modifiée redevient À VÉRIFIER, sauf nouvelle confirmation. */}
      <CaseACocher nom="confirme" libelle={aVerifier ? 'Valeur confirmée (fiche technique, comptable ou expérience)' : 'Confirmer aussi la nouvelle valeur'} />
      <RappelEnvoi garde={garde} etat={{}} sansBrouillon />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</Bouton>
    </form>
  );
}

export function LigneReferentiel({ type, libelle, min, max, minutes, sechage, aVerifier }: {
  type: string; libelle: string; min: string; max: string; minutes: string; sechage: string; aVerifier: boolean;
}) {
  // Enduit : au kg et par passe (la consommation dépend du produit : lissage, rebouchage…).
  const u = type === 'enduit' ? 'kg par passe' : 'L';
  return (
    <Ligne action={enregistrerReferentiel} titre={libelle} aVerifier={aVerifier} caches={{ type_produit: type }}>
      {(e, v) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Champ libelle={`Rendement mini (m²/${u})`} nom="rendement_min" inputMode="decimal" defaultValue={v.rendement_min ?? min} erreur={e.rendement_min} />
            <Champ libelle={`Rendement maxi (m²/${u})`} nom="rendement_max" inputMode="decimal" defaultValue={v.rendement_max ?? max} erreur={e.rendement_max} />
          </div>
          {min === '' && max === '' && !v.rendement_min ? <p className="text-sm text-encre-douce">Pas de valeur de départ : renseignez-la d’après la fiche technique. Vides : quantité non calculée (signalé).</p> : null}
          <div className="grid grid-cols-2 gap-3">
            <Champ libelle="Temps de pose (min/m²/couche)" nom="minutes_par_m2_couche" inputMode="decimal" defaultValue={v.minutes_par_m2_couche ?? minutes}
              erreur={e.minutes_par_m2_couche} aide="Conversion : 60 ÷ m² posés par heure (15 m²/h -> 4). Vide : non compté (signalé)." />
            <Champ libelle="Séchage avant recouvrement (h)" nom="sechage_recouvrable_h" inputMode="decimal" defaultValue={v.sechage_recouvrable_h ?? sechage}
              erreur={e.sechage_recouvrable_h} aide="Vide : non compté (signalé)." />
          </div>
        </>
      )}
    </Ligne>
  );
}

export function LigneCoefficient({ support, libelle, pourcentage, aVerifier }: { support: string; libelle: string; pourcentage: string; aVerifier: boolean }) {
  return (
    <Ligne action={enregistrerCoefficient} titre={libelle} aVerifier={aVerifier} caches={{ support }}>
      {(e, v) => (
        <Champ libelle="Rendement retenu (% du rendement indiqué)" nom="coef_rendement_bp" inputMode="decimal" defaultValue={v.coef_rendement_bp ?? pourcentage}
          erreur={e.coef_rendement_bp} aide="Support poreux ou irrégulier : moins de 100 % (ex. 80)." />
      )}
    </Ligne>
  );
}

export function LigneEtape({ id, libelle, minutes, typeProduit, couches, avecMatiere, types, aVerifier }: {
  id: string; libelle: string; minutes: string; typeProduit: string; couches: string; avecMatiere: boolean;
  types: { valeur: string; libelle: string }[]; aVerifier: boolean;
}) {
  return (
    <Ligne action={enregistrerEtape} titre={libelle} aVerifier={aVerifier} caches={{ id }}>
      {(e, v) => (
        <>
          <Champ libelle="Temps (min par m²)" nom="minutes_par_m2" inputMode="decimal" defaultValue={v.minutes_par_m2 ?? minutes} erreur={e.minutes_par_m2} />
          <div className="grid grid-cols-2 gap-3">
            <Selection libelle="Matière (type de produit)" nom="type_produit" defaultValue={v.type_produit ?? typeProduit} erreur={e.type_produit}>
              <option value="">{avecMatiere ? 'Aucune (signalé)' : 'Aucune'}</option>
              {types.map((t) => <option key={t.valeur} value={t.valeur}>{t.libelle}</option>)}
            </Selection>
            <Champ libelle="Couches ou passes" nom="couches" inputMode="numeric" defaultValue={v.couches ?? couches} erreur={e.couches} />
          </div>
        </>
      )}
    </Ligne>
  );
}

export function FormulaireConsommable() {
  const { etat, action: envoyer, enCours, formRef, garde, surEnvoi } = useFormulaire('consommable:nouveau', ajouterConsommable, { viderApresSucces: true });
  const e = etat.erreurs ?? {};
  const v = etat.valeurs ?? {};
  return (
    <form ref={formRef} action={envoyer} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <RetourFormulaire etat={etat} />
      <Champ libelle="Libellé" nom="libelle" defaultValue={v.libelle} erreur={e.libelle} placeholder="Bâches et adhésif, rouleaux…" />
      <div className="grid grid-cols-2 gap-3">
        <Selection libelle="Compté" nom="mode" defaultValue={v.mode ?? 'par_chantier'}>
          <option value="par_chantier">par chantier</option>
          <option value="par_m2">par m² peint</option>
        </Selection>
        <Champ libelle="Prix HT (€)" nom="prix_ht_cents" inputMode="decimal" defaultValue={v.prix_ht_cents} erreur={e.prix_ht_cents} />
      </div>
      <RappelEnvoi garde={garde} etat={{}} />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Ajout…' : 'Ajouter le consommable'}</Bouton>
    </form>
  );
}

export function FormulaireMetre({ porteLargeur, porteHauteur, formats, sacs, hauteurAlerte, heuresParJour, toleranceReste }: {
  porteLargeur: string; porteHauteur: string; formats: string; sacs: string; hauteurAlerte: string; heuresParJour: string; toleranceReste: string;
}) {
  const { etat, action: envoyer, enCours, formRef, garde, surEnvoi } = useFormulaire(null, enregistrerMetre);
  const e = etat.erreurs ?? {};
  const v = etat.valeurs ?? {};
  return (
    <form ref={formRef} action={envoyer} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <RetourFormulaire etat={etat} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Porte : largeur (cm)" nom="porte_largeur_mm" inputMode="decimal" defaultValue={v.porte_largeur_mm ?? porteLargeur} erreur={e.porte_largeur_mm} />
        <Champ libelle="Porte : hauteur (cm)" nom="porte_hauteur_mm" inputMode="decimal" defaultValue={v.porte_hauteur_mm ?? porteHauteur} erreur={e.porte_hauteur_mm} />
      </div>
      <Champ libelle="Formats de pots (L), séparés par « ; »" nom="formats_pots_ml" defaultValue={v.formats_pots_ml ?? formats} erreur={e.formats_pots_ml}
        aide="Utilisés quand aucun produit du catalogue n’est choisi (prix inconnus)." />
      <Champ libelle="Reste toléré quand les prix sont inconnus (%)" nom="tolerance_reste_bp" inputMode="decimal" defaultValue={v.tolerance_reste_bp ?? toleranceReste}
        erreur={e.tolerance_reste_bp} aide="Pots choisis sans prix : le moins de pots possible, avec un reste inférieur au plus petit pot ou à ce pourcentage du besoin." />
      <Champ libelle="Formats de sacs d’enduit (kg), séparés par « ; »" nom="formats_sacs_g" defaultValue={v.formats_sacs_g ?? sacs} erreur={e.formats_sacs_g} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Alerte de hauteur (m)" nom="hauteur_alerte_mm" inputMode="decimal" defaultValue={v.hauteur_alerte_mm ?? hauteurAlerte} erreur={e.hauteur_alerte_mm}
          aide="Au-delà : échafaudage signalé." />
        <Champ libelle="Journée de travail (h)" nom="minutes_par_jour" inputMode="decimal" defaultValue={v.minutes_par_jour ?? heuresParJour} erreur={e.minutes_par_jour}
          aide="Pour l’estimation en jours." />
      </div>
      <RappelEnvoi garde={garde} etat={{}} sansBrouillon />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</Bouton>
    </form>
  );
}
