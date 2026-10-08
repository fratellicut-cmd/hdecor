'use server';

import { revalidatePath } from 'next/cache';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import {
  lireFormulaire, schemaAssurance, schemaConditions, schemaEntreprise, schemaFiscal, schemaMentions,
} from '@/lib/validation/parametres';
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
  const erreur = await mettreAJour(session.organisationId, {
    ...valeurs,
    mention_franchise_a_verifier: !mention_franchise_confirmee,
    seuils_confirmes_le: seuils_confirmes ? aujourdHuiParis() : null,
  });
  if (erreur) return { message: ECHEC };
  revalidatePath('/', 'layout');
  return { succes: OK };
}

export async function enregistrerConditions(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaConditions.safeParse(lireFormulaire(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const { confirmes, ...valeurs } = lu.data;
  const supabase = await clientServeur();
  const { data: actuel } = await supabase.from('parametres_entreprise').select('valeurs_a_verifier')
    .eq('organisation_id', session.organisationId).single();
  const restants = (actuel?.valeurs_a_verifier ?? []).filter((c) => !(confirmes as string[]).includes(c));
  if (await mettreAJour(session.organisationId, { ...valeurs, valeurs_a_verifier: restants })) return { message: ECHEC };
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

export async function supprimerAssurance(formData: FormData) {
  await verifierSession();
  const id = String(formData.get('id') ?? '');
  const supabase = await clientServeur();
  await supabase.from('assurances').delete().eq('id', id);
  revalidatePath('/parametres/assurances');
}

export async function majTauxTva(formData: FormData) {
  const session = await verifierSession();
  const tauxBp = Number(formData.get('taux_bp'));
  if (!Number.isSafeInteger(tauxBp)) return;
  const champ = String(formData.get('champ'));
  const supabase = await clientServeur();
  const requete = supabase.from('taux_tva');
  if (champ === 'confirmer') await requete.update({ a_verifier: false }).eq('organisation_id', session.organisationId).eq('taux_bp', tauxBp);
  if (champ === 'actif') await requete.update({ actif: formData.get('valeur') === '1' }).eq('organisation_id', session.organisationId).eq('taux_bp', tauxBp);
  revalidatePath('/parametres/taux-tva');
}
