import { describe, expect, it } from 'vitest';
import { schemaAssurance, schemaConditions, schemaEntreprise, schemaFiscal } from '../validation/parametres';

const entreprise = { raison_sociale: "H'DECOR", forme_juridique: 'EI' };

describe('schemaEntreprise', () => {
  it('normalise SIRET et IBAN, vide -> null', () => {
    const r = schemaEntreprise.parse({ ...entreprise, siret: '732 829 320 00074', iban: 'fr76 3000 6000 0112 3456 7890 189', ville: '  ' });
    expect(r.siret).toBe('73282932000074');
    expect(r.iban).toBe('FR7630006000011234567890189');
    expect(r.ville).toBeNull();
  });
  it('refuse un SIRET à clé fausse, un IBAN faux, un code postal à 4 chiffres', () => {
    const r = schemaEntreprise.safeParse({ ...entreprise, siret: '73282932000075', iban: 'FR7630006000011234567890188', code_postal: '5729' });
    expect(r.success).toBe(false);
    const champs = r.error!.issues.map((i) => i.path[0]);
    expect(champs).toEqual(expect.arrayContaining(['siret', 'iban', 'code_postal']));
  });
  it('raison sociale obligatoire', () => {
    expect(schemaEntreprise.safeParse({ raison_sociale: ' ', forme_juridique: 'EI' }).success).toBe(false);
  });
});

describe('schemaFiscal', () => {
  const base = { regime_tva: 'franchise', mention_franchise: 'TVA non applicable', seuil_alerte_1_bp: '80', seuil_alerte_2_bp: '95' };
  it('paliers en points de base, seuils en centimes', () => {
    const r = schemaFiscal.parse({ ...base, seuil_ca_micro_cents: '77 700', seuil_franchise_tva_cents: '37 500,50', seuils_confirmes: 'on' });
    expect(r.seuil_alerte_1_bp).toBe(8000);
    expect(r.seuil_ca_micro_cents).toBe(7_770_000);
    expect(r.seuil_franchise_tva_cents).toBe(3_750_050);
    expect(r.seuils_confirmes).toBe(true);
  });
  it('refuse des paliers inversés et une confirmation sans seuils', () => {
    expect(schemaFiscal.safeParse({ ...base, seuil_alerte_1_bp: '96' }).success).toBe(false);
    expect(schemaFiscal.safeParse({ ...base, seuils_confirmes: 'on' }).success).toBe(false);
  });
});

describe('schemaConditions', () => {
  const base = {
    delai_paiement_jours: '30', delai_paiement_max_jours: '60', indemnite_recouvrement_cents: '40',
    escompte_texte: 'Pas d’escompte.', validite_devis_jours: '30', acompte_pct_defaut_bp: '30',
    marge_perte_bp: '10', coef_marge_bp: '100', relance_devis_jours: '7', duree_conservation_prospects_mois: '36', confirmes: [],
  };
  it('convertit et accepte une saisie complète', () => {
    const r = schemaConditions.parse({ ...base, taux_penalites_bp: '12,5', taux_horaire_cents: '45', confirmes: ['taux_penalites_bp'] });
    expect(r.taux_penalites_bp).toBe(1250);
    expect(r.indemnite_recouvrement_cents).toBe(4000);
    expect(r.taux_horaire_cents).toBe(4500);
    expect(r.coef_marge_bp).toBe(10000);
    expect(r.relance_devis_active).toBe(false);
  });
  it('refuse un délai supérieur au maximum et une clé de confirmation inconnue', () => {
    expect(schemaConditions.safeParse({ ...base, delai_paiement_jours: '90' }).success).toBe(false);
    expect(schemaConditions.safeParse({ ...base, confirmes: ['siret'] }).success).toBe(false);
  });
});

describe('schemaAssurance', () => {
  it('fin avant début refusée', () => {
    expect(schemaAssurance.safeParse({ type: 'decennale', assureur: 'X', numero_contrat: '1', debut: '2026-01-01', fin: '2025-12-31', zone_couverte: 'France' }).success).toBe(false);
  });
});

describe('conservation des prospects', () => {
  const base = {
    delai_paiement_jours: '30', delai_paiement_max_jours: '60', taux_penalites_bp: '', indemnite_recouvrement_cents: '40',
    escompte_texte: 'Aucun escompte.', validite_devis_jours: '30', acompte_pct_defaut_bp: '30',
    marge_perte_bp: '10', coef_marge_bp: '100', relance_devis_jours: '7', confirmes: [],
  };
  it.each(['0', '121', '', '3,5'])('durée %s refusée (1 à 120 mois)', (d) => {
    const r = schemaConditions.safeParse({ ...base, duree_conservation_prospects_mois: d });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['duree_conservation_prospects_mois']);
  });
  it('la durée peut être confirmée', () => {
    const r = schemaConditions.parse({ ...base, duree_conservation_prospects_mois: '24', confirmes: ['duree_conservation_prospects_mois'] });
    expect(r.duree_conservation_prospects_mois).toBe(24);
    expect(r.confirmes).toEqual(['duree_conservation_prospects_mois']);
  });
});
