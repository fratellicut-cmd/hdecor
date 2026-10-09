/**
 * Calculateur de peinture : assemble, pour chaque poste de travaux, la
 * surface, le rendement retenu, la quantité, les pots, le temps, les coûts et
 * les avertissements ; puis la liste d'achat du chantier.
 *
 * Règle d'honnêteté : aucune donnée n'est inventée. Un rendement, un temps ou
 * une matière manquants sont SIGNALÉS sur le poste, et rendent les totaux
 * « partiels » : jamais un total présenté comme complet alors qu'il ne l'est pas.
 */

import { calculerTemps, coutConsommable, coutMainOeuvre, prixVenteMatiere, type Temps, arrondi } from './chiffrage';
import { formaterLongueur } from './metre';
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
  /** Séchage avant recouvrement en dixièmes d'heure (6 h -> 60). */
  sechageDixiemesH: number | null;
  usages: string[];
  /** Finition du produit (catalogue), si renseignée. */
  finition: Finition | null;
  aVerifier: boolean;
  /** Produit retiré du catalogue (encore utilisé par un poste). */
  archive: boolean;
  formats: Format[];
};

export type ReferentielType = {
  /** null : rendement non renseigné (aucune fourchette de départ). */
  rendementMinCentiemes: number | null;
  minutesParM2CoucheCentiemes: number | null;
  sechageDixiemesH: number | null;
  aVerifier: boolean;
};

export type EtapeCalc = {
  id: string;
  code: string;
  libelle: string;
  minutesParM2Centiemes: number;
  /** Matière par produit du catalogue et consommation au m²… */
  produit: ProduitCalc | null;
  /** … consommation par m² × 10 000 (L ou kg), pertes comprises … */
  consommationE4: number | null;
  /** … ou par type de produit (rendement du référentiel), en « couches » (passes). */
  typeProduit: TypeProduit | null;
  couches: number;
  /** L'étape consomme de la matière : si rien ne la chiffre, c'est signalé. */
  avecMatiere: boolean;
  aVerifier: boolean;
};

export type ParametresCalcul = {
  margePerteBp: number;
  coefMargeBp: number;
  tauxHoraireCents: bigint | null;
  /** Formats usuels quand aucun produit du catalogue n'est choisi : ml (litres) et g (kg). */
  formatsDefautMl: number[];
  formatsDefautG: number[];
  /** Formats usuels propres à un type (une laque ne se vend pas en 15 L) ; sinon les formats généraux. */
  formatsParType: Partial<Record<TypeProduit, number[]>>;
  hauteurAlerteMm: number;
  /** Pots sans prix : reste toléré, en points de base du besoin (R3). */
  toleranceResteBp: number;
  coefSupport: Partial<Record<Support, { bp: number; aVerifier: boolean }>>;
  referentiel: Partial<Record<TypeProduit, ReferentielType>>;
};

export type PosteCalc = {
  id: string;
  libelle: string;
  /** Surface à traiter (multiplicateur de pièce appliqué), ou ce qui manque. */
  surface: { mm2: bigint } | { manque: string };
  /** Identifie la surface traitée (pièce + cible + élément) : deux postes sur le même mur la partagent. */
  cleSurface: string;
  hauteurMm: number;
  cible: 'murs' | 'plafond' | 'element';
  /** Type de l'élément peint (« facade », « plinthe »…), null pour murs et plafond. */
  typeElement: string | null;
  support: Support;
  zoneHumide: boolean;
  taches: boolean;
  exterieur: boolean;
  etapes: EtapeCalc[];
  produit: ProduitCalc | null;
  typeProduit: TypeProduit | null;
  /** Teinte du catalogue, ou saisie libre (id « libre:… ») : deux teintes = deux lignes d'achat. */
  teinte: { id: string; nom: string } | null;
  /** Finition demandée : 30 L de velours et 3 L de satin ne s'achètent pas en une ligne. */
  finition: Finition | null;
  couches: number;
  rendementForceCentiemes: number | null;
  margePerteBp: number | null;
  majorationTempsBp: number;
};

export type MatiereCalc = {
  cle: string;
  libelle: string;
  reference: string | null;
  unite: 'L' | 'kg';
  formats: Format[];
  quantite: Fraction;
  aVerifier: boolean;
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
  /** Ce qui manque au calcul complet (affiché sur le poste). */
  manques: string[];
  /** Ce qui manque, par nature : rend les totaux partiels. */
  incomplet: { quantite: boolean; temps: boolean; matiere: boolean };
  avertissements: string[];
  /** Valeurs utilisées non confirmées (À VÉRIFIER). */
  aVerifier: string[];
  /** Attente minimale de séchage entre couches (dixièmes d'heure), si connue. */
  attenteSechageDixiemesH: number | null;
  sechage: string | null;
  /** Matière des étapes de préparation (enduit, impression…). */
  matierePreparation: MatiereCalc[];
};

export type Finition = 'mat' | 'velours' | 'satin' | 'brillant';
export const LIBELLES_FINITION: Record<Finition, string> = { mat: 'mat', velours: 'velours', satin: 'satin', brillant: 'brillant' };

const LIBELLES_TYPE: Record<TypeProduit, string> = {
  sous_couche: 'Sous-couche', impression: 'Impression', acrylique: 'Acrylique', glycero: 'Glycéro', laque: 'Laque',
  facade: 'Peinture façade', lasure: 'Lasure', vernis: 'Vernis', enduit: 'Enduit', anti_humidite: 'Anti-humidité',
  anti_rouille: 'Antirouille', sous_couche_bloquante: 'Sous-couche bloquante', autre: 'Autre produit',
};
export const libelleType = (t: TypeProduit) => LIBELLES_TYPE[t];
export const uniteDuType = (t: TypeProduit | null): 'L' | 'kg' => (t === 'enduit' ? 'kg' : 'L');

/**
 * Clé d'une ligne d'achat : produit (ou type) + teinte + finition. La même
 * forme pour un poste et pour la matière d'une étape : une impression posée
 * en poste et une impression cochée en préparation font UNE ligne.
 */
/** Teinte tapée -> clé de regroupement : forme Unicode unique, sans casse ni espaces (« RAL 9010 » = « ral9010 »). */
export const cleTeinte = (t: string) => t.normalize('NFC').toLocaleLowerCase('fr').replace(/\s+/g, '');

const cleAchat = (produit: string, teinte: string | null, finition: string | null) => `${produit}|${teinte ?? ''}|${finition ?? ''}`;

/**
 * Le coefficient de support corrige l'ABSORPTION d'une peinture (impression,
 * sous-couche, finition) par un support poreux. Il ne s'applique pas à un
 * enduit ni à une matière au kg : sa consommation dépend de l'épaisseur et des
 * passes, et elle est saisie pertes comprises.
 */
const sensibleAuSupport = (type: TypeProduit | null, unite: 'L' | 'kg') => type !== 'enduit' && unite === 'L';

const ELEMENTS_A_HAUTEUR_HOMME = ['plinthe', 'porte', 'fenetre', 'radiateur', 'volet'];

const formatsDefaut = (p: ParametresCalcul, unite: 'L' | 'kg', type: TypeProduit | null): Format[] =>
  ((type ? p.formatsParType[type] : undefined) ?? (unite === 'kg' ? p.formatsDefautG : p.formatsDefautMl)).map((c) => ({ contenanceMl: c, prixCents: null }));

const heures = (dixiemes: number) => `${Math.trunc(dixiemes / 10)}${dixiemes % 10 ? `,${dixiemes % 10}` : ''} h`;

export function calculerPoste(poste: PosteCalc, p: ParametresCalcul): ResultatPoste {
  const manques: string[] = [];
  const aVerifier: string[] = [];
  const incomplet = { quantite: false, temps: false, matiere: false };
  const type = poste.produit?.type ?? poste.typeProduit;
  const unite = poste.produit?.unite ?? uniteDuType(type);
  const coef = p.coefSupport[poste.support];
  const coefSupportBp = coef?.bp ?? 10_000;
  const coefPoste = sensibleAuSupport(type, unite) ? coefSupportBp : 10_000;
  if (!coef) manques.push('Coefficient du support non paramétré (1,00 appliqué).');
  else if (coef.aVerifier && sensibleAuSupport(type, unite)) aVerifier.push('coefficient du support');

  // Surface nulle (ouvertures ≥ murs…) : rien à acheter, le métré est à vérifier.
  const surfaceMm2 = 'mm2' in poste.surface && poste.surface.mm2 > 0n ? poste.surface.mm2 : null;
  if (!('mm2' in poste.surface)) { manques.push(poste.surface.manque); incomplet.quantite = true; incomplet.temps = true; }
  else if (surfaceMm2 === null) { manques.push('Surface nulle : vérifiez le métré.'); incomplet.quantite = true; incomplet.temps = true; }

  // Rendement : forcé sur le poste > produit du catalogue > bas de la fourchette du référentiel (prudent).
  let rendement: number | null = null;
  let source: ResultatPoste['sourceRendement'] = null;
  const ref = type ? p.referentiel[type] : undefined;
  if (poste.rendementForceCentiemes) { rendement = poste.rendementForceCentiemes; source = 'force'; }
  else if (poste.produit?.rendementCentiemes) {
    rendement = poste.produit.rendementCentiemes; source = 'produit';
    if (poste.produit.aVerifier) aVerifier.push('rendement du produit');
  } else if (ref?.rendementMinCentiemes) {
    rendement = ref.rendementMinCentiemes; source = 'referentiel';
    if (ref.aVerifier) aVerifier.push('rendement indicatif');
  }
  if (!type) { manques.push('Choisissez un produit ou un type de produit.'); incomplet.quantite = true; }
  else if (rendement === null) {
    manques.push(`Rendement inconnu pour « ${LIBELLES_TYPE[type]} » : renseignez-le (Paramètres > Réglages de calcul, ou rendement forcé).`);
    incomplet.quantite = true;
  }

  const marge = poste.margePerteBp ?? p.margePerteBp;
  let quantite: Quantite | null = null;
  let pots: ChoixPots | null = null;
  let coutMatiere: bigint | null = null;
  if (surfaceMm2 !== null && rendement !== null) {
    quantite = calculerQuantite({ surfaceMm2, rendementCentiemes: rendement, coefSupportBp: coefPoste, couches: poste.couches, margePerteBp: marge });
    try {
      pots = choisirPots(quantite.aCouvrirMl, poste.produit?.formats.length ? poste.produit.formats : formatsDefaut(p, unite, type), { toleranceResteBp: p.toleranceResteBp });
      coutMatiere = pots.retenue.coutCents;
    } catch (e) {
      if (!(e instanceof ErreurPots)) throw e;
      manques.push(e.message);
      incomplet.quantite = true;
    }
  }

  const matierePreparation: MatiereCalc[] = [];
  let temps: Temps | null = null;
  if (surfaceMm2 !== null) {
    temps = calculerTemps({
      surfaceMm2,
      minutesParM2CoucheCentiemes: ref?.minutesParM2CoucheCentiemes ?? null,
      couches: poste.couches,
      preparationsCentiemes: poste.etapes.map((e) => e.minutesParM2Centiemes),
      majorationBp: poste.majorationTempsBp,
    });
    if (!temps.complet) {
      manques.push('Temps de pose par m² non renseigné pour ce type de produit : temps de finition non compté.');
      incomplet.temps = true;
    } else if (ref?.aVerifier) aVerifier.push('temps de pose');

    for (const e of poste.etapes) {
      if (e.aVerifier) aVerifier.push(`étape « ${e.libelle} »`);
      if (e.minutesParM2Centiemes === 0) { manques.push(`Temps de l’étape « ${e.libelle} » non renseigné.`); incomplet.temps = true; }
      if (e.produit && e.consommationE4) {
        matierePreparation.push({
          cle: cleAchat(`p:${e.produit.id}`, null, null), libelle: e.produit.libelle, reference: e.produit.reference, unite: e.produit.unite,
          formats: e.produit.formats.length ? e.produit.formats : formatsDefaut(p, e.produit.unite, e.produit.type),
          // S/1e6 m² × conso/1e4 par m² et par passe (pertes comprises) × passes, corrigé du support
          // (coef/1e4) seulement pour une peinture : S × conso × passes / (1e6 × coef).
          quantite: {
            num: surfaceMm2 * BigInt(e.consommationE4) * BigInt(e.couches),
            den: 1_000_000n * BigInt(sensibleAuSupport(e.produit.type, e.produit.unite) ? coefSupportBp : 10_000),
          },
          aVerifier: e.produit.aVerifier || e.aVerifier,
        });
      } else if (e.typeProduit) {
        const r = p.referentiel[e.typeProduit];
        if (r?.rendementMinCentiemes) {
          const u = uniteDuType(e.typeProduit);
          matierePreparation.push({
            cle: cleAchat(`t:${e.typeProduit}`, null, null), libelle: `${LIBELLES_TYPE[e.typeProduit]} (produit à choisir)`, reference: null, unite: u,
            formats: formatsDefaut(p, u, e.typeProduit), aVerifier: true,
            quantite: calculerQuantite({
              surfaceMm2, rendementCentiemes: r.rendementMinCentiemes, couches: e.couches, margePerteBp: marge,
              coefSupportBp: sensibleAuSupport(e.typeProduit, u) ? coefSupportBp : 10_000,
            }).exacte,
          });
        } else {
          manques.push(`Matière de l’étape « ${e.libelle} » non comptée : rendement de « ${LIBELLES_TYPE[e.typeProduit]} » à renseigner.`);
          incomplet.matiere = true;
        }
      } else if (e.avecMatiere) {
        manques.push(`Matière de l’étape « ${e.libelle} » non comptée : associez-lui un produit ou un type (Réglages de calcul).`);
        incomplet.matiere = true;
      }
    }
  }
  const coutMO = temps && p.tauxHoraireCents !== null ? coutMainOeuvre(temps.minutes, p.tauxHoraireCents) : null;
  if (temps && p.tauxHoraireCents === null) manques.push('Taux horaire non renseigné (Paramètres > Conditions et tarifs).');

  const avertissements = type ? avertissementsSysteme({
    cible: poste.cible, support: poste.support, zoneHumide: poste.zoneHumide, taches: poste.taches, exterieur: poste.exterieur,
    preparations: poste.etapes.map((e) => e.code), typeProduit: type, usagesProduit: poste.produit?.usages ?? [],
    couches: poste.couches, couchesRecommandees: poste.produit?.couchesRecommandees ?? null, typeElement: poste.typeElement,
    finitionProduit: poste.produit?.finition ?? null, finitionPoste: poste.finition,
  }) : [];
  if (poste.produit?.archive) avertissements.push('Ce produit a été retiré du catalogue : choisissez-en un autre ou réactivez-le.');
  // Hauteur de la pièce : vaut pour les murs, le plafond, une façade, un escalier, une rambarde… ;
  // pas pour un élément posé à hauteur d'homme (plinthe, porte, fenêtre, radiateur, volet).
  if (poste.hauteurMm > p.hauteurAlerteMm && (poste.cible !== 'element' || !ELEMENTS_A_HAUTEUR_HOMME.includes(poste.typeElement ?? ''))) {
    avertissements.push(`Hauteur ${formaterLongueur(BigInt(poste.hauteurMm))} : prévoir échafaudage ou escabeau adapté${poste.majorationTempsBp ? '' : ', et une majoration du temps (réglages avancés du poste)'}.`);
  }

  // Séchage : fiche produit, sinon référentiel du type. Attente minimale = (couches − 1) × séchage.
  const sechage = poste.produit?.sechageDixiemesH ?? ref?.sechageDixiemesH ?? null;
  let attente: number | null = null;
  let texteSechage: string | null = null;
  if (poste.couches > 1) {
    if (sechage === null) texteSechage = 'Séchage entre couches non renseigné : durée du chantier sous-estimée.';
    else {
      attente = sechage * (poste.couches - 1);
      texteSechage = `Séchage avant recouvrement : ${heures(sechage)} entre couches, soit ${heures(attente)} d’attente au minimum.`;
    }
  }

  return {
    surfaceMm2, rendementCentiemes: rendement, sourceRendement: source, coefSupportBp, quantite, unite, pots,
    coutMatiereCents: coutMatiere, temps, coutMainOeuvreCents: coutMO, manques, incomplet, avertissements,
    aVerifier: [...new Set(aVerifier)], attenteSechageDixiemesH: attente, sechage: texteSechage, matierePreparation,
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
  finition: string | null;
  /** Ligne issue d'au moins un poste (et pas seulement d'une préparation) : sa finition est attendue. */
  depuisPoste: boolean;
  unite: 'L' | 'kg';
  quantite: Quantite;
  pots: ChoixPots | null;
  probleme: string | null;
  coutCents: bigint | null;
  /** Prix connus mais pas tous les formats : combinaison au moins de pots, coût non optimisé. */
  coutIndicatif: boolean;
  aVerifier: boolean;
  /** Postes qui consomment ce produit (traçabilité). */
  postes: string[];
};

export type Consommable = { id: string; libelle: string; mode: 'par_chantier' | 'par_m2'; prixCents: bigint; aVerifier: boolean };

export type ListeAchat = {
  lignes: LigneAchat[];
  /** Postes ou matières NON chiffrés (absents des lignes) : à compléter avant d'acheter. */
  nonChiffres: { id: string; libelle: string; raison: string }[];
  /**
   * Comptés plusieurs fois sur une même surface : même produit (ou type) sur
   * deux postes, ou même étape cochée sur deux postes. Signalés, jamais retirés d'office.
   */
  doublons: string[];
  consommables: { id: string; libelle: string; coutCents: bigint; aVerifier: boolean }[];
  coutMatiereCents: bigint;
  /**
   * Faux si une ligne n'a pas de prix, si un poste / une matière n'est pas
   * chiffré, ou si un coût n'est qu'indicatif (combinaison non optimisée au coût).
   */
  coutComplet: boolean;
  tempsMinutes: bigint;
  /** Faux si un temps de pose ou de préparation manque. */
  tempsComplet: boolean;
  /** Plus longue attente de séchage entre couches d'un poste (dixièmes d'heure). */
  attenteSechageDixiemesH: number | null;
  coutMainOeuvreCents: bigint | null;
  /** null tant que coût ET temps ne sont pas complets. */
  prixVenteHtCents: bigint | null;
};

type Cumul = Omit<MatiereCalc, 'cle'> & { teinte: string | null; finition: string | null; depuisPoste: boolean; postes: string[] };

export function listeAchat(postes: { poste: PosteCalc; resultat: ResultatPoste }[], consommables: Consommable[], p: ParametresCalcul): ListeAchat {
  const cumuls = new Map<string, Cumul>();
  const ajouter = (cle: string, m: Omit<MatiereCalc, 'cle'>, teinte: string | null, finition: string | null, poste: string, depuisPoste: boolean) => {
    const c = cumuls.get(cle) ?? { ...m, quantite: FRACTION_NULLE, teinte, finition, depuisPoste, postes: [] };
    c.depuisPoste = c.depuisPoste || depuisPoste;
    c.quantite = additionner(c.quantite, m.quantite);
    c.aVerifier = c.aVerifier || m.aVerifier;
    if (!c.postes.includes(poste)) c.postes.push(poste);
    cumuls.set(cle, c);
  };

  const nonChiffres: ListeAchat['nonChiffres'] = [];
  const surfaces = new Map<string, bigint>();
  let temps = 0n;
  let tempsComplet = true;
  let matiereComplete = true;
  let attente: number | null = null;
  const etapesParSurface = new Map<string, { libelle: string; postes: number; surface: string }>();
  const produitsParSurface = new Map<string, { libelle: string; postes: number; surface: string }>();
  for (const { poste, resultat } of postes) {
    // Par TYPE de produit : un produit du catalogue et un « type à choisir » identiques sur un même mur sont aussi vus.
    const typeEffectif = poste.produit?.type ?? poste.typeProduit;
    if (typeEffectif) {
      const k = `${poste.cleSurface}#${typeEffectif}`;
      const vu = produitsParSurface.get(k);
      produitsParSurface.set(k, { libelle: LIBELLES_TYPE[typeEffectif], postes: (vu?.postes ?? 0) + 1, surface: poste.libelle });
    }
    for (const e of poste.etapes) {
      const k = `${poste.cleSurface}#${e.id}`;
      const vu = etapesParSurface.get(k);
      etapesParSurface.set(k, { libelle: e.libelle, postes: (vu?.postes ?? 0) + 1, surface: poste.libelle });
    }
    if (resultat.surfaceMm2 !== null) surfaces.set(poste.cleSurface, resultat.surfaceMm2);
    if (resultat.temps) temps += resultat.temps.minutes;
    if (!resultat.temps || resultat.incomplet.temps) tempsComplet = false;
    if (resultat.incomplet.matiere) {
      matiereComplete = false;
      nonChiffres.push({ id: `${poste.id}:preparation`, libelle: `${poste.libelle} : préparation`, raison: resultat.manques.find((m) => m.startsWith('Matière')) ?? 'Matière de préparation non comptée.' });
    }
    if (resultat.attenteSechageDixiemesH !== null) attente = Math.max(attente ?? 0, resultat.attenteSechageDixiemesH);
    if (resultat.quantite) {
      const pr = poste.produit;
      const type = pr?.type ?? poste.typeProduit!;
      ajouter(cleAchat(pr ? `p:${pr.id}` : `t:${type}`, poste.teinte?.id ?? null, poste.finition), {
        libelle: pr?.libelle ?? `${LIBELLES_TYPE[type]} (produit à choisir)`, reference: pr?.reference ?? null, unite: resultat.unite,
        formats: pr?.formats.length ? pr.formats : formatsDefaut(p, resultat.unite, type), aVerifier: pr ? pr.aVerifier : true,
        quantite: resultat.quantite.exacte,
      }, poste.teinte?.nom ?? null, poste.finition ? LIBELLES_FINITION[poste.finition] : null, poste.libelle, true);
    } else {
      nonChiffres.push({ id: poste.id, libelle: poste.libelle, raison: resultat.manques[0] ?? 'Quantité non calculée.' });
    }
    for (const m of resultat.matierePreparation) ajouter(m.cle, m, null, null, `${poste.libelle} (préparation)`, false);
  }

  let cout = 0n;
  let prixComplets = true;
  const lignes: LigneAchat[] = [...cumuls.entries()].map(([cle, c]) => {
    const quantite = quantiteDepuisFraction(c.quantite);
    let pots: ChoixPots | null = null;
    let probleme: string | null = null;
    try { pots = choisirPots(quantite.aCouvrirMl, c.formats, { toleranceResteBp: p.toleranceResteBp }); } catch (e) {
      if (!(e instanceof ErreurPots)) throw e;
      probleme = e.message;
    }
    const coutLigne = pots?.retenue.coutCents ?? null;
    if (coutLigne === null) prixComplets = false; else cout += coutLigne;
    return {
      cle, libelle: c.libelle, reference: c.reference, teinte: c.teinte, finition: c.finition, depuisPoste: c.depuisPoste, unite: c.unite,
      quantite, pots, probleme, coutCents: coutLigne, coutIndicatif: coutLigne !== null && !pots!.choixAuCout, aVerifier: c.aVerifier, postes: c.postes,
    };
  }).sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr') || (a.finition ?? '').localeCompare(b.finition ?? '', 'fr')
    || (a.teinte ?? '').localeCompare(b.teinte ?? '', 'fr'));

  // Consommables au m² : chaque surface traitée comptée une fois (impression + finition sur un même mur = une surface).
  const surfaceTraitee = [...surfaces.values()].reduce((a, b) => a + b, 0n);
  const lignesConso = consommables.map((k) => ({ id: k.id, libelle: k.libelle, coutCents: coutConsommable(k.mode, k.prixCents, surfaceTraitee), aVerifier: k.aVerifier }));
  for (const k of lignesConso) cout += k.coutCents;

  const doublons = [
    ...[...produitsParSurface.values()].filter((v) => v.postes > 1)
      .map((v) => `${v.libelle} prévu sur ${v.postes} postes de la même surface (${v.surface}) : peinture et temps comptés ${v.postes} fois. Retirez le poste en trop.`),
    ...[...etapesParSurface.values()].filter((v) => v.postes > 1)
      .map((v) => `Étape « ${v.libelle} » cochée sur ${v.postes} postes de la même surface (${v.surface}) : son temps et sa matière sont comptés ${v.postes} fois. Décochez-la sur l’un d’eux.`),
  ];
  const coutComplet = prixComplets && matiereComplete && !nonChiffres.length && !lignes.some((l) => l.coutIndicatif);
  const mo = p.tauxHoraireCents === null ? null : coutMainOeuvre(temps, p.tauxHoraireCents);
  const vente = coutComplet && tempsComplet && mo !== null ? prixVenteMatiere(cout, p.coefMargeBp) + mo : null;
  return {
    lignes, nonChiffres, doublons, consommables: lignesConso, coutMatiereCents: cout, coutComplet, tempsMinutes: temps, tempsComplet,
    attenteSechageDixiemesH: attente, coutMainOeuvreCents: mo, prixVenteHtCents: vente,
  };
}

/**
 * Durée estimée en DIXIÈMES de jour de travail (durée d'une journée : paramètre
 * de l'entreprise), séchage non compris : 630 min, journée de 420 min -> 15 (1,5 jour).
 */
export const dixiemesDeJour = (minutes: bigint, minutesParJour: bigint) => arrondi(minutes * 10n, minutesParJour);
