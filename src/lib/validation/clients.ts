import { z } from 'zod';
import { texteFacultatif, texteObligatoire } from './champs';
import { normaliserSiret, siretValide, tvaIntraFrValide } from './identifiants';

export const TYPES_CLIENT = ['particulier', 'professionnel'] as const;
export const CIVILITES = ['Mme', 'M.'] as const;

export const schemaClient = z.object({
  type: z.enum(TYPES_CLIENT, { error: 'Choisissez particulier ou professionnel.' }),
  civilite: z.preprocess((v) => (v === '' ? null : v), z.enum(CIVILITES, { error: 'Civilité invalide.' }).nullable()),
  nom: texteObligatoire('Nom', 200),
  prenom: texteFacultatif(100),
  raison_sociale: texteFacultatif(200),
  siret: texteFacultatif(20).refine((v) => v === null || siretValide(v), { error: 'SIRET invalide : vérifiez les 14 chiffres.' })
    .transform((v) => (v === null ? null : normaliserSiret(v))),
  tva_intra: texteFacultatif(20).refine((v) => v === null || tvaIntraFrValide(v), { error: 'Numéro de TVA intracommunautaire invalide.' })
    .transform((v) => (v === null ? null : v.replace(/\s/g, '').toUpperCase())),
  email: texteFacultatif(200).refine((v) => v === null || z.email().safeParse(v).success, { error: 'Adresse email invalide.' }),
  telephone: texteFacultatif(30).refine((v) => v === null || /^[+\d][\d\s.]{8,}$/.test(v), { error: 'Numéro de téléphone invalide.' }),
  fact_ligne1: texteFacultatif(),
  fact_ligne2: texteFacultatif(),
  fact_code_postal: texteFacultatif(10).refine((v) => v === null || /^\d{5}$/.test(v), { error: 'Code postal : 5 chiffres.' }),
  fact_ville: texteFacultatif(100),
  notes: texteFacultatif(2000),
  source: texteFacultatif(100),
}).refine((v) => v.type === 'particulier' || v.raison_sociale !== null, {
  error: 'Raison sociale obligatoire pour un professionnel.',
  path: ['raison_sociale'],
}).transform((v) => (v.type === 'particulier'
  // Un particulier n'a ni raison sociale, ni SIRET, ni TVA : on n'enregistre
  // pas des valeurs restées dans des champs masqués.
  ? { ...v, raison_sociale: null, siret: null, tva_intra: null }
  : v));

export type SaisieClient = z.infer<typeof schemaClient>;

/** Filtres de la liste (paramètres d'URL), toujours bornés. */
export const schemaFiltresClients = z.object({
  q: z.preprocess((v) => (typeof v === 'string' ? v.slice(0, 100) : ''), z.string()),
  type: z.preprocess((v) => (v === '' ? undefined : v), z.enum(TYPES_CLIENT).optional().catch(undefined)),
  anonymises: z.preprocess((v) => v === '1', z.boolean()),
  page: z.preprocess((v) => (typeof v === 'string' && /^\d{1,4}$/.test(v) ? Number(v) : 1), z.number().int().min(1).max(1000)),
});
