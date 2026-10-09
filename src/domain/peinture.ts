/**
 * Quantité de produit (règle R2 du cadrage), en décimal EXACT :
 *   quantité = surface ÷ (rendement × coefficient de support) × couches × (1 + marge de perte)
 * La fraction exacte est conservée ; on en tire :
 *   - la valeur à 4 décimales (7,0239 L), arrondie au demi supérieur ;
 *   - le volume à COUVRIR en ml (ou g), arrondi au ml supérieur : les pots
 *     choisis couvrent toujours le besoin réel, jamais un besoin arrondi à la baisse.
 */

export type Fraction = { num: bigint; den: bigint };

export type EntreeQuantite = {
  surfaceMm2: bigint;
  /** Rendement par couche en centièmes de m² par litre (ou kg) : 10 m²/L -> 1000. */
  rendementCentiemes: number;
  /** Coefficient de rendement du support en points de base : 1,00 -> 10 000. */
  coefSupportBp: number;
  couches: number;
  /** Marge de perte en points de base : 10 % -> 1 000. */
  margePerteBp: number;
};

export type Quantite = {
  exacte: Fraction;
  /** Litres (ou kg) × 10 000, demi supérieur : 7,0239 L -> 70 239n. */
  dixMilliemes: bigint;
  /** Litres (ou kg) × 100 pour l'affichage, arrondi UNE fois depuis la valeur exacte (pas de double arrondi). */
  centiemes: bigint;
  /** Volume à couvrir en ml (ou g), arrondi au supérieur. */
  aCouvrirMl: bigint;
};

export class ErreurCalcul extends Error {}

const entier = (v: number, libelle: string, min: number, max: number) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) {
    throw new ErreurCalcul(`${libelle} : valeur entière entre ${min} et ${max} attendue (reçu ${v}).`);
  }
  return BigInt(v);
};

export function calculerQuantite(e: EntreeQuantite): Quantite {
  if (e.surfaceMm2 < 0n) throw new ErreurCalcul('Surface négative.');
  const rendement = entier(e.rendementCentiemes, 'Rendement', 1, 1_000_000);
  const coef = entier(e.coefSupportBp, 'Coefficient de support', 1, 100_000);
  const couches = entier(e.couches, 'Nombre de couches', 1, 10);
  const marge = entier(e.margePerteBp, 'Marge de perte', 0, 10_000);

  // S/1e6 ÷ (r/100 × c/1e4) × k × (1e4 + m)/1e4  =  S × 100 × k × (1e4 + m) / (1e6 × r × c)
  const num = e.surfaceMm2 * 100n * couches * (10_000n + marge);
  const den = 1_000_000n * rendement * coef;
  return quantiteDepuisFraction({ num, den });
}

/** Somme exacte de fractions (liste d'achat : un même produit sur plusieurs postes). */
export function additionner(a: Fraction, b: Fraction): Fraction {
  const num = a.num * b.den + b.num * a.den;
  const den = a.den * b.den;
  const p = pgcd(num, den);
  return { num: num / p, den: den / p };
}

export const FRACTION_NULLE: Fraction = { num: 0n, den: 1n };

export function pgcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x || 1n;
}

export function quantiteDepuisFraction(f: Fraction): Quantite {
  return {
    exacte: f,
    dixMilliemes: (f.num * 10_000n * 2n + f.den) / (2n * f.den),
    centiemes: (f.num * 100n * 2n + f.den) / (2n * f.den),
    aCouvrirMl: (f.num * 1_000n + f.den - 1n) / f.den,
  };
}

/** Quantité affichée à 2 décimales : « 7,02 ». */
export function formaterQuantiteCourte(q: Quantite): string {
  return `${q.centiemes / 100n},${(q.centiemes % 100n).toString().padStart(2, '0')}`;
}

/** « 7,0239 » (4 décimales) à partir des dix-millièmes ; 2 décimales : voir formaterQuantiteCourte. */
export function formaterQuantite(dixMilliemes: bigint, decimales: 2 | 4 = 2): string {
  const v = decimales === 4 ? dixMilliemes : (dixMilliemes + 50n) / 100n;
  const facteur = decimales === 4 ? 10_000n : 100n;
  return `${v / facteur},${(v % facteur).toString().padStart(decimales, '0')}`;
}

/** Contenance en ml -> « 2,5 L » ; en g -> « 2,5 kg ». */
export function formaterContenance(ml: number, unite: 'L' | 'kg' = 'L'): string {
  const entierPart = Math.trunc(ml / 1000);
  const reste = ml % 1000;
  const dec = reste === 0 ? '' : `,${String(reste).padStart(3, '0').replace(/0+$/, '')}`;
  return `${entierPart}${dec} ${unite}`;
}
