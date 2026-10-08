'use client';

import { useActionState } from 'react';
import { enregistrerConditions } from '@/app/(app)/parametres/actions';
import { ETAT_INITIAL } from '@/lib/etat-formulaire';
import type { Ligne } from '@/lib/supabase/types';
import { montantVersSaisie, pourcentageVersSaisie } from '@/domain/formats';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher, TexteLong } from '@/components/ui/Autres';
import { RetourFormulaire } from './RetourFormulaire';

type P = Ligne<'parametres_entreprise'>;

export function FormulaireConditions({ p }: { p: P }) {
  const [etat, action, enCours] = useActionState(enregistrerConditions, ETAT_INITIAL);
  const e = etat.erreurs ?? {};
  const sv = etat.valeurs;
  const val = (cle: string, defaut: string) => sv?.[cle] ?? defaut;
  const aVerifier = (cle: string) => p.valeurs_a_verifier.includes(cle);
  const confirmer = (cle: string) =>
    aVerifier(cle) ? <CaseACocher nom="confirmes" valeur={cle} libelle="Valeur confirmée (par moi ou le comptable)" /> : null;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <RetourFormulaire etat={etat} />
      <h3 className="text-lg font-bold">Paiement</h3>
      <Champ libelle="Délai de paiement (jours)" nom="delai_paiement_jours" inputMode="numeric" defaultValue={val('delai_paiement_jours', String(p.delai_paiement_jours))} erreur={e.delai_paiement_jours} aVerifier={aVerifier('delai_paiement_jours')} />
      {confirmer('delai_paiement_jours')}
      <Champ libelle="Délai de paiement maximal autorisé (jours)" nom="delai_paiement_max_jours" inputMode="numeric" defaultValue={val('delai_paiement_max_jours', String(p.delai_paiement_max_jours))} erreur={e.delai_paiement_max_jours} aVerifier={aVerifier('delai_paiement_max_jours')}
        aide="Plafond légal à confirmer avec le comptable. Une facture ne peut pas dépasser ce délai." />
      {confirmer('delai_paiement_max_jours')}
      <Champ libelle="Taux des pénalités de retard (% par an)" nom="taux_penalites_bp" inputMode="decimal" defaultValue={val('taux_penalites_bp', pourcentageVersSaisie(p.taux_penalites_bp))} erreur={e.taux_penalites_bp} aVerifier={aVerifier('taux_penalites_bp')}
        aide="Obligatoire avant la première facture. Aucune valeur par défaut." />
      {confirmer('taux_penalites_bp')}
      <Champ libelle="Indemnité forfaitaire de recouvrement (€)" nom="indemnite_recouvrement_cents" inputMode="decimal" defaultValue={val('indemnite_recouvrement_cents', montantVersSaisie(p.indemnite_recouvrement_cents))} erreur={e.indemnite_recouvrement_cents} aVerifier={aVerifier('indemnite_recouvrement_cents')}
        aide="Concerne les clients professionnels ; mention pour les particuliers à valider par le comptable." />
      {confirmer('indemnite_recouvrement_cents')}
      <TexteLong libelle="Conditions d’escompte" nom="escompte_texte" defaultValue={val('escompte_texte', p.escompte_texte)} erreur={e.escompte_texte} aVerifier={aVerifier('escompte_texte')} />
      {confirmer('escompte_texte')}
      <h3 className="mt-2 text-lg font-bold">Devis</h3>
      <Champ libelle="Durée de validité des devis (jours)" nom="validite_devis_jours" inputMode="numeric" defaultValue={val('validite_devis_jours', String(p.validite_devis_jours))} erreur={e.validite_devis_jours} aVerifier={aVerifier('validite_devis_jours')} />
      {confirmer('validite_devis_jours')}
      <Champ libelle="Acompte par défaut (%)" nom="acompte_pct_defaut_bp" inputMode="decimal" defaultValue={val('acompte_pct_defaut_bp', pourcentageVersSaisie(p.acompte_pct_defaut_bp))} erreur={e.acompte_pct_defaut_bp} aVerifier={aVerifier('acompte_pct_defaut_bp')} />
      {confirmer('acompte_pct_defaut_bp')}
      <CaseACocher nom="relance_devis_active" libelle="Relancer automatiquement les devis non signés" defaultChecked={sv ? sv.relance_devis_active === 'on' : p.relance_devis_active} />
      <Champ libelle="Relance après (jours)" nom="relance_devis_jours" inputMode="numeric" defaultValue={val('relance_devis_jours', String(p.relance_devis_jours))} erreur={e.relance_devis_jours} />
      <h3 className="mt-2 text-lg font-bold">Chiffrage</h3>
      <Champ libelle="Taux horaire de main-d’œuvre (€ HT)" nom="taux_horaire_cents" inputMode="decimal" defaultValue={val('taux_horaire_cents', montantVersSaisie(p.taux_horaire_cents))} erreur={e.taux_horaire_cents} />
      <Champ libelle="Marge de perte sur la peinture (%)" nom="marge_perte_bp" inputMode="decimal" defaultValue={val('marge_perte_bp', pourcentageVersSaisie(p.marge_perte_bp))} erreur={e.marge_perte_bp} />
      <Champ libelle="Coefficient de marge (%)" nom="coef_marge_bp" inputMode="decimal" defaultValue={val('coef_marge_bp', pourcentageVersSaisie(p.coef_marge_bp))} erreur={e.coef_marge_bp}
        aide="100 = prix coûtant ; 130 = coût + 30 %." />
      <h3 className="mt-2 text-lg font-bold">Données personnelles</h3>
      <Champ libelle="Conservation des prospects sans devis ni facture (mois)" nom="duree_conservation_prospects_mois" inputMode="numeric"
        defaultValue={val('duree_conservation_prospects_mois', String(p.duree_conservation_prospects_mois))} erreur={e.duree_conservation_prospects_mois}
        aVerifier={aVerifier('duree_conservation_prospects_mois')}
        aide="Passé ce délai sans activité, la fiche est anonymisée automatiquement (chaque nuit). Durée à faire valider." />
      {confirmer('duree_conservation_prospects_mois')}
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</Bouton>
    </form>
  );
}
