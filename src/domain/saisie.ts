/**
 * Lecture des saisies du métré, EXACTE (aucun flottant) :
 *   « 4,25 » m -> 4 250 mm ; « 83 » cm -> 830 mm ; « 1,6932 » m² -> 1 693 200 mm².
 * Une précision plus fine que l'unité stockée est refusée (pas d'arrondi caché).
 */

/** Décimal positif « 1 234,56 » -> entier × 10^decimales, ou null si invalide ou trop précis. */
export function lireDecimal(saisie: string, decimales: number): bigint | null {
  const t = saisie.replace(/[\s  ]/g, '');
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(t);
  if (!m) return null;
  const dec = m[2] ?? '';
  if (dec.replace(/0+$/, '').length > decimales) return null;
  return BigInt(m[1]!) * 10n ** BigInt(decimales) + BigInt((dec + '0'.repeat(decimales)).slice(0, decimales) || '0');
}

export type UniteLongueur = 'm' | 'cm';

/**
 * Longueur en mm. Unité explicite possible (« 83 cm », « 2,04 m ») ; sinon
 * l'unité du champ. Précision : le millimètre.
 */
export function lireLongueurMm(saisie: string, uniteParDefaut: UniteLongueur): number | null {
  const t = saisie.trim().toLowerCase();
  const m = /^(.*?)\s*(mm|cm|m)?$/.exec(t);
  if (!m || !m[1]) return null;
  const unite = (m[2] ?? uniteParDefaut) as UniteLongueur | 'mm';
  const v = lireDecimal(m[1], unite === 'm' ? 3 : unite === 'cm' ? 1 : 0);
  if (v === null) return null;
  return Number(v); // m × 1000 (3 déc.) = mm ; cm × 10 (1 déc.) = mm ; mm
}

/** Surface en m² (jusqu'à 6 décimales) -> mm². */
export function lireSurfaceMm2(saisie: string): number | null {
  const v = lireDecimal(saisie.replace(/m²|m2/i, ''), 6);
  return v === null || v > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(v);
}

/** Quantité décimale (4 décimales) -> × 10 000. */
export function lireQuantiteE4(saisie: string): number | null {
  const v = lireDecimal(saisie, 4);
  return v === null || v > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(v);
}

/** mm -> « 4,25 » (m) ou « 83 » (cm) pour réafficher une saisie. */
export function longueurVersSaisie(mm: number | null | undefined, unite: UniteLongueur): string {
  if (mm === null || mm === undefined) return '';
  const d = unite === 'm' ? 1000 : 10;
  const entier = Math.trunc(mm / d);
  const reste = mm % d;
  if (reste === 0) return String(entier);
  return `${entier},${String(reste).padStart(unite === 'm' ? 3 : 1, '0').replace(/0+$/, '')}`;
}

/** mm² -> « 1,6932 » (m²). */
export function surfaceVersSaisie(mm2: number | null | undefined): string {
  if (mm2 === null || mm2 === undefined) return '';
  const entier = Math.trunc(mm2 / 1_000_000);
  const reste = mm2 % 1_000_000;
  return reste === 0 ? String(entier) : `${entier},${String(reste).padStart(6, '0').replace(/0+$/, '')}`;
}

/** × 10 000 -> « 14,5 ». */
export function quantiteVersSaisie(e4: number | null | undefined): string {
  if (e4 === null || e4 === undefined) return '';
  const entier = Math.trunc(e4 / 10_000);
  const reste = e4 % 10_000;
  return reste === 0 ? String(entier) : `${entier},${String(reste).padStart(4, '0').replace(/0+$/, '')}`;
}
