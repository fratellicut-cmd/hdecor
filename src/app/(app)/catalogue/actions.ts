'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { analyserImport, cleProduit, type AnalyseImport, type FourchettesRendement } from '@/domain/catalogue';
import { TAILLE_MAX_CSV } from '@/domain/csv';
import { schemaFormat, schemaPrestation, schemaProduit, schemaTeinte } from '@/lib/validation/catalogue';
import { montantFacultatif } from '@/lib/validation/champs';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const REFUS = 'Ces informations ont été refusées (valeur hors limites ou incohérente). Vérifiez la saisie.';
const FORMULAIRE_INCOMPLET = 'Formulaire incomplet : rechargez la page.';
const messageErreur = (code: string | undefined) => (code?.startsWith('23') || code?.startsWith('22') || code === 'P0001' ? REFUS : ECHEC);
const identifiant = z.uuid();
const idDe = (formData: FormData, cle: string) => identifiant.safeParse(formData.get(cle));

function lireChamps(formData: FormData, tableaux: string[] = []): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const t of tableaux) o[t] = formData.getAll(t).map(String);
  for (const [k, v] of formData.entries()) if (!k.startsWith('$') && !tableaux.includes(k)) o[k] = v;
  return o;
}

const rafraichir = () => revalidatePath('/', 'layout');

/** Statut après enregistrement : confirmé -> vérifié ; modifié sans confirmation -> À VÉRIFIER ; inchangé -> conservé. */
function statutVerification(confirme: boolean, modifie: boolean, actuel: string | null) {
  if (confirme) return 'verifie' as const;
  if (modifie || actuel === null) return 'a_verifier' as const;
  return actuel as 'verifie' | 'a_verifier' | 'fictif';
}

// --------------------------------------------------------------------------
// Produits
// --------------------------------------------------------------------------

export async function enregistrerProduit(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const saisie = () => ({ ...valeursTexte(formData, ['usages']), usages: formData.getAll('usages').map(String).join(',') });
  const lu = schemaProduit.safeParse(lireChamps(formData, ['usages']));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: saisie() };
  const { confirme, verifie_le, source_verification, ...produit } = lu.data;
  const supabase = await clientServeur();

  const idSaisi = formData.get('id');
  const idLu = idSaisi ? identifiant.safeParse(idSaisi) : idDe(formData, 'id_nouveau');
  if (!idLu.success) return { message: idSaisi ? 'Produit introuvable.' : FORMULAIRE_INCOMPLET };
  const { data: actuel } = await supabase.from('produits').select('*').eq('id', idLu.data).maybeSingle();
  if (idSaisi && !actuel) return { message: 'Produit introuvable.' };

  // Comparaison par nature de champ : nombres comparés en valeur (« 10.50 » = 10.5), textes à l'identique
  // (« 0123 » ≠ « 123 » pour une référence), listes sans tenir compte de l'ordre.
  const NUMERIQUES = ['rendement_m2_par_unite', 'couches_recommandees', 'sechage_recouvrable_h'];
  const normal = (k: string, v: unknown) => (v === null || v === undefined ? ''
    : Array.isArray(v) ? [...v].sort().join(',') : NUMERIQUES.includes(k) ? String(Number(v)) : String(v));
  const champs = Object.keys(produit) as (keyof typeof produit)[];
  const modifie = !actuel || champs.some((k) => normal(k, produit[k]) !== normal(k, actuel[k]));
  // Les contenances sont dans l'unité du produit : pas de changement d'unité tant qu'il a des formats.
  if (actuel && actuel.unite_mesure !== produit.unite_mesure) {
    const { count } = await supabase.from('conditionnements').select('id', { count: 'exact', head: true }).eq('produit_id', actuel.id);
    if (count) return { erreurs: { unite_mesure: `Ce produit a des formats en ${actuel.unite_mesure} : retirez-les ou créez un autre produit.` }, valeurs: saisie() };
  }
  const statut = statutVerification(confirme, modifie, actuel?.statut_verification ?? null);
  const verification = statut === 'verifie'
    ? { verifie_le: confirme ? verifie_le : actuel?.verifie_le ?? null, source_verification: confirme ? source_verification : actuel?.source_verification ?? null }
    : { verifie_le: null, source_verification: null };
  // Décimaux contrôlés au texte (2 et 1 décimales), transmis comme nombres à la colonne numeric.
  const ligne = {
    ...produit,
    rendement_m2_par_unite: produit.rendement_m2_par_unite === null ? null : Number(produit.rendement_m2_par_unite),
    sechage_recouvrable_h: produit.sechage_recouvrable_h === null ? null : Number(produit.sechage_recouvrable_h),
    statut_verification: statut, ...verification,
  };

  const { error } = actuel
    ? await supabase.from('produits').update(ligne).eq('id', idLu.data)
    // Identifiant fixé par le formulaire : renvoyer après une réponse perdue ne crée pas de doublon.
    : await supabase.from('produits').upsert({ ...ligne, id: idLu.data, organisation_id: session.organisationId }, { onConflict: 'id', ignoreDuplicates: true });
  if (error?.code === '23505') return { erreurs: { reference_fabricant: 'Cette référence existe déjà pour cette marque dans le catalogue.' }, valeurs: saisie() };
  if (error) return { message: messageErreur(error.code), valeurs: saisie() };
  rafraichir();
  redirect(`/catalogue/produits/${idLu.data}?enregistre=1`);
}

export async function actionProduit(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(formData, 'id');
  const quoi = z.enum(['archiver', 'reactiver']).safeParse(formData.get('quoi'));
  if (!id.success || !quoi.success) return { message: 'Demande invalide. Rechargez la page.' };
  const supabase = await clientServeur();
  // Archivage (actif = false) : un produit ne se supprime pas, son historique de prix et les devis passés le citent.
  const { data, error } = await supabase.from('produits').update({ actif: quoi.data === 'reactiver' }).eq('id', id.data).select('id');
  if (error || !data?.length) return { message: ECHEC };
  rafraichir();
  return { succes: quoi.data === 'archiver' ? 'Produit retiré du catalogue (archivé). Il reste visible dans les calculs qui l’utilisent.' : 'Produit remis au catalogue.' };
}

// --------------------------------------------------------------------------
// Formats (conditionnements)
// --------------------------------------------------------------------------

export async function ajouterFormat(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const produitId = idDe(formData, 'produit_id');
  if (!produitId.success) return { message: 'Produit introuvable.' };
  const lu = schemaFormat.safeParse(lireChamps(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  const { data: existant } = await supabase.from('conditionnements').select('id, actif')
    .eq('produit_id', produitId.data).eq('contenance', lu.data.contenance).maybeSingle();
  if (existant?.actif) return { erreurs: { contenance: 'Ce format existe déjà : modifiez son prix ci-dessus.' }, valeurs: valeursTexte(formData) };
  const { error } = existant
    ? await supabase.from('conditionnements').update({ actif: true, prix_achat_ht_cents: lu.data.prix_achat_ht_cents }).eq('id', existant.id)
    : await supabase.from('conditionnements').insert({
      organisation_id: session.organisationId, produit_id: produitId.data, contenance: lu.data.contenance, prix_achat_ht_cents: lu.data.prix_achat_ht_cents,
    });
  if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData) };
  rafraichir();
  return { succes: 'Format ajouté.' };
}

const schemaPrixFormat = z.object({ id: z.uuid(), prix_achat_ht_cents: montantFacultatif(10_000_000) });

/** Prix d'achat d'un format : chaque changement est historisé (trigger) et daté. */
export async function modifierPrixFormat(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const lu = schemaPrixFormat.safeParse(lireChamps(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('conditionnements').update({ prix_achat_ht_cents: lu.data.prix_achat_ht_cents }).eq('id', lu.data.id).select('id');
  if (error || !data?.length) return { message: error ? messageErreur(error.code) : 'Format introuvable.', valeurs: valeursTexte(formData) };
  rafraichir();
  return { succes: 'Prix enregistré.' };
}

export async function actionFormat(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(formData, 'id');
  const quoi = z.enum(['archiver', 'reactiver']).safeParse(formData.get('quoi'));
  if (!id.success || !quoi.success) return { message: 'Demande invalide. Rechargez la page.' };
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('conditionnements').update({ actif: quoi.data === 'reactiver' }).eq('id', id.data).select('id');
  if (error || !data?.length) return { message: ECHEC };
  rafraichir();
  return { succes: quoi.data === 'archiver' ? 'Format retiré (archivé).' : 'Format remis en vente.' };
}

// --------------------------------------------------------------------------
// Teintes
// --------------------------------------------------------------------------

export async function enregistrerTeinte(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaTeinte.safeParse(lireChamps(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const { confirme, verifie_le, source_verification, ...teinte } = lu.data;
  const supabase = await clientServeur();
  const idSaisi = formData.get('id');
  const idLu = idSaisi ? identifiant.safeParse(idSaisi) : idDe(formData, 'id_nouveau');
  if (!idLu.success) return { message: idSaisi ? 'Teinte introuvable.' : FORMULAIRE_INCOMPLET };
  const { data: actuel } = await supabase.from('teintes').select('*').eq('id', idLu.data).maybeSingle();
  if (idSaisi && !actuel) return { message: 'Teinte introuvable.' };
  const modifie = !actuel || (Object.keys(teinte) as (keyof typeof teinte)[]).some((k) => (teinte[k] ?? '') !== (actuel[k] ?? ''));
  const statut = statutVerification(confirme, modifie, actuel?.statut_verification ?? null);
  const ligne = {
    ...teinte, statut_verification: statut,
    ...(statut === 'verifie'
      ? { verifie_le: confirme ? verifie_le : actuel?.verifie_le ?? null, source_verification: confirme ? source_verification : actuel?.source_verification ?? null }
      : { verifie_le: null, source_verification: null }),
  };
  const { error } = actuel
    ? await supabase.from('teintes').update(ligne).eq('id', idLu.data)
    : await supabase.from('teintes').upsert({ ...ligne, id: idLu.data, organisation_id: session.organisationId }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData) };
  rafraichir();
  if (idSaisi) redirect('/catalogue/teintes?enregistre=1');
  return { succes: 'Teinte ajoutée.' };
}

export async function actionTeinte(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(formData, 'id');
  const quoi = z.enum(['archiver', 'reactiver']).safeParse(formData.get('quoi'));
  if (!id.success || !quoi.success) return { message: 'Demande invalide. Rechargez la page.' };
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('teintes').update({ actif: quoi.data === 'reactiver' }).eq('id', id.data).select('id');
  if (error || !data?.length) return { message: ECHEC };
  rafraichir();
  return { succes: quoi.data === 'archiver' ? 'Teinte retirée du nuancier.' : 'Teinte remise au nuancier.' };
}

// --------------------------------------------------------------------------
// Prestations
// --------------------------------------------------------------------------

export async function enregistrerPrestation(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaPrestation.safeParse(lireChamps(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  // Le taux doit être un des taux proposés (Paramètres > Taux de TVA).
  const { data: taux } = await supabase.from('taux_tva').select('taux_bp').eq('taux_bp', lu.data.taux_tva_bp).eq('actif', true).maybeSingle();
  if (!taux) return { erreurs: { taux_tva_bp: 'Taux de TVA non proposé dans les paramètres.' }, valeurs: valeursTexte(formData) };
  const idSaisi = formData.get('id');
  const idLu = idSaisi ? identifiant.safeParse(idSaisi) : idDe(formData, 'id_nouveau');
  if (!idLu.success) return { message: idSaisi ? 'Prestation introuvable.' : FORMULAIRE_INCOMPLET };
  const { data, error } = idSaisi
    ? await supabase.from('prestations').update(lu.data).eq('id', idLu.data).select('id')
    : await supabase.from('prestations').upsert({ ...lu.data, id: idLu.data, organisation_id: session.organisationId }, { onConflict: 'id', ignoreDuplicates: true }).select('id');
  if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData) };
  if (idSaisi && !data?.length) return { message: 'Prestation introuvable.' };
  rafraichir();
  redirect('/catalogue/prestations?enregistre=1');
}

export async function actionPrestation(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(formData, 'id');
  const quoi = z.enum(['archiver', 'reactiver']).safeParse(formData.get('quoi'));
  if (!id.success || !quoi.success) return { message: 'Demande invalide. Rechargez la page.' };
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('prestations').update({ actif: quoi.data === 'reactiver' }).eq('id', id.data).select('id');
  if (error || !data?.length) return { message: ECHEC };
  rafraichir();
  return { succes: quoi.data === 'archiver' ? 'Prestation retirée (archivée).' : 'Prestation remise dans la bibliothèque.' };
}

// --------------------------------------------------------------------------
// Import CSV
// --------------------------------------------------------------------------

export type EtatImport = {
  message?: string;
  succes?: string;
  /** Aperçu : rien n'est écrit tant qu'il n'est pas validé. */
  apercu?: {
    erreursFichier: string[];
    colonnesIgnorees: string[];
    lignes: { numero: number; libelle: string; action: 'creation' | 'mise_a_jour' | null; erreurs: string[]; avertissements: string[]; formats: number }[];
  };
};

const schemaContenu = z.string().min(1, { error: 'Choisissez un fichier CSV.' }).max(TAILLE_MAX_CSV, { error: 'Fichier trop volumineux (1 Mo au maximum).' });

/** Fourchettes indicatives du référentiel (alertes de plausibilité de l'aperçu). */
async function fourchettes(): Promise<FourchettesRendement> {
  const supabase = await clientServeur();
  const { data } = await supabase.from('referentiel_calcul').select('type_produit, rendement_min, rendement_max');
  return Object.fromEntries((data ?? []).filter((r) => r.rendement_min !== null && r.rendement_max !== null)
    .map((r) => [r.type_produit, { min: Math.round(Number(r.rendement_min) * 100), max: Math.round(Number(r.rendement_max) * 100) }]));
}

async function analyser(texte: string): Promise<{ analyse: AnalyseImport; existants: Set<string> } | null> {
  const analyse = analyserImport(texte, await fourchettes());
  const supabase = await clientServeur();
  const existants = new Set<string>();
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await supabase.from('produits').select('marque, reference_fabricant, designation').order('id').range(debut, debut + 999);
    if (error) return null;
    for (const p of data) existants.add(cleProduit(p.marque, p.reference_fabricant, p.designation));
    if (data.length < 1000) break;
  }
  return { analyse, existants };
}

/** Étape 1 : lecture et contrôle ligne par ligne, sans rien écrire. */
export async function apercuImport(_: EtatImport, formData: FormData): Promise<EtatImport> {
  await verifierSession();
  const contenu = schemaContenu.safeParse(formData.get('contenu'));
  if (!contenu.success) return { message: contenu.error.issues[0]?.message ?? 'Fichier illisible.' };
  return construireApercu(contenu.data);
}

async function construireApercu(texte: string): Promise<EtatImport> {
  const lu = await analyser(texte);
  if (!lu) return { message: 'Le catalogue n’a pas pu être lu pour comparer : réessayez dans un instant.' };
  const { analyse, existants } = lu;
  return {
    apercu: {
      erreursFichier: analyse.erreursFichier,
      colonnesIgnorees: analyse.colonnesIgnorees,
      lignes: analyse.lignes.map((l) => ({
        numero: l.numero,
        libelle: l.produit ? [l.produit.marque, l.produit.reference_fabricant, l.produit.designation].filter(Boolean).join(' · ') : '',
        action: l.cle === null ? null : existants.has(l.cle) ? 'mise_a_jour' : 'creation',
        erreurs: l.erreurs,
        avertissements: l.avertissements,
        formats: l.produit?.formats.length ?? 0,
      })),
    },
  };
}

/** Étape 2 : le fichier est relu et recontrôlé côté serveur (l'aperçu n'est jamais cru), puis importé en une transaction. */
export async function validerImport(_: EtatImport, formData: FormData): Promise<EtatImport> {
  const session = await verifierSession();
  const contenu = schemaContenu.safeParse(formData.get('contenu'));
  if (!contenu.success) return { message: contenu.error.issues[0]?.message ?? 'Fichier illisible.' };
  const ignorer = formData.get('ignorer_erreurs') === 'on';
  const analyse = analyserImport(contenu.data);
  if (analyse.erreursFichier.length) return { message: analyse.erreursFichier[0] };
  const valides = analyse.lignes.filter((l) => l.produit).map((l) => l.produit!);
  const enErreur = analyse.lignes.length - valides.length;
  if (enErreur && !ignorer) return { message: `${enErreur} ligne(s) en erreur : corrigez le fichier, ou cochez « Importer seulement les lignes valides ».` };
  if (!valides.length) return { message: 'Aucune ligne valide à importer.' };
  const supabase = await clientServeur();
  const { data, error } = await supabase.rpc('importer_produits', { p_organisation_id: session.organisationId, p_lignes: valides });
  if (error) {
    // P0001 : refus explicite de la fonction d'import (message rédigé en français, sans donnée sensible).
    if (error.code === 'P0001') return { message: `${error.message} Rien n’a été importé.` };
    const refus = error.code?.startsWith('23') || error.code?.startsWith('22') || error.code === 'P0002';
    return { message: `${refus ? REFUS : ECHEC} Rien n’a été importé.` };
  }
  const r = data as { crees: number; mis_a_jour: number };
  rafraichir();
  // Aperçu relu après l'import : ce que montre l'écran correspond au catalogue.
  const relu = await construireApercu(contenu.data);
  return {
    apercu: relu.apercu,
    succes: `Import terminé : ${r.crees} produit(s) créé(s), ${r.mis_a_jour} mis à jour${enErreur ? `, ${enErreur} ligne(s) en erreur ignorée(s)` : ''}. Les produits importés sont « À VÉRIFIER ».`,
  };
}

// --------------------------------------------------------------------------
// Matière d'une étape de préparation (produit du catalogue + consommation)
// --------------------------------------------------------------------------

const schemaMatiereEtape = z.object({
  id: z.uuid(),
  produit_id: z.preprocess((v) => (typeof v !== 'string' || v === '' ? null : v), z.uuid({ error: 'Produit invalide.' }).nullable()),
  // Consommation par m² et par passe, pertes comprises : 4 décimales (kg ou L).
  consommation_par_m2: z.preprocess((v) => (typeof v !== 'string' || v.trim() === '' ? null : v.trim().replace(',', '.')),
    z.string().regex(/^\d{1,4}(\.\d{1,4})?$/, { error: 'Consommation : nombre invalide (4 décimales au plus, exemple : 0,6).' })
      .refine((s) => Number(s) > 0, { error: 'Consommation : supérieure à 0.' }).nullable()),
}).superRefine((v, ctx) => {
  if ((v.produit_id === null) !== (v.consommation_par_m2 === null)) {
    ctx.addIssue({ code: 'custom', path: ['consommation_par_m2'], message: 'Choisissez le produit ET sa consommation par m², ou aucun des deux.' });
  }
});

export async function enregistrerMatiereEtape(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const lu = schemaMatiereEtape.safeParse(lireChamps(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('etapes_preparation')
    .update({ produit_id: lu.data.produit_id, consommation_par_m2: lu.data.consommation_par_m2 === null ? null : Number(lu.data.consommation_par_m2), statut_verification: 'a_verifier' })
    .eq('id', lu.data.id).select('id');
  if (error || !data?.length) return { message: error ? messageErreur(error.code) : 'Étape introuvable.', valeurs: valeursTexte(formData) };
  rafraichir();
  return { succes: 'Matière de l’étape enregistrée (À VÉRIFIER).' };
}

