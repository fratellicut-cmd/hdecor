import { z } from 'zod';
import { FINITIONS, TYPES, USAGES } from '@/domain/catalogue';
import { lireDecimal } from '@/domain/saisie';
import { caseACocher, dateFacultative, montantFacultatif, montantObligatoire, texteFacultatif, texteObligatoire } from './champs';

const vide = (v: unknown) => typeof v !== 'string' || v.trim() === '';

/** Décimal saisi (« 10,5 ») -> texte exact « 10.50 » pour une colonne numeric, ou null si vide. */
const decimalFacultatif = (libelle: string, dec: number, min: bigint, max: bigint) =>
  z.preprocess((v) => (vide(v) ? null : String(v)), z.string().nullable()
    .transform((v, ctx) => {
      if (v === null) return null;
      const n = lireDecimal(v.trim(), dec);
      if (n === null || n < min || n > max) {
        ctx.addIssue({ code: 'custom', message: `${libelle} : nombre invalide (${dec} décimale${dec > 1 ? 's' : ''} au plus).` });
        return z.NEVER;
      }
      const f = 10n ** BigInt(dec);
      return `${n / f}.${(n % f).toString().padStart(dec, '0')}`;
    }));

/** Contenance saisie en L ou kg (« 2,5 ») -> ml ou g entiers. */
export const contenance = z.preprocess((v) => {
  if (vide(v)) return Number.NaN;
  const ml = lireDecimal(String(v).trim().replace(/\s*(l|kg)$/i, ''), 3);
  return ml === null ? Number.NaN : Number(ml);
}, z.number({ error: 'Contenance invalide (exemple : 2,5).' }).int().min(1, { error: 'Contenance invalide.' }).max(100_000, { error: 'Contenance : 100 au maximum.' }));

const codesTypes = TYPES.map((t) => t.code) as [string, ...string[]];
const codesUsages = USAGES.map((u) => u.code) as [string, ...string[]];

export const schemaProduit = z.object({
  marque: texteObligatoire('Marque', 100),
  gamme: texteFacultatif(100),
  reference_fabricant: texteFacultatif(100),
  designation: texteObligatoire('Désignation', 200),
  type: z.enum(codesTypes, { error: 'Choisissez le type de produit.' }),
  usages: z.array(z.enum(codesUsages)).max(6),
  finition: z.preprocess((v) => (vide(v) ? null : v), z.enum(FINITIONS, { error: 'Finition invalide.' }).nullable()),
  unite_mesure: z.enum(['L', 'kg'], { error: 'Unité : L ou kg.' }),
  rendement_m2_par_unite: decimalFacultatif('Rendement', 2, 1n, 999_999n),
  couches_recommandees: z.preprocess((v) => (vide(v) ? null : String(v).trim()),
    z.string().regex(/^[1-5]$/, { error: 'Couches recommandées : de 1 à 5.' }).transform(Number).nullable()),
  sechage_recouvrable_h: decimalFacultatif('Séchage', 1, 0n, 99_999n),
  fournisseur: texteFacultatif(200),
  fiche_technique_url: z.preprocess((v) => (vide(v) ? null : String(v).trim()),
    z.string().max(500).regex(/^https?:\/\/\S+$/i, { error: 'Lien : commençant par http:// ou https://.' }).nullable()),
  // Vérification : case + date + source (la base refuse « vérifié » sans les deux).
  confirme: caseACocher,
  verifie_le: dateFacultative,
  source_verification: texteFacultatif(300),
}).superRefine((v, ctx) => {
  if (v.confirme && !v.verifie_le) ctx.addIssue({ code: 'custom', path: ['verifie_le'], message: 'Date de vérification : obligatoire pour « vérifié ».' });
  if (v.confirme && !v.source_verification) {
    ctx.addIssue({ code: 'custom', path: ['source_verification'], message: 'Source : obligatoire pour « vérifié » (fiche technique, fournisseur…).' });
  }
});

export const schemaFormat = z.object({
  contenance,
  prix_achat_ht_cents: montantFacultatif(10_000_000),
});

export const schemaTeinte = z.object({
  nom: texteObligatoire('Nom', 100),
  marque: texteFacultatif(100),
  code_ral: texteFacultatif(40),
  code_ncs: texteFacultatif(40),
  code_fabricant: texteFacultatif(60),
  apercu_hex: z.preprocess((v) => (vide(v) ? null : String(v).trim().toUpperCase()),
    z.string().regex(/^#[0-9A-F]{6}$/, { error: 'Couleur : code du type #A1B2C3.' }).nullable()),
  confirme: caseACocher,
});

export const UNITES_PRESTATION = { m2: 'm²', ml: 'mètre linéaire', u: 'unité', h: 'heure', forfait: 'forfait' } as const;

export const schemaPrestation = z.object({
  libelle: texteObligatoire('Libellé', 200),
  description: texteFacultatif(2000),
  unite: z.enum(['m2', 'ml', 'u', 'h', 'forfait'], { error: 'Unité invalide.' }),
  prix_unitaire_ht_cents: montantObligatoire(100_000_000),
  taux_tva_bp: z.preprocess((v) => (vide(v) ? Number.NaN : Number(v)), z.number({ error: 'Choisissez le taux de TVA.' }).int().min(0).max(10_000)),
});
