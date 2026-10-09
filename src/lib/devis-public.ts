import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { clientAdmin } from '@/lib/supabase/admin';
import { deposer, lire } from '@/lib/stockage';
import { pdfDevisSigne, titreDevis } from '@/lib/pdf/devis';
import { ajouterJours, avecRetractation, type CopieClient } from '@/domain/devis-document';
import { retirer } from '@/lib/stockage';
import { totalLigne, type Regime } from '@/domain/devis';

/**
 * Accès « service » des devis, réservé à deux cas (règle ESLint) :
 *  - le lien public : le JETON est vérifié par la base (devis_par_jeton,
 *    signer_devis_par_jeton) avant toute lecture, et chaque lecture filtre sur
 *    le devis ET l'organisation que le jeton désigne ;
 *  - l'archivage du PDF signé (la table signatures n'est modifiable que par
 *    le serveur) : appelé avec l'organisation de la session ou du jeton.
 */

export type OptionPublique = { id: string; designation: string; description: string | null; totalHtCents: bigint };

export type DevisPublic = {
  devisId: string;
  organisationId: string;
  titre: string;
  entreprise: string;
  statut: string;
  peutSigner: boolean;
  pdfChemin: string;
  pdfSha256: string;
  valideJusquAu: string;
  regime: Regime;
  totalTtcCents: bigint;
  totalHtCents: bigint;
  options: OptionPublique[];
  /** Rétractation applicable (hors établissement ET client particulier), comme sur le PDF. */
  retractation: boolean;
  pdfSigneChemin: string | null;
};

/** Devis désigné par un jeton valide ; null sinon (même réponse dans tous les cas). */
export async function devisParJeton(jeton: string): Promise<DevisPublic | null> {
  const admin = clientAdmin();
  const { data, error } = await admin.rpc('devis_par_jeton', { p_jeton: jeton });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) return null;
  const r = data as { devis_id: string; organisation_id: string; peut_signer: boolean };
  const [{ data: d }, { data: options }] = await Promise.all([
    admin.from('devis').select('numero, version, statut, pdf_chemin, pdf_sha256, date_emission, validite_jours, regime_tva, total_ttc_cents, total_ht_cents, hors_etablissement, copie_emetteur, copie_client, signature_id')
      .eq('id', r.devis_id).eq('organisation_id', r.organisation_id).maybeSingle(),
    admin.from('devis_lignes').select('id, designation, description, quantite_e4, prix_unitaire_ht_cents, remise_bp')
      .eq('devis_id', r.devis_id).eq('organisation_id', r.organisation_id).eq('type', 'ligne').eq('optionnelle', true).order('ordre'),
  ]);
  if (!d || !d.pdf_chemin || !d.pdf_sha256 || !d.date_emission) return null;
  let pdfSigneChemin: string | null = null;
  if (d.signature_id) {
    const { data: s } = await admin.from('signatures').select('pdf_signe_chemin')
      .eq('id', d.signature_id).eq('organisation_id', r.organisation_id).maybeSingle();
    pdfSigneChemin = s?.pdf_signe_chemin ?? null;
  }
  const emetteur = (d.copie_emetteur ?? {}) as { raison_sociale?: string | null };
  return {
    devisId: r.devis_id, organisationId: r.organisation_id, titre: titreDevis(d.numero, d.version),
    entreprise: emetteur.raison_sociale ?? '', statut: d.statut, peutSigner: r.peut_signer,
    pdfChemin: d.pdf_chemin, pdfSha256: d.pdf_sha256, valideJusquAu: ajouterJours(d.date_emission, d.validite_jours),
    regime: d.regime_tva, totalTtcCents: BigInt(d.total_ttc_cents), totalHtCents: BigInt(d.total_ht_cents),
    retractation: avecRetractation(d.hors_etablissement, (d.copie_client ?? {}) as CopieClient), pdfSigneChemin,
    options: (options ?? []).map((o) => ({
      id: o.id, designation: o.designation, description: o.description,
      totalHtCents: totalLigne(BigInt(o.quantite_e4 ?? 0), BigInt(o.prix_unitaire_ht_cents ?? 0), o.remise_bp),
    })),
  };
}

const sha256 = (o: Uint8Array) => createHash('sha256').update(o).digest('hex');

/**
 * PDF (original, ou signé s'il existe et est demandé) d'un devis désigné par
 * un jeton valide. L'empreinte du fichier servi est RECALCULÉE et comparée à
 * celle enregistrée : le client ne reçoit jamais un document différent de celui
 * qu'il signe (sinon : refus, et l'incident est journalisé).
 */
export async function pdfParJeton(jeton: string, signe: boolean): Promise<{ octets: Uint8Array; nom: string } | null> {
  const d = await devisParJeton(jeton);
  if (!d) return null;
  const versionSignee = signe && d.pdfSigneChemin;
  const octets = await lire('documents', d.organisationId, versionSignee ? d.pdfSigneChemin! : d.pdfChemin);
  if (!octets) return null;
  const attendu = versionSignee ? await empreinteSignee(d.organisationId, d.devisId) : d.pdfSha256;
  if (sha256(octets) !== attendu) {
    console.error('Empreinte du PDF différente de celle enregistrée', d.devisId);
    return null;
  }
  return { octets, nom: `${d.titre.replace(/[^A-Za-z0-9-]+/g, '-')}${versionSignee ? '-signe' : ''}.pdf` };
}

async function empreinteSignee(organisationId: string, devisId: string): Promise<string | null> {
  const admin = clientAdmin();
  const { data: d } = await admin.from('devis').select('signature_id').eq('id', devisId).eq('organisation_id', organisationId).maybeSingle();
  if (!d?.signature_id) return null;
  const { data: s } = await admin.from('signatures').select('pdf_signe_sha256').eq('id', d.signature_id).eq('organisation_id', organisationId).maybeSingle();
  return s?.pdf_signe_sha256 ?? null;
}

/** Dépose le tracé de signature (PNG déjà contrôlé) ; renvoie son chemin. */
export async function deposerTrace(organisationId: string, devisId: string, png: Uint8Array): Promise<string> {
  const chemin = `${organisationId}/devis/${devisId}/${randomUUID()}.png`;
  await deposer('signatures', organisationId, chemin, png, 'image/png');
  return chemin;
}

/** Signature par lien : la base vérifie le jeton (usage unique), l'empreinte, la validité et les options. */
export async function signerParJeton(jeton: string, s: {
  nom: string; mention: string; png: Uint8Array; documentSha256: string; options: string[]; ip: string | null; userAgent: string | null;
}): Promise<{ ok: true; devisId: string; organisationId: string } | { ok: false; message: string }> {
  const d = await devisParJeton(jeton);
  if (!d || !d.peutSigner) return { ok: false, message: 'Ce lien ne permet plus de signer (déjà utilisé, expiré ou révoqué).' };
  // Contrôles AVANT tout dépôt de fichier : un envoi refusé ne laisse rien dans le stockage.
  if (s.documentSha256 !== d.pdfSha256) return { ok: false, message: messageSignature('ne correspond pas') };
  if (s.options.some((o) => !d.options.some((x) => x.id === o))) return { ok: false, message: messageSignature('Option inconnue') };
  const image = await deposerTrace(d.organisationId, d.devisId, s.png);
  const { error } = await clientAdmin().rpc('signer_devis_par_jeton', {
    p_jeton: jeton, p_nom: s.nom, p_mention: s.mention, p_image_chemin: image, p_document_sha256: s.documentSha256,
    p_options: s.options, p_ip: s.ip as unknown as string, p_user_agent: s.userAgent as unknown as string,
  });
  if (error) {
    const certain = error.code === 'P0001' || error.code === 'P0002';
    // Refus certain : le tracé n'est référencé nulle part. Sinon (réponse perdue) il est gardé.
    if (certain) await retirer('signatures', d.organisationId, image).catch(() => undefined);
    if (error.code === 'P0002') return { ok: false, message: 'Ce lien ne permet plus de signer (déjà utilisé, expiré ou révoqué).' };
    if (error.code === 'P0001') return { ok: false, message: messageSignature(error.message) };
    return { ok: false, message: 'La signature n’a pas pu être enregistrée. Réessayez.' };
  }
  return { ok: true, devisId: d.devisId, organisationId: d.organisationId };
}

/** Messages de la base (refus métier) -> texte pour le signataire. */
export function messageSignature(m: string): string {
  if (/expiré/.test(m)) return 'Ce devis a expiré : demandez une nouvelle version à l’entreprise.';
  if (/ne correspond pas/.test(m)) return 'Le devis a changé depuis l’ouverture de la page : rechargez-la avant de signer.';
  if (/Option inconnue/.test(m)) return 'Option inconnue : rechargez la page.';
  if (/ne peut plus être signé/.test(m)) return 'Ce devis ne peut plus être signé (déjà signé, refusé ou remplacé).';
  return 'La signature a été refusée. Rechargez la page.';
}

/** Lien de consultation (après signature : le lien de signature est consommé). */
export async function creerLienConsultation(organisationId: string, devisId: string, expire: Date, sha256: string): Promise<boolean> {
  const { error } = await clientAdmin().from('liens_publics').insert({
    organisation_id: organisationId, devis_id: devisId, finalite: 'consultation', jeton_sha256: sha256, expire_le: expire.toISOString(),
  });
  return !error;
}

/**
 * PDF signé : pages du devis émis + certificat de signature, déposé puis
 * référencé UNE fois sur la signature (la base refuse toute autre
 * modification). Idempotent : sans effet si déjà archivé.
 */
export async function archiverPdfSigne(organisationId: string, devisId: string): Promise<boolean> {
  const admin = clientAdmin();
  const { data: d } = await admin.from('devis')
    .select('numero, version, pdf_chemin, regime_tva, signature_id, total_accepte_ht_cents, total_accepte_tva_cents, total_accepte_ttc_cents')
    .eq('id', devisId).eq('organisation_id', organisationId).maybeSingle();
  if (!d?.signature_id || !d.pdf_chemin) return false;
  const { data: s } = await admin.from('signatures').select('*').eq('id', d.signature_id).eq('organisation_id', organisationId).maybeSingle();
  if (!s) return false;
  if (s.pdf_signe_sha256) return true;
  const [original, trace, { data: options }] = await Promise.all([
    lire('documents', organisationId, d.pdf_chemin),
    lire('signatures', organisationId, s.image_chemin),
    s.options_acceptees.length
      ? admin.from('devis_lignes').select('id, designation').eq('devis_id', devisId).eq('organisation_id', organisationId).in('id', s.options_acceptees)
      : Promise.resolve({ data: [] as { id: string; designation: string }[] }),
  ]);
  if (!original || !trace) return false;
  // Le devis archivé avec la signature est bien celui que le client a signé.
  if (sha256(original) !== s.document_sha256) {
    console.error('Archivage refusé : empreinte du PDF émis différente de celle signée', devisId);
    return false;
  }
  const octets = await pdfDevisSigne(original, titreDevis(d.numero, d.version), {
    methode: s.methode as 'sur_place' | 'lien', signataire: s.signataire_nom, mention: s.mention, signeLe: s.signe_le,
    ip: s.ip as string | null, userAgent: s.user_agent, documentSha256: s.document_sha256,
    options: (options ?? []).map((o) => o.designation), regime: d.regime_tva, image: trace,
    totalAccepte: { htCents: BigInt(d.total_accepte_ht_cents ?? 0), tvaCents: BigInt(d.total_accepte_tva_cents ?? 0), ttcCents: BigInt(d.total_accepte_ttc_cents ?? 0) },
  });
  const chemin = `${organisationId}/devis/${devisId}/signe-${randomUUID()}.pdf`;
  await deposer('documents', organisationId, chemin, octets, 'application/pdf');
  const { data: maj, error } = await admin.from('signatures')
    .update({ pdf_signe_chemin: chemin, pdf_signe_sha256: sha256(octets) })
    .eq('id', s.id).eq('organisation_id', organisationId).is('pdf_signe_sha256', null).select('id');
  return !error && (maj?.length ?? 0) === 1;
}
