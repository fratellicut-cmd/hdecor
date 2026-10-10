'use server';

import { revalidatePath } from 'next/cache';
import { PDFDocument } from 'pdf-lib';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { deposer, oublier, retirer } from '@/lib/stockage';
import { jpegSansMetadonnees, typeReel } from '@/lib/fichiers';
import type { EtatFormulaire } from '@/lib/etat-formulaire';

/** Limite de l'espace « marque » (2 Mo). */
const TAILLE_MAX_LOGO = 2 * 1024 * 1024;
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
  if (f.size > TAILLE_MAX_LOGO) return { erreurs: { logo: 'Fichier trop lourd (2 Mo au maximum).' } };
  let octets = new Uint8Array(await f.arrayBuffer());
  const type = typeReel(octets);
  if (type !== 'image/png' && type !== 'image/jpeg') return { erreurs: { logo: 'Format refusé : PNG ou JPEG seulement.' } };
  if (type === 'image/jpeg') {
    const net = jpegSansMetadonnees(octets);
    if (!net) return { erreurs: { logo: 'Image illisible : enregistrez-la à nouveau en PNG ou JPEG.' } };
    octets = new Uint8Array(net.octets);
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
  const { error } = await sb.from('parametres_entreprise').update({ logo_chemin: chemin }).eq('organisation_id', session.organisationId);
  if (error) {
    await retirer('marque', session.organisationId, chemin).catch(() => undefined);
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
  const { error } = await sb.from('parametres_entreprise').update({ logo_chemin: null }).eq('organisation_id', session.organisationId);
  if (error) return { message: ECHEC };
  await oublier('marque', session.organisationId, p.logo_chemin);
  revalidatePath('/parametres');
  return { succes: 'Logo retiré.' };
}
