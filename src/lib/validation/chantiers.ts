import { z } from 'zod';
import { lireLongueurMm, lireQuantiteE4, lireSurfaceMm2, type UniteLongueur } from '@/domain/saisie';
import { entier, pourcentage, texteFacultatif, texteObligatoire } from './champs';

export const STATUTS_CHANTIER = ['a_planifier', 'en_cours', 'termine'] as const;
export const SUPPORTS = ['platre_neuf', 'ancienne_peinture', 'beton', 'enduit', 'bois_brut', 'bois_vernis', 'metal',
  'papier_peint', 'carrelage', 'autre'] as const;
export const TYPES_PRODUIT = ['sous_couche', 'impression', 'acrylique', 'glycero', 'laque', 'facade', 'lasure', 'vernis',
  'enduit', 'anti_humidite', 'anti_rouille', 'sous_couche_bloquante', 'autre'] as const;
export const TYPES_OUVERTURE = ['porte', 'fenetre', 'baie', 'autre'] as const;
export const TYPES_ELEMENT = ['plinthe', 'corniche', 'porte', 'fenetre', 'radiateur', 'volet', 'escalier', 'rambarde', 'facade', 'autre'] as const;

const vide = (v: unknown) => typeof v !== 'string' || v.trim() === '';

/** Longueur saisie en m ou cm -> mm entiers, bornes incluses. */
const longueur = (libelle: string, unite: UniteLongueur, minMm: number, maxMm: number) =>
  z.preprocess((v) => (vide(v) ? undefined : lireLongueurMm(String(v), unite) ?? Number.NaN),
    // Saisie illisible -> NaN, que zod refuse comme type : message distinct de « obligatoire ».
    z.number({ error: (iss) => (iss.input === undefined
      ? `${libelle} : obligatoire (exemple : ${unite === 'm' ? '4,25' : '83'}).`
      : `${libelle} : nombre invalide ou plus précis que le millimètre (en ${unite === 'm' ? 'mètres, exemple : 4,25' : 'centimètres, exemple : 83'}).`) })
      .refine((n) => n >= minMm, { error: `${libelle} : trop petit (en ${unite === 'm' ? 'mètres, exemple : 4,25' : 'centimètres, exemple : 83'}).` })
      .refine((n) => n <= maxMm, { error: `${libelle} : trop grand, vérifiez l’unité.` }));
const longueurFacultative = (libelle: string, unite: UniteLongueur, minMm: number, maxMm: number) =>
  // Vide -> null avant le schéma : une saisie illisible remonte le message français (pas « Invalid input » d'une union).
  z.preprocess((v) => (vide(v) ? null : v), longueur(libelle, unite, minMm, maxMm).nullable());

const surfaceFacultative = (libelle: string) =>
  z.preprocess((v) => (vide(v) ? null : lireSurfaceMm2(String(v)) ?? Number.NaN),
    z.number({ error: `${libelle} : surface invalide (exemple : 1,69).` }).refine((n) => n > 0, { error: `${libelle} : surface invalide (exemple : 1,69).` })
      .refine((n) => n <= 100_000_000_000, { error: `${libelle} : surface trop grande.` }).nullable());

const dateFacultative = z.preprocess((v) => (vide(v) ? null : v), z.iso.date({ error: 'Date invalide.' }).nullable());
const uuidFacultatif = z.preprocess((v) => (vide(v) ? null : v), z.uuid({ error: 'Choix invalide.' }).nullable());
const caseCochee = z.preprocess((v) => v === 'on', z.boolean());

export const schemaChantier = z.object({
  client_id: z.uuid({ error: 'Choisissez un client.' }),
  nom: texteObligatoire('Nom du chantier', 200),
  adresse_ligne1: texteFacultatif(),
  adresse_ligne2: texteFacultatif(),
  code_postal: texteFacultatif(10).refine((v) => v === null || /^\d{5}$/.test(v), { error: 'Code postal : 5 chiffres.' }),
  ville: texteFacultatif(100),
  statut: z.enum(STATUTS_CHANTIER, { error: 'Statut invalide.' }),
  date_debut_prevue: dateFacultative,
  notes: texteFacultatif(2000),
  /** Teinte du nuancier associée au chantier (facultative). */
  teinte_id: uuidFacultatif,
});

export const MURS_MAX = 30;

export const schemaPiece = z.object({
  nom: texteObligatoire('Nom de la pièce', 100),
  etage: texteFacultatif(50),
  mode_saisie: z.enum(['rectangle', 'murs'], { error: 'Mode de saisie invalide.' }),
  longueur_mm: longueurFacultative('Longueur', 'm', 100, 100_000),
  largeur_mm: longueurFacultative('Largeur', 'm', 100, 100_000),
  /** Longueurs des murs telles que saisies (mode « murs »). */
  murs: z.array(z.string()).max(MURS_MAX, { error: `${MURS_MAX} murs au maximum.` }),
  surface_sol_mm2: surfaceFacultative('Surface au sol'),
  hauteur_mm: longueur('Hauteur sous plafond', 'm', 500, 20_000),
  multiplicateur: entier(1, 50, 'Nombre de pièces identiques'),
  etat_support: texteFacultatif(200),
  notes: texteFacultatif(2000),
  /** Teinte du nuancier associée à la pièce (facultative). */
  teinte_id: uuidFacultatif,
}).transform((v, ctx) => {
  const commun = {
    nom: v.nom, etage: v.etage, mode_saisie: v.mode_saisie, hauteur_mm: v.hauteur_mm, multiplicateur: v.multiplicateur,
    etat_support: v.etat_support, notes: v.notes, teinte_id: v.teinte_id,
  };
  if (v.mode_saisie === 'rectangle') {
    if (v.longueur_mm === null) ctx.addIssue({ code: 'custom', path: ['longueur_mm'], message: 'Longueur : obligatoire.' });
    if (v.largeur_mm === null) ctx.addIssue({ code: 'custom', path: ['largeur_mm'], message: 'Largeur : obligatoire.' });
    return { ...commun, longueur_mm: v.longueur_mm, largeur_mm: v.largeur_mm, murs_mm: null, surface_sol_mm2: null };
  }
  const murs = v.murs.map((m) => lireLongueurMm(m, 'm'));
  murs.forEach((m, i) => {
    if (m === null || m < 100 || m > 100_000) ctx.addIssue({ code: 'custom', path: [`mur_${i + 1}`], message: `Mur ${i + 1} : longueur invalide (exemple : 3,25).` });
  });
  if (murs.length < 3) ctx.addIssue({ code: 'custom', path: ['nb_murs'], message: 'Au moins 3 murs.' });
  return { ...commun, longueur_mm: null, largeur_mm: null, murs_mm: murs as number[], surface_sol_mm2: v.surface_sol_mm2 };
});

/** Champs « nb_murs » et « mur_1 … mur_N » du formulaire -> liste des murs saisis. */
export function mursSaisis(formData: FormData): string[] {
  const nb = Math.min(Math.max(Number(formData.get('nb_murs')) || 0, 0), MURS_MAX);
  return Array.from({ length: nb }, (_, i) => String(formData.get(`mur_${i + 1}`) ?? ''));
}

export const schemaOuverture = z.object({
  type: z.enum(TYPES_OUVERTURE, { error: 'Type d’ouverture invalide.' }),
  largeur_mm: longueurFacultative('Largeur', 'cm', 50, 20_000),
  hauteur_mm: longueurFacultative('Hauteur', 'cm', 50, 20_000),
  surface_directe_mm2: surfaceFacultative('Surface'),
  quantite: entier(1, 100, 'Quantité'),
}).superRefine((v, ctx) => {
  const dims = v.largeur_mm !== null || v.hauteur_mm !== null;
  if (dims && v.surface_directe_mm2 !== null) ctx.addIssue({ code: 'custom', path: ['surface_directe_mm2'], message: 'Dimensions OU surface, pas les deux.' });
  if (!dims && v.surface_directe_mm2 === null) ctx.addIssue({ code: 'custom', path: ['largeur_mm'], message: 'Saisissez les dimensions ou la surface.' });
  if (dims && (v.largeur_mm === null || v.hauteur_mm === null)) ctx.addIssue({ code: 'custom', path: [v.largeur_mm === null ? 'largeur_mm' : 'hauteur_mm'], message: 'Largeur et hauteur sont nécessaires.' });
});

export const schemaElement = z.object({
  type: z.enum(TYPES_ELEMENT, { error: 'Type d’élément invalide.' }),
  unite: z.enum(['ml', 'm2', 'u'], { error: 'Unité invalide.' }),
  quantite_e4: z.preprocess((v) => (vide(v) ? Number.NaN : lireQuantiteE4(String(v)) ?? Number.NaN),
    z.number({ error: 'Quantité invalide (exemple : 14,5).' }).refine((n) => n > 0, { error: 'Quantité invalide (exemple : 14,5).' })
      .refine((n) => n <= 100_000_000, { error: 'Quantité trop grande.' })),
  faces: entier(1, 2, 'Faces'),
  developpe_mm: longueurFacultative('Largeur développée', 'cm', 1, 5_000),
  surface_unitaire_mm2: surfaceFacultative('Surface d’une unité'),
  notes: texteFacultatif(500),
}).transform((v) => ({
  ...v,
  // Seule la conversion utile à l'unité est gardée.
  developpe_mm: v.unite === 'ml' ? v.developpe_mm : null,
  surface_unitaire_mm2: v.unite === 'u' ? v.surface_unitaire_mm2 : null,
}));

/**
 * Rendement saisi « 10,5 » (m²/L), au plus 2 décimales, -> nombre pour la
 * colonne numeric(6,2) : le JSON transporte « 10.5 », relu exactement par la base.
 */
const rendementFacultatif = z.preprocess((v) => (vide(v) ? null : String(v).trim().replace(',', '.')),
  z.string().regex(/^\d{1,4}(\.\d{1,2})?$/, { error: 'Rendement invalide (exemple : 10,5 m²/L).' })
    .refine((s) => Number(s) > 0, { error: 'Rendement : supérieur à 0.' }).transform(Number).nullable());

export const schemaPoste = z.object({
  piece_id: z.uuid({ error: 'Choisissez une pièce.' }),
  cible: z.enum(['murs', 'plafond', 'element'], { error: 'Choisissez quoi peindre.' }),
  element_id: uuidFacultatif,
  support: z.enum(SUPPORTS, { error: 'Choisissez le support.' }),
  zone_humide: caseCochee,
  taches: caseCochee,
  exterieur: caseCochee,
  produit_id: uuidFacultatif,
  type_produit: z.preprocess((v) => (vide(v) ? null : v), z.enum(TYPES_PRODUIT, { error: 'Type de produit invalide.' }).nullable()),
  teinte_id: uuidFacultatif,
  // Teinte tapée (« blanc », « RAL 9010 ») tant que le catalogue des teintes est vide.
  teinte_libre: texteFacultatif(80),
  finition: z.preprocess((v) => (vide(v) ? null : v), z.enum(['mat', 'velours', 'satin', 'brillant']).nullable()),
  couches: entier(1, 5, 'Nombre de couches'),
  rendement_force: rendementFacultatif,
  marge_perte_bp: z.preprocess((v) => (vide(v) ? null : v), pourcentage(0, 5000).nullable()),
  majoration_temps_bp: z.preprocess((v) => (vide(v) ? '0' : v), pourcentage(0, 50_000)),
  etapes: z.array(z.uuid()).max(30),
  /** Même poste (murs ou plafond) créé aussi sur ces pièces du chantier. */
  pieces_copie: z.array(z.uuid()).max(100),
}).superRefine((v, ctx) => {
  if (v.cible === 'element' && !v.element_id) ctx.addIssue({ code: 'custom', path: ['element_id'], message: 'Choisissez l’élément à peindre.' });
  if (!v.produit_id && !v.type_produit) ctx.addIssue({ code: 'custom', path: ['type_produit'], message: 'Choisissez un produit ou un type de produit.' });
}).transform((v) => ({
  ...v,
  element_id: v.cible === 'element' ? v.element_id : null,
  // Une teinte du catalogue choisie l'emporte sur la saisie libre.
  teinte_libre: v.teinte_id ? null : v.teinte_libre,
  pieces_copie: v.cible === 'element' ? [] : [...new Set(v.pieces_copie)].filter((p) => p !== v.piece_id),
}));
