'use server';

import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { viderFileSuppression } from '@/lib/stockage-admin';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { mursSaisis, schemaChantier, schemaElement, schemaOuverture, schemaPiece, schemaPoste, STATUTS_CHANTIER } from '@/lib/validation/chantiers';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const REFUS = 'Ces informations ont été refusées (valeur hors limites ou incohérente). Vérifiez la saisie.';
const identifiant = z.uuid();

const messageErreur = (code: string | undefined) => (code?.startsWith('23') || code === 'P0001' ? REFUS : ECHEC);

function lireChamps(formData: FormData, tableaux: string[] = []): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const t of tableaux) o[t] = formData.getAll(t).map(String);
  for (const [k, v] of formData.entries()) if (!k.startsWith('$') && !tableaux.includes(k)) o[k] = v;
  return o;
}

const idDe = (formData: FormData, cle: string) => identifiant.safeParse(formData.get(cle));

// --------------------------------------------------------------------------
// Chantiers
// --------------------------------------------------------------------------

export async function enregistrerChantier(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaChantier.safeParse(lireChamps(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();

  // Le client doit exister dans l'organisation et ne pas être anonymisé.
  const { data: client, error: eClient } = await supabase.from('clients')
    .select('id, anonymise_le, fact_ligne1, fact_ligne2, fact_code_postal, fact_ville').eq('id', lu.data.client_id).maybeSingle();
  if (eClient) return { message: ECHEC, valeurs: valeursTexte(formData) };
  if (!client || client.anonymise_le) return { erreurs: { client_id: 'Client introuvable ou anonymisé.' }, valeurs: valeursTexte(formData) };

  // « Même adresse que le client » : reprise de l'adresse de facturation.
  const valeurs = formData.get('adresse_client') === 'on'
    ? { ...lu.data, adresse_ligne1: client.fact_ligne1, adresse_ligne2: client.fact_ligne2, code_postal: client.fact_code_postal, ville: client.fact_ville }
    : lu.data;

  const idSaisi = formData.get('id');
  let id: string;
  if (idSaisi) {
    const idLu = identifiant.safeParse(idSaisi);
    if (!idLu.success) return { message: 'Chantier introuvable.' };
    const { data, error } = await supabase.from('chantiers').update(valeurs).eq('id', idLu.data).select('id').maybeSingle();
    if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData) };
    if (!data) return { message: 'Chantier introuvable.' };
    id = data.id;
  } else {
    const { data, error } = await supabase.from('chantiers')
      .insert({ ...valeurs, organisation_id: session.organisationId }).select('id').single();
    if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData) };
    id = data.id;
  }
  revalidatePath('/chantiers');
  redirect(`/chantiers/${id}?enregistre=1`);
}

export async function changerStatutChantier(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(formData, 'id');
  const statut = z.enum(STATUTS_CHANTIER).safeParse(formData.get('statut'));
  if (!id.success || !statut.success) return { message: 'Demande invalide. Rechargez la page.' };
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('chantiers').update({ statut: statut.data }).eq('id', id.data).select('id');
  if (error || !data?.length) return { message: ECHEC };
  revalidatePath(`/chantiers/${id.data}`);
  return { succes: 'Statut mis à jour.' };
}

export async function supprimerChantier(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(formData, 'id');
  if (!id.success) return { message: 'Demande invalide. Rechargez la page.' };
  if (formData.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer la suppression.' };
  const supabase = await clientServeur();
  const { data: fichiers, error } = await supabase.rpc('supprimer_chantier', { p_chantier_id: id.data });
  if (error) {
    return { message: error.code === 'P0001' ? 'Ce chantier a des devis, factures ou un PV : il ne peut pas être supprimé.' : ECHEC };
  }
  if ((fichiers ?? 0) > 0) {
    after(async () => {
      try { await viderFileSuppression({ organisationId: session.organisationId }); } catch (e) {
        console.error('Chantier supprimé : fichiers reportés à la tâche planifiée', e instanceof Error ? e.message : e);
      }
    });
  }
  revalidatePath('/chantiers');
  redirect('/chantiers?supprime=1');
}

// --------------------------------------------------------------------------
// Pièces
// --------------------------------------------------------------------------

export async function enregistrerPiece(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const chantierId = idDe(formData, 'chantier_id');
  if (!chantierId.success) return { message: 'Chantier introuvable.' };
  const lu = schemaPiece.safeParse({ ...lireChamps(formData), murs: mursSaisis(formData) });
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  const idSaisi = formData.get('id');
  let id: string;
  if (idSaisi) {
    const idLu = identifiant.safeParse(idSaisi);
    if (!idLu.success) return { message: 'Pièce introuvable.' };
    const { data, error } = await supabase.from('pieces').update(lu.data).eq('id', idLu.data).select('id').maybeSingle();
    if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData) };
    if (!data) return { message: 'Pièce introuvable.' };
    id = data.id;
  } else {
    const { data: ordre } = await supabase.from('pieces').select('ordre').eq('chantier_id', chantierId.data)
      .order('ordre', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('pieces').insert({
      ...lu.data, organisation_id: session.organisationId, chantier_id: chantierId.data, ordre: (ordre?.ordre ?? -1) + 1,
    }).select('id').single();
    if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData) };
    id = data.id;
  }
  revalidatePath(`/chantiers/${chantierId.data}`, 'layout');
  redirect(`/chantiers/${chantierId.data}/pieces/${id}?enregistre=1`);
}

export async function dupliquerPiece(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(formData, 'id');
  const chantierId = idDe(formData, 'chantier_id');
  const nom = z.string().trim().min(1).max(100).safeParse(formData.get('nom'));
  if (!id.success || !chantierId.success) return { message: 'Demande invalide. Rechargez la page.' };
  if (!nom.success) return { erreurs: { nom: 'Nom de la copie : 1 à 100 caractères.' } };
  const supabase = await clientServeur();
  const { data, error } = await supabase.rpc('dupliquer_piece', { p_piece_id: id.data, p_nom: nom.data });
  if (error || !data) return { message: ECHEC };
  revalidatePath(`/chantiers/${chantierId.data}`, 'layout');
  redirect(`/chantiers/${chantierId.data}/pieces/${data}?enregistre=1`);
}

export async function supprimerPiece(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(formData, 'id');
  const chantierId = idDe(formData, 'chantier_id');
  if (!id.success || !chantierId.success) return { message: 'Demande invalide. Rechargez la page.' };
  if (formData.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer la suppression.' };
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('pieces').delete().eq('id', id.data).select('id');
  if (error || !data?.length) return { message: ECHEC };
  revalidatePath(`/chantiers/${chantierId.data}`, 'layout');
  redirect(`/chantiers/${chantierId.data}?piece=supprimee`);
}

// --------------------------------------------------------------------------
// Ouvertures et éléments
// --------------------------------------------------------------------------

async function cheminPiece(pieceId: string) {
  const supabase = await clientServeur();
  const { data } = await supabase.from('pieces').select('chantier_id').eq('id', pieceId).maybeSingle();
  return data ? `/chantiers/${data.chantier_id}/pieces/${pieceId}` : null;
}

export async function ajouterOuverture(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const pieceId = idDe(formData, 'piece_id');
  if (!pieceId.success) return { message: 'Pièce introuvable.' };
  const lu = schemaOuverture.safeParse(lireChamps(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  const { error } = await supabase.from('ouvertures').insert({ ...lu.data, organisation_id: session.organisationId, piece_id: pieceId.data });
  if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData) };
  const chemin = await cheminPiece(pieceId.data);
  if (chemin) revalidatePath(chemin);
  return { succes: 'Ouverture ajoutée.' };
}

export async function ajouterElement(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const pieceId = idDe(formData, 'piece_id');
  if (!pieceId.success) return { message: 'Pièce introuvable.' };
  const lu = schemaElement.safeParse(lireChamps(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };
  const supabase = await clientServeur();
  const { error } = await supabase.from('elements').insert({ ...lu.data, organisation_id: session.organisationId, piece_id: pieceId.data });
  if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData) };
  const chemin = await cheminPiece(pieceId.data);
  if (chemin) revalidatePath(chemin);
  return { succes: 'Élément ajouté.' };
}

/** Retrait d'une ouverture ou d'un élément (une ligne d'une liste). */
export async function retirerLigne(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(formData, 'id');
  const pieceId = idDe(formData, 'piece_id');
  const table = z.enum(['ouvertures', 'elements']).safeParse(formData.get('table'));
  if (!id.success || !pieceId.success || !table.success) return { message: 'Demande invalide. Rechargez la page.' };
  const supabase = await clientServeur();
  if (table.data === 'elements') {
    // La base supprimerait en cascade les postes de peinture de l'élément :
    // on refuse plutôt, pour ne rien faire disparaître sans le dire.
    const { count, error: eCompte } = await supabase.from('postes_travaux').select('id', { count: 'exact', head: true }).eq('element_id', id.data);
    if (eCompte) return { message: ECHEC };
    if (count) return { message: 'Cet élément est peint dans un poste de peinture : retirez d’abord le poste.' };
  }
  const { data, error } = await supabase.from(table.data).delete().eq('id', id.data).eq('piece_id', pieceId.data).select('id');
  if (error) return { message: ECHEC };
  if (!data?.length) return { message: 'Déjà retiré.' };
  const chemin = await cheminPiece(pieceId.data);
  if (chemin) revalidatePath(chemin);
  return { succes: 'Retiré.' };
}

// --------------------------------------------------------------------------
// Postes de peinture
// --------------------------------------------------------------------------

export async function enregistrerPoste(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const chantierId = idDe(formData, 'chantier_id');
  if (!chantierId.success) return { message: 'Chantier introuvable.' };
  const lu = schemaPoste.safeParse(lireChamps(formData, ['etapes']));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData, ['etapes']) };
  const { etapes, ...poste } = lu.data;
  const supabase = await clientServeur();

  // La pièce doit appartenir au chantier (et l'élément à la pièce : clé étrangère composite côté base).
  const { data: piece } = await supabase.from('pieces').select('id').eq('id', poste.piece_id).eq('chantier_id', chantierId.data).maybeSingle();
  if (!piece) return { erreurs: { piece_id: 'Pièce introuvable dans ce chantier.' }, valeurs: valeursTexte(formData, ['etapes']) };
  if (poste.element_id) {
    const { data: el } = await supabase.from('elements').select('id').eq('id', poste.element_id).eq('piece_id', poste.piece_id).maybeSingle();
    if (!el) return { erreurs: { element_id: 'Cet élément n’appartient pas à la pièce choisie.' }, valeurs: valeursTexte(formData, ['etapes']) };
  }

  const idSaisi = formData.get('id');
  let id: string;
  if (idSaisi) {
    const idLu = identifiant.safeParse(idSaisi);
    if (!idLu.success) return { message: 'Poste introuvable.' };
    const { data, error } = await supabase.from('postes_travaux').update(poste).eq('id', idLu.data).select('id').maybeSingle();
    if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData, ['etapes']) };
    if (!data) return { message: 'Poste introuvable.' };
    id = data.id;
  } else {
    const { data, error } = await supabase.from('postes_travaux').insert({ ...poste, organisation_id: session.organisationId }).select('id').single();
    if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData, ['etapes']) };
    id = data.id;
  }
  const { error: ePrep } = await supabase.rpc('definir_preparations', { p_poste_id: id, p_etapes: etapes });
  if (ePrep) return { message: 'Poste enregistré, mais pas ses étapes de préparation : réessayez.', valeurs: valeursTexte(formData, ['etapes']) };
  revalidatePath(`/chantiers/${chantierId.data}`, 'layout');
  redirect(`/chantiers/${chantierId.data}/peinture?enregistre=1#poste-${id}`);
}

export async function supprimerPoste(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(formData, 'id');
  const chantierId = idDe(formData, 'chantier_id');
  if (!id.success || !chantierId.success) return { message: 'Demande invalide. Rechargez la page.' };
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('postes_travaux').delete().eq('id', id.data).select('id');
  if (error || !data?.length) return { message: ECHEC };
  revalidatePath(`/chantiers/${chantierId.data}`, 'layout');
  return { succes: 'Poste retiré.' };
}
