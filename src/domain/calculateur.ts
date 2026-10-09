/**
 * Calculateur de peinture : assemble, pour chaque poste de travaux, la
 * surface, le rendement retenu, la quantité, les pots, le temps, les coûts et
 * les avertissements ; puis la liste d'achat du chantier.
 * Aucune donnée n'est inventée : un rendement ou un temps manquant est
 * signalé, jamais remplacé par une valeur arbitraire.
 */

import { arrondi, calculerTemps, coutConsommable, coutMainOeuvre, prixVenteMatiere, type Temps } from './chiffrage';
import { additionner, calculerQuantite, FRACTION_NULLE, quantiteDepuisFraction, type Fraction, type Quantite } from './peinture';
import { choisirPots, ErreurPots, type ChoixPots, type Format } from './pots';
import { avertissementsSysteme, type Support, type TypeProduit } from './systemes';

export type ProduitCalc = {
  id: string;
  libelle: string;
  reference: string | null;
  type: TypeProduit;
  unite: 'L' | 'kg';
  rendementCentiemes: number | null;
  couchesRecommandees: number | null;
  sechageRecouvrableH: string | null;
  usages: string[];
  aVerifier: boolean;
  formats: Format[];
};

export type ReferentielType = { rendementMinCentiemes: number; minutesParM2CoucheCentiemes: number | null; aVerifier: boolean };

export type EtapeCalc = {
  id: string;
  code: string;
  libelle: string;
  minutesParM2Centiemes: number;
  produit: ProduitCalc | null;
  /** Consommation par m² × 10 000 (L ou kg). */
  consommationE4: number | null;
  aVerifier: boolean;
};

export type ParametresCalcul = {
  margePerteBp: number;
  coefMargeBp: number;
  tauxHoraireCents: bigint | null;
  /** Formats usuels quand aucun produit du catalogue n'est choisi (ml). */
  formatsDefautMl: number[];
  coefSupportBp: Partial<Record<Support, number>>;
  referentiel: Partial<Record<TypeProduit, ReferentielType>>;
};

export type PosteCalc = {
  id: string;
  libelle: string;
  /** Surface à traiter (multiplicateur de pièce appliqué), ou ce qui manque. */
  surface: { mm2: bigint } | { manque: string };
  cible: 'murs' | 'plafond' | 'element';
  support: Support;
  zoneHumide: boolean;
  taches: boolean;
  etapes: EtapeCalc[];
  produit: ProduitCalc | null;
  typeProduit: TypeProduit | null;
  teinte: { id: string; nom: string } | null;
  couches: number;
  rendementForceCentiemes: number | null;
  margePerteBp: number | null;
  majorationTempsBp: number;
};

export type ResultatPoste = {
  surfaceMm2: bigint | null;
  rendementCentiemes: number | null;
  sourceRendement: 'force' | 'produit' | 'referentiel' | null;
  coefSupportBp: number;
  quantite: Quantite | null;
  unite: 'L' | 'kg';
  pots: ChoixPots | null;
  coutMatiereCents: bigint | null;
  temps: Temps | null;
  coutMainOeuvreCents: bigint | null;
  /** Problèmes qui empêchent le calcul complet. */
  manques: string[];
  avertissements: string[];
  /** Valeurs utilisées non confirmées (À VÉRIFIER). */
  aVerifier: string[];
  sechage: string | null;
  /** Matière des étapes de préparation (enduit, impression…). */
  matierePreparation: { etape: EtapeCalc; quantite: Fraction }[];
};

const LIBELLES_TYPE: Record<TypeProduit, string> = {
  sous_couche: 'Sous-couche', impression: 'Impression', acrylique: 'Acrylique', glycero: 'Glycéro', laque: 'Laque',
  facade: 'Peinture façade', lasure: 'Lasure', vernis: 'Vernis', enduit: 'Enduit', anti_humidite: 'Anti-humidité',
  anti_rouille: 'Antirouille', sous_couche_bloquante: 'Sous-couche bloquante', autre: 'Autre produit',
};
export const libelleType = (t: TypeProduit) => LIBELLES_TYPE[t];

const formatsDefaut = (p: ParametresCalcul): Format[] => p.formatsDefautMl.map((c) => ({ contenanceMl: c, prixCents: null }));

export function calculerPoste(poste: PosteCalc, p: ParametresCalcul): ResultatPoste {
  const manques: string[] = [];
  const aVerifier: string[] = [];
  const type = poste.produit?.type ?? poste.typeProduit;
  const unite = poste.produit?.unite ?? (type === 'enduit' ? 'kg' : 'L');
  const coefSupportBp = p.coefSupportBp[poste.support] ?? 10_000;
  if (p.coefSupportBp[poste.support] === undefined) manques.push('Coefficient du support non paramétré (1,00 appliqué).');
  else aVerifier.push('coefficient du support');

  const surfaceMm2 = 'mm2' in poste.surface ? poste.surface.mm2 : null;
  if (!('mm2' in poste.surface)) manques.push(poste.surface.manque);

  // Rendement : forcé sur le poste > produit du catalogue > bas de la fourchette du référentiel (prudent).
  let rendement: number | null = null;
  let source: ResultatPoste['sourceRendement'] = null;
  const ref = type ? p.referentiel[type] : undefined;
  if (poste.rendementForceCentiemes) { rendement = poste.rendementForceCentiemes; source = 'force'; }
  else if (poste.produit?.rendementCentiemes) {
    rendement = poste.produit.rendementCentiemes; source = 'produit';
    if (poste.produit.aVerifier) aVerifier.push('rendement du produit');
  } else if (ref) {
    rendement = ref.rendementMinCentiemes; source = 'referentiel';
    if (ref.aVerifier) aVerifier.push('rendement indicatif');
  }
  if (!type) manques.push('Choisissez un produit ou un type de produit.');
  else if (rendement === null) manques.push(`Rendement inconnu pour « ${LIBELLES_TYPE[type]} » : renseignez-le (produit ou réglages de calcul).`);

  const marge = poste.margePerteBp ?? p.margePerteBp;
  let quantite: Quantite | null = null;
  let pots: ChoixPots | null = null;
  let coutMatiere: bigint | null = null;
  if (surfaceMm2 !== null && rendement !== null) {
    quantite = calculerQuantite({ surfaceMm2, rendementCentiemes: rendement, coefSupportBp, couches: poste.couches, margePerteBp: marge });
    try {
      pots = choisirPots(quantite.aCouvrirMl, poste.produit?.formats.length ? poste.produit.formats : formatsDefaut(p));
      coutMatiere = pots.retenue.coutCents;
    } catch (e) {
      if (!(e instanceof ErreurPots)) throw e;
      manques.push(e.message);
    }
  }

  const matierePreparation: ResultatPoste['matierePreparation'] = [];
  let temps: Temps | null = null;
  if (surfaceMm2 !== null) {
    temps = calculerTemps({
      surfaceMm2,
      minutesParM2CoucheCentiemes: ref?.minutesParM2CoucheCentiemes ?? null,
      couches: poste.couches,
      preparationsCentiemes: poste.etapes.map((e) => e.minutesParM2Centiemes),
      majorationBp: poste.majorationTempsBp,
    });
    if (!temps.complet) manques.push('Temps de pose par m² non renseigné pour ce type de produit : temps de finition non compté.');
    else if (ref?.aVerifier) aVerifier.push('temps de pose');
    for (const e of poste.etapes) {
      if (e.aVerifier) aVerifier.push(`étape « ${e.libelle} »`);
      if (e.minutesParM2Centiemes === 0) manques.push(`Temps de l’étape « ${e.libelle} » non renseigné.`);
      if (e.produit && e.consommationE4) {
        // S/1e6 m² × conso/1e4 (L ou kg par m²)
        matierePreparation.push({ etape: e, quantite: { num: surfaceMm2 * BigInt(e.consommationE4), den: 10_000_000_000n } });
      }
    }
  }
  const coutMO = temps && p.tauxHoraireCents !== null ? coutMainOeuvre(temps.minutes, p.tauxHoraireCents) : null;
  if (temps && p.tauxHoraireCents === null) manques.push('Taux horaire non renseigné (Paramètres > Conditions et tarifs).');

  const avertissements = type ? avertissementsSysteme({
    cible: poste.cible, support: poste.support, zoneHumide: poste.zoneHumide, taches: poste.taches,
    preparations: poste.etapes.map((e) => e.code), typeProduit: type, usagesProduit: poste.produit?.usages ?? [],
    couches: poste.couches, couchesRecommandees: poste.produit?.couchesRecommandees ?? null,
  }) : [];

  const sechage = poste.produit?.sechageRecouvrableH && poste.couches > 1
    ? `Séchage avant recouvrement : ${poste.produit.sechageRecouvrableH.replace('.', ',')} h entre couches (fiche produit).`
    : null;

  return {
    surfaceMm2, rendementCentiemes: rendement, sourceRendement: source, coefSupportBp, quantite, unite, pots,
    coutMatiereCents: coutMatiere, temps, coutMainOeuvreCents: coutMO, manques, avertissements,
    aVerifier: [...new Set(aVerifier)], sechage, matierePreparation,
  };
}

// --------------------------------------------------------------------------
// Liste d'achat
// --------------------------------------------------------------------------

export type LigneAchat = {
  cle: string;
  libelle: string;
  reference: string | null;
  teinte: string | null;
  unite: 'L' | 'kg';
  quantite: Quantite;
  pots: ChoixPots | null;
  probleme: string | null;
  coutCents: bigint | null;
  aVerifier: boolean;
  /** Postes qui consomment ce produit (traçabilité). */
  postes: string[];
};

export type Consommable = { id: string; libelle: string; mode: 'par_chantier' | 'par_m2'; prixCents: bigint; aVerifier: boolean };

export type ListeAchat = {
  lignes: LigneAchat[];
  consommables: { libelle: string; coutCents: bigint; aVerifier: boolean }[];
  coutMatiereCents: bigint;
  /** Faux si au moins une ligne n'a pas de prix : le total est alors partiel. */
  coutComplet: boolean;
  tempsMinutes: bigint;
  coutMainOeuvreCents: bigint | null;
  prixVenteHtCents: bigint | null;
};

type Cumul = { libelle: string; reference: string | null; teinte: string | null; unite: 'L' | 'kg'; formats: Format[]; quantite: Fraction; aVerifier: boolean; postes: string[] };

export function listeAchat(postes: { poste: PosteCalc; resultat: ResultatPoste }[], consommables: Consommable[], p: ParametresCalcul): ListeAchat {
  const cumuls = new Map<string, Cumul>();
  const ajouter = (cle: string, base: Omit<Cumul, 'quantite' | 'postes'>, q: Fraction, poste: string) => {
    const c = cumuls.get(cle) ?? { ...base, quantite: FRACTION_NULLE, postes: [] };
    c.quantite = additionner(c.quantite, q);
    if (!c.postes.includes(poste)) c.postes.push(poste);
    cumuls.set(cle, c);
  };

  let surfaceTotale = 0n;
  let temps = 0n;
  for (const { poste, resultat } of postes) {
    if (resultat.surfaceMm2 !== null) surfaceTotale += resultat.surfaceMm2;
    if (resultat.temps) temps += resultat.temps.minutes;
    if (resultat.quantite) {
      const pr = poste.produit;
      const type = pr?.type ?? poste.typeProduit!;
      const cle = `${pr ? `p:${pr.id}` : `t:${type}`}|${poste.teinte?.id ?? ''}`;
      ajouter(cle, {
        libelle: pr?.libelle ?? `${LIBELLES_TYPE[type]} (produit à choisir)`, reference: pr?.reference ?? null,
        teinte: poste.teinte?.nom ?? null, unite: resultat.unite,
        formats: pr?.formats.length ? pr.formats : formatsDefaut(p), aVerifier: pr ? pr.aVerifier : true,
      }, resultat.quantite.exacte, poste.libelle);
    }
    for (const m of resultat.matierePreparation) {
      const pr = m.etape.produit!;
      ajouter(`p:${pr.id}|`, {
        libelle: pr.libelle, reference: pr.reference, teinte: null, unite: pr.unite,
        formats: pr.formats.length ? pr.formats : formatsDefaut(p), aVerifier: pr.aVerifier || m.etape.aVerifier,
      }, m.quantite, `${poste.libelle} (${m.etape.libelle})`);
    }
  }

  let cout = 0n;
  let complet = true;
  const lignes: LigneAchat[] = [...cumuls.entries()].map(([cle, c]) => {
    const quantite = quantiteDepuisFraction(c.quantite);
    let pots: ChoixPots | null = null;
    let probleme: string | null = null;
    try { pots = choisirPots(quantite.aCouvrirMl, c.formats); } catch (e) {
      if (!(e instanceof ErreurPots)) throw e;
      probleme = e.message;
    }
    const coutLigne = pots?.retenue.coutCents ?? null;
    if (coutLigne === null) complet = false; else cout += coutLigne;
    return { cle, libelle: c.libelle, reference: c.reference, teinte: c.teinte, unite: c.unite, quantite, pots, probleme, coutCents: coutLigne, aVerifier: c.aVerifier, postes: c.postes };
  }).sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr') || (a.teinte ?? '').localeCompare(b.teinte ?? '', 'fr'));

  const lignesConso = consommables.map((k) => ({ libelle: k.libelle, coutCents: coutConsommable(k.mode, k.prixCents, surfaceTotale), aVerifier: k.aVerifier }));
  for (const k of lignesConso) cout += k.coutCents;

  const mo = p.tauxHoraireCents === null ? null : coutMainOeuvre(temps, p.tauxHoraireCents);
  const vente = complet && mo !== null ? prixVenteMatiere(cout, p.coefMargeBp) + mo : null;
  return { lignes, consommables: lignesConso, coutMatiereCents: cout, coutComplet: complet, tempsMinutes: temps, coutMainOeuvreCents: mo, prixVenteHtCents: vente };
}

/**
 * Durée estimée en DIXIÈMES de jour de travail (journée de 7 h par défaut),
 * séchage non compris : 630 min -> 15 (1,5 jour).
 */
export const dixiemesDeJour = (minutes: bigint, minutesParJour = 420n) => arrondi(minutes * 10n, minutesParJour);
