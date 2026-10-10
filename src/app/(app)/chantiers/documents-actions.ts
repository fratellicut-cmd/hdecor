'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { deposer, oublier } from '@/lib/stockage';
import { fichierConforme, jpegSansMetadonnees, typeReel, type TypeFichier } from '@/lib/fichiers';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { PHOTOS_PAR_ENVOI, schemaDocument, schemaModifierPhoto, schemaPhotos, TAILLE_MAX_ENVOI } from '@/lib/validation/documents';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const INCOMPLET = 'Formulaire incomplet : rechargez la page.';
const idDe = (fd: FormData, cle: string) => z.uuid().safeParse(fd.get(cle));
const champs = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => !k.startsWith('$') && typeof v === 'string'));
const fichiers = (fd: FormData, cle: string) => fd.getAll(cle).filter((f): f is File => f instanceof File && f.size > 0);

const revalider = (chantierId: string) => {
  revalidatePath(`/chantiers/${chantierId}`);
  revalidatePath(`/chantiers/${chantierId}/photos`);
  revalidatePath(`/chantiers/${chantierId}/documents`);
};

/** Chantier lisible par la session (RLS) et, le cas échéant, pièce de CE chantier. */
async function verifierChantier(sb: Awaited<ReturnType<typeof clientServeur>>, chantierId: string, pieceId: string | null): Promise<string | null> {
  const { data: ch } = await sb.from('chantiers').select('id').eq('id', chantierId).maybeSingle();
  if (!ch) return 'Chantier introuvable.';
  if (pieceId) {
    const { data: piece } = await sb.from('pieces').select('id').eq('id', pieceId).eq('chantier_id', chantierId).maybeSingle();
    if (!piece) return 'Pièce introuvable sur ce chantier.';
  }
  return null;
}

// --------------------------------------------------------------------------
// Photos
// --------------------------------------------------------------------------

/**
 * Ajout de photos (une à huit) : JPEG uniquement (le téléphone convertit et
 * réduit avant l'envoi), métadonnées retirées par le serveur (position GPS,
 * appareil), rangées dans le dossier du chantier. Une photo refusée n'empêche
 * pas les autres d'être enregistrées.
 */
export async function ajouterPhotos(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaPhotos.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const liste = fichiers(fd, 'photos');
  if (!liste.length) return { erreurs: { photos: 'Choisissez au moins une photo.' }, valeurs: valeursTexte(fd) };
  if (liste.length > PHOTOS_PAR_ENVOI) return { erreurs: { photos: `${PHOTOS_PAR_ENVOI} photos au maximum par envoi.` }, valeurs: valeursTexte(fd) };
  if (liste.reduce((a, f) => a + f.size, 0) > TAILLE_MAX_ENVOI) return { erreurs: { photos: 'Envoi trop lourd : envoyez moins de photos à la fois.' }, valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const refus = await verifierChantier(sb, lu.data.chantier_id, lu.data.piece_id);
  if (refus) return { message: refus };

  let ok = 0;
  const problemes: string[] = [];
  for (const f of liste) {
    const propre = jpegSansMetadonnees(new Uint8Array(await f.arrayBuffer()));
    if (!propre || typeReel(propre.octets) !== 'image/jpeg') { problemes.push(`${f.name} : format non reconnu (prenez la photo avec l’appareil photo, en JPEG)`); continue; }
    const id = randomUUID();
    const chemin = `${session.organisationId}/chantiers/${lu.data.chantier_id}/photos/${id}.jpg`;
    try {
      await deposer('photos', session.organisationId, chemin, propre.octets, 'image/jpeg');
    } catch (e) {
      console.error('Photo non déposée', e instanceof Error ? e.message : e);
      problemes.push(`${f.name} : envoi impossible`);
      continue;
    }
    const { error } = await sb.from('photos').insert({
      id, organisation_id: session.organisationId, chantier_id: lu.data.chantier_id, piece_id: lu.data.piece_id, moment: lu.data.moment,
      legende: lu.data.legende, chemin, largeur: propre.largeur, hauteur: propre.hauteur,
    });
    if (error) {
      await oublier('photos', session.organisationId, chemin);
      problemes.push(`${f.name} : non enregistrée`);
      continue;
    }
    ok += 1;
  }
  revalider(lu.data.chantier_id);
  if (!ok) return { message: `Aucune photo enregistrée. ${problemes.join(' ; ')}.` };
  const bilan = `${ok} photo${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''}.`;
  return problemes.length ? { message: `${bilan} Refusées : ${problemes.join(' ; ')}.` } : { succes: bilan };
}

export async function modifierPhoto(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const lu = schemaModifierPhoto.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const { data: photo } = await sb.from('photos').select('chantier_id').eq('id', lu.data.id).maybeSingle();
  if (!photo) return { message: 'Photo introuvable.' };
  const refus = await verifierChantier(sb, photo.chantier_id, lu.data.piece_id);
  if (refus) return { message: refus };
  const { error } = await sb.from('photos').update({
    moment: lu.data.moment, piece_id: lu.data.piece_id, legende: lu.data.legende, en_galerie: lu.data.en_galerie,
  }).eq('id', lu.data.id);
  if (error) return { message: ECHEC, valeurs: valeursTexte(fd) };
  revalider(photo.chantier_id);
  return { succes: 'Photo mise à jour.' };
}

export async function supprimerPhoto(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  if (fd.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer.' };
  const sb = await clientServeur();
  const { data, error } = await sb.from('photos').delete().eq('id', id.data).select('chemin, chantier_id');
  if (error) return { message: ECHEC };
  const p = data?.[0];
  if (!p) return { message: 'Photo introuvable.' };
  await oublier('photos', session.organisationId, p.chemin);
  revalider(p.chantier_id);
  return { succes: 'Photo supprimée.' };
}

/** Accord du client pour diffuser les photos (portfolio, réseaux sociaux), daté ; retirable. */
export async function enregistrerAccordDiffusion(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'chantier_id');
  if (!id.success) return { message: INCOMPLET };
  const accord = fd.get('accord') === 'oui';
  if (accord && fd.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer l’accord du client.' };
  const sb = await clientServeur();
  const { data, error } = await sb.from('chantiers').update({ accord_diffusion_photos_le: accord ? new Date().toISOString() : null })
    .eq('id', id.data).select('id');
  if (error) return { message: ECHEC };
  if (!data?.length) return { message: 'Chantier introuvable.' };
  revalider(id.data);
  return { succes: accord ? 'Accord du client noté.' : 'Accord retiré : la galerie n’est plus exportable.' };
}

// --------------------------------------------------------------------------
// Documents de chantier (fiches techniques, attestations, plans)
// --------------------------------------------------------------------------

const TYPES_DOCUMENT_FICHIER: readonly TypeFichier[] = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const EXTENSION: Partial<Record<TypeFichier, string>> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function ajouterDocument(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaDocument.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const [f] = fichiers(fd, 'fichier');
  if (!f) return { erreurs: { fichier: 'Choisissez le fichier.' }, valeurs: valeursTexte(fd) };
  if (f.size > TAILLE_MAX_ENVOI) return { erreurs: { fichier: 'Fichier trop lourd (5 Mo au maximum).' }, valeurs: valeursTexte(fd) };
  let octets: Uint8Array = new Uint8Array(await f.arrayBuffer());
  const type = typeReel(octets);
  if (!type || !fichierConforme(octets, type, TYPES_DOCUMENT_FICHIER)) return { erreurs: { fichier: 'Format refusé : PDF ou photo (JPEG, PNG, WebP).' }, valeurs: valeursTexte(fd) };
  if (type === 'image/jpeg') octets = jpegSansMetadonnees(octets)?.octets ?? octets;
  const sb = await clientServeur();
  const refus = await verifierChantier(sb, lu.data.chantier_id, null);
  if (refus) return { message: refus };
  const id = randomUUID();
  const chemin = `${session.organisationId}/chantiers/${lu.data.chantier_id}/documents/${id}.${EXTENSION[type]}`;
  try {
    await deposer('justificatifs', session.organisationId, chemin, octets, type);
  } catch (e) {
    console.error('Document non déposé', e instanceof Error ? e.message : e);
    return { message: ECHEC, valeurs: valeursTexte(fd) };
  }
  const { error } = await sb.from('documents_chantier').insert({
    id, organisation_id: session.organisationId, chantier_id: lu.data.chantier_id, type: lu.data.type, nom: lu.data.nom, chemin, espace: 'justificatifs',
  });
  if (error) {
    await oublier('justificatifs', session.organisationId, chemin);
    return { message: ECHEC, valeurs: valeursTexte(fd) };
  }
  revalider(lu.data.chantier_id);
  return { succes: `« ${lu.data.nom} » ajouté.` };
}

export async function supprimerDocument(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  if (fd.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer.' };
  const sb = await clientServeur();
  const { data, error } = await sb.from('documents_chantier').delete().eq('id', id.data).select('chemin, chantier_id');
  if (error) return { message: ECHEC };
  const d = data?.[0];
  if (!d) return { message: 'Document introuvable.' };
  await oublier('justificatifs', session.organisationId, d.chemin);
  revalider(d.chantier_id);
  return { succes: 'Document supprimé.' };
}
