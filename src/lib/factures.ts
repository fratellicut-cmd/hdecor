import 'server-only';
import { verifierSession } from '@/lib/dal';
import { envPublique } from '@/lib/env';
import { clientServeur } from '@/lib/supabase/serveur';
import type { Ligne, Vue } from '@/lib/supabase/types';
import type { Regime, Ventilation } from '@/domain/devis';
import { copieChantier, copieClient, copieEmetteur, type CopieChantier, type CopieClient, type Manque } from '@/domain/devis-document';
import { aujourdHuiParis } from '@/domain/dates';
import { ajouterJours } from '@/domain/devis-document';
import {
  controlerMentionsFacture, ErreurFacture, finRetractation, netAPayer, textesAVerifierFacture, totauxFacture,
  type CopieEmetteurFacture, type Deduction, type LigneFacture, type TypeFacture,
} from '@/domain/factures';
import type { DonneesPdfFacture } from '@/lib/pdf/facture';

type Client = Awaited<ReturnType<typeof clientServeur>>;

function verifier<T>(r: { data: T | null; error: unknown }, quoi: string): T {
  if (r.error || r.data === null) throw new Error(`Lecture impossible : ${quoi}.`);
  return r.data;
}

/** Ligne de la base -> ligne du domaine (montants en bigint). */
export function ligneFactureDomaine(l: Ligne<'facture_lignes'>): LigneFacture {
  return {
    id: l.id, type: l.type, designation: l.designation, description: l.description,
    quantiteE4: l.quantite_e4 === null ? null : BigInt(l.quantite_e4), unite: l.unite,
    prixUnitaireCents: l.prix_unitaire_ht_cents === null ? null : BigInt(l.prix_unitaire_ht_cents),
    remiseBp: l.remise_bp, tauxTvaBp: l.taux_tva_bp, optionnelle: false, avancementBp: l.avancement_bp, devisLigneId: l.devis_ligne_id,
  };
}

/** JSON de la base -> déductions du domaine. */
export function deductionsDomaine(json: unknown): Deduction[] {
  return (Array.isArray(json) ? json : []).map((d: { facture_id: string; numero: string; ht: number; tva: number; ttc: number }) => ({
    facture_id: d.facture_id, numero: d.numero, ht: BigInt(d.ht), tva: BigInt(d.tva), ttc: BigInt(d.ttc),
  }));
}

export const deductionsJson = (ds: Deduction[]) => ds.map((d) => ({ facture_id: d.facture_id, numero: d.numero, ht: Number(d.ht), tva: Number(d.tva), ttc: Number(d.ttc) }));

export const ventilationDomaine = (json: unknown): Ventilation =>
  (Array.isArray(json) ? json : []).map((v: { taux_bp: number; base_ht_cents: number; tva_cents: number }) => ({
    taux_bp: v.taux_bp, base_ht_cents: BigInt(v.base_ht_cents), tva_cents: BigInt(v.tva_cents),
  }));

export type FactureComplete = {
  facture: Vue<'v_factures'> & { id: string; organisation_id: string; client_id: string; type: TypeFacture; statut: string; regime_tva: Regime };
  lignes: Ligne<'facture_lignes'>[];
  client: Ligne<'clients'> | null;
  chantier: Ligne<'chantiers'> | null;
  devis: Ligne<'devis'> | null;
  origine: Ligne<'factures'> | null;
};

/** Facture, lignes, client, chantier, devis et facture d'origine (RLS : organisation de la session). */
export async function chargerFacture(id: string, supabase?: Client): Promise<FactureComplete | null> {
  await verifierSession();
  const sb = supabase ?? await clientServeur();
  const { data: f, error } = await sb.from('v_factures').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('Lecture impossible : facture.');
  if (!f) return null;
  const [lignes, client, chantier, devis, origine] = await Promise.all([
    sb.from('facture_lignes').select('*').eq('facture_id', id).order('ordre'),
    sb.from('clients').select('*').eq('id', f.client_id!).maybeSingle(),
    f.chantier_id ? sb.from('chantiers').select('*').eq('id', f.chantier_id).maybeSingle() : Promise.resolve({ data: null }),
    f.devis_id ? sb.from('devis').select('*').eq('id', f.devis_id).maybeSingle() : Promise.resolve({ data: null }),
    f.facture_origine_id ? sb.from('factures').select('*').eq('id', f.facture_origine_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    facture: f as FactureComplete['facture'], lignes: verifier(lignes, 'lignes de la facture'),
    client: client.data, chantier: chantier.data, devis: devis.data, origine: origine.data,
  };
}

export type ResultatRecalcul = 'ok' | 'a_corriger' | 'fige' | 'introuvable' | 'echec';

/**
 * Recalcule et enregistre les totaux d'un BROUILLON (lignes, remise, TVA,
 * déductions, net à payer) avec le domaine : la base recontrôle à l'émission.
 */
export async function recalculerTotauxFacture(sb: Client, factureId: string): Promise<ResultatRecalcul> {
  const [{ data: f, error: e1 }, { data: lignes, error: e2 }] = await Promise.all([
    sb.from('factures').select('statut, remise_globale_bp, regime_tva, autoliquidation, deductions').eq('id', factureId).maybeSingle(),
    sb.from('facture_lignes').select('*').eq('facture_id', factureId).order('ordre'),
  ]);
  if (e1 || e2 || !lignes) return 'echec';
  if (!f) return 'introuvable';
  if (f.statut !== 'brouillon') return 'fige';
  let colonnes;
  try {
    const t = totauxFacture(lignes.map(ligneFactureDomaine), f.remise_globale_bp, f.regime_tva, f.autoliquidation);
    const net = netAPayer(t.totalTtcCents, deductionsDomaine(f.deductions));
    colonnes = {
      total_ht_cents: Number(t.totalHtCents), total_tva_cents: Number(t.totalTvaCents), total_ttc_cents: Number(t.totalTtcCents),
      ventilation_tva: t.ventilation.map((v) => ({ taux_bp: v.taux_bp, base_ht_cents: Number(v.base_ht_cents), tva_cents: Number(v.tva_cents) })),
      net_a_payer_cents: Number(net),
    };
  } catch (e) {
    if (e instanceof ErreurFacture) return 'a_corriger';
    throw e;
  }
  const { error } = await sb.from('factures').update(colonnes).eq('id', factureId);
  return error ? 'echec' : 'ok';
}

/** Émission impossible pour une raison à expliquer (message en français). */
export class ErreurPreparationFacture extends Error {}

export type PreparationFacture = {
  emetteur: CopieEmetteurFacture;
  client: CopieClient;
  chantier: CopieChantier;
  manques: Manque[];
  textesAVerifier: string[];
  /** Dernier jour du délai de rétractation si la facture est émise pendant ce délai (aucun paiement demandé avant le lendemain). */
  retractationJusquau: string | null;
};

/** Fin du délai de rétractation du devis de la facture (signé hors établissement par un particulier), sinon null. */
export function finRetractationFacture(c: Pick<FactureComplete, 'devis'>, typeClient: string): string | null {
  const d = c.devis;
  return d ? finRetractation(d.hors_etablissement, typeClient, d.accepte_le ? aujourdHuiParis(new Date(d.accepte_le)) : null) : null;
}

/** Copies figées (à la date d'émission) et contrôle des mentions : rien n'est inventé pour combler un manque. */
export async function preparerEmissionFacture(sb: Client, c: FactureComplete, dateIso: string): Promise<PreparationFacture> {
  const [{ data: p, error }, { data: assurances }] = await Promise.all([
    sb.from('parametres_entreprise').select('*').eq('organisation_id', c.facture.organisation_id).single(),
    sb.from('assurances').select('type, assureur, numero_contrat, debut, fin, zone_couverte'),
  ]);
  if (error || !p) throw new ErreurPreparationFacture('Paramètres de l’entreprise illisibles : réessayez.');
  if (!c.client || c.client.anonymise_le) throw new ErreurPreparationFacture('Client introuvable ou anonymisé.');
  const emetteur: CopieEmetteurFacture = {
    ...copieEmetteur(p, (assurances ?? []).map((a) => ({ ...a, type: a.type as 'decennale' | 'rc_pro' })), dateIso),
    paiement: {
      iban: p.iban?.replace(/\s+/g, '').toUpperCase() ?? null, bic: p.bic?.replace(/\s+/g, '').toUpperCase() || null,
      taux_penalites_bp: p.taux_penalites_bp, indemnite_recouvrement_cents: Number(p.indemnite_recouvrement_cents), escompte_texte: p.escompte_texte,
    },
  };
  const client = copieClient(c.client);
  const chantier = copieChantier(c.chantier);
  const f = c.facture;
  const fin = f.type === 'avoir' ? null : finRetractationFacture(c, client.type);
  const aControler = {
    type: f.type, date_prestation_debut: f.date_prestation_debut, date_prestation_fin: f.date_prestation_fin,
    autoliquidation: f.autoliquidation!, regime_tva: f.regime_tva,
    date_emission: dateIso, date_echeance: ajouterJours(dateIso, f.delai_paiement_jours!), fin_retractation: fin,
  };
  return {
    emetteur, client, chantier, manques: controlerMentionsFacture(emetteur, client, chantier, aControler),
    textesAVerifier: textesAVerifierFacture(emetteur, client, aControler), retractationJusquau: fin && dateIso <= fin ? fin : null,
  };
}

/** Données du PDF (aperçu ou émission) depuis la facture et les copies. */
export function donneesPdfFacture(c: FactureComplete, prep: Pick<PreparationFacture, 'emetteur' | 'client' | 'chantier' | 'retractationJusquau'>,
  o: { numero: string | null; dateEmission: string; dateEcheance: string; brouillon: boolean }): DonneesPdfFacture {
  const f = c.facture;
  return {
    numero: o.numero, type: f.type, brouillon: o.brouillon, dateEmission: o.dateEmission, dateEcheance: o.dateEcheance,
    datePrestationDebut: f.date_prestation_debut, datePrestationFin: f.date_prestation_fin,
    emetteur: prep.emetteur, client: prep.client, chantier: prep.chantier,
    devis: c.devis?.numero ? { numero: c.devis.numero, version: c.devis.version, accepteLe: c.devis.accepte_le?.slice(0, 10) ?? null } : null,
    origine: c.origine?.numero && c.origine.date_emission ? { numero: c.origine.numero, dateEmission: c.origine.date_emission } : null,
    natureAvoir: (f.nature_avoir as 'correction' | 'reduction' | null) ?? null, avancementBp: f.avancement_bp,
    regime: f.regime_tva, autoliquidation: f.autoliquidation!, remiseGlobaleBp: f.remise_globale_bp!,
    lignes: c.lignes.map(ligneFactureDomaine), deductions: deductionsDomaine(f.deductions), notesClient: f.notes_client,
    paiementApresLe: prep.retractationJusquau ? ajouterJours(prep.retractationJusquau, 1) : null,
    urlConfidentialite: `${envPublique.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}/confidentialite`,
  };
}

/** Copies figées d'une facture émise (jamais recalculées). */
export function copiesFigeesFacture(f: FactureComplete['facture']) {
  return {
    emetteur: f.copie_emetteur as unknown as CopieEmetteurFacture,
    client: f.copie_client as unknown as CopieClient,
    chantier: (f.copie_chantier && Object.keys(f.copie_chantier as object).length ? f.copie_chantier : null) as unknown as CopieChantier,
  };
}
