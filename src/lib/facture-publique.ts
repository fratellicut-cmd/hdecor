import 'server-only';
import { createHash } from 'node:crypto';
import { clientAdmin } from '@/lib/supabase/admin';
import { lire } from '@/lib/stockage';
import { titreFacture } from '@/lib/pdf/facture';
import { ajouterJours, nomAvecForme } from '@/domain/devis-document';
import { aujourdHuiParis } from '@/domain/dates';
import { finRetractation, type CopieEmetteurFacture, type TypeFacture } from '@/domain/factures';

/**
 * Accès « service » d'une facture partagée (règle ESLint) : le JETON est
 * vérifié par la base (facture_par_jeton) avant toute lecture, et chaque
 * lecture filtre sur la facture ET l'organisation que le jeton désigne.
 * Seul le strict nécessaire au paiement est exposé (ni lignes ni client).
 */

export type FacturePublique = {
  factureId: string;
  organisationId: string;
  titre: string;
  entreprise: string;
  numero: string;
  type: TypeFacture;
  statut: string;
  dateEcheance: string | null;
  netAPayerCents: bigint;
  resteAPayerCents: bigint;
  pdfChemin: string;
  pdfSha256: string;
  iban: string | null;
  bic: string | null;
  /** Contrat signé hors établissement : premier jour où un paiement peut être demandé (délai de rétractation), sinon null. */
  paiementApresLe: string | null;
};

/** Null si le jeton est invalide, expiré ou révoqué ; une panne (réseau, base) LÈVE une erreur. */
export async function factureParJeton(jeton: string): Promise<FacturePublique | null> {
  const admin = clientAdmin();
  const { data, error } = await admin.rpc('facture_par_jeton', { p_jeton: jeton });
  if (error?.code === 'P0002') return null;
  if (error) throw new Error(`Lien public : lecture impossible (${error.code ?? 'réseau'}).`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const r = data as { facture_id: string; organisation_id: string; reste_a_payer_cents: number | null };
  const { data: f } = await admin.from('factures').select('numero, type, statut, date_echeance, net_a_payer_cents, pdf_chemin, pdf_sha256, copie_emetteur, copie_client, devis_id')
    .eq('id', r.facture_id).eq('organisation_id', r.organisation_id).maybeSingle();
  if (!f || !f.numero || !f.pdf_chemin || !f.pdf_sha256) return null;
  let paiementApresLe: string | null = null;
  if (f.devis_id && f.type !== 'avoir') {
    const { data: d } = await admin.from('devis').select('hors_etablissement, accepte_le').eq('id', f.devis_id).eq('organisation_id', r.organisation_id).maybeSingle();
    const fin = d ? finRetractation(d.hors_etablissement, (f.copie_client as { type?: string } | null)?.type ?? '', d.accepte_le ? aujourdHuiParis(new Date(d.accepte_le)) : null) : null;
    paiementApresLe = fin ? ajouterJours(fin, 1) : null;
  }
  const e = f.copie_emetteur as unknown as CopieEmetteurFacture;
  return {
    factureId: r.facture_id, organisationId: r.organisation_id, titre: titreFacture(f.type, f.numero), entreprise: nomAvecForme(e),
    numero: f.numero, type: f.type, statut: f.statut, dateEcheance: f.date_echeance, netAPayerCents: BigInt(f.net_a_payer_cents),
    resteAPayerCents: BigInt(f.type === 'avoir' ? 0 : r.reste_a_payer_cents ?? 0), pdfChemin: f.pdf_chemin, pdfSha256: f.pdf_sha256,
    iban: e.paiement?.iban ?? null, bic: e.paiement?.bic ?? null, paiementApresLe,
  };
}

/** PDF figé de la facture partagée, contrôlé par son empreinte. */
export async function pdfFactureParJeton(jeton: string): Promise<{ octets: Uint8Array; nom: string } | null> {
  const f = await factureParJeton(jeton);
  if (!f) return null;
  const octets = await lire('documents', f.organisationId, f.pdfChemin);
  if (!octets) return null;
  if (createHash('sha256').update(octets).digest('hex') !== f.pdfSha256) {
    console.error('Empreinte du PDF de facture différente de celle enregistrée', f.factureId);
    return null;
  }
  return { octets, nom: `${f.titre.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf` };
}
