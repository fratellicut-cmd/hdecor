'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import {
  lireFormulaire, schemaAssurance, schemaConditions, schemaEntreprise, schemaFiscal, schemaMentions,
} from '@/lib/validation/parametres';
import { CODES_MESSAGES, controlerDelaisRelances, schemaModeleMessage } from '@/lib/validation/messages';
import { aujourdHuiParis } from '@/domain/dates';
import type { MiseAJour } from '@/lib/supabase/types';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const OK = 'Enregistré.';

async function mettreAJour(organisationId: string, valeurs: MiseAJour<'parametres_entreprise'>) {
  const supabase = await clientServeur();
  const { error } = await supabase.from('parametres_entreprise').update(valeurs).eq('organisation_id', organisationId);
  return error;
}

export async function enregistrerEntreprise(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaEntreprise.safeParse(lireFormulaire(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  if (await mettreAJour(session.organisationId, lu.data)) return { message: ECHEC, valeurs: valeursTexte(formData) };
  revalidatePath('/', 'layout');
  return { succes: OK };
}

export async function enregistrerFiscal(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaFiscal.safeParse(lireFormulaire(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const { mention_franchise_confirmee, seuils_confirmes, ...valeurs } = lu.data;
  const supabase = await clientServeur();
  const { data: actuel, error: lecture } = await supabase.from('parametres_entreprise')
    .select('mention_franchise, mention_franchise_a_verifier, seuil_ca_micro_cents, seuil_franchise_tva_cents, seuils_confirmes_le')
    .eq('organisation_id', session.organisationId).single();
  if (lecture || !actuel) return { message: ECHEC, valeurs: valeursTexte(formData) };
  // Une confirmation n'est jamais déduite : la case est décochée à l'affichage.
  // Cochée -> confirmé ; décochée et valeur inchangée -> état conservé ;
  // décochée et valeur modifiée -> de nouveau À VÉRIFIER.
  const mentionModifiee = valeurs.mention_franchise !== actuel.mention_franchise;
  const seuilsModifies = valeurs.seuil_ca_micro_cents !== actuel.seuil_ca_micro_cents
    || valeurs.seuil_franchise_tva_cents !== actuel.seuil_franchise_tva_cents;
  const erreur = await mettreAJour(session.organisationId, {
    ...valeurs,
    mention_franchise_a_verifier: mention_franchise_confirmee ? false : (mentionModifiee || actuel.mention_franchise_a_verifier),
    seuils_confirmes_le: seuils_confirmes ? aujourdHuiParis() : (seuilsModifies ? null : actuel.seuils_confirmes_le),
  });
  if (erreur) return { message: ECHEC, valeurs: valeursTexte(formData) };
  revalidatePath('/', 'layout');
  return { succes: OK };
}

export async function enregistrerConditions(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaConditions.safeParse(lireFormulaire(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const { confirmes, ...valeurs } = lu.data;
  if (await mettreAJour(session.organisationId, valeurs)) return { message: ECHEC, valeurs: valeursTexte(formData) };
  if (confirmes.length) {
    // Retrait atomique en base : une lecture échouée ne peut plus « confirmer »
    // d'autres valeurs, et deux enregistrements simultanés ne se marchent pas dessus.
    const supabase = await clientServeur();
    const { data, error } = await supabase.rpc('confirmer_valeurs', {
      p_organisation_id: session.organisationId, p_confirmees: confirmes,
    });
    if (error || !data) return { message: ECHEC, valeurs: valeursTexte(formData) };
  }
  revalidatePath('/', 'layout');
  return { succes: OK };
}

export async function enregistrerMentions(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaMentions.safeParse(lireFormulaire(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  if (await mettreAJour(session.organisationId, lu.data)) return { message: ECHEC, valeurs: valeursTexte(formData) };
  revalidatePath('/', 'layout');
  return { succes: OK };
}

export async function ajouterAssurance(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaAssurance.safeParse(lireFormulaire(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  const { error } = await supabase.from('assurances').insert({ ...lu.data, organisation_id: session.organisationId });
  if (error) return { message: ECHEC, valeurs: valeursTexte(formData) };
  revalidatePath('/', 'layout');
  return { succes: 'Assurance ajoutée.' };
}

const schemaSuppressionAssurance = z.object({
  id: z.uuid({ error: 'Assurance introuvable.' }),
  confirmation: z.literal('on', { error: 'Cochez la case pour confirmer la suppression.' }),
});

export async function supprimerAssurance(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const lu = schemaSuppressionAssurance.safeParse({ id: formData.get('id'), confirmation: formData.get('confirmation') });
  if (!lu.success) return { message: lu.error.issues[0]?.message ?? ECHEC };
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('assurances').delete().eq('id', lu.data.id).select('id');
  if (error) return { message: 'La suppression a échoué. Vérifiez la connexion et réessayez.' };
  if (!data?.length) return { message: 'Assurance introuvable (déjà supprimée ?).' };
  revalidatePath('/parametres', 'layout');
  return { succes: 'Assurance supprimée.' };
}

const schemaTauxTva = z.object({
  taux_bp: z.coerce.number().int().min(0).max(10000),
  champ: z.enum(['confirmer', 'actif']),
  valeur: z.enum(['0', '1']).optional(),
}).refine((v) => v.champ !== 'actif' || v.valeur !== undefined);

export async function majTauxTva(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaTauxTva.safeParse({
    taux_bp: formData.get('taux_bp'), champ: formData.get('champ'), valeur: formData.get('valeur') ?? undefined,
  });
  if (!lu.success) return { message: 'Demande invalide. Rechargez la page.' };
  const supabase = await clientServeur();
  const modification = lu.data.champ === 'confirmer' ? { a_verifier: false } : { actif: lu.data.valeur === '1' };
  const { data, error } = await supabase.from('taux_tva').update(modification)
    .eq('organisation_id', session.organisationId).eq('taux_bp', lu.data.taux_bp).select('taux_bp');
  if (error || !data?.length) return { message: 'La modification a échoué. Vérifiez la connexion et réessayez.' };
  revalidatePath('/parametres', 'layout');
  return { succes: lu.data.champ === 'confirmer' ? 'Taux confirmé.' : 'Enregistré.' };
}

export async function enregistrerModeleMessage(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const code = z.enum(CODES_MESSAGES).safeParse(formData.get('code'));
  if (!code.success) return { message: 'Modèle inconnu : rechargez la page.' };
  const lu = schemaModeleMessage(code.data).safeParse(lireFormulaire(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  if (lu.data.delai_jours !== undefined) {
    const { data: autres, error: e } = await supabase.from('modeles_messages').select('code, delai_jours')
      .eq('organisation_id', session.organisationId).in('code', ['impaye_1', 'impaye_2', 'impaye_3']);
    if (e) return { message: ECHEC, valeurs: valeursTexte(formData) };
    const delais = Object.fromEntries((autres ?? []).map((m) => [m.code, m.delai_jours ?? undefined]));
    const probleme = controlerDelaisRelances({ ...delais, [code.data]: lu.data.delai_jours });
    if (probleme) return { erreurs: { delai_jours: probleme }, valeurs: valeursTexte(formData) };
  }
  const { data, error } = await supabase.from('modeles_messages').update(lu.data)
    .eq('organisation_id', session.organisationId).eq('code', code.data).select('id');
  if (error || !data?.length) return { message: ECHEC, valeurs: valeursTexte(formData) };
  revalidatePath('/parametres/messages');
  return { succes: OK };
}
