import { inflateSync } from 'node:zlib';
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
// Casse, espaces et ponctuation finale (« Bon pour accord. ») tolérés : le clavier du téléphone l'ajoute souvent.
const mention = z.preprocess((v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').replace(/\s*[.!,;]+$/, '') : v),
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

/** Encre minimale d'une signature : assez de pixels tracés, sur une largeur ou une hauteur suffisante. */
export const ENCRE_MIN_PIXELS = 300;
export const ENCRE_MIN_ETENDUE = 40;

export const MESSAGES_TRACE = {
  illisible: 'Signature illisible : effacez et recommencez.',
  vide: 'Signature vide ou trop courte : signez dans le cadre.',
} as const;

export type ResultatPng = { octets: Uint8Array } | { erreur: 'illisible' | 'vide' };

/**
 * Tracé de signature : PNG valide (signature binaire, IHDR, 8 bits, sans
 * entrelacement), taille et dimensions bornées, et ENCRE réelle (un cadre
 * blanc ou un simple point n'est pas une signature). Le PNG est décodé ici
 * (zlib + filtres de lignes) : rien n'est confié au navigateur.
 */
export function lirePngSignature(dataUrl: string): ResultatPng {
  const octets = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (octets.length < 33 || octets.length > TAILLE_MAX_SIGNATURE) return { erreur: 'illisible' };
  if (!SIGNATURE.every((b, i) => octets[i] === b)) return { erreur: 'illisible' };
  if (octets.toString('ascii', 12, 16) !== 'IHDR') return { erreur: 'illisible' };
  const largeur = octets.readUInt32BE(16);
  const hauteur = octets.readUInt32BE(20);
  if (largeur < 50 || hauteur < 20 || largeur > 2000 || hauteur > 1000) return { erreur: 'illisible' };
  const encre = mesurerEncre(octets, largeur, hauteur);
  if (encre === null) return { erreur: 'illisible' };
  if (encre.pixels < ENCRE_MIN_PIXELS || Math.max(encre.largeur, encre.hauteur) < ENCRE_MIN_ETENDUE) return { erreur: 'vide' };
  return { octets: new Uint8Array(octets) };
}

const OCTETS_PAR_PIXEL: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Pixels « encrés » (opaques et foncés) et étendue du tracé ; null si le PNG n'est pas décodable. */
function mesurerEncre(png: Buffer, largeur: number, hauteur: number): { pixels: number; largeur: number; hauteur: number } | null {
  const profondeur = png[24];
  const couleur = png[25]!;
  const entrelace = png[28];
  const bpp = OCTETS_PAR_PIXEL[couleur];
  if (profondeur !== 8 || entrelace !== 0 || !bpp) return null;
  const morceaux: Buffer[] = [];
  for (let i = 8; i + 8 <= png.length;) {
    const n = png.readUInt32BE(i);
    const type = png.toString('ascii', i + 4, i + 8);
    if (i + 12 + n > png.length) return null;
    if (type === 'IDAT') morceaux.push(png.subarray(i + 8, i + 8 + n));
    if (type === 'IEND') break;
    i += 12 + n;
  }
  let brut: Buffer;
  try { brut = inflateSync(Buffer.concat(morceaux), { maxOutputLength: (largeur * bpp + 1) * hauteur }); } catch { return null; }
  const ligne = largeur * bpp;
  if (brut.length !== (ligne + 1) * hauteur) return null;
  const courante = Buffer.alloc(ligne);
  let precedente = Buffer.alloc(ligne);
  let pixels = 0;
  let xMin = largeur, xMax = -1, yMin = hauteur, yMax = -1;
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (ligne + 1)];
    const src = brut.subarray(y * (ligne + 1) + 1, (y + 1) * (ligne + 1));
    for (let x = 0; x < ligne; x++) {
      const a = x >= bpp ? courante[x - bpp]! : 0;
      const b = precedente[x]!;
      const c = x >= bpp ? precedente[x - bpp]! : 0;
      let pred = 0;
      if (filtre === 1) pred = a;
      else if (filtre === 2) pred = b;
      else if (filtre === 3) pred = (a + b) >> 1;
      else if (filtre === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filtre !== 0) return null;
      courante[x] = (src[x]! + pred) & 0xff;
    }
    for (let x = 0; x < largeur; x++) {
      const o = x * bpp;
      const gris = couleur === 0 || couleur === 4 ? courante[o]! : (courante[o]! + courante[o + 1]! + courante[o + 2]!) / 3;
      const alpha = couleur === 4 ? courante[o + 1]! : couleur === 6 ? courante[o + 3]! : 255;
      if (alpha > 64 && gris < 160) {
        pixels++;
        if (x < xMin) xMin = x; if (x > xMax) xMax = x; if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      }
    }
    precedente = Buffer.from(courante);
  }
  return { pixels, largeur: xMax < 0 ? 0 : xMax - xMin + 1, hauteur: yMax < 0 ? 0 : yMax - yMin + 1 };
}
