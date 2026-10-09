/**
 * Choix des pots (règle R3 du cadrage, révisée après l'audit métier) : la
 * combinaison qui COUVRE le besoin au COÛT MINIMAL. À coût égal : le moins de
 * reste, puis le moins de pots.
 * Si un prix manque, on ne compare pas des coûts partiels : le MOINS DE POTS
 * parmi les combinaisons dont le reste est inférieur au plus petit format,
 * puis le moins de reste (coût signalé inconnu). Les petits pots coûtant plus
 * cher au litre, « 10 L » vaut mieux que « 5 + 2,5 + 1 + 1 L » pour 9,2 L.
 *
 * Méthode exacte (programmation dynamique) sur les volumes totaux possibles,
 * par pas du PGCD des contenances, jusqu'à besoin + plus grand format.
 */

export type Format = { contenanceMl: number; prixCents: bigint | null; id?: string };

export type LignePots = { contenanceMl: number; nombre: number; prixUnitaireCents: bigint | null; id?: string };

export type Combinaison = {
  pots: LignePots[];
  totalMl: bigint;
  resteMl: bigint;
  nombrePots: number;
  /** null si au moins un format utilisé n'a pas de prix. */
  coutCents: bigint | null;
};

export type ChoixPots = {
  retenue: Combinaison;
  /** Solutions à un seul format, pour comparer (« 10 L seul »). */
  alternatives: Combinaison[];
  /** Vrai si tous les formats ont un prix : le choix est fait au coût. */
  choixAuCout: boolean;
};

export class ErreurPots extends Error {}

/** Au-delà, la saisie est sûrement fausse (10 000 L). */
export const BESOIN_MAX_ML = 10_000_000n;
/** Taille maximale du tableau de calcul (protège le téléphone et le serveur). */
const TAILLE_MAX = 2_000_000;

const pgcd = (a: number, b: number): number => (b === 0 ? a : pgcd(b, a % b));

function composer(formats: Format[], comptes: number[], besoinMl: bigint): Combinaison {
  const pots: LignePots[] = [];
  let total = 0n;
  let cout: bigint | null = 0n;
  let nombre = 0;
  formats.forEach((f, i) => {
    const n = comptes[i] ?? 0;
    if (n === 0) return;
    pots.push({ contenanceMl: f.contenanceMl, nombre: n, prixUnitaireCents: f.prixCents, id: f.id });
    total += BigInt(f.contenanceMl) * BigInt(n);
    nombre += n;
    cout = cout === null || f.prixCents === null ? null : cout + f.prixCents * BigInt(n);
  });
  pots.sort((a, b) => b.contenanceMl - a.contenanceMl);
  return { pots, totalMl: total, resteMl: total - besoinMl, nombrePots: nombre, coutCents: cout };
}

export function choisirPots(besoinMl: bigint, formatsBruts: Format[]): ChoixPots {
  if (besoinMl < 0n) throw new ErreurPots('Besoin négatif.');
  if (besoinMl > BESOIN_MAX_ML) throw new ErreurPots('Besoin supérieur à 10 000 L : vérifiez la saisie (surface, rendement).');
  // Formats distincts et valides uniquement.
  const vus = new Set<number>();
  const formats = formatsBruts.filter((f) => {
    if (!Number.isSafeInteger(f.contenanceMl) || f.contenanceMl <= 0 || vus.has(f.contenanceMl)) return false;
    if (f.prixCents !== null && f.prixCents < 0n) throw new ErreurPots('Prix négatif.');
    vus.add(f.contenanceMl);
    return true;
  }).sort((a, b) => a.contenanceMl - b.contenanceMl);
  if (!formats.length) throw new ErreurPots('Aucun format de pot disponible pour ce produit.');

  const choixAuCout = formats.every((f) => f.prixCents !== null);
  if (besoinMl === 0n) {
    return { retenue: composer(formats, [], 0n), alternatives: [], choixAuCout };
  }

  const pas = formats.reduce((g, f) => pgcd(g, f.contenanceMl), 0);
  const plusGrand = formats[formats.length - 1]!.contenanceMl;
  const besoinPas = Number((besoinMl + BigInt(pas) - 1n) / BigInt(pas));
  const borne = besoinPas + plusGrand / pas; // au-delà, un pot de trop serait retirable
  if (borne > TAILLE_MAX) throw new ErreurPots('Formats de pots inhabituels (contenances sans diviseur commun) : vérifiez le catalogue.');
  const tailles = formats.map((f) => f.contenanceMl / pas);
  const prix = formats.map((f) => f.prixCents ?? 0n);

  // meilleur[t] : (coût, nombre de pots) minimal pour un total EXACT de t pas.
  const cout: (bigint | null)[] = new Array(borne + 1).fill(null);
  const nb: number[] = new Array(borne + 1).fill(0);
  const dernier: number[] = new Array(borne + 1).fill(-1);
  cout[0] = 0n;
  for (let t = 1; t <= borne; t += 1) {
    for (let i = 0; i < formats.length; i += 1) {
      const avant = t - tailles[i]!;
      if (avant < 0 || cout[avant] === null) continue;
      const c = choixAuCout ? cout[avant]! + prix[i]! : 0n;
      const n = nb[avant]! + 1;
      if (cout[t] === null || c < cout[t]! || (c === cout[t]! && n < nb[t]!)) {
        cout[t] = c; nb[t] = n; dernier[t] = i;
      }
    }
  }

  let meilleur = -1;
  if (choixAuCout) {
    // Parmi les totaux qui couvrent : coût, puis reste, puis pots.
    for (let t = besoinPas; t <= borne; t += 1) {
      if (cout[t] === null) continue;
      if (meilleur < 0) { meilleur = t; continue; }
      const plusCher = cout[t]! - cout[meilleur]!;
      if (plusCher < 0n || (plusCher === 0n && (t < meilleur || (t === meilleur && nb[t]! < nb[meilleur]!)))) meilleur = t;
    }
  } else {
    // Sans prix (R3 révisée, boucle 2) : parmi TOUTES les combinaisons qui
    // couvrent le besoin, le moins de pots, puis le moins de reste. 13,86 L
    // -> 1 × 15 L et non 10 + 2,5 + 1 + 1 L. Choix indicatif (prix inconnus).
    for (let t = besoinPas; t <= borne; t += 1) {
      if (cout[t] === null) continue;
      if (meilleur < 0 || nb[t]! < nb[meilleur]!) meilleur = t;
    }
  }
  if (meilleur < 0) throw new ErreurPots('Aucune combinaison de pots ne couvre le besoin.');

  const comptes = formats.map(() => 0);
  for (let t = meilleur; t > 0; t -= tailles[dernier[t]!]!) comptes[dernier[t]!]! += 1;
  const retenue = composer(formats, comptes, besoinMl);

  const alternatives = formats.map((f, i) => {
    const n = Number((besoinMl + BigInt(f.contenanceMl) - 1n) / BigInt(f.contenanceMl));
    const c = formats.map((_, j) => (j === i ? n : 0));
    return composer(formats, c, besoinMl);
  }).filter((a) => !(a.pots.length === retenue.pots.length && a.pots.every((p, k) => p.contenanceMl === retenue.pots[k]!.contenanceMl && p.nombre === retenue.pots[k]!.nombre)));

  return { retenue, alternatives, choixAuCout };
}
