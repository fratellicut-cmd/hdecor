'use server';

import { revalidatePath } from 'next/cache';
import { PDFDocument } from 'pdf-lib';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { MESSAGE_LOGO_TROP_LOURD, TAILLE_MAX_LOGO } from '@/domain/logo';
import { deposer, oublier } from '@/lib/stockage';
import { jpegSansMetadonnees, typeReel } from '@/lib/fichiers';
import type { EtatFormulaire } from '@/lib/etat-formulaire';
import { enregistrerCheminLogo } from '@/lib/logo';

/** Limite de l'espace « marque » (2 Mo). */
/** Côté maximal : une image très grande mais légère (fichier compressé) saturerait la mémoire à chaque PDF. */
const COTE_MAX_LOGO = 4096;

/** Dimensions lues dans l'en-tête PNG (IHDR). */
function dimensionsPng(o: Uint8Array) {
  if (o.length < 33) return null;
  const v = new DataView(o.buffer, o.byteOffset, o.byteLength);
  // Le premier bloc DOIT être IHDR (13 octets) : sinon les dimensions lues seraient celles d'un faux bloc.
  if (v.getUint32(8) !== 13 || String.fromCharCode(o[12]!, o[13]!, o[14]!, o[15]!) !== 'IHDR') return null;
  return { largeur: v.getUint32(16), hauteur: v.getUint32(20) };
}
const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';

/**
 * Logo de l'entreprise : PNG ou JPEG (contenu vérifié, métadonnées du JPEG
 * retirées), lisible par le générateur de PDF. L'ancien logo est retiré ; les
 * documents déjà émis gardent le leur (PDF figé).
 */
export async function deposerLogo(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const f = fd.get('logo');
  if (!(f instanceof File) || f.size === 0) return { erreurs: { logo: 'Choisissez un fichier PNG ou JPEG.' } };
  if (f.size > TAILLE_MAX_LOGO) return { erreurs: { logo: MESSAGE_LOGO_TROP_LOURD } };
  let octets = new Uint8Array(await f.arrayBuffer());
  const type = typeReel(octets);
  if (type !== 'image/png' && type !== 'image/jpeg') return { erreurs: { logo: 'Format refusé : PNG ou JPEG seulement.' } };
  let dimensions = type === 'image/png' ? dimensionsPng(octets) : null;
  if (type === 'image/jpeg') {
    const net = jpegSansMetadonnees(octets);
    if (!net) return { erreurs: { logo: 'Image illisible : enregistrez-la à nouveau en PNG ou JPEG.' } };
    octets = new Uint8Array(net.octets);
    dimensions = net.largeur && net.hauteur ? { largeur: net.largeur, hauteur: net.hauteur } : null;
  }
  if (!dimensions || dimensions.largeur < 1 || dimensions.hauteur < 1 || dimensions.largeur > COTE_MAX_LOGO || dimensions.hauteur > COTE_MAX_LOGO) {
    return { erreurs: { logo: `Image trop grande ou illisible : ${COTE_MAX_LOGO} pixels de côté au plus.` } };
  }
  try {
    const doc = await PDFDocument.create();
    if (type === 'image/png') await doc.embedPng(octets); else await doc.embedJpg(octets);
  } catch {
    return { erreurs: { logo: 'Image illisible pour les documents : enregistrez-la à nouveau en PNG.' } };
  }
  const sb = await clientServeur();
  const { data: p, error: lecture } = await sb.from('parametres_entreprise').select('logo_chemin').eq('organisation_id', session.organisationId).single();
  if (lecture || !p) return { message: ECHEC };
  const chemin = `${session.organisationId}/logo/${crypto.randomUUID()}.${type === 'image/png' ? 'png' : 'jpg'}`;
  try {
    await deposer('marque', session.organisationId, chemin, octets, type);
  } catch {
    return { message: ECHEC };
  }
  if (!(await enregistrerCheminLogo(session.organisationId, chemin))) {
    await oublier('marque', session.organisationId, chemin);
    return { message: ECHEC };
  }
  if (p.logo_chemin) await oublier('marque', session.organisationId, p.logo_chemin);
  revalidatePath('/parametres');
  return { succes: 'Logo enregistré : il figurera sur les prochains devis, factures et procès-verbaux.' };
}

/** Retire le logo (les documents déjà émis gardent le leur). */
export async function retirerLogo(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  if (fd.get('confirmer') !== 'oui') return { message: 'Formulaire incomplet : rechargez la page.' };
  const sb = await clientServeur();
  const { data: p } = await sb.from('parametres_entreprise').select('logo_chemin').eq('organisation_id', session.organisationId).single();
  if (!p?.logo_chemin) return { succes: 'Aucun logo.' };
  if (!(await enregistrerCheminLogo(session.organisationId, null))) return { message: ECHEC };
  await oublier('marque', session.organisationId, p.logo_chemin);
  revalidatePath('/parametres');
  return { succes: 'Logo retiré.' };
}
