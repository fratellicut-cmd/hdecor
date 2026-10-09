/**
 * Temps de main-d'œuvre, coûts et prix de vente d'un poste de travaux.
 * Argent en centimes entiers (BigInt) ; arrondi au demi supérieur (R4, R10 :
 * méthode À FAIRE VALIDER PAR LE COMPTABLE).
 */

import { ErreurCalcul } from './peinture';

/** Arrondi au demi supérieur de num / den (num, den ≥ 0). */
export function arrondi(num: bigint, den: bigint): bigint {
  if (den <= 0n || num < 0n) throw new ErreurCalcul('Arrondi : valeurs positives attendues.');
  return (2n * num + den) / (2n * den);
}

/** Nombre décimal saisi en base (numeric) -> centièmes entiers, sans flottant cumulé. */
export function centiemes(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  // Les colonnes numeric(…, 2) arrivent en nombre JSON : toFixed(2) redonne
  // leur écriture décimale exacte (2 décimales au plus). Conversion seulement :
  // aucun calcul n'est fait en flottant.
  const s = typeof v === 'number' ? v.toFixed(2) : v.trim();
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) throw new ErreurCalcul(`Nombre décimal invalide : ${v}`);
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export type EntreeTemps = {
  surfaceMm2: bigint;
  /** Minutes par m² et par couche (centièmes : 0,15 min -> 15), null si inconnu. */
  minutesParM2CoucheCentiemes: number | null;
  couches: number;
  /** Minutes par m² de chaque étape de préparation cochée (centièmes). */
  preparationsCentiemes: number[];
  /** Majoration (hauteur, mobilier, état du support) en points de base : 20 % -> 2 000. */
  majorationBp: number;
};

export type Temps = { minutes: bigint; complet: boolean };

/**
 * minutes = surface (m²) × (min/m²/couche × couches + Σ min/m² des préparations) × (1 + majoration)
 * Arrondi à la minute (demi supérieur). « complet » est faux si le temps de
 * finition n'est pas renseigné (le total ne compte alors que la préparation).
 */
export function calculerTemps(e: EntreeTemps): Temps {
  if (e.surfaceMm2 < 0n) throw new ErreurCalcul('Surface négative.');
  if (!Number.isSafeInteger(e.majorationBp) || e.majorationBp < 0 || e.majorationBp > 50_000) {
    throw new ErreurCalcul('Majoration de temps invalide.');
  }
  const finition = e.minutesParM2CoucheCentiemes === null ? 0n : BigInt(e.minutesParM2CoucheCentiemes) * BigInt(e.couches);
  const prepa = e.preparationsCentiemes.reduce((a, p) => a + BigInt(p), 0n);
  // S/1e6 × (centièmes/100) × (1e4 + maj)/1e4
  const num = e.surfaceMm2 * (finition + prepa) * (10_000n + BigInt(e.majorationBp));
  const den = 1_000_000n * 100n * 10_000n;
  return { minutes: arrondi(num, den), complet: e.minutesParM2CoucheCentiemes !== null };
}

/** Coût de main-d'œuvre : minutes × taux horaire / 60, au centime (demi supérieur). */
export function coutMainOeuvre(minutes: bigint, tauxHoraireCents: bigint): bigint {
  return arrondi(minutes * tauxHoraireCents, 60n);
}

/** Prix de vente de la matière : coût × coefficient de marge (100 % = prix coûtant). */
export function prixVenteMatiere(coutCents: bigint, coefMargeBp: number): bigint {
  return arrondi(coutCents * BigInt(coefMargeBp), 10_000n);
}

/** Coût d'un consommable : forfait par chantier, ou prix par m² × surface. */
export function coutConsommable(mode: 'par_chantier' | 'par_m2', prixCents: bigint, surfaceMm2: bigint): bigint {
  return mode === 'par_chantier' ? prixCents : arrondi(prixCents * surfaceMm2, 1_000_000n);
}

/** « 2 h 05 » */
export function formaterDuree(minutes: bigint): string {
  const h = minutes / 60n;
  const m = minutes % 60n;
  return h === 0n ? `${m} min` : `${h} h ${m.toString().padStart(2, '0')}`;
}
