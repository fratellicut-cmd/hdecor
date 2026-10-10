'use server';

import { createHash, randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { deposer, retirer } from '@/lib/stockage';
import { ipEtNavigateur } from '@/lib/requete';
import { chargerPv, donneesPdfPv, tracesPv } from '@/lib/pv';
import { pdfPv } from '@/lib/pdf/pv';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { lirePngSignature, MESSAGES_TRACE } from '@/lib/validation/devis';
import { schemaLevee, schemaPv, schemaSignaturePv } from '@/lib/validation/pv';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const INCOMPLET = 'Formulaire incomplet : rechargez la page.';
const idDe = (fd: FormData, cle: string) => z.uuid().safeParse(fd.get(cle));
const champs = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => !k.startsWith('$') && typeof v === 'string'));
const sha256 = (o: Uint8Array) => createHash('sha256').update(o).digest('hex');
/** Message d'une erreur métier de la base (P0001) ; sinon message générique. */
const messageBase = (e: { code?: string; message?: string }) => (e.code === 'P0001' || e.code === 'P0002' ? e.message ?? ECHEC : ECHEC);

const revalider = (chantierId: string, pvId?: string) => {
  revalidatePath(`/chantiers/${chantierId}`);
  revalidatePath(`/chantiers/${chantierId}/pv`);
  if (pvId) revalidatePath(`/chantiers/${chantierId}/pv/${pvId}`);
};

/** Nouveau PV (brouillon) pour un chantier ; identifiant fixé par le formulaire (pas de doublon). */
export async function creerPv(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const chantier = idDe(fd, 'chantier_id');
  const nouveau = idDe(fd, 'id_nouveau');
  if (!chantier.success || !nouveau.success) return { message: INCOMPLET };
  const lu = schemaPv.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const { data: ch } = await sb.from('chantiers').select('id').eq('id', chantier.data).maybeSingle();
  if (!ch) return { message: 'Chantier introuvable.' };
  const { error } = await sb.from('pv_reception').upsert({
    id: nouveau.data, organisation_id: session.organisationId, chantier_id: ch.id, ...lu.data, avec_reserves: lu.data.reserves.length > 0,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) return { message: error.code?.startsWith('23') ? 'Ces informations ont été refusées : vérifiez la saisie.' : ECHEC, valeurs: valeursTexte(fd) };
  revalider(ch.id);
  redirect(`/chantiers/${ch.id}/pv/${nouveau.data}`);
}

export async function enregistrerPv(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const lu = schemaPv.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const { data, error } = await sb.from('pv_reception').update({ ...lu.data, avec_reserves: lu.data.reserves.length > 0 })
    .eq('id', id.data).select('chantier_id');
  if (error) return { message: messageBase(error), valeurs: valeursTexte(fd) };
  if (!data?.length) return { message: 'PV introuvable.' };
  revalider(data[0]!.chantier_id, id.data);
  return { succes: 'PV enregistré.' };
}

export async function supprimerPv(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  if (fd.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer.' };
  const sb = await clientServeur();
  const { data, error } = await sb.from('pv_reception').delete().eq('id', id.data).select('chantier_id');
  if (error) return { message: messageBase(error) };
  if (!data?.length) return { message: 'PV introuvable.' };
  revalider(data[0]!.chantier_id);
  redirect(`/chantiers/${data[0]!.chantier_id}/pv`);
}

/**
 * Présenter le PV au client : le PDF du brouillon est figé (déposé, empreinte
 * enregistrée). C'est CE PDF que le client relit et signe ; toute modification
 * ultérieure efface l'empreinte (il faut le représenter).
 */
export async function presenterPv(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const c = await chargerPv(sb, id.data);
  if (!c) return { message: 'PV introuvable.' };
  if (c.pv.statut !== 'brouillon') return { message: 'Ce PV est déjà signé.' };
  const donnees = await donneesPdfPv(sb, c);
  if ('erreur' in donnees) return { message: donnees.erreur };
  const pdf = await pdfPv(donnees);
  const chemin = `${session.organisationId}/pv/${c.pv.id}/${randomUUID()}.pdf`;
  try {
    await deposer('documents', session.organisationId, chemin, pdf, 'application/pdf');
  } catch (e) {
    console.error('PV non déposé', e instanceof Error ? e.message : e);
    return { message: ECHEC };
  }
  const { error } = await sb.rpc('presenter_pv', { p_pv_id: c.pv.id, p_pdf_chemin: chemin, p_pdf_sha256: sha256(pdf) });
  if (error) {
    await retirer('documents', session.organisationId, chemin).catch(() => undefined);
    return { message: messageBase(error) };
  }
  // L'ancien PDF présenté (remplacé) n'est plus référencé.
  if (c.pv.pdf_chemin && c.pv.pdf_chemin !== chemin) await retirer('documents', session.organisationId, c.pv.pdf_chemin).catch(() => undefined);
  revalider(c.chantier.id, c.pv.id);
  redirect(`/chantiers/${c.chantier.id}/pv/${c.pv.id}/signer`);
}

/** Archive du PV signé (PDF portant les deux signatures) ; renvoie false si l'archivage a échoué. */
async function archiver(sb: Awaited<ReturnType<typeof clientServeur>>, organisationId: string, pvId: string): Promise<boolean> {
  const c = await chargerPv(sb, pvId);
  if (!c || c.pv.statut !== 'signe' || !c.signature || !c.pv.signature_entreprise_chemin) return false;
  if (c.signature.pdf_signe_chemin) return true;
  const traces = await tracesPv(organisationId, c.signature.image_chemin, c.pv.signature_entreprise_chemin);
  if (!traces) return false;
  const donnees = await donneesPdfPv(sb, c, {
    nom: c.signature.signataire_nom, mention: c.signature.mention, signeLe: c.signature.signe_le,
    client: traces.client, entreprise: traces.entreprise, documentSha256: c.signature.document_sha256,
  });
  if ('erreur' in donnees) return false;
  const pdf = await pdfPv(donnees);
  const chemin = `${organisationId}/pv/${pvId}/${randomUUID()}.pdf`;
  try {
    await deposer('documents', organisationId, chemin, pdf, 'application/pdf');
  } catch {
    return false;
  }
  const { error } = await sb.rpc('archiver_pv_signe', { p_pv_id: pvId, p_chemin: chemin, p_sha256: sha256(pdf) });
  if (error) { await retirer('documents', organisationId, chemin).catch(() => undefined); return false; }
  return true;
}

/** Signature sur place : le client (nom, « Lu et approuvé », tracé) puis l'entreprise (tracé). */
export async function signerPv(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sauf = ['image', 'image_entreprise'];
  const lu = schemaSignaturePv.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd, sauf) };
  const client = lirePngSignature(lu.data.image);
  if ('erreur' in client) return { erreurs: { image: MESSAGES_TRACE[client.erreur] }, valeurs: valeursTexte(fd, sauf) };
  const entreprise = lirePngSignature(lu.data.image_entreprise);
  if ('erreur' in entreprise) return { erreurs: { image_entreprise: MESSAGES_TRACE[entreprise.erreur] }, valeurs: valeursTexte(fd, sauf) };
  const sb = await clientServeur();
  const { data: pv } = await sb.from('pv_reception').select('id, chantier_id, statut, pdf_sha256').eq('id', id.data).maybeSingle();
  if (!pv) return { message: 'PV introuvable.' };
  if (pv.statut !== 'brouillon') return { message: 'Ce PV est déjà signé.' };
  if (pv.pdf_sha256 !== lu.data.document_sha256) return { message: 'Le PV a changé depuis sa présentation : présentez-le à nouveau.' };
  const base = `${session.organisationId}/pv/${pv.id}`;
  const cheminClient = `${base}/${randomUUID()}.png`;
  const cheminEntreprise = `${base}/${randomUUID()}.png`;
  try {
    await deposer('signatures', session.organisationId, cheminClient, client.octets, 'image/png');
    await deposer('signatures', session.organisationId, cheminEntreprise, entreprise.octets, 'image/png');
  } catch (e) {
    console.error('Tracés du PV non déposés', e instanceof Error ? e.message : e);
    await retirer('signatures', session.organisationId, cheminClient).catch(() => undefined);
    return { message: ECHEC, valeurs: valeursTexte(fd, sauf) };
  }
  const { ip, userAgent } = await ipEtNavigateur();
  const { error } = await sb.rpc('signer_pv_sur_place', {
    p_pv_id: pv.id, p_nom: lu.data.nom, p_mention: lu.data.mention, p_image_chemin: cheminClient, p_image_entreprise_chemin: cheminEntreprise,
    p_document_sha256: lu.data.document_sha256, p_ip: ip as string, p_user_agent: userAgent as string,
  });
  if (error) {
    // Refus certain : tracés retirés. Issue incertaine (réseau) : tracés gardés, état relu.
    if (error.code === 'P0001' || error.code === 'P0002' || error.code?.startsWith('23')) {
      await retirer('signatures', session.organisationId, cheminClient).catch(() => undefined);
      await retirer('signatures', session.organisationId, cheminEntreprise).catch(() => undefined);
      return { message: messageBase(error), valeurs: valeursTexte(fd, sauf) };
    }
    const { data: apres } = await sb.from('pv_reception').select('statut').eq('id', pv.id).maybeSingle();
    if (apres?.statut !== 'signe') return { message: 'Le réseau ne répond pas : la signature n’est pas confirmée. Rechargez la page avant de réessayer.', valeurs: valeursTexte(fd, sauf) };
  }
  const archive = await archiver(sb, session.organisationId, pv.id).catch(() => false);
  revalider(pv.chantier_id, pv.id);
  redirect(`/chantiers/${pv.chantier_id}/pv/${pv.id}?signe=1${archive ? '' : '&archive=0'}`);
}

export async function archiverPv(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data: pv } = await sb.from('pv_reception').select('chantier_id').eq('id', id.data).eq('statut', 'signe').maybeSingle();
  if (!pv) return { message: 'PV introuvable ou non signé.' };
  const ok = await archiver(sb, session.organisationId, id.data).catch(() => false);
  revalider(pv.chantier_id, id.data);
  return ok ? { succes: 'PV signé archivé.' } : { message: 'Archivage impossible pour l’instant. Réessayez plus tard.' };
}

/** Levée d'une réserve (PV signé) : date et note, définitives. */
export async function leverReserve(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const lu = schemaLevee.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const { error } = await sb.rpc('lever_reserve', { p_pv_id: id.data, p_rang: lu.data.rang, p_date: lu.data.levee_le, p_note: lu.data.levee_note as string });
  if (error) return { message: messageBase(error), valeurs: valeursTexte(fd) };
  const { data: pv } = await sb.from('pv_reception').select('chantier_id').eq('id', id.data).maybeSingle();
  if (pv) revalider(pv.chantier_id, id.data);
  return { succes: 'Réserve levée.' };
}
