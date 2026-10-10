import 'server-only';
import { clientServeur } from '@/lib/supabase/serveur';
import { lire } from '@/lib/stockage';
import { chargerLogo, LOGO_ILLISIBLE } from '@/lib/logo';
import { copieChantier, copieClient, copieEmetteur } from '@/domain/devis-document';
import type { Reserve } from '@/domain/pv';
import type { DonneesPv } from '@/lib/pdf/pv';

type Sb = Awaited<ReturnType<typeof clientServeur>>;

/** PV avec son chantier, son client, le devis rattaché et la signature (lecture sous RLS). */
export async function chargerPv(sb: Sb, pvId: string) {
  const { data: pv, error } = await sb.from('pv_reception')
    .select('id, organisation_id, chantier_id, statut, date_reception, avec_reserves, reserves, travaux, observations, delai_levee_jours, devis_id, pdf_chemin, pdf_sha256, signature_id, signature_entreprise_chemin, created_at')
    .eq('id', pvId).maybeSingle();
  if (error) throw new Error('Lecture impossible : PV.');
  if (!pv) return null;
  const [{ data: chantier }, { data: devis }, { data: signature }] = await Promise.all([
    sb.from('chantiers').select('id, nom, client_id, adresse_ligne1, adresse_ligne2, code_postal, ville').eq('id', pv.chantier_id).single(),
    pv.devis_id ? sb.from('devis').select('numero').eq('id', pv.devis_id).maybeSingle() : Promise.resolve({ data: null }),
    pv.signature_id ? sb.from('signatures').select('signataire_nom, mention, signe_le, image_chemin, document_sha256, pdf_signe_chemin').eq('id', pv.signature_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!chantier) throw new Error('Lecture impossible : chantier du PV.');
  const { data: client } = await sb.from('clients')
    .select('type, civilite, nom, prenom, raison_sociale, siret, tva_intra, email, telephone, fact_ligne1, fact_ligne2, fact_code_postal, fact_ville, fact_pays, anonymise_le')
    .eq('id', chantier.client_id).maybeSingle();
  return { pv: { ...pv, reserves: pv.reserves as Reserve[] }, chantier, client, devisNumero: devis?.numero ?? null, signature };
}

export type PvCharge = NonNullable<Awaited<ReturnType<typeof chargerPv>>>;

/**
 * Données du PDF : identité de l'entreprise et assurances à la date de
 * réception, client et lieu des travaux (PV présenté, avant signature).
 */
export async function donneesPdfPv(sb: Sb, c: PvCharge): Promise<DonneesPv | { erreur: string }> {
  const [{ data: p, error }, { data: assurances }] = await Promise.all([
    sb.from('parametres_entreprise').select('*').eq('organisation_id', c.pv.organisation_id).single(),
    sb.from('assurances').select('type, assureur, numero_contrat, debut, fin, zone_couverte'),
  ]);
  if (error || !p) return { erreur: 'Paramètres de l’entreprise illisibles : réessayez.' };
  if (!c.client || c.client.anonymise_le) return { erreur: 'Client introuvable ou anonymisé : PV impossible.' };
  if (!p.raison_sociale) return { erreur: 'Renseignez la raison sociale de l’entreprise (Réglages) avant le PV.' };
  const { logo, illisible } = await chargerLogo(c.pv.organisation_id, p.logo_chemin);
  if (illisible) return { erreur: LOGO_ILLISIBLE };
  return {
    emetteur: copieEmetteur(p, (assurances ?? []).map((a) => ({ ...a, type: a.type as 'decennale' | 'rc_pro' })), c.pv.date_reception),
    client: copieClient({ ...c.client, type: c.client.type as 'particulier' | 'professionnel' }),
    chantier: copieChantier(c.chantier),
    dateReception: c.pv.date_reception,
    travaux: c.pv.travaux,
    devisNumero: c.devisNumero,
    reserves: c.pv.reserves.map((r) => ({ description: r.description })),
    delaiLeveeJours: c.pv.delai_levee_jours,
    observations: c.pv.observations,
    logo,
  };
}

/** Tracés de signature d'un PV signé (client, entreprise). */
export async function tracesPv(organisationId: string, cheminClient: string, cheminEntreprise: string) {
  const [client, entreprise] = await Promise.all([lire('signatures', organisationId, cheminClient), lire('signatures', organisationId, cheminEntreprise)]);
  return client && entreprise ? { client, entreprise } : null;
}
