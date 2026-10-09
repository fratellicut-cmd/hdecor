/**
 * Catalogue : modèle CSV d'import / export des produits, lecture et contrôle
 * ligne par ligne. Rien n'est écrit tant que l'aperçu n'est pas validé ; une
 * ligne importée est toujours « À VÉRIFIER » (aucune donnée confirmée sans source).
 */

import { ErreurCsv, fichierCsv, lireCsv } from './csv';
import { lireMontantEnCentimes } from './formats';
import { lireDecimal } from './saisie';
import type { TypeProduit } from './systemes';

export const TYPES: { code: TypeProduit; libelle: string }[] = [
  { code: 'sous_couche', libelle: 'Sous-couche' }, { code: 'impression', libelle: 'Impression' },
  { code: 'acrylique', libelle: 'Acrylique' }, { code: 'glycero', libelle: 'Glycéro' }, { code: 'laque', libelle: 'Laque' },
  { code: 'facade', libelle: 'Peinture façade' }, { code: 'lasure', libelle: 'Lasure' }, { code: 'vernis', libelle: 'Vernis' },
  { code: 'enduit', libelle: 'Enduit' }, { code: 'anti_humidite', libelle: 'Anti-humidité' }, { code: 'anti_rouille', libelle: 'Antirouille' },
  { code: 'sous_couche_bloquante', libelle: 'Sous-couche bloquante' }, { code: 'autre', libelle: 'Autre produit' },
];
export const USAGES = [
  { code: 'mur', libelle: 'Mur' }, { code: 'plafond', libelle: 'Plafond' }, { code: 'boiserie', libelle: 'Boiserie' },
  { code: 'metal', libelle: 'Métal' }, { code: 'exterieur', libelle: 'Extérieur' }, { code: 'sol', libelle: 'Sol' },
] as const;
export const FINITIONS = ['mat', 'velours', 'satin', 'brillant'] as const;
export type Usage = (typeof USAGES)[number]['code'];
export type FinitionProduit = (typeof FINITIONS)[number];

/** Marques de départ (cahier des charges) : de simples suggestions, sans référence ni prix. */
export const MARQUES_SUGGEREES = ['Tollens', 'Dulux Valentine', 'Sikkens', 'Zolpan', 'Seigneurie', 'Ripolin', 'Levis', 'Farrow & Ball', 'Little Greene'];

/** Colonnes du modèle, dans l'ordre. Les listes d'une cellule sont séparées par « / ». */
export const COLONNES = [
  { cle: 'marque', titre: 'Marque', obligatoire: true },
  { cle: 'gamme', titre: 'Gamme' },
  { cle: 'reference', titre: 'Référence fabricant' },
  { cle: 'designation', titre: 'Désignation', obligatoire: true },
  { cle: 'type', titre: 'Type', obligatoire: true },
  { cle: 'usages', titre: 'Usages' },
  { cle: 'finition', titre: 'Finition' },
  { cle: 'unite', titre: 'Unité (L ou kg)' },
  { cle: 'rendement', titre: 'Rendement (m² par L ou kg, par couche)' },
  { cle: 'couches', titre: 'Couches recommandées' },
  { cle: 'sechage', titre: 'Séchage avant recouvrement (h)' },
  { cle: 'formats', titre: 'Formats (L ou kg)' },
  { cle: 'prix', titre: 'Prix d’achat HT par format (€)' },
  { cle: 'fournisseur', titre: 'Fournisseur' },
  { cle: 'fiche', titre: 'Fiche technique (lien)' },
] as const;
type CleColonne = (typeof COLONNES)[number]['cle'];

export type ProduitImport = {
  marque: string;
  gamme: string | null;
  reference_fabricant: string | null;
  designation: string;
  type: TypeProduit;
  usages: Usage[];
  finition: FinitionProduit | null;
  unite_mesure: 'L' | 'kg';
  /** Nombres décimaux en texte (« 10.5 ») : lus exactement par la base. */
  rendement: string | null;
  couches: number | null;
  sechage_h: string | null;
  fournisseur: string | null;
  fiche_technique_url: string | null;
  /** Contenance en ml (ou g) ; prix null : prix existant conservé. */
  formats: { contenance: number; prix_cents: number | null }[];
};

export type LigneAnalysee = { numero: number; produit: ProduitImport | null; erreurs: string[]; cle: string | null };
export type AnalyseImport = { lignes: LigneAnalysee[]; erreursFichier: string[]; colonnesIgnorees: string[] };

/** Comparaison tolérante : casse, accents, espaces et ponctuation ignorés. */
const simplifier = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const vide = (v: string | undefined) => (v ?? '').trim() === '';
const liste = (v: string) => v.split('/').map((x) => x.trim());

/** Clé d'un produit : marque + référence, sinon marque + désignation (comme la base). */
export const cleProduit = (marque: string, reference: string | null, designation: string) =>
  `${marque.trim().toLowerCase()}|${reference ? `r:${reference.trim().toLowerCase()}` : `d:${designation.trim().toLowerCase()}`}`;

const MAX_LIGNES = 2000;

/** Lit et contrôle tout le fichier ; aucune écriture. */
export function analyserImport(texte: string): AnalyseImport {
  let tableau: string[][];
  try { tableau = lireCsv(texte); } catch (e) {
    if (e instanceof ErreurCsv) return { lignes: [], erreursFichier: [e.message], colonnesIgnorees: [] };
    throw e;
  }
  const [entetes, ...corps] = tableau;
  if (!entetes) return { lignes: [], erreursFichier: ['Fichier vide.'], colonnesIgnorees: [] };
  const index = new Map<CleColonne, number>();
  const colonnesIgnorees: string[] = [];
  entetes.forEach((titre, i) => {
    const col = COLONNES.find((c) => simplifier(c.titre) === simplifier(titre) || simplifier(c.cle) === simplifier(titre));
    if (col && !index.has(col.cle)) index.set(col.cle, i); else if (titre.trim()) colonnesIgnorees.push(titre.trim());
  });
  const manquantes = COLONNES.filter((c) => 'obligatoire' in c && c.obligatoire && !index.has(c.cle)).map((c) => `« ${c.titre} »`);
  if (manquantes.length) {
    return { lignes: [], erreursFichier: [`Colonnes obligatoires absentes : ${manquantes.join(', ')}. Partez du modèle à télécharger.`], colonnesIgnorees };
  }
  if (!corps.length) return { lignes: [], erreursFichier: ['Aucune ligne de produit sous les titres.'], colonnesIgnorees };
  if (corps.length > MAX_LIGNES) return { lignes: [], erreursFichier: [`${corps.length} lignes : ${MAX_LIGNES} au maximum par import.`], colonnesIgnorees };

  const vues = new Map<string, number>();
  const lignes = corps.map((cellules, i) => {
    const numero = i + 2; // ligne 1 : titres
    const lire = (cle: CleColonne) => { const k = index.get(cle); return k === undefined ? '' : (cellules[k] ?? '').trim(); };
    const r = lireLigne(lire);
    if (r.produit) {
      const cle = cleProduit(r.produit.marque, r.produit.reference_fabricant, r.produit.designation);
      const deja = vues.get(cle);
      if (deja !== undefined) return { numero, produit: null, cle: null, erreurs: [`Même produit qu’à la ligne ${deja} (marque et référence ou désignation).`] };
      vues.set(cle, numero);
      return { numero, produit: r.produit, erreurs: [], cle };
    }
    return { numero, produit: null, erreurs: r.erreurs, cle: null };
  });
  return { lignes, erreursFichier: [], colonnesIgnorees };
}

function lireLigne(lire: (cle: CleColonne) => string): { produit: ProduitImport | null; erreurs: string[] } {
  const erreurs: string[] = [];
  const texte = (cle: CleColonne, titre: string, max: number, obligatoire = false) => {
    const v = lire(cle);
    if (!v) { if (obligatoire) erreurs.push(`${titre} : obligatoire.`); return null; }
    if (v.length > max) { erreurs.push(`${titre} : ${max} caractères au maximum.`); return null; }
    return v;
  };
  const marque = texte('marque', 'Marque', 100, true);
  const gamme = texte('gamme', 'Gamme', 100);
  const reference = texte('reference', 'Référence fabricant', 100);
  const designation = texte('designation', 'Désignation', 200, true);
  const fournisseur = texte('fournisseur', 'Fournisseur', 200);

  const typeBrut = lire('type');
  const type = TYPES.find((t) => simplifier(t.code) === simplifier(typeBrut) || simplifier(t.libelle) === simplifier(typeBrut))?.code ?? null;
  if (!typeBrut) erreurs.push('Type : obligatoire.');
  else if (!type) erreurs.push(`Type « ${typeBrut} » inconnu (attendu : ${TYPES.map((t) => t.libelle).join(', ')}).`);

  const usages: Usage[] = [];
  for (const u of lire('usages').split(/[,/]/).map((x) => x.trim()).filter(Boolean)) {
    const code = USAGES.find((x) => simplifier(x.code) === simplifier(u) || simplifier(x.libelle) === simplifier(u))?.code;
    if (!code) erreurs.push(`Usage « ${u} » inconnu (attendu : ${USAGES.map((x) => x.libelle.toLowerCase()).join(', ')}).`);
    else if (!usages.includes(code)) usages.push(code);
  }

  const finitionBrute = lire('finition');
  const finition = FINITIONS.find((f) => simplifier(f) === simplifier(finitionBrute)) ?? null;
  if (finitionBrute && !finition) erreurs.push(`Finition « ${finitionBrute} » inconnue (mat, velours, satin ou brillant).`);

  const uniteBrute = lire('unite');
  const unite = !uniteBrute ? (type === 'enduit' ? 'kg' : 'L') : simplifier(uniteBrute) === 'l' ? 'L' : simplifier(uniteBrute) === 'kg' ? 'kg' : null;
  if (!unite) erreurs.push(`Unité « ${uniteBrute} » : L ou kg.`);

  const decimal = (cle: CleColonne, titre: string, dec: number, min: bigint, max: bigint) => {
    const v = lire(cle);
    if (!v) return null;
    const n = lireDecimal(v, dec);
    if (n === null) { erreurs.push(`${titre} : nombre invalide « ${v} » (${dec} décimale${dec > 1 ? 's' : ''} au plus).`); return null; }
    if (n < min || n > max) { erreurs.push(`${titre} : hors limites (« ${v} »).`); return null; }
    const f = 10n ** BigInt(dec);
    return `${n / f}.${(n % f).toString().padStart(dec, '0')}`;
  };
  const rendement = decimal('rendement', 'Rendement', 2, 1n, 999_999n);
  const sechage = decimal('sechage', 'Séchage', 1, 0n, 9999n);
  const couchesBrutes = lire('couches');
  let couches: number | null = null;
  if (couchesBrutes) {
    if (!/^[1-5]$/.test(couchesBrutes)) erreurs.push(`Couches recommandées : de 1 à 5 (« ${couchesBrutes} »).`);
    else couches = Number(couchesBrutes);
  }

  const fiche = lire('fiche');
  if (fiche && (!/^https?:\/\/\S+$/i.test(fiche) || fiche.length > 500)) erreurs.push('Fiche technique : lien commençant par http:// ou https://.');

  // Formats et prix : listes alignées (« 2,5 / 10 » et « 30,00 / 90,00 ») ; un prix vide est permis.
  const formats: ProduitImport['formats'] = [];
  const formatsBruts = vide(lire('formats')) ? [] : liste(lire('formats'));
  const prixBruts = vide(lire('prix')) ? [] : liste(lire('prix'));
  if (prixBruts.length > formatsBruts.length) erreurs.push('Prix : plus de prix que de formats.');
  if (formatsBruts.length > 10) erreurs.push('Formats : 10 au maximum.');
  formatsBruts.forEach((f, i) => {
    const ml = lireDecimal(f.replace(/\s*(l|kg)$/i, ''), 3);
    if (ml === null || ml < 1n || ml > 100_000n) { erreurs.push(`Format « ${f} » invalide (exemple : 2,5).`); return; }
    if (formats.some((x) => x.contenance === Number(ml))) { erreurs.push(`Format « ${f} » en double.`); return; }
    const p = prixBruts[i] ?? '';
    let prix: number | null = null;
    if (p) {
      prix = lireMontantEnCentimes(p);
      if (prix === null || prix < 0 || prix > 10_000_000) { erreurs.push(`Prix « ${p} » invalide (exemple : 30,00).`); prix = null; }
    }
    formats.push({ contenance: Number(ml), prix_cents: prix });
  });

  if (erreurs.length || !marque || !designation || !type || !unite) return { produit: null, erreurs };
  return {
    erreurs: [],
    produit: {
      marque, gamme, reference_fabricant: reference, designation, type, usages, finition, unite_mesure: unite,
      rendement, couches, sechage_h: sechage, fournisseur, fiche_technique_url: fiche || null, formats,
    },
  };
}

/** Décimal exact « 10.5 » (base) -> « 10,5 » (Excel en français). */
const decimalFr = (v: string | number | null) => (v === null ? '' : String(v).replace('.', ','));
const contenanceFr = (ml: number) => `${Math.trunc(ml / 1000)}${ml % 1000 ? `,${String(ml % 1000).padStart(3, '0').replace(/0+$/, '')}` : ''}`;
const prixFr = (c: number | null) => (c === null ? '' : `${Math.trunc(c / 100)},${String(c % 100).padStart(2, '0')}`);

export type ProduitExport = {
  marque: string; gamme: string | null; reference_fabricant: string | null; designation: string; type: string; usages: string[];
  finition: string | null; unite_mesure: string; rendement_m2_par_unite: number | null; couches_recommandees: number | null;
  sechage_recouvrable_h: number | null; fournisseur: string | null; fiche_technique_url: string | null;
  formats: { contenance: number; prix_achat_ht_cents: number | null }[];
};

/** Export au format du modèle : il se réimporte tel quel. */
export function exporterProduits(produits: ProduitExport[]): string {
  return fichierCsv(COLONNES.map((c) => c.titre), produits.map((p) => {
    const formats = [...p.formats].sort((a, b) => a.contenance - b.contenance);
    return [
      p.marque, p.gamme, p.reference_fabricant, p.designation, TYPES.find((t) => t.code === p.type)?.libelle ?? p.type,
      p.usages.map((u) => USAGES.find((x) => x.code === u)?.libelle.toLowerCase() ?? u).join(', '), p.finition, p.unite_mesure,
      decimalFr(p.rendement_m2_par_unite), p.couches_recommandees === null ? '' : String(p.couches_recommandees), decimalFr(p.sechage_recouvrable_h),
      formats.map((f) => contenanceFr(f.contenance)).join(' / '),
      formats.some((f) => f.prix_achat_ht_cents !== null) ? formats.map((f) => prixFr(f.prix_achat_ht_cents)).join(' / ') : '',
      p.fournisseur, p.fiche_technique_url,
    ];
  }));
}

/**
 * Modèle à remplir : les titres seuls (aucune ligne d'exemple, qui risquerait
 * d'être importée comme un vrai produit). L'écran d'import montre un exemple.
 */
export function modeleImport(): string {
  return fichierCsv(COLONNES.map((c) => c.titre), []);
}
