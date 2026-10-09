'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { deposer, oublier } from '@/lib/stockage';
import { fichierConforme, typeReel, type TypeFichier } from '@/lib/fichiers';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { schemaCategorie, schemaDepense, schemaMateriel, TAILLE_MAX_JUSTIFICATIF } from '@/lib/validation/comptabilite';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const REFUS = 'Ces informations ont été refusées (valeur incohérente, chantier ou catégorie introuvable). Vérifiez la saisie.';
const INCOMPLET = 'Formulaire incomplet : rechargez la page.';
const idDe = (fd: FormData, cle: string) => z.uuid().safeParse(fd.get(cle));
const champs = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => !k.startsWith('$') && typeof v === 'string'));
const messageErreur = (code: string | undefined) => (code?.startsWith('23') ? REFUS : ECHEC);

/** Justificatifs acceptés (l'espace de stockage les limite aussi) ; taille : TAILLE_MAX_JUSTIFICATIF. */
const TYPES_JUSTIFICATIF: readonly TypeFichier[] = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EXTENSION: Partial<Record<TypeFichier, string>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

type Fichier = { octets: Uint8Array; type: TypeFichier } | null;

/** Justificatif joint : contenu vérifié (signature binaire), pas seulement le type annoncé par le navigateur. */
async function lireJustificatif(fd: FormData): Promise<Fichier | string> {
  const f = fd.get('justificatif');
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > TAILLE_MAX_JUSTIFICATIF) return 'Fichier trop lourd (5 Mo au maximum). Reprenez la photo ou envoyez un PDF plus léger.';
  const octets = new Uint8Array(await f.arrayBuffer());
  const type = typeReel(octets);
  if (!type || !fichierConforme(octets, type, TYPES_JUSTIFICATIF)) return 'Format refusé : photo (JPEG, PNG, WebP) ou PDF.';
  return { octets, type };
}

/** Dépose le justificatif d'un achat et l'y rattache ; l'ancien est retiré après coup. */
async function attacher(organisationId: string, depenseId: string, fichier: NonNullable<Fichier>, ancien: string | null): Promise<string | null> {
  const chemin = `${organisationId}/depenses/${depenseId}/${randomUUID()}.${EXTENSION[fichier.type]}`;
  try {
    await deposer('justificatifs', organisationId, chemin, fichier.octets, fichier.type);
  } catch (e) {
    console.error('Justificatif non déposé', e instanceof Error ? e.message : e);
    return 'Achat enregistré, mais le justificatif n’a pas pu être envoyé : ouvrez l’achat et ajoutez-le à nouveau.';
  }
  const sb = await clientServeur();
  const { data, error } = await sb.from('depenses').update({ justificatif_chemin: chemin }).eq('id', depenseId).select('id').maybeSingle();
  if (error || !data) {
    await oublier('justificatifs', organisationId, chemin);
    return 'Achat enregistré, mais le justificatif n’a pas pu y être rattaché : ouvrez l’achat et ajoutez-le à nouveau.';
  }
  if (ancien && ancien !== chemin) await oublier('justificatifs', organisationId, ancien);
  return null;
}

const revalider = (chantierId?: string | null) => {
  revalidatePath('/comptabilite', 'layout');
  revalidatePath('/');
  if (chantierId) revalidatePath(`/chantiers/${chantierId}`);
};

/**
 * Achat (création ou modification), avec photo ou PDF du ticket. Création :
 * identifiant fixé par le formulaire ; un second envoi (réponse perdue, ou
 * saisie corrigée entre-temps) met à jour l'achat déjà créé, sans doublon. Un
 * justificatif joint remplace le précédent (l'ancien fichier est retiré).
 */
export async function enregistrerDepense(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaDepense.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const fichier = await lireJustificatif(fd);
  if (typeof fichier === 'string') return { erreurs: { justificatif: fichier }, valeurs: valeursTexte(fd) };
  const existant = fd.get('id') ? idDe(fd, 'id') : null;
  const nouveau = idDe(fd, 'id_nouveau');
  if (existant ? !existant.success : !nouveau.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const id = existant?.success ? existant.data : nouveau.data!;

  const { data: avant, error: eAvant } = await sb.from('depenses').select('justificatif_chemin, chantier_id').eq('id', id).maybeSingle();
  if (eAvant) return { message: ECHEC, valeurs: valeursTexte(fd) };
  if (existant && !avant) return { message: 'Achat introuvable.' };
  const ecrire = async () => (avant
    ? sb.from('depenses').update(lu.data).eq('id', id)
    : sb.from('depenses').insert({ ...lu.data, id, organisation_id: session.organisationId }));
  let { error } = await ecrire();
  // Deux envois simultanés de la même création : le second met à jour l'achat créé par le premier.
  if (error?.code === '23505' && !avant) ({ error } = await sb.from('depenses').update(lu.data).eq('id', id));
  if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(fd) };
  const avertissement = fichier ? await attacher(session.organisationId, id, fichier, avant?.justificatif_chemin ?? null) : null;
  revalider(lu.data.chantier_id);
  if (avant?.chantier_id && avant.chantier_id !== lu.data.chantier_id) revalider(avant.chantier_id);
  if (avertissement) return { message: avertissement };
  if (existant) return { succes: 'Achat modifié.' };
  // Noté depuis la fiche d'un chantier (et toujours rattaché à lui) : retour au chantier.
  const depuis = idDe(fd, 'depuis_chantier');
  if (depuis.success && depuis.data === lu.data.chantier_id) redirect(`/chantiers/${depuis.data}?achat=1`);
  redirect(`/comptabilite/achats?mois=${lu.data.date_depense.slice(0, 7)}&enregistre=1`);
}

export async function supprimerDepense(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  if (fd.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer.' };
  const sb = await clientServeur();
  const { data, error } = await sb.from('depenses').delete().eq('id', id.data).select('justificatif_chemin, chantier_id, date_depense');
  if (error) return { message: error.code === '23503' ? 'Cet achat est rattaché à du matériel : retirez d’abord ce rattachement.' : ECHEC };
  const supprime = data?.[0];
  if (!supprime) return { message: 'Achat introuvable.' };
  if (supprime.justificatif_chemin) await oublier('justificatifs', session.organisationId, supprime.justificatif_chemin);
  revalider(supprime.chantier_id);
  redirect(`/comptabilite/achats?mois=${supprime.date_depense.slice(0, 7)}&supprime=1`);
}

export async function ajouterCategorie(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaCategorie.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const { error } = await sb.from('categories_depenses').insert({ organisation_id: session.organisationId, libelle: lu.data.libelle });
  if (error) return { erreurs: error.code === '23505' ? { libelle: 'Cette catégorie existe déjà.' } : undefined, message: error.code === '23505' ? undefined : ECHEC, valeurs: valeursTexte(fd) };
  revalider();
  return { succes: `Catégorie « ${lu.data.libelle} » ajoutée.` };
}

// --------------------------------------------------------------------------
// Matériel
// --------------------------------------------------------------------------

export async function enregistrerMateriel(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaMateriel.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const existant = fd.get('id') ? idDe(fd, 'id') : null;
  const nouveau = idDe(fd, 'id_nouveau');
  if (existant ? !existant.success : !nouveau.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { error } = existant?.success
    ? await sb.from('materiel').update(lu.data).eq('id', existant.data)
    : await sb.from('materiel').upsert({ ...lu.data, id: nouveau.data!, organisation_id: session.organisationId }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(fd) };
  revalider();
  return { succes: existant ? 'Matériel modifié.' : `« ${lu.data.libelle} » ajouté au matériel.` };
}

export async function supprimerMateriel(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  if (fd.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer.' };
  const sb = await clientServeur();
  const { error } = await sb.from('materiel').delete().eq('id', id.data);
  if (error) return { message: ECHEC };
  revalider();
  return { succes: 'Matériel retiré.' };
}
