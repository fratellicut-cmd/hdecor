import { z } from 'zod';
import { lireDecimal, lireQuantiteE4 } from '@/domain/saisie';
import { caseACocher, dateFacultative, entier, montantObligatoire, pourcentage, texteFacultatif, texteObligatoire } from './champs';

export const UNITES_DEVIS = ['m2', 'ml', 'u', 'h', 'forfait', 'L', 'kg'] as const;
export const TYPES_LIGNE = ['ligne', 'section', 'sous_total', 'texte'] as const;
export const DECLENCHEURS = ['signature', 'debut_travaux', 'mi_chantier', 'fin_travaux', 'date'] as const;

const vide = (v: unknown) => typeof v !== 'string' || v.trim() === '';

/** Durée en jours (« 3 », « 0,5 ») : dixièmes au plus, > 0, ≤ 9999,9. */
const dureeFacultative = z.preprocess((v) => {
  if (vide(v)) return null;
  const d = lireDecimal(String(v), 1);
  return d === null ? Number.NaN : Number(d) / 10;
}, z.number({ error: 'Durée invalide (exemple : 3 ou 0,5).' })
  .refine((n) => !Number.isNaN(n), { error: 'Durée invalide (exemple : 3 ou 0,5), un chiffre après la virgule au plus.' })
  .refine((n) => n > 0 && n <= 9999.9, { error: 'Durée : entre 0,1 et 9 999 jours.' }).nullable());

export const schemaNouveauDevis = z.object({
  chantier_id: z.uuid({ error: 'Choisissez un chantier.' }),
  objet: texteFacultatif(200),
  importer_postes: caseACocher,
});

export const schemaEntete = z.object({
  objet: texteFacultatif(200),
  validite_jours: entier(1, 365, 'Validité'),
  date_debut_travaux: dateFacultative,
  delai_debut_texte: texteFacultatif(200),
  duree_estimee_jours: dureeFacultative,
  conditions_paiement: texteFacultatif(1000),
  hors_etablissement: caseACocher,
  remise_globale_bp: pourcentage(0, 10000),
  acompte_pct_bp: pourcentage(0, 10000),
  notes_client: texteFacultatif(2000),
});

/** Quantité (4 décimales au plus) -> quantité × 10 000. */
const quantite = z.preprocess((v) => (vide(v) ? undefined : lireQuantiteE4(String(v)) ?? Number.NaN),
  z.number({ error: 'Quantité obligatoire (exemple : 31,93).' })
    .refine((n) => !Number.isNaN(n), { error: 'Quantité invalide (4 chiffres après la virgule au plus).' })
    .refine((n) => n > 0, { error: 'Quantité : supérieure à 0.' })
    .refine((n) => n <= 1_000_000 * 10_000, { error: 'Quantité trop grande.' }));

const base = z.object({
  designation: texteObligatoire('Désignation', 300),
  description: texteFacultatif(2000),
});

export const schemaLigne = z.discriminatedUnion('type', [
  base.extend({
    type: z.literal('ligne'),
    quantite_e4: quantite,
    unite: z.enum(UNITES_DEVIS, { error: 'Unité invalide.' }),
    prix_unitaire_ht_cents: montantObligatoire(10_000_000_00),
    remise_bp: pourcentage(0, 10000),
    taux_tva_bp: z.preprocess((v) => (vide(v) ? Number.NaN : Number(v)), z.number({ error: 'Choisissez un taux de TVA.' }).int().min(0).max(10000)),
    optionnelle: caseACocher,
  }),
  base.extend({ type: z.literal('section') }),
  base.extend({ type: z.literal('texte') }),
  z.object({ type: z.literal('sous_total'), designation: texteFacultatif(300).transform((v) => v ?? 'Sous-total'), description: z.null().default(null) }),
], { error: 'Type de ligne invalide.' });

export const schemaEcheance = z.object({
  libelle: texteObligatoire('Libellé', 100),
  pourcentage_bp: pourcentage(1, 10000),
  declencheur: z.enum(DECLENCHEURS, { error: 'Choisissez quand l’échéance est due.' }),
  date_prevue: dateFacultative,
}).refine((e) => (e.declencheur === 'date') === (e.date_prevue !== null), {
  error: 'Une date est demandée seulement pour « à une date ».', path: ['date_prevue'],
});

/** Mention « Bon pour accord » exigée (casse et espaces libres). */
export const MENTION_ACCORD = 'Bon pour accord';
const mention = z.preprocess((v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v),
  z.string({ error: 'Écrivez « Bon pour accord ».' })
    .refine((s) => s.toLowerCase() === MENTION_ACCORD.toLowerCase(), { error: 'Écrivez exactement « Bon pour accord ».' }));

export const TAILLE_MAX_SIGNATURE = 400_000;
const signatureImage = z.string({ error: 'Signez dans le cadre.' })
  .startsWith('data:image/png;base64,', { error: 'Signez dans le cadre.' })
  .max(Math.ceil((TAILLE_MAX_SIGNATURE * 4) / 3) + 40, { error: 'Signature trop lourde : effacez et recommencez.' });

export const schemaSignature = z.object({
  nom: texteObligatoire('Nom et prénom', 200).refine((s) => s.length >= 2, { error: 'Nom et prénom : 2 caractères au moins.' }),
  mention,
  image: signatureImage,
  document_sha256: z.string().regex(/^[0-9a-f]{64}$/, { error: 'Document inconnu : rechargez la page.' }),
  lu: z.literal('on', { error: 'Cochez la case pour confirmer avoir lu le devis.' }),
  options: z.array(z.uuid()).max(200).default([]),
});

/** PNG valide (signature binaire et en-tête IHDR), taille et dimensions bornées. */
export function lirePngSignature(dataUrl: string): Uint8Array | null {
  const octets = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (octets.length < 33 || octets.length > TAILLE_MAX_SIGNATURE) return null;
  if (!SIGNATURE.every((b, i) => octets[i] === b)) return null;
  if (octets.toString('ascii', 12, 16) !== 'IHDR') return null;
  const largeur = octets.readUInt32BE(16);
  const hauteur = octets.readUInt32BE(20);
  if (largeur < 50 || hauteur < 20 || largeur > 2000 || hauteur > 1000) return null;
  return new Uint8Array(octets);
}
