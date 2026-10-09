import 'server-only';
import { clientServeur } from '@/lib/supabase/serveur';
import { aujourdHuiParis, finDeJourParis } from '@/domain/dates';
import { ajouterJours } from '@/domain/devis-document';
import { deductionsDomaine } from '@/lib/factures';
import {
  anPrecedent, chiffreAffaires, coutAchat, jaugeSeuil, margeChantier, periodesTableauDeBord, statistiquesDevis,
  tresoreriePrevisionnelle, type Chiffre, type DevisResume, type Encaissement, type Jauge, type Marge, type DonneesMarge,
} from '@/domain/pilotage';
import type { Regime } from '@/domain/devis';

type Sb = Awaited<ReturnType<typeof clientServeur>>;

function lu<T>(r: { data: T | null; error: unknown }, quoi: string): NonNullable<T> {
  if (r.error || r.data === null) throw new Error(`Lecture impossible : ${quoi}.`);
  return r.data as NonNullable<T>;
}

/** Encaissements (livre des recettes) depuis le 1er janvier de l'année précédente : base du CA et des seuils. */
async function encaissementsDepuis(sb: Sb, du: string): Promise<Encaissement[]> {
  const lignes = lu(await sb.from('v_livre_recettes')
    .select('date_paiement, montant_cents, facture_net_ttc_cents, facture_net_ht_cents, regime_tva')
    .gte('date_paiement', du).limit(20_000), 'livre des recettes');
  return lignes.map((l) => ({
    date: l.date_paiement!, montantCents: BigInt(l.montant_cents!), factureNetTtcCents: BigInt(l.facture_net_ttc_cents!),
    factureNetHtCents: BigInt(l.facture_net_ht_cents!), regime: l.regime_tva!,
  }));
}

// --------------------------------------------------------------------------
// À faire (rappels du jour, dérivés des données ; aucun envoi)
// --------------------------------------------------------------------------

export type AFaire = { cle: string; urgence: 'retard' | 'aujourdhui' | 'bientot'; texte: string; lien: string; rappelId?: string };

export async function aFaire(sb: Sb, aujourdhui: string, p: { relance_devis_jours: number }): Promise<AFaire[]> {
  const demain = ajouterJours(aujourdhui, 1);
  const dans3 = ajouterJours(aujourdhui, 3);
  const limiteRelance = ajouterJours(aujourdhui, -p.relance_devis_jours);
  // Bornes en heure de Paris (changements d'heure compris).
  const debutAujourdhui = new Date(finDeJourParis(ajouterJours(aujourdhui, -1)).getTime() + 1_000).toISOString();
  const finDemain = finDeJourParis(demain).toISOString();
  const [factures, devis, chantiers, rappels] = await Promise.all([
    sb.from('v_factures').select('id, numero, date_echeance, reste_a_payer_cents, copie_client')
      .eq('statut', 'emise').neq('type', 'avoir').gt('reste_a_payer_cents', 0).lte('date_echeance', dans3).order('date_echeance').limit(50),
    sb.from('v_devis').select('id, numero, version, copie_client, valide_jusqu_au, statut_affiche').eq('statut', 'envoye').limit(200),
    sb.from('evenements').select('id, titre, debut, chantier_id').eq('type', 'chantier')
      .gte('debut', debutAujourdhui).lte('debut', finDemain).order('debut').limit(20),
    sb.from('rappels').select('id, titre, echeance, type, chantier_id').eq('statut', 'a_envoyer').lte('echeance', finDemain).order('echeance').limit(50),
  ]);
  const items: AFaire[] = [];
  for (const f of lu(factures, 'factures à échéance')) {
    const nom = (f.copie_client as { nom_affiche?: string } | null)?.nom_affiche ?? '';
    const retard = f.date_echeance! < aujourdhui;
    items.push({ cle: `f${f.id}`, urgence: retard ? 'retard' : f.date_echeance === aujourdhui ? 'aujourdhui' : 'bientot',
      texte: `${retard ? 'Impayée' : 'Échéance'} : facture ${f.numero} (${nom})`, lien: `/factures/${f.id}` });
  }
  // Devis envoyés, encore valables, sans réponse depuis le délai de relance et jamais relancés.
  const devisOuverts = lu(devis, 'devis envoyés').filter((d) => d.statut_affiche === 'envoye' || d.statut_affiche === 'consulte');
  if (devisOuverts.length) {
    const envois = lu(await sb.from('envois').select('document_id, nature, envoye_le, statut').eq('document_type', 'devis')
      .in('document_id', devisOuverts.map((d) => d.id!)).neq('statut', 'echec'), 'envois des devis');
    for (const d of devisOuverts) {
      const siens = envois.filter((e) => e.document_id === d.id);
      const dernier = siens.filter((e) => e.nature === 'envoi').map((e) => aujourdHuiParis(new Date(e.envoye_le))).sort().at(-1);
      if (!dernier || dernier > limiteRelance || siens.some((e) => e.nature === 'relance_devis')) continue;
      const nom = (d.copie_client as { nom_affiche?: string } | null)?.nom_affiche ?? '';
      items.push({ cle: `d${d.id}`, urgence: 'aujourdhui', texte: `Relancer le devis ${d.numero}${d.version! > 1 ? ` v${d.version}` : ''} (${nom})`, lien: `/devis/${d.id}` });
    }
  }
  for (const e of lu(chantiers, 'début des chantiers')) {
    const jour = aujourdHuiParis(new Date(e.debut));
    items.push({ cle: `e${e.id}`, urgence: jour === aujourdhui ? 'aujourdhui' : 'bientot',
      texte: `${jour === aujourdhui ? 'Aujourd’hui' : 'Demain'} : début du chantier ${e.titre}`, lien: `/chantiers/${e.chantier_id}` });
  }
  for (const r of lu(rappels, 'rappels')) {
    const echu = new Date(r.echeance).getTime() <= Date.now();
    items.push({ cle: `r${r.id}`, urgence: echu ? 'aujourdhui' : 'bientot', texte: r.titre,
      lien: r.chantier_id ? `/chantiers/${r.chantier_id}` : '/planning', rappelId: r.id });
  }
  const ordre = { retard: 0, aujourdhui: 1, bientot: 2 };
  return items.sort((a, b) => ordre[a.urgence] - ordre[b.urgence]);
}

// --------------------------------------------------------------------------
// Tableau de bord
// --------------------------------------------------------------------------

export type TableauDeBord = {
  aujourdhui: string;
  regime: Regime;
  ca: Record<'mois' | 'trimestre' | 'annee', { courant: Chiffre; precedent: Chiffre }>;
  seuils: { ca: Jauge; franchise: Jauge; confirmes: boolean; base: Chiffre };
  devis: ReturnType<typeof statistiquesDevis>;
  tresorerie: ReturnType<typeof tresoreriePrevisionnelle>;
  impayes: { nombre: number; montantCents: bigint; enRetard: number };
  chantiers: { id: string; nom: string; statut: string; debut: string | null; resteAFacturerCents: bigint }[];
  aFaire: AFaire[];
};

export async function chargerTableauDeBord(organisationId: string): Promise<TableauDeBord> {
  const sb = await clientServeur();
  const aujourdhui = aujourdHuiParis();
  const periodes = periodesTableauDeBord(aujourdhui);
  const { data: p, error: eP } = await sb.from('parametres_entreprise')
    .select('regime_tva, seuil_ca_micro_cents, seuil_franchise_tva_cents, seuil_alerte_1_bp, seuil_alerte_2_bp, seuils_confirmes_le, relance_devis_jours')
    .eq('organisation_id', organisationId).single();
  if (eP || !p) throw new Error('Lecture impossible : paramètres.');
  const [encaissements, devis, factures, chantiers, faire] = await Promise.all([
    encaissementsDepuis(sb, periodes.annee.precedente.du),
    sb.from('v_devis').select('statut, date_emission, valide_jusqu_au, accepte_le, total_ttc_cents')
      .neq('statut', 'brouillon').gte('created_at', `${anPrecedent(anPrecedent(aujourdhui))}T00:00:00Z`).limit(5_000),
    sb.from('v_factures').select('reste_a_payer_cents, date_echeance, statut_affiche').eq('statut', 'emise').neq('type', 'avoir')
      .gt('reste_a_payer_cents', 0).limit(5_000),
    sb.from('v_chantiers').select('id, nom, statut, statut_affiche, date_debut_prevue, reste_a_facturer_cents, created_at')
      .neq('statut', 'termine').order('date_debut_prevue', { ascending: true, nullsFirst: false }).limit(500),
    aFaire(sb, aujourdhui, p),
  ]);
  const ch = lu(chantiers, 'chantiers');
  const restesAFacturer = lu(await sb.from('v_chantiers').select('reste_a_facturer_cents').gt('reste_a_facturer_cents', 0).limit(5_000), 'restes à facturer');
  const fa = lu(factures, 'factures à encaisser');
  const ca = (k: 'mois' | 'trimestre' | 'annee') => ({
    courant: chiffreAffaires(encaissements, periodes[k].courante), precedent: chiffreAffaires(encaissements, periodes[k].precedente),
  });
  const annee = chiffreAffaires(encaissements, periodes.annee.courante);
  // Seuils : CA hors taxes de l'année civile en cours (base à faire confirmer par le comptable).
  const base = annee.htCents;
  const devisResumes: DevisResume[] = lu(devis, 'devis').map((d) => ({
    statut: d.statut as DevisResume['statut'], dateEmission: d.date_emission, valideJusquAu: d.valide_jusqu_au,
    accepteLe: d.accepte_le ? aujourdHuiParis(new Date(d.accepte_le)) : null, totalTtcCents: BigInt(d.total_ttc_cents ?? 0),
  }));
  return {
    aujourdhui, regime: p.regime_tva,
    ca: { mois: ca('mois'), trimestre: ca('trimestre'), annee: ca('annee') },
    seuils: {
      ca: jaugeSeuil(base, p.seuil_ca_micro_cents === null ? null : BigInt(p.seuil_ca_micro_cents), p.seuil_alerte_1_bp, p.seuil_alerte_2_bp),
      franchise: jaugeSeuil(base, p.seuil_franchise_tva_cents === null ? null : BigInt(p.seuil_franchise_tva_cents), p.seuil_alerte_1_bp, p.seuil_alerte_2_bp),
      confirmes: p.seuils_confirmes_le !== null, base: annee,
    },
    devis: statistiquesDevis(devisResumes, aujourdhui),
    tresorerie: tresoreriePrevisionnelle(fa.map((f) => ({ resteCents: BigInt(f.reste_a_payer_cents!), echeance: f.date_echeance! })),
      restesAFacturer.map((r) => BigInt(r.reste_a_facturer_cents!)), aujourdhui),
    impayes: {
      nombre: fa.length, montantCents: fa.reduce((a, f) => a + BigInt(f.reste_a_payer_cents!), 0n),
      enRetard: fa.filter((f) => f.statut_affiche === 'en_retard').length,
    },
    chantiers: ch.slice(0, 8).map((c) => ({
      id: c.id!, nom: c.nom!, statut: c.statut_affiche!, debut: c.date_debut_prevue, resteAFacturerCents: BigInt(c.reste_a_facturer_cents!),
    })),
    aFaire: faire,
  };
}

// --------------------------------------------------------------------------
// Rentabilité d'un chantier
// --------------------------------------------------------------------------

export type Rentabilite = DonneesMarge & Marge & { regime: Regime; devisSignes: number };

export async function rentabiliteChantier(chantierId: string, organisationId: string): Promise<Rentabilite> {
  const sb = await clientServeur();
  const [p, devis, temps, depenses] = await Promise.all([
    sb.from('parametres_entreprise').select('regime_tva, taux_horaire_cents').eq('organisation_id', organisationId).single(),
    sb.from('devis').select('id, signature_id').eq('chantier_id', chantierId).eq('statut', 'accepte'),
    sb.from('temps_passes').select('minutes').eq('chantier_id', chantierId).limit(10_000),
    sb.from('depenses').select('montant_ht_cents, montant_ttc_cents').eq('chantier_id', chantierId).limit(10_000),
  ]);
  const param = lu(p, 'paramètres');
  const signes = lu(devis, 'devis signés');
  const idsDevis = signes.map((d) => d.id);
  const [lignes, signatures, factures] = await Promise.all([
    idsDevis.length ? sb.from('devis_lignes').select('id, devis_id, type, optionnelle, cout_matiere_prevu_cents, minutes_prevues').in('devis_id', idsDevis)
      : Promise.resolve({ data: [], error: null }),
    signes.some((d) => d.signature_id) ? sb.from('signatures').select('id, options_acceptees').in('id', signes.map((d) => d.signature_id).filter((x): x is string => !!x))
      : Promise.resolve({ data: [], error: null }),
    sb.from('factures').select('id, type, statut, total_ht_cents, deductions, facture_origine_id, chantier_id, devis_id')
      .neq('statut', 'brouillon').or(`chantier_id.eq.${chantierId}${idsDevis.length ? `,devis_id.in.(${idsDevis.join(',')})` : ''}`).limit(1_000),
  ]);
  const options = new Set(lu(signatures, 'signatures').flatMap((s) => s.options_acceptees ?? []));
  const retenues = lu(lignes, 'lignes des devis').filter((l) => l.type === 'ligne' && (!l.optionnelle || options.has(l.id)));
  const fs = lu(factures, 'factures du chantier');
  // Avoirs : rattachés par leur facture d'origine (ni chantier ni devis).
  const avoirs = fs.length ? lu(await sb.from('factures').select('total_ht_cents, deductions').eq('type', 'avoir').neq('statut', 'brouillon')
    .in('facture_origine_id', fs.map((f) => f.id)), 'avoirs') : [];
  const netHt = (f: { total_ht_cents: number; deductions: unknown }) => BigInt(f.total_ht_cents) - deductionsDomaine(f.deductions).reduce((a, d) => a + d.ht, 0n);
  const factureHt = fs.filter((f) => f.type !== 'avoir').reduce((a, f) => a + netHt(f), 0n) - avoirs.reduce((a, f) => a + netHt(f), 0n);
  const donnees: DonneesMarge = {
    factureHtCents: factureHt,
    achatsCents: lu(depenses, 'achats').reduce((a, d) => a + coutAchat({ htCents: BigInt(d.montant_ht_cents), ttcCents: BigInt(d.montant_ttc_cents) }, param.regime_tva), 0n),
    minutesReelles: lu(temps, 'temps passés').reduce((a, t) => a + t.minutes, 0),
    matierePrevueCents: retenues.reduce((a, l) => a + BigInt(l.cout_matiere_prevu_cents ?? 0), 0n),
    minutesPrevues: retenues.reduce((a, l) => a + (l.minutes_prevues ?? 0), 0),
    tauxHoraireCents: param.taux_horaire_cents === null ? null : BigInt(param.taux_horaire_cents),
  };
  return { ...donnees, ...margeChantier(donnees), regime: param.regime_tva, devisSignes: signes.length };
}
