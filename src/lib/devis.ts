import { chargerLogo } from '@/lib/logo';
import 'server-only';
import { verifierSession } from '@/lib/dal';
import { envPublique } from '@/lib/env';
import { clientServeur } from '@/lib/supabase/serveur';
import type { Ligne, Vue } from '@/lib/supabase/types';
import { ErreurDevis, totauxDevis, type Echeance, type LigneDevis, type PosteAReprendre, type Regime, type TotauxDevis } from '@/domain/devis';
import { libelleType, type PosteCalc, type ResultatPoste } from '@/domain/calculateur';
import {
  controlerMentions, controlerTaux, copieChantier, copieClient, copieEmetteur, avecRetractation, signauxRetractation, TEXTES_A_VERIFIER,
  type CopieChantier, type CopieClient, type CopieEmetteur, type Manque,
} from '@/domain/devis-document';
import type { DonneesPdfDevis } from '@/lib/pdf/devis';

type Client = Awaited<ReturnType<typeof clientServeur>>;

function verifier<T>(r: { data: T | null; error: unknown }, quoi: string): T {
  if (r.error || r.data === null) throw new Error(`Lecture impossible : ${quoi}.`);
  return r.data;
}

/** Ligne de la base -> ligne du domaine (montants en bigint). */
export function ligneDomaine(l: Ligne<'devis_lignes'>): LigneDevis {
  return {
    id: l.id, type: l.type, designation: l.designation, description: l.description,
    quantiteE4: l.quantite_e4 === null ? null : BigInt(l.quantite_e4), unite: l.unite,
    prixUnitaireCents: l.prix_unitaire_ht_cents === null ? null : BigInt(l.prix_unitaire_ht_cents),
    remiseBp: l.remise_bp, tauxTvaBp: l.taux_tva_bp, optionnelle: l.optionnelle,
  };
}

export const echeanceDomaine = (e: Ligne<'devis_echeances'>): Echeance => ({
  libelle: e.libelle, pourcentageBp: e.pourcentage_bp, declencheur: e.declencheur as Echeance['declencheur'], datePrevue: e.date_prevue,
});

/** Ligne reprise d'un poste dont le prix reste à compléter. */
export const aCompleter = (l: Ligne<'devis_lignes'>) =>
  l.type === 'ligne' && !!l.origine && typeof l.origine === 'object' && !Array.isArray(l.origine) && l.origine.a_completer === true;

export type DevisComplet = {
  devis: Vue<'v_devis'> & { id: string; organisation_id: string; client_id: string; regime_tva: Regime; statut: string };
  lignes: Ligne<'devis_lignes'>[];
  echeances: Ligne<'devis_echeances'>[];
  client: Ligne<'clients'> | null;
  chantier: Ligne<'chantiers'> | null;
};

/** Devis, lignes, échéancier, client et chantier (RLS : organisation de la session). */
export async function chargerDevis(id: string, supabase?: Client): Promise<DevisComplet | null> {
  await verifierSession();
  const sb = supabase ?? await clientServeur();
  const { data: devis, error } = await sb.from('v_devis').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('Lecture impossible : devis.');
  if (!devis) return null;
  const [lignes, echeances, client, chantier] = await Promise.all([
    sb.from('devis_lignes').select('*').eq('devis_id', id).order('ordre'),
    sb.from('devis_echeances').select('*').eq('devis_id', id).order('ordre'),
    sb.from('clients').select('*').eq('id', devis.client_id!).maybeSingle(),
    devis.chantier_id ? sb.from('chantiers').select('*').eq('id', devis.chantier_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  return {
    devis: devis as DevisComplet['devis'],
    lignes: verifier(lignes, 'lignes du devis'),
    echeances: verifier(echeances, 'échéancier'),
    client: client.data,
    chantier: chantier.data,
  };
}

/** Totaux du domaine (lignes fermes) au format des colonnes de la base. */
export function colonnesTotaux(t: TotauxDevis) {
  return {
    total_ht_cents: Number(t.totalHtCents),
    total_tva_cents: Number(t.totalTvaCents),
    total_ttc_cents: Number(t.totalTtcCents),
    ventilation_tva: t.ventilation.map((v) => ({ taux_bp: v.taux_bp, base_ht_cents: Number(v.base_ht_cents), tva_cents: Number(v.tva_cents) })),
  };
}

/**
 * Recalcule et enregistre les totaux d'un BROUILLON depuis ses lignes (domaine,
 * mêmes règles que la base). Appelé après chaque modification de lignes ou de
 * remise : la base revérifie l'égalité stricte à l'émission.
 */
export type ResultatRecalcul = 'ok' | 'a_corriger' | 'fige' | 'introuvable' | 'echec';

export async function recalculerTotaux(sb: Client, devisId: string): Promise<ResultatRecalcul> {
  const [{ data: d, error: e1 }, { data: lignes, error: e2 }] = await Promise.all([
    sb.from('devis').select('remise_globale_bp, regime_tva, statut').eq('id', devisId).maybeSingle(),
    sb.from('devis_lignes').select('*').eq('devis_id', devisId).order('ordre'),
  ]);
  if (e1 || e2 || !lignes) return 'echec';
  if (!d) return 'introuvable';
  if (d.statut !== 'brouillon') return 'fige';
  let t: TotauxDevis;
  try { t = totauxDevis(lignes.map(ligneDomaine), d.remise_globale_bp, d.regime_tva); } catch (e) {
    if (e instanceof ErreurDevis) return 'a_corriger';   // lignes à corriger (signalé sur la page) : totaux inchangés
    throw e;
  }
  const { error } = await sb.from('devis').update(colonnesTotaux(t)).eq('id', devisId);
  return error ? 'echec' : 'ok';
}

/** Émission impossible pour une raison à expliquer (message en français), pas un incident. */
export class ErreurPreparation extends Error {}

export type Preparation = {
  emetteur: CopieEmetteur;
  client: CopieClient;
  chantier: CopieChantier;
  manques: Manque[];
  /** Lignes reprises des postes dont le prix est à compléter. */
  aCompleter: string[];
  /** Textes types À VÉRIFIER qui figureront sur le PDF (confirmation exigée). */
  textesAVerifier: string[];
  logo: DonneesPdfDevis['logo'];
};

/** Copies (à la date donnée) et contrôles de l'émission : rien n'est inventé pour combler un manque. */
export async function preparerEmission(sb: Client, c: DevisComplet, dateIso: string): Promise<Preparation> {
  const [{ data: p, error }, { data: assurances }, { data: taux }] = await Promise.all([
    sb.from('parametres_entreprise').select('*').eq('organisation_id', c.devis.organisation_id).single(),
    sb.from('assurances').select('type, assureur, numero_contrat, debut, fin, zone_couverte'),
    sb.from('taux_tva').select('taux_bp, attestation_requise').eq('actif', true),
  ]);
  if (error || !p) throw new ErreurPreparation('Paramètres de l’entreprise illisibles : réessayez.');
  const emetteur = copieEmetteur(p, (assurances ?? []).map((a) => ({ ...a, type: a.type as 'decennale' | 'rc_pro' })), dateIso);
  if (!c.client || c.client.anonymise_le) throw new ErreurPreparation('Client introuvable ou anonymisé : ce devis ne peut plus être émis.');
  const client = copieClient(c.client);
  const chantier = copieChantier(c.chantier);
  const manques = controlerMentions(emetteur, client, chantier, {
    hors_etablissement: c.devis.hors_etablissement!, date_debut_travaux: c.devis.date_debut_travaux,
    delai_debut_texte: c.devis.delai_debut_texte, duree_estimee_jours: c.devis.duree_estimee_jours,
    conditions_paiement: c.devis.conditions_paiement, regime_tva: c.devis.regime_tva,
  });
  const lignesChiffrees = c.lignes.filter((l) => l.type === 'ligne').map((l) => ({ designation: l.designation, tauxTvaBp: l.taux_tva_bp }));
  manques.push(...controlerTaux(lignesChiffrees, c.devis.regime_tva, taux ?? []));
  const retractation = avecRetractation(c.devis.hors_etablissement!, client);
  const acompteSignature = c.echeances.length
    ? c.echeances.filter((e) => e.declencheur === 'signature').reduce((a, e) => a + e.pourcentage_bp, 0) : c.devis.acompte_pct_bp!;
  manques.push(...signauxRetractation({ retractation, dateEmission: dateIso, dateDebutTravaux: c.devis.date_debut_travaux, acompteSignatureBp: acompteSignature }));
  // Textes légaux (Paramètres) : à confirmer à l'émission tant que le comptable ne les a pas validés.
  const textes: string[] = [];
  if (!p.textes_legaux_valides_le) {
    textes.push(TEXTES_A_VERIFIER.devis_recu);
    if (emetteur.mediateur.nom) textes.push(TEXTES_A_VERIFIER.mediateur);
    if (retractation) textes.push(TEXTES_A_VERIFIER.retractation, TEXTES_A_VERIFIER.execution_anticipee);
  }
  if (emetteur.regime_tva === 'franchise' && p.mention_franchise_a_verifier) textes.push('Mention de franchise de TVA');
  return {
    emetteur, client, chantier, manques,
    aCompleter: c.lignes.filter(aCompleter).map((l) => l.designation),
    textesAVerifier: textes,
    logo: await chargerLogo(p.organisation_id, p.logo_chemin),
  };
}

/** Données du PDF depuis le devis et les copies (aperçu ou émission). */
export function donneesPdf(c: DevisComplet, prep: Pick<Preparation, 'emetteur' | 'client' | 'chantier' | 'logo'>,
  o: { numero: string | null; dateEmission: string; brouillon: boolean }): DonneesPdfDevis {
  const d = c.devis;
  return {
    numero: o.numero, version: d.version!, dateEmission: o.dateEmission, validiteJours: d.validite_jours!, brouillon: o.brouillon,
    emetteur: prep.emetteur, client: prep.client, chantier: prep.chantier, objet: d.objet,
    dateDebutTravaux: d.date_debut_travaux, delaiDebutTexte: d.delai_debut_texte, dureeEstimeeJours: d.duree_estimee_jours,
    conditionsPaiement: d.conditions_paiement, horsEtablissement: d.hors_etablissement!, notesClient: d.notes_client,
    regime: d.regime_tva, remiseGlobaleBp: d.remise_globale_bp!, lignes: c.lignes.map(ligneDomaine),
    echeances: c.echeances.map(echeanceDomaine), acomptePctBp: d.acompte_pct_bp!, logo: prep.logo,
    urlConfidentialite: `${envPublique.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}/confidentialite`,
  };
}

/** Copies figées lues sur un devis émis (jamais recalculées). */
export function copiesFigees(d: DevisComplet['devis']): { emetteur: CopieEmetteur; client: CopieClient; chantier: CopieChantier } {
  return {
    emetteur: d.copie_emetteur as unknown as CopieEmetteur,
    client: d.copie_client as unknown as CopieClient,
    chantier: (d.copie_chantier && Object.keys(d.copie_chantier as object).length ? d.copie_chantier : null) as unknown as CopieChantier,
  };
}

/** Poste calculé du chantier -> données de reprise en ligne de devis (prix jamais inventé). */
export function posteAReprendre(c: { poste: PosteCalc; resultat: ResultatPoste }, chantierId: string): PosteAReprendre {
  const { poste: p, resultat: r } = c;
  const produit = p.produit?.libelle ?? (p.typeProduit ? libelleType(p.typeProduit) : null);
  const description = [
    p.etapes.length ? `Préparation : ${p.etapes.map((e) => e.libelle.toLowerCase()).join(', ')}` : null,
    [produit, `${p.couches} couche${p.couches > 1 ? 's' : ''}`, p.finition, p.teinte ? `teinte ${p.teinte.nom}` : null].filter(Boolean).join(', '),
  ].filter(Boolean).join('. ');
  return {
    designation: p.libelle,
    description,
    surfaceMm2: r.surfaceMm2,
    coutMatiereCents: r.coutMatiereCents,
    coutMainOeuvreCents: r.coutMainOeuvreCents,
    minutes: r.temps?.minutes ?? null,
    incomplet: r.incomplet.quantite || r.incomplet.temps || r.incomplet.matiere,
    // Raison d'un prix non calculé : montrée sur la ligne « à compléter ».
    origine: { poste_id: p.id, chantier_id: chantierId, ...(r.manques[0] ? { manque: r.manques[0] } : 'manque' in p.surface ? { manque: p.surface.manque } : {}) },
  };
}
