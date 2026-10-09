/**
 * Devis : calcul des totaux (règles R4 à R8 du cadrage), options, acompte,
 * reprise des postes de peinture, comparaison de versions.
 *
 * Tout est en centimes ENTIERS (bigint). La base recalcule la même ventilation
 * (`ventilation_attendue`) et exige l'égalité stricte à l'émission.
 */

import { arrondi } from './chiffrage';
import { mm2EnCentiemesM2 } from './metre';

export type TypeLigne = 'section' | 'ligne' | 'sous_total' | 'texte';
export type Regime = 'franchise' | 'assujetti';

export type LigneDevis = {
  id?: string;
  type: TypeLigne;
  designation: string;
  description?: string | null;
  /** Quantité × 10 000 (4 décimales exactes). */
  quantiteE4: bigint | null;
  unite: string | null;
  prixUnitaireCents: bigint | null;
  /** Remise de ligne, en points de base (10 % -> 1 000). */
  remiseBp: number;
  tauxTvaBp: number | null;
  optionnelle: boolean;
};

export type Ventilation = { taux_bp: number; base_ht_cents: bigint; tva_cents: bigint }[];

export class ErreurDevis extends Error {}

/**
 * R4 : total HT d'une ligne = arrondi demi-supérieur, EN UNE FOIS, de
 * quantité × prix unitaire × (1 − remise). 31,93 m² × 12,50 € = 399,125 -> 399,13 €.
 */
export function totalLigne(quantiteE4: bigint, prixUnitaireCents: bigint, remiseBp: number): bigint {
  if (quantiteE4 < 0n || prixUnitaireCents < 0n) throw new ErreurDevis('Quantité et prix : positifs.');
  if (!Number.isInteger(remiseBp) || remiseBp < 0 || remiseBp > 10_000) throw new ErreurDevis('Remise de ligne : de 0 à 100 %.');
  // (q/1e4) × pu × (1e4 − r)/1e4 = q × pu × (1e4 − r) / 1e8
  return arrondi(quantiteE4 * prixUnitaireCents * BigInt(10_000 - remiseBp), 100_000_000n);
}

/** Lignes chiffrées comptées : fermes, plus les options retenues (par identifiant). */
function lignesComptees(lignes: LigneDevis[], options: Set<string> | 'aucune'): { taux: number; total: bigint }[] {
  return lignes.filter((l) => l.type === 'ligne' && (!l.optionnelle || (options !== 'aucune' && l.id !== undefined && options.has(l.id))))
    .map((l) => {
      if (l.quantiteE4 === null || l.prixUnitaireCents === null || l.tauxTvaBp === null) {
        throw new ErreurDevis(`Ligne « ${l.designation} » incomplète (quantité, prix ou TVA).`);
      }
      return { taux: l.tauxTvaBp, total: totalLigne(l.quantiteE4, l.prixUnitaireCents, l.remiseBp) };
    });
}

/**
 * R5 + R6 + R8 : ventilation par taux, identique à `ventilation_attendue` (SQL).
 *  - remise totale = arrondi demi-supérieur(somme × remise) ;
 *  - remise d'un taux = partie entière(somme du taux × remise totale ÷ somme), puis
 *    les centimes restants un par un aux plus forts restes (à égalité : taux le plus élevé) ;
 *  - TVA du taux = arrondi demi-supérieur(base × taux) ; 0 en franchise.
 * Les taux dont la somme est nulle sont omis (comme en base).
 */
export function ventiler(lignesParTaux: { taux: number; total: bigint }[], remiseGlobaleBp: number, regime: Regime): Ventilation {
  if (!Number.isInteger(remiseGlobaleBp) || remiseGlobaleBp < 0 || remiseGlobaleBp > 10_000) throw new ErreurDevis('Remise globale : de 0 à 100 %.');
  const sommes = new Map<number, bigint>();
  for (const l of lignesParTaux) sommes.set(l.taux, (sommes.get(l.taux) ?? 0n) + l.total);
  const taux = [...sommes.entries()].filter(([, s]) => s > 0n).map(([t, s]) => ({ taux: t, somme: s }));
  const somme = taux.reduce((a, t) => a + t.somme, 0n);
  const remise = somme === 0n ? 0n : arrondi(somme * BigInt(remiseGlobaleBp), 10_000n);
  const parts = taux.map((t) => ({
    ...t,
    remise: somme === 0n ? 0n : (t.somme * remise) / somme,
    reste: somme === 0n ? 0n : (t.somme * remise) % somme,
  }));
  let aRepartir = remise - parts.reduce((a, p) => a + p.remise, 0n);
  [...parts].sort((a, b) => (b.reste > a.reste ? 1 : b.reste < a.reste ? -1 : b.taux - a.taux)).forEach((p) => {
    if (aRepartir > 0n) { p.remise += 1n; aRepartir -= 1n; }
  });
  return parts.sort((a, b) => a.taux - b.taux).map((p) => {
    const base = p.somme - p.remise;
    return { taux_bp: p.taux, base_ht_cents: base, tva_cents: regime === 'franchise' ? 0n : arrondi(base * BigInt(p.taux), 10_000n) };
  });
}

export type TotauxDevis = {
  ventilation: Ventilation;
  totalHtCents: bigint;
  totalTvaCents: bigint;
  totalTtcCents: bigint;
  /** Somme HT des lignes avant remise globale. */
  sommeLignesCents: bigint;
  remiseGlobaleCents: bigint;
  /** Total HT des options (hors remise), pour information. */
  optionsHtCents: bigint;
};

/**
 * Plafond d'un devis (lignes fermes + options) : 10 000 000 € HT. Garde la
 * ventilation en base (bigint) loin du débordement, quelle que soit la remise.
 */
export const TOTAL_MAX_CENTS = 1_000_000_000n;

export function totauxDevis(lignes: LigneDevis[], remiseGlobaleBp: number, regime: Regime, options: Set<string> | 'aucune' = 'aucune'): TotauxDevis {
  if (regime === 'franchise' && lignes.some((l) => l.type === 'ligne' && l.tauxTvaBp !== null && l.tauxTvaBp !== 0)) {
    throw new ErreurDevis('Franchise en base de TVA : toutes les lignes sont à 0 %.');
  }
  const comptees = lignesComptees(lignes, options);
  const ventilation = ventiler(comptees, remiseGlobaleBp, regime);
  const totalHt = ventilation.reduce((a, v) => a + v.base_ht_cents, 0n);
  const totalTva = ventilation.reduce((a, v) => a + v.tva_cents, 0n);
  const sommeLignes = comptees.reduce((a, l) => a + l.total, 0n);
  const optionsHt = lignes.filter((l) => l.type === 'ligne' && l.optionnelle && l.quantiteE4 !== null && l.prixUnitaireCents !== null)
    .reduce((a, l) => a + totalLigne(l.quantiteE4!, l.prixUnitaireCents!, l.remiseBp), 0n);
  if (lignes.filter((l) => l.type === 'ligne' && !l.optionnelle).reduce((a, l) => a + (l.quantiteE4 !== null && l.prixUnitaireCents !== null
    ? totalLigne(l.quantiteE4, l.prixUnitaireCents, l.remiseBp) : 0n), 0n) + optionsHt > TOTAL_MAX_CENTS) {
    throw new ErreurDevis('Devis trop élevé : 10 000 000 € HT au plus (options comprises).');
  }
  return {
    ventilation, totalHtCents: totalHt, totalTvaCents: totalTva, totalTtcCents: totalHt + totalTva,
    sommeLignesCents: sommeLignes, remiseGlobaleCents: sommeLignes - totalHt, optionsHtCents: optionsHt,
  };
}

/** Sous-totaux affichés : somme HT des lignes fermes depuis la section (ou le sous-total) précédent. */
export function sousTotaux(lignes: LigneDevis[]): Map<number, bigint> {
  const res = new Map<number, bigint>();
  let cumul = 0n;
  lignes.forEach((l, i) => {
    if (l.type === 'section') cumul = 0n;
    else if (l.type === 'ligne' && !l.optionnelle && l.quantiteE4 !== null && l.prixUnitaireCents !== null) {
      cumul += totalLigne(l.quantiteE4, l.prixUnitaireCents, l.remiseBp);
    } else if (l.type === 'sous_total') { res.set(i, cumul); cumul = 0n; }
  });
  return res;
}

/**
 * Acompte (R9) : base HT de chaque taux × pourcentage (demi supérieur), puis
 * TVA de chaque taux selon R6. Retourne HT, TVA et TTC.
 */
export function acompte(ventilation: Ventilation, pourcentageBp: number, regime: Regime) {
  if (!Number.isInteger(pourcentageBp) || pourcentageBp < 0 || pourcentageBp > 10_000) throw new ErreurDevis('Acompte : de 0 à 100 %.');
  let ht = 0n;
  let tva = 0n;
  for (const v of ventilation) {
    const base = arrondi(v.base_ht_cents * BigInt(pourcentageBp), 10_000n);
    ht += base;
    tva += regime === 'franchise' ? 0n : arrondi(base * BigInt(v.taux_bp), 10_000n);
  }
  return { htCents: ht, tvaCents: tva, ttcCents: ht + tva };
}

/**
 * Ventilation d'une FACTURE D'ACOMPTE d'échéance, taux par taux :
 *  - base HT = base(cumul k) − base(cumul k−1), avec base(c) = arrondi(base du taux × c) ;
 *  - TVA = arrondi(base × taux) (R6, comme toute facture).
 * La première échéance est donc l'acompte R9. La dernière échéance (cumul
 * 100 %) n'est pas un acompte : c'est la facture finale, qui prend le reste
 * exact (total − acomptes déduits) ; voir montantsEcheances.
 */
export function ventilationEcheance(ventilation: Ventilation, cumulAvantBp: number, pourcentageBp: number, regime: Regime): Ventilation {
  const cumul = cumulAvantBp + pourcentageBp;
  if (!Number.isInteger(pourcentageBp) || !Number.isInteger(cumulAvantBp) || pourcentageBp < 0 || cumulAvantBp < 0 || cumul > 10_000) {
    throw new ErreurDevis('L’échéancier dépasse 100 % du devis.');
  }
  const base = (b: bigint, c: number) => arrondi(b * BigInt(c), 10_000n);
  return ventilation.map((v) => {
    const baseK = base(v.base_ht_cents, cumul) - base(v.base_ht_cents, cumulAvantBp);
    return { taux_bp: v.taux_bp, base_ht_cents: baseK, tva_cents: regime === 'franchise' ? 0n : arrondi(baseK * BigInt(v.taux_bp), 10_000n) };
  });
}

/**
 * Montants de l'échéancier (dans l'ordre), identiques aux factures d'acompte
 * puis à la facture finale : base en cumulé, TVA de chaque échéance selon R6,
 * la dernière (cumul 100 %) prenant le reste exact de la TVA. Somme exacte.
 */
export function montantsEcheances(ventilation: Ventilation, pourcentagesBp: number[], regime: Regime) {
  let cumul = 0;
  const tvaFacturee = new Map<number, bigint>();
  return pourcentagesBp.map((p) => {
    if (cumul + p > 10_000) throw new ErreurDevis('L’échéancier dépasse 100 % du devis.');
    const v = ventilationEcheance(ventilation, cumul, p, regime).map((x) => {
      if (cumul + p < 10_000) return x;
      // Reste exact de la TVA réellement facturée par les échéances précédentes.
      const total = ventilation.find((t) => t.taux_bp === x.taux_bp)!.tva_cents;
      return { ...x, tva_cents: total - (tvaFacturee.get(x.taux_bp) ?? 0n) };
    });
    for (const x of v) tvaFacturee.set(x.taux_bp, (tvaFacturee.get(x.taux_bp) ?? 0n) + x.tva_cents);
    cumul += p;
    const htCents = v.reduce((a, x) => a + x.base_ht_cents, 0n);
    const tvaCents = v.reduce((a, x) => a + x.tva_cents, 0n);
    return { htCents, tvaCents, ttcCents: htCents + tvaCents };
  });
}

export type Echeance = { libelle: string; pourcentageBp: number; declencheur: 'signature' | 'debut_travaux' | 'mi_chantier' | 'fin_travaux' | 'date'; datePrevue: string | null };

/** Contrôles de l'échéancier (mêmes règles que la base) ; renvoie l'acompte à la signature. */
export function controlerEcheancier(echeances: Echeance[]): { acompteBp: number; erreurs: string[] } {
  const erreurs: string[] = [];
  const total = echeances.reduce((a, e) => a + e.pourcentageBp, 0);
  if (total > 10_000) erreurs.push('L’échéancier dépasse 100 % du devis.');
  // Montants calculés en cumulé dans l'ordre : l'acompte (échéances « à la signature ») doit venir en tête
  // pour que son montant soit exactement celui de l'acompte du devis (R9).
  const premiereAutre = echeances.findIndex((e) => e.declencheur !== 'signature');
  if (premiereAutre >= 0 && echeances.slice(premiereAutre).some((e) => e.declencheur === 'signature')) {
    erreurs.push('Les échéances « à la signature » viennent en premier : retirez les autres, ajoutez celle-ci, puis remettez-les.');
  }
  for (const e of echeances) {
    if (e.pourcentageBp < 1 || e.pourcentageBp > 10_000) erreurs.push(`Échéance « ${e.libelle} » : de 0,01 à 100 %.`);
    if ((e.declencheur === 'date') !== (e.datePrevue !== null)) erreurs.push(`Échéance « ${e.libelle} » : une date seulement pour le déclencheur « à date ».`);
  }
  return { acompteBp: echeances.filter((e) => e.declencheur === 'signature').reduce((a, e) => a + e.pourcentageBp, 0), erreurs };
}

// --------------------------------------------------------------------------
// Reprise des postes de peinture (R1 : la quantité du devis est la surface AFFICHÉE)
// --------------------------------------------------------------------------

export type PosteAReprendre = {
  designation: string;
  description: string;
  surfaceMm2: bigint | null;
  coutMatiereCents: bigint | null;
  coutMainOeuvreCents: bigint | null;
  minutes: bigint | null;
  /** Le calcul du poste est incomplet (prix, temps ou matière manquants). */
  incomplet: boolean;
  origine: Record<string, string>;
};

export type LigneReprise = LigneDevis & {
  coutMatierePrevuCents: bigint | null;
  minutesPrevues: number | null;
  origine: Record<string, string | boolean>;
  /** Prix unitaire à compléter à la main (calcul incomplet). */
  aCompleter: boolean;
};

/**
 * Un poste -> une ligne au m² : quantité = surface affichée (0,01 m², demi
 * supérieur) ; prix unitaire = prix de vente du poste (matière × coefficient
 * de marge + main-d'œuvre) ÷ quantité, arrondi au centime. Calcul incomplet ou
 * surface inconnue : prix à compléter (0), signalé, jamais inventé.
 */
export function repriseDePoste(p: PosteAReprendre, coefMargeBp: number, tauxTvaBp: number): LigneReprise {
  const centiemesM2 = p.surfaceMm2 === null ? null : mm2EnCentiemesM2(p.surfaceMm2);
  const quantiteE4 = centiemesM2 === null ? 0n : centiemesM2 * 100n;
  const complet = !p.incomplet && p.coutMatiereCents !== null && p.coutMainOeuvreCents !== null && centiemesM2 !== null && centiemesM2 > 0n;
  let pu = 0n;
  if (complet) {
    const venteMatiere = arrondi(p.coutMatiereCents! * BigInt(coefMargeBp), 10_000n);
    // prix total ÷ (centièmes / 100) = prix × 100 ÷ centièmes
    pu = arrondi((venteMatiere + p.coutMainOeuvreCents!) * 100n, centiemesM2!);
  }
  return {
    type: 'ligne', designation: p.designation, description: p.description, quantiteE4, unite: 'm2', prixUnitaireCents: pu,
    remiseBp: 0, tauxTvaBp, optionnelle: false,
    coutMatierePrevuCents: p.coutMatiereCents, minutesPrevues: p.minutes === null ? null : Number(p.minutes),
    origine: { ...p.origine, a_completer: !complet }, aCompleter: !complet,
  };
}

// --------------------------------------------------------------------------
// Comparaison de deux versions
// --------------------------------------------------------------------------

export type Difference =
  | { nature: 'ajoutee'; designation: string; apres: bigint | null }
  | { nature: 'retiree'; designation: string; avant: bigint | null }
  | { nature: 'modifiee'; designation: string; champs: string[]; avant: bigint | null; apres: bigint | null };

const totalOuNull = (l: LigneDevis) => (l.type === 'ligne' && l.quantiteE4 !== null && l.prixUnitaireCents !== null
  ? totalLigne(l.quantiteE4, l.prixUnitaireCents, l.remiseBp) : null);

/** Différences ligne à ligne (rapprochées par désignation, dans l'ordre). */
export function comparerVersions(avant: LigneDevis[], apres: LigneDevis[]): Difference[] {
  const cle = (l: LigneDevis) => `${l.type}|${l.designation.trim().toLowerCase()}`;
  const restants = [...avant];
  const diffs: Difference[] = [];
  for (const b of apres) {
    const i = restants.findIndex((a) => cle(a) === cle(b));
    if (i < 0) { diffs.push({ nature: 'ajoutee', designation: b.designation, apres: totalOuNull(b) }); continue; }
    const [a] = restants.splice(i, 1);
    const champs: string[] = [];
    if (a!.quantiteE4 !== b.quantiteE4) champs.push('quantité');
    if (a!.unite !== b.unite) champs.push('unité');
    if (a!.prixUnitaireCents !== b.prixUnitaireCents) champs.push('prix unitaire');
    if (a!.remiseBp !== b.remiseBp) champs.push('remise');
    if (a!.tauxTvaBp !== b.tauxTvaBp) champs.push('TVA');
    if (a!.optionnelle !== b.optionnelle) champs.push('option');
    if ((a!.description ?? '') !== (b.description ?? '')) champs.push('description');
    if (champs.length) diffs.push({ nature: 'modifiee', designation: b.designation, champs, avant: totalOuNull(a!), apres: totalOuNull(b) });
  }
  for (const a of restants) diffs.push({ nature: 'retiree', designation: a.designation, avant: totalOuNull(a) });
  return diffs;
}

// --------------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------------

/** Remplace {client}, {numero}… ; un champ inconnu reste tel quel (visible, jamais inventé). */
export function remplirModele(texte: string, valeurs: Record<string, string>): string {
  return texte.replace(/\{([a-z_]+)\}/g, (m, cle: string) => (cle in valeurs ? valeurs[cle]! : m));
}

export const LIBELLES_STATUT_DEVIS: Record<string, string> = {
  brouillon: 'Brouillon', envoye: 'Envoyé', consulte: 'Consulté', accepte: 'Accepté', refuse: 'Refusé', expire: 'Expiré', remplace: 'Remplacé',
};
