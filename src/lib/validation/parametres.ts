import { z } from 'zod';
import {
  caseACocher, dateFacultative, entier, montantFacultatif, montantObligatoire, pourcentage, pourcentageFacultatif, texteFacultatif, texteObligatoire,
} from './champs';
import { bicValide, ibanValide, normaliserIban, normaliserSiret, siretValide, tvaIntraFrValide } from './identifiants';

export const schemaEntreprise = z.object({
  raison_sociale: texteObligatoire('Raison sociale'),
  forme_juridique: texteObligatoire('Forme juridique', 40),
  nom_dirigeant: texteFacultatif(),
  siret: texteFacultatif(20).refine((v) => v === null || siretValide(v), { error: 'SIRET invalide : vérifiez les 14 chiffres.' })
    .transform((v) => (v === null ? null : normaliserSiret(v))),
  immatriculation: texteFacultatif(120),
  adresse_ligne1: texteFacultatif(),
  adresse_ligne2: texteFacultatif(),
  code_postal: texteFacultatif(5).refine((v) => v === null || /^\d{5}$/.test(v), { error: 'Code postal : 5 chiffres.' }),
  ville: texteFacultatif(100),
  telephone: texteFacultatif(30).refine((v) => v === null || /^[+\d][\d\s.]{8,}$/.test(v), { error: 'Numéro de téléphone invalide.' }),
  email: texteFacultatif(200).refine((v) => v === null || z.email().safeParse(v).success, { error: 'Adresse email invalide.' }),
  iban: texteFacultatif(50).refine((v) => v === null || ibanValide(v), { error: 'IBAN invalide : vérifiez la saisie.' })
    .transform((v) => (v === null ? null : normaliserIban(v))),
  bic: texteFacultatif(15).refine((v) => v === null || bicValide(v), { error: 'BIC invalide (8 ou 11 caractères).' })
    .transform((v) => (v === null ? null : v.replace(/\s/g, '').toUpperCase())),
});

export const schemaFiscal = z.object({
  regime_tva: z.enum(['franchise', 'assujetti'], { error: 'Choisissez le régime de TVA.' }),
  mention_franchise: texteObligatoire('Mention de franchise', 300),
  mention_franchise_confirmee: caseACocher,
  numero_tva_intra: texteFacultatif(20).refine((v) => v === null || tvaIntraFrValide(v), { error: 'Numéro de TVA intracommunautaire invalide.' })
    .transform((v) => (v === null ? null : v.replace(/\s/g, '').toUpperCase())),
  seuil_ca_micro_cents: montantFacultatif(),
  seuil_franchise_tva_cents: montantFacultatif(),
  seuils_confirmes: caseACocher,
  seuil_alerte_1_bp: pourcentage(0, 10000),
  seuil_alerte_2_bp: pourcentage(0, 10000),
}).refine((v) => v.seuil_alerte_1_bp <= v.seuil_alerte_2_bp, {
  error: 'Le premier palier d’alerte doit être inférieur ou égal au second.',
  path: ['seuil_alerte_1_bp'],
}).refine((v) => !v.seuils_confirmes || (v.seuil_ca_micro_cents !== null && v.seuil_franchise_tva_cents !== null), {
  error: 'Saisissez les deux seuils avant de les confirmer.',
  path: ['seuils_confirmes'],
});

/** Valeurs par défaut susceptibles d'être « À VÉRIFIER » (clés = colonnes). */
export const VALEURS_VERIFIABLES = [
  'delai_paiement_jours', 'delai_paiement_max_jours', 'indemnite_recouvrement_cents',
  'escompte_texte', 'validite_devis_jours', 'acompte_pct_defaut_bp', 'taux_penalites_bp',
] as const;

export const schemaConditions = z.object({
  delai_paiement_jours: entier(0, 365, 'Délai de paiement'),
  delai_paiement_max_jours: entier(0, 365, 'Délai maximal'),
  taux_penalites_bp: pourcentageFacultatif(0, 10000),
  indemnite_recouvrement_cents: montantObligatoire(100_000),
  escompte_texte: texteObligatoire('Conditions d’escompte', 300),
  validite_devis_jours: entier(1, 365, 'Validité des devis'),
  acompte_pct_defaut_bp: pourcentage(0, 10000),
  marge_perte_bp: pourcentage(0, 5000),
  coef_marge_bp: pourcentage(10000, 50000),
  taux_horaire_cents: montantFacultatif(1_000_000),
  relance_devis_active: caseACocher,
  relance_devis_jours: entier(1, 90, 'Délai de relance'),
  confirmes: z.array(z.enum(VALEURS_VERIFIABLES)),
}).refine((v) => v.delai_paiement_jours <= v.delai_paiement_max_jours, {
  error: 'Le délai de paiement dépasse le délai maximal saisi.',
  path: ['delai_paiement_jours'],
});

export const schemaMentions = z.object({
  mediateur_nom: texteFacultatif(200),
  mediateur_coordonnees: texteFacultatif(500),
  mediateur_site: texteFacultatif(300).refine((v) => v === null || /^https:\/\/[^\s]+$/.test(v), { error: 'Adresse du site : https://…' }),
  mentions_pied: texteFacultatif(1000),
  avis_google_url: texteFacultatif(500).refine((v) => v === null || /^https:\/\/[^\s]+$/.test(v), { error: 'Lien : https://…' }),
});

export const schemaAssurance = z.object({
  type: z.enum(['decennale', 'rc_pro'], { error: 'Choisissez le type d’assurance.' }),
  assureur: texteObligatoire('Assureur'),
  numero_contrat: texteObligatoire('Numéro de contrat', 80),
  debut: z.iso.date({ error: 'Date de début invalide.' }),
  fin: dateFacultative,
  zone_couverte: texteObligatoire('Zone géographique couverte', 300),
}).refine((v) => v.fin === null || v.fin >= v.debut, { error: 'La fin doit suivre le début.', path: ['fin'] });

/** FormData -> objet simple (les cases « confirmes » deviennent un tableau). */
export function lireFormulaire(formData: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith('$')) continue;
    if (k === 'confirmes') (o.confirmes = (o.confirmes as string[] | undefined) ?? []).push(String(v));
    else o[k] = v;
  }
  if (!('confirmes' in o)) o.confirmes = [];
  return o;
}
