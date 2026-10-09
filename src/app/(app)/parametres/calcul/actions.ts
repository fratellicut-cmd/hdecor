'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { lireDecimal, lireLongueurMm } from '@/domain/saisie';
import { SUPPORTS, TYPES_PRODUIT } from '@/lib/validation/chantiers';
import { montantObligatoire, pourcentage, texteObligatoire } from '@/lib/validation/champs';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const OK = 'Enregistré.';

/** Décimal saisi (« 10,5 ») -> nombre pour une colonne numeric à `dec` décimales. */
const decimal = (libelle: string, dec: number, min: number, max: number, facultatif = false) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? (facultatif ? null : Number.NaN) : String(v).trim().replace(',', '.')),
    z.union([z.null(), z.string()
      .regex(new RegExp(`^\\d+(\\.\\d{1,${dec}})?$`), { error: `${libelle} : nombre invalide (${dec} décimales au plus).` })
      .transform(Number)
      .refine((n) => n >= min && n <= max, { error: `${libelle} : entre ${min} et ${max}.` })]))
    .refine((v) => facultatif || v !== null, { error: `${libelle} : obligatoire.` });

const confirme = z.preprocess((v) => v === 'on', z.boolean());

/**
 * Statut après enregistrement : case cochée -> vérifié ; sinon une valeur
 * modifiée redevient « À VÉRIFIER » ; inchangée -> statut conservé.
 */
const statut = (coche: boolean, modifie: boolean, actuel: string) => (coche ? 'verifie' : modifie ? 'a_verifier' : actuel) as 'verifie' | 'a_verifier' | 'fictif';

const schemaReferentiel = z.object({
  type_produit: z.enum(TYPES_PRODUIT),
  rendement_min: decimal('Rendement minimal', 2, 0.01, 9999),
  rendement_max: decimal('Rendement maximal', 2, 0.01, 9999),
  minutes_par_m2_couche: decimal('Temps par m² et par couche', 2, 0, 999, true),
  confirme,
}).refine((v) => v.rendement_min! <= v.rendement_max!, { error: 'Le minimum dépasse le maximum.', path: ['rendement_min'] });

export async function enregistrerReferentiel(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaReferentiel.safeParse(Object.fromEntries(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  const { data: actuel } = await supabase.from('referentiel_calcul').select('*')
    .eq('organisation_id', session.organisationId).eq('type_produit', lu.data.type_produit).maybeSingle();
  const modifie = !actuel || Number(actuel.rendement_min) !== lu.data.rendement_min || Number(actuel.rendement_max) !== lu.data.rendement_max
    || (actuel.minutes_par_m2_couche === null ? null : Number(actuel.minutes_par_m2_couche)) !== lu.data.minutes_par_m2_couche;
  const { error } = await supabase.from('referentiel_calcul').upsert({
    organisation_id: session.organisationId, type_produit: lu.data.type_produit,
    rendement_min: lu.data.rendement_min!, rendement_max: lu.data.rendement_max!, minutes_par_m2_couche: lu.data.minutes_par_m2_couche,
    statut_verification: statut(lu.data.confirme, modifie, actuel?.statut_verification ?? 'a_verifier'),
  });
  if (error) return { message: ECHEC, valeurs: valeursTexte(formData) };
  revalidatePath('/parametres', 'layout');
  return { succes: OK };
}

// Coefficient saisi en pourcentage du rendement (80 = rendement × 0,80), de 10 % à 150 %.
const schemaCoefficient = z.object({ support: z.enum(SUPPORTS), coef_rendement_bp: pourcentage(1000, 15000), confirme });

export async function enregistrerCoefficient(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaCoefficient.safeParse(Object.fromEntries(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const coef = lu.data.coef_rendement_bp; // 80 % = 8 000 points de base = coefficient 0,80
  const supabase = await clientServeur();
  const { data: actuel } = await supabase.from('coefficients_support').select('*')
    .eq('organisation_id', session.organisationId).eq('support', lu.data.support).maybeSingle();
  const { error } = await supabase.from('coefficients_support').upsert({
    organisation_id: session.organisationId, support: lu.data.support, coef_rendement_bp: coef,
    statut_verification: statut(lu.data.confirme, actuel?.coef_rendement_bp !== coef, actuel?.statut_verification ?? 'a_verifier'),
  });
  if (error) return { message: ECHEC, valeurs: valeursTexte(formData) };
  revalidatePath('/parametres', 'layout');
  return { succes: OK };
}

const schemaEtape = z.object({ id: z.uuid(), minutes_par_m2: decimal('Temps par m²', 2, 0, 999), confirme });

export async function enregistrerEtape(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const lu = schemaEtape.safeParse(Object.fromEntries(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  const { data: actuel } = await supabase.from('etapes_preparation').select('minutes_par_m2, statut_verification').eq('id', lu.data.id).maybeSingle();
  if (!actuel) return { message: 'Étape introuvable.' };
  const { error } = await supabase.from('etapes_preparation').update({
    minutes_par_m2: lu.data.minutes_par_m2!,
    statut_verification: statut(lu.data.confirme, Number(actuel.minutes_par_m2) !== lu.data.minutes_par_m2, actuel.statut_verification),
  }).eq('id', lu.data.id);
  if (error) return { message: ECHEC, valeurs: valeursTexte(formData) };
  revalidatePath('/parametres', 'layout');
  return { succes: OK };
}

const schemaConsommable = z.object({
  libelle: texteObligatoire('Libellé', 200),
  mode: z.enum(['par_chantier', 'par_m2'], { error: 'Mode invalide.' }),
  prix_ht_cents: montantObligatoire(1_000_000),
});

export async function ajouterConsommable(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaConsommable.safeParse(Object.fromEntries(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  const { error } = await supabase.from('consommables').insert({ ...lu.data, organisation_id: session.organisationId });
  if (error) return { message: ECHEC, valeurs: valeursTexte(formData) };
  revalidatePath('/parametres', 'layout');
  return { succes: 'Consommable ajouté.' };
}

export async function actionConsommable(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = z.uuid().safeParse(formData.get('id'));
  const quoi = z.enum(['confirmer', 'retirer']).safeParse(formData.get('quoi'));
  if (!id.success || !quoi.success) return { message: 'Demande invalide. Rechargez la page.' };
  const supabase = await clientServeur();
  // Retrait = archivage (actif = false) : rien ne disparaît des calculs passés sans trace.
  const maj = quoi.data === 'confirmer' ? { statut_verification: 'verifie' as const } : { actif: false };
  const { data, error } = await supabase.from('consommables').update(maj).eq('id', id.data).select('id');
  if (error || !data?.length) return { message: ECHEC };
  revalidatePath('/parametres', 'layout');
  return { succes: quoi.data === 'confirmer' ? 'Confirmé.' : 'Retiré.' };
}

const schemaMetre = z.object({
  porte_largeur_mm: z.preprocess((v) => lireLongueurMm(String(v ?? ''), 'cm') ?? Number.NaN,
    z.number().int().min(300, { error: 'Largeur de porte : 30 cm minimum.' }).max(3000, { error: 'Largeur de porte : 300 cm maximum.' })),
  porte_hauteur_mm: z.preprocess((v) => lireLongueurMm(String(v ?? ''), 'cm') ?? Number.NaN,
    z.number().int().min(1000, { error: 'Hauteur de porte : 100 cm minimum.' }).max(4000, { error: 'Hauteur de porte : 400 cm maximum.' })),
  // « 1 ; 2,5 ; 5 » (litres, 3 décimales au plus) -> millilitres.
  formats_pots_ml: z.preprocess((v) => String(v ?? '').split(';').map((f) => f.trim().replace(/\s*l$/i, '')).filter(Boolean)
    .map((f) => { const ml = lireDecimal(f, 3); return ml === null ? Number.NaN : Number(ml); }),
  z.array(z.number().int().min(100, { error: 'Format de pot invalide (exemple : 2,5).' }).max(100_000, { error: 'Format trop grand.' }))
    .min(1, { error: 'Au moins un format.' }).max(10, { error: '10 formats au maximum.' })),
});

export async function enregistrerMetre(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaMetre.safeParse(Object.fromEntries(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  const { error } = await supabase.from('parametres_entreprise').update({
    ...lu.data, formats_pots_ml: [...new Set(lu.data.formats_pots_ml)].sort((a, b) => a - b),
  }).eq('organisation_id', session.organisationId);
  if (error) return { message: ECHEC, valeurs: valeursTexte(formData) };
  revalidatePath('/parametres', 'layout');
  return { succes: OK };
}
