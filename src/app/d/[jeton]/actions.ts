'use server';

import { redirect } from 'next/navigation';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { archiverPdfSigne, creerLienConsultation, devisParJeton, signerParJeton } from '@/lib/devis-public';
import { jetonBienForme, nouveauJeton } from '@/lib/liens';
import { ipEtNavigateur } from '@/lib/requete';
import { lirePngSignature, MESSAGES_TRACE, schemaSignature } from '@/lib/validation/devis';

/** Après signature, le lien de signature est consommé : un lien de consultation le remplace (limite de sécurité). */
const CONSULTATION_APRES_SIGNATURE_JOURS = 30;

/**
 * Signature à distance. Action PUBLIQUE (aucune session) : l'autorisation est
 * le jeton, vérifié par la base (usage unique, expiration, révocation), avec
 * l'empreinte du PDF présenté et les options proposées.
 */
export async function signerEnLigne(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const jeton = String(fd.get('jeton') ?? '');
  if (!jetonBienForme(jeton)) return { message: 'Lien invalide ou expiré.' };
  const lu = schemaSignature.safeParse({
    nom: fd.get('nom'), mention: fd.get('mention'), image: fd.get('image'), document_sha256: fd.get('document_sha256'),
    lu: fd.get('lu') ?? undefined, options: fd.getAll('options').map(String),
  });
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd, ['image', 'jeton']) };
  // Le jeton est vérifié par la base AVANT le décodage du tracé (coûteux) : un jeton inventé ne coûte qu'une lecture.
  const d = await devisParJeton(jeton);
  if (!d?.peutSigner) return { message: 'Ce lien ne permet plus de signer (déjà utilisé, expiré ou révoqué).' };
  const png = lirePngSignature(lu.data.image);
  if ('erreur' in png) return { erreurs: { image: MESSAGES_TRACE[png.erreur] }, valeurs: valeursTexte(fd, ['image', 'jeton']) };
  const { ip, userAgent } = await ipEtNavigateur();
  const r = await signerParJeton(jeton, {
    nom: lu.data.nom, mention: lu.data.mention, png: png.octets, documentSha256: lu.data.document_sha256, options: lu.data.options, ip, userAgent,
  });
  if (!r.ok) return { message: r.message, valeurs: valeursTexte(fd, ['image', 'jeton']) };
  await archiverPdfSigne(r.organisationId, r.devisId).catch((e) => {
    console.error('Archivage du PDF signé reporté', e instanceof Error ? e.message : e);
  });
  const consultation = nouveauJeton();
  const ok = await creerLienConsultation(r.organisationId, r.devisId,
    new Date(Date.now() + CONSULTATION_APRES_SIGNATURE_JOURS * 24 * 3600 * 1000), consultation.sha256);
  redirect(ok ? `/d/${consultation.jeton}?signe=1` : '/d/merci');
}
