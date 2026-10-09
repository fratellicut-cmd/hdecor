'use server';

import { createHash, randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import type { Insertion } from '@/lib/supabase/types';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import {
  chargerFacture, copiesFigeesFacture, deductionsDomaine, deductionsJson, donneesPdfFacture, ErreurPreparationFacture, ligneFactureDomaine, preparerEmissionFacture,
  recalculerTotauxFacture, ventilationDomaine, type ResultatRecalcul,
} from '@/lib/factures';
import { ligneDomaine } from '@/lib/devis';
import { tauxProposes } from '@/lib/taux';
import { pdfFacture } from '@/lib/pdf/facture';
import { deposer, retirer } from '@/lib/stockage';
import { emailConfigure, envoyerEmail } from '@/lib/email';
import { conclureEnvoi, reserverEnvoi } from '@/lib/envois';
import { expirationLienFacture, nouveauJeton, urlPublique } from '@/lib/liens';
import { remplirModele, TOTAL_MAX_CENTS, type Regime } from '@/domain/devis';
import {
  deductionsDisponibles, ErreurFacture, lignesAcompte, lignesAvoirMontant, lignesAvoirTotal, lignesDepuisDevis, netAPayer, netParTaux,
  totalLigneFacture, totauxFacture, type Deduction, type LigneFacture, type TypeFacture,
} from '@/domain/factures';
import { xmlFacturX } from '@/domain/facturx';
import { formaterDate, formaterEuros, formaterTaux } from '@/domain/formats';
import { aujourdHuiParis } from '@/domain/dates';
import { schemaAvancement, schemaAvoir, schemaEnteteFacture, schemaLigneFacture, schemaNouvelleFacture, schemaPaiement } from '@/lib/validation/factures';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const REFUS = 'Ces informations ont été refusées (valeur hors limites ou incohérente). Vérifiez la saisie.';
const FIGE = 'Cette facture a été émise : elle ne se modifie plus. Établissez un avoir.';
const INCOMPLET = 'Formulaire incomplet : rechargez la page.';
const identifiant = z.uuid();
const idDe = (fd: FormData, cle: string) => identifiant.safeParse(fd.get(cle));
type Sb = Awaited<ReturnType<typeof clientServeur>>;

const messageErreur = (e: { code?: string; message?: string } | null) =>
  e?.message?.includes('émise') ? FIGE : e?.code?.startsWith('23') || e?.code === 'P0001' ? REFUS : ECHEC;

function lireChamps(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (!k.startsWith('$')) o[k] = v;
  return o;
}

function messageRecalcul(r: ResultatRecalcul): string | null {
  if (r === 'ok' || r === 'a_corriger') return null;
  if (r === 'fige') return FIGE;
  if (r === 'introuvable') return 'Facture introuvable.';
  return 'Les totaux n’ont pas pu être recalculés. Rechargez la page et réessayez.';
}

const revalider = (id: string) => { revalidatePath(`/factures/${id}`); revalidatePath('/factures'); };

/** Lignes du domaine -> lignes à insérer (total de ligne calculé comme en base). */
function lignesAInserer(lignes: LigneFacture[], factureId: string, organisationId: string, depart = 1): Insertion<'facture_lignes'>[] {
  return lignes.map((l, i) => ({
    organisation_id: organisationId, facture_id: factureId, ordre: depart + i, type: l.type, designation: l.designation.slice(0, 300),
    description: l.description?.slice(0, 2000) ?? null,
    quantite_e4: l.quantiteE4 === null ? null : Number(l.quantiteE4), unite: l.unite,
    prix_unitaire_ht_cents: l.prixUnitaireCents === null ? null : Number(l.prixUnitaireCents), remise_bp: l.remiseBp,
    taux_tva_bp: l.tauxTvaBp, avancement_bp: l.type === 'ligne' ? l.avancementBp : null, devis_ligne_id: l.devisLigneId ?? null,
    total_ht_cents: l.type === 'ligne' ? Number(totalLigneFacture(l.quantiteE4!, l.prixUnitaireCents!, l.remiseBp, l.avancementBp)) : null,
  }));
}

// --------------------------------------------------------------------------
// Création
// --------------------------------------------------------------------------

/** Factures du devis (pour les déductions et l'acompte cumulé). */
async function facturesDuDevis(sb: Sb, devisId: string) {
  const { data } = await sb.from('factures').select('id, numero, type, statut, total_ht_cents, total_tva_cents, total_ttc_cents, deductions, acompte_pct_bp')
    .eq('devis_id', devisId);
  return (data ?? []).map((f) => ({
    id: f.id, numero: f.numero, type: f.type as TypeFacture, statut: f.statut as 'brouillon' | 'emise' | 'annulee',
    totalHtCents: BigInt(f.total_ht_cents), totalTvaCents: BigInt(f.total_tva_cents), totalTtcCents: BigInt(f.total_ttc_cents),
    deduit: (Array.isArray(f.deductions) ? f.deductions : []).map((d) => (d as { facture_id: string }).facture_id), acomptePctBp: f.acompte_pct_bp,
  }));
}

export async function creerFacture(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaNouvelleFacture.safeParse(lireChamps(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const nouveau = idDe(fd, 'id_nouveau');
  if (!nouveau.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data: existe } = await sb.from('factures').select('id').eq('id', nouveau.data).maybeSingle();
  if (existe) redirect(`/factures/${existe.id}`);
  const { data: p } = await sb.from('parametres_entreprise').select('regime_tva, delai_paiement_jours').eq('organisation_id', session.organisationId).single();
  if (!p) return { message: ECHEC };
  const n = lu.data;

  let entete: Insertion<'factures'>;
  let lignes: LigneFacture[] = [];
  try {
    if (n.type === 'libre') {
      const { data: client } = await sb.from('clients').select('id, anonymise_le').eq('id', n.client_id!).maybeSingle();
      if (!client || client.anonymise_le) return { erreurs: { client_id: 'Client introuvable ou anonymisé.' }, valeurs: valeursTexte(fd) };
      let chantierId: string | null = null;
      if (n.chantier_id) {
        const { data: ch } = await sb.from('chantiers').select('id, client_id').eq('id', n.chantier_id).maybeSingle();
        if (!ch || ch.client_id !== client.id) return { erreurs: { chantier_id: 'Ce chantier n’est pas celui de ce client.' }, valeurs: valeursTexte(fd) };
        chantierId = ch.id;
      }
      entete = { id: nouveau.data, organisation_id: session.organisationId, type: 'libre', client_id: client.id, chantier_id: chantierId,
        delai_paiement_jours: p.delai_paiement_jours, regime_tva: p.regime_tva, date_prestation_fin: aujourdHuiParis() };
    } else {
      const { data: d } = await sb.from('devis').select('*').eq('id', n.devis_id!).maybeSingle();
      if (!d) return { erreurs: { devis_id: 'Devis introuvable.' }, valeurs: valeursTexte(fd) };
      if (d.statut !== 'accepte' || !d.ventilation_acceptee) return { message: 'Seul un devis accepté (signé) se facture.' };
      if (d.regime_tva !== p.regime_tva) return { message: 'Votre régime de TVA a changé depuis le devis : facturez par une facture libre (À VÉRIFIER avec le comptable).' };
      const [{ data: lignesDevis }, { data: sig }, factures] = await Promise.all([
        sb.from('devis_lignes').select('*').eq('devis_id', d.id).order('ordre'),
        d.signature_id ? sb.from('signatures').select('options_acceptees').eq('id', d.signature_id).maybeSingle() : Promise.resolve({ data: null }),
        facturesDuDevis(sb, d.id),
      ]);
      // Dates préremplies (modifiables) : début prévu du devis ; fin = aujourd'hui pour une situation ou une finale (achèvement à confirmer).
      const base = { id: nouveau.data, organisation_id: session.organisationId, client_id: d.client_id, chantier_id: d.chantier_id, devis_id: d.id,
        delai_paiement_jours: p.delai_paiement_jours, regime_tva: d.regime_tva, date_prestation_debut: d.date_debut_travaux,
        date_prestation_fin: n.type === 'acompte' ? null : aujourdHuiParis() };
      const libelleDevis = `${d.numero}${d.version > 1 ? ` v${d.version}` : ''}`;
      if (n.type === 'acompte') {
        // Cumul des acomptes déjà facturés (émis ou en brouillon) : l'échéance suivante en découle, comme sur le devis imprimé.
        const cumul = factures.filter((f) => f.type === 'acompte' && f.statut !== 'annulee').reduce((a, f) => a + (f.acomptePctBp ?? 0), 0);
        lignes = lignesAcompte(ventilationDomaine(d.ventilation_acceptee), cumul, n.pourcentage_bp!, d.regime_tva,
          `Acompte de ${formaterTaux(n.pourcentage_bp!)} sur le devis ${libelleDevis}`);
        entete = { ...base, type: 'acompte', acompte_pct_bp: n.pourcentage_bp! };
      } else {
        const options = new Set(sig?.options_acceptees ?? []);
        lignes = lignesDepuisDevis((lignesDevis ?? []).map(ligneDomaine), options, n.type === 'situation' ? n.pourcentage_bp! : null);
        const deductions = deductionsDisponibles(factures);
        const t = totauxFacture(lignes, d.remise_globale_bp, d.regime_tva);
        if (n.type === 'finale' && t.totalTtcCents !== BigInt(d.total_accepte_ttc_cents ?? -1)) {
          return { message: 'Le total des lignes ne correspond pas au montant accepté du devis : facturez par une facture libre et signalez-le.' };
        }
        netAPayer(t.totalTtcCents, deductions);   // refuse si les acomptes dépassent cette facture
        entete = { ...base, type: n.type, remise_globale_bp: d.remise_globale_bp, deductions: deductionsJson(deductions),
          avancement_bp: n.type === 'situation' ? n.pourcentage_bp! : null };
      }
    }
  } catch (e) {
    if (e instanceof ErreurFacture) return { message: e.message, valeurs: valeursTexte(fd) };
    throw e;
  }

  const { error } = await sb.from('factures').insert(entete);
  if (error) {
    if (error.code === '23505') redirect(`/factures/${nouveau.data}`);
    return { message: messageErreur(error), valeurs: valeursTexte(fd) };
  }
  if (lignes.length) {
    const { error: e } = await sb.from('facture_lignes').insert(lignesAInserer(lignes, nouveau.data, session.organisationId));
    if (e) redirect(`/factures/${nouveau.data}?lignes=echec`);
  }
  const r = await recalculerTotauxFacture(sb, nouveau.data);
  revalidatePath('/factures');
  redirect(`/factures/${nouveau.data}?cree=1${r === 'echec' ? '&totaux=echec' : ''}`);
}

export async function creerAvoir(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaAvoir.safeParse(lireChamps(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const nouveau = idDe(fd, 'id_nouveau');
  if (!nouveau.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data: existe } = await sb.from('factures').select('id').eq('id', nouveau.data).maybeSingle();
  if (existe) redirect(`/factures/${existe.id}`);
  const c = await chargerFacture(lu.data.facture_id, sb);
  if (!c) return { message: 'Facture introuvable.' };
  const o = c.facture;
  if (o.type === 'avoir' || o.statut !== 'emise') return { message: 'Un avoir corrige une facture émise et non annulée.' };
  const du = BigInt(o.net_a_payer_cents!) - BigInt(o.avoirs_cents ?? 0);
  const avoirsEmis = BigInt(o.avoirs_cents ?? 0);
  // Acompte ou situation : une correction se fait en totalité (la base le contrôle aussi).
  if ((o.type === 'acompte' || o.type === 'situation') && lu.data.nature === 'correction' && lu.data.mode !== 'total') {
    return { erreurs: { mode: 'Une facture d’acompte ou de situation se corrige en totalité (puis une nouvelle facture si besoin).' }, valeurs: valeursTexte(fd) };
  }
  let lignes: LigneFacture[];
  let remise = 0;
  let deductions: Deduction[] = [];
  try {
    if (lu.data.mode === 'total' && avoirsEmis === 0n) {
      // Annulation : mêmes lignes, même remise et mêmes déductions -> même net, même TVA nette par taux, au centime.
      lignes = lignesAvoirTotal(c.lignes.map(ligneFactureDomaine));
      remise = o.remise_globale_bp!;
      deductions = deductionsDomaine(o.deductions);
    } else {
      const montant = lu.data.mode === 'total' ? du : BigInt(lu.data.montant_ttc_cents!);
      if (montant > du) return { erreurs: { montant_ttc_cents: `Au plus ${formaterEuros(du)} (reste dû de la facture après les avoirs déjà émis).` }, valeurs: valeursTexte(fd) };
      // Reste par taux = ventilation − acomptes déduits − avoirs déjà émis.
      const ids = deductionsDomaine(o.deductions).map((d) => d.facture_id);
      const [{ data: deduits, error: e1 }, { data: avoirs, error: e2 }] = await Promise.all([
        ids.length ? sb.from('factures').select('ventilation_tva').in('id', ids) : Promise.resolve({ data: [], error: null }),
        sb.from('factures').select('ventilation_tva').eq('facture_origine_id', o.id).neq('statut', 'brouillon'),
      ]);
      if (e1 || e2 || (deduits ?? []).length !== ids.length) return { message: ECHEC, valeurs: valeursTexte(fd) };
      const net = netParTaux(ventilationDomaine(o.ventilation_tva), (deduits ?? []).map((x) => ventilationDomaine(x.ventilation_tva)),
        (avoirs ?? []).map((x) => ventilationDomaine(x.ventilation_tva)));
      lignes = lignesAvoirMontant(net, montant, o.regime_tva, o.autoliquidation!,
        lu.data.nature === 'reduction' ? `Réduction de prix sur la facture ${o.numero}` : `Avoir sur la facture ${o.numero}`);
    }
  } catch (e) {
    if (e instanceof ErreurFacture) return { message: e.message, valeurs: valeursTexte(fd) };
    throw e;
  }
  const { error } = await sb.from('factures').insert({
    id: nouveau.data, organisation_id: session.organisationId, type: 'avoir', client_id: o.client_id, facture_origine_id: o.id,
    nature_avoir: lu.data.nature, delai_paiement_jours: 0, regime_tva: o.regime_tva, autoliquidation: o.autoliquidation!,
    remise_globale_bp: remise, notes_client: lu.data.motif, deductions: deductionsJson(deductions),
  });
  if (error) {
    if (error.code === '23505') redirect(`/factures/${nouveau.data}`);
    return { message: messageErreur(error), valeurs: valeursTexte(fd) };
  }
  const { error: e } = await sb.from('facture_lignes').insert(lignesAInserer(lignes, nouveau.data, session.organisationId));
  if (e) redirect(`/factures/${nouveau.data}?lignes=echec`);
  await recalculerTotauxFacture(sb, nouveau.data);
  revalidatePath('/factures');
  redirect(`/factures/${nouveau.data}?cree=1`);
}

// --------------------------------------------------------------------------
// Brouillon : en-tête, lignes
// --------------------------------------------------------------------------

async function brouillon(sb: Sb, id: string) {
  const { data } = await sb.from('factures').select('id, statut, type, regime_tva, devis_id').eq('id', id).maybeSingle();
  if (!data) return { erreur: 'Facture introuvable.' } as const;
  if (data.statut !== 'brouillon') return { erreur: FIGE } as const;
  return { facture: data } as const;
}

export async function enregistrerEnteteFacture(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'facture_id');
  if (!id.success) return { message: INCOMPLET };
  const lu = schemaEnteteFacture.safeParse(lireChamps(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const b = await brouillon(sb, id.data);
  if ('erreur' in b) return { message: b.erreur };
  const { data: p } = await sb.from('parametres_entreprise').select('delai_paiement_max_jours').eq('organisation_id', session.organisationId).single();
  if (p && lu.data.delai_paiement_jours > p.delai_paiement_max_jours) {
    return { erreurs: { delai_paiement_jours: `Au plus ${p.delai_paiement_max_jours} jours (Paramètres).` }, valeurs: valeursTexte(fd) };
  }
  // Remise globale : seulement sur une facture libre (sinon celle du devis, inchangeable). Autoliquidation : assujetti seulement.
  const valeurs = {
    date_prestation_debut: lu.data.date_prestation_debut, date_prestation_fin: lu.data.date_prestation_fin,
    delai_paiement_jours: lu.data.delai_paiement_jours, notes_client: lu.data.notes_client,
    ...(b.facture.type === 'libre' ? { remise_globale_bp: lu.data.remise_globale_bp } : {}),
    ...(b.facture.regime_tva === 'assujetti' && b.facture.type !== 'avoir' ? { autoliquidation: lu.data.autoliquidation } : {}),
  };
  const { error } = await sb.from('factures').update(valeurs).eq('id', id.data);
  if (error) return { message: messageErreur(error), valeurs: valeursTexte(fd) };
  const recalcul = messageRecalcul(await recalculerTotauxFacture(sb, id.data));
  revalider(id.data);
  return recalcul ? { message: recalcul } : { succes: 'En-tête enregistré.' };
}

export async function enregistrerLigneFacture(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const factureId = idDe(fd, 'facture_id');
  if (!factureId.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const b = await brouillon(sb, factureId.data);
  if ('erreur' in b) return { message: b.erreur };
  const champs = lireChamps(fd);
  if (b.facture.regime_tva === 'franchise') champs.taux_tva_bp = '0';
  const ligneId = fd.get('id') ? identifiant.safeParse(fd.get('id')) : null;
  if (ligneId && !ligneId.success) return { message: 'Ligne introuvable.' };

  // Situation : seul l'avancement d'une ligne reprise du devis se modifie.
  if (b.facture.type === 'situation' && ligneId) {
    const av = schemaAvancement.safeParse(champs.avancement_bp);
    if (!av.success) return { erreurs: { avancement_bp: 'Avancement : de 0 à 100 %.' }, valeurs: valeursTexte(fd) };
    const { data: l } = await sb.from('facture_lignes').select('*').eq('id', ligneId.data).eq('facture_id', factureId.data).maybeSingle();
    if (!l || l.type !== 'ligne') return { message: 'Ligne introuvable.' };
    const { error } = await sb.from('facture_lignes').update({
      avancement_bp: av.data, total_ht_cents: Number(totalLigneFacture(BigInt(l.quantite_e4!), BigInt(l.prix_unitaire_ht_cents!), l.remise_bp, av.data)),
    }).eq('id', l.id);
    if (error) return { message: messageErreur(error) };
  } else {
    if (b.facture.type !== 'libre') return { message: 'Les lignes de cette facture viennent du devis ou de la facture d’origine : elles ne se modifient pas ici.' };
    const lu = schemaLigneFacture.safeParse(champs);
    if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
    const l = lu.data;
    if (l.type === 'ligne' && b.facture.regime_tva === 'assujetti' && !(await tauxProposes()).some((t) => t.taux_bp === l.taux_tva_bp)) {
      return { erreurs: { taux_tva_bp: 'Taux non proposé dans les Paramètres.' }, valeurs: valeursTexte(fd) };
    }
    const colonnes = l.type === 'ligne' ? {
      type: l.type, designation: l.designation, description: l.description, quantite_e4: l.quantite_e4, unite: l.unite,
      prix_unitaire_ht_cents: l.prix_unitaire_ht_cents, remise_bp: l.remise_bp, taux_tva_bp: l.taux_tva_bp, avancement_bp: null,
      total_ht_cents: Number(totalLigneFacture(BigInt(l.quantite_e4), BigInt(l.prix_unitaire_ht_cents), l.remise_bp, null)),
    } : {
      type: l.type, designation: l.designation, description: l.description, quantite_e4: null, unite: null, prix_unitaire_ht_cents: null,
      remise_bp: 0, taux_tva_bp: null, avancement_bp: null, total_ht_cents: null,
    };
    // Plafond (comme le devis) vérifié avant d'enregistrer.
    const { data: autres } = await sb.from('facture_lignes').select('*').eq('facture_id', factureId.data);
    const somme = (autres ?? []).filter((x) => x.id !== ligneId?.data && x.type === 'ligne').reduce((a, x) => a + BigInt(x.total_ht_cents ?? 0), 0n)
      + BigInt(colonnes.total_ht_cents ?? 0);
    if (somme > TOTAL_MAX_CENTS) return { message: 'Facture trop élevée : 10 000 000 € HT au plus.', valeurs: valeursTexte(fd) };
    if (ligneId) {
      const { error } = await sb.from('facture_lignes').update(colonnes).eq('id', ligneId.data).eq('facture_id', factureId.data);
      if (error) return { message: messageErreur(error), valeurs: valeursTexte(fd) };
    } else {
      const nouveau = idDe(fd, 'id_nouveau');
      if (!nouveau.success) return { message: INCOMPLET };
      const { data: dernier } = await sb.from('facture_lignes').select('ordre').eq('facture_id', factureId.data).order('ordre', { ascending: false }).limit(1).maybeSingle();
      const { error } = await sb.from('facture_lignes').upsert({
        ...colonnes, id: nouveau.data, organisation_id: session.organisationId, facture_id: factureId.data, ordre: (dernier?.ordre ?? 0) + 1,
      }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) return { message: messageErreur(error), valeurs: valeursTexte(fd) };
    }
  }
  const recalcul = messageRecalcul(await recalculerTotauxFacture(sb, factureId.data));
  revalider(factureId.data);
  return recalcul ? { message: recalcul } : { succes: ligneId ? 'Ligne modifiée.' : 'Ligne ajoutée.' };
}

export async function supprimerLigneFacture(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const factureId = idDe(fd, 'facture_id');
  const id = idDe(fd, 'id');
  if (!factureId.success || !id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const b = await brouillon(sb, factureId.data);
  if ('erreur' in b) return { message: b.erreur };
  if (b.facture.type !== 'libre') return { message: 'Les lignes de cette facture ne se suppriment pas ici.' };
  const { data, error } = await sb.from('facture_lignes').delete().eq('id', id.data).eq('facture_id', factureId.data).select('id');
  if (error) return { message: messageErreur(error) };
  if (!data?.length) return { message: 'Ligne déjà supprimée.' };
  const recalcul = messageRecalcul(await recalculerTotauxFacture(sb, factureId.data));
  revalider(factureId.data);
  return recalcul ? { message: recalcul } : { succes: 'Ligne supprimée.' };
}

export async function deplacerLigneFacture(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const factureId = idDe(fd, 'facture_id');
  const id = idDe(fd, 'id');
  const sens = fd.get('sens') === 'haut' ? -1 : fd.get('sens') === 'bas' ? 1 : null;
  if (!factureId.success || !id.success || sens === null) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { error } = await sb.rpc('deplacer_ligne_facture', { p_ligne_id: id.data, p_sens: sens });
  if (error) return { message: messageErreur(error) };
  revalider(factureId.data);
  return {};
}

export async function supprimerBrouillonFacture(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  if (fd.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer.' };
  const sb = await clientServeur();
  const { data, error } = await sb.from('factures').delete().eq('id', id.data).eq('statut', 'brouillon').select('id');
  if (error || !data?.length) return { message: error ? messageErreur(error) : 'Seul un brouillon peut être supprimé.' };
  revalidatePath('/factures');
  redirect('/factures?supprime=1');
}

// --------------------------------------------------------------------------
// Émission
// --------------------------------------------------------------------------

const refusCertain = (code: string | undefined) => code === 'HD001' || code === 'P0001' || code === 'P0002' || !!code?.startsWith('23');

export async function emettreFacture(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  if (fd.get('textes_confirmes') !== 'on') return { message: 'Cochez la case : textes À VÉRIFIER par le comptable.' };
  const sb = await clientServeur();
  const recalcul = await recalculerTotauxFacture(sb, id.data);
  if (recalcul === 'fige') redirect(`/factures/${id.data}`);
  const probleme = messageRecalcul(recalcul);
  if (probleme) return { message: probleme };

  for (let essai = 0; essai < 3; essai++) {
    const c = await chargerFacture(id.data, sb);
    if (!c) return { message: 'Facture introuvable.' };
    if (c.facture.statut !== 'brouillon') redirect(`/factures/${id.data}`);
    const { data: prev, error: ePrev } = await sb.rpc('numero_facture_previsionnel', { p_facture_id: id.data });
    if (ePrev || !prev) return { message: ECHEC };
    const { numero, date_emission: date, date_echeance: echeance } = prev as { numero: string; date_emission: string; date_echeance: string };
    let octets: Uint8Array;
    let prep;
    try {
      prep = await preparerEmissionFacture(sb, c, date);
      const bloquants = prep.manques.filter((m) => m.bloquant);
      if (bloquants.length) return { message: `Émission impossible : ${bloquants.map((m) => m.message).join(' ')}` };
      if (!c.lignes.some((l) => l.type === 'ligne')) return { message: 'Ajoutez au moins une ligne chiffrée.' };
      if ((c.facture.total_ht_cents ?? 0) <= 0) return { message: 'Une facture à 0 € ne peut pas être émise.' };
      octets = await pdfFacture(donneesPdfFacture(c, prep, { numero, dateEmission: date, dateEcheance: echeance, brouillon: false }));
    } catch (e) {
      if (e instanceof ErreurPreparationFacture || e instanceof ErreurFacture) return { message: `Émission impossible : ${e.message}` };
      throw e;
    }
    const sha = createHash('sha256').update(octets).digest('hex');
    const chemin = `${session.organisationId}/factures/${id.data}/${randomUUID()}.pdf`;
    await deposer('documents', session.organisationId, chemin, octets, 'application/pdf');
    const { error } = await sb.rpc('emettre_facture_attendue', {
      p_facture_id: id.data, p_copie_emetteur: prep.emetteur, p_copie_client: prep.client, p_copie_chantier: prep.chantier ?? {},
      p_pdf_chemin: chemin, p_pdf_sha256: sha, p_numero_attendu: numero, p_date_attendue: date,
    });
    if (!error) {
      await enregistrerFacturX(sb, session.organisationId, id.data).catch((e) => console.error('Factur-X non enregistré', e instanceof Error ? e.message : e));
      revalider(id.data);
      if (c.facture.facture_origine_id) revalider(c.facture.facture_origine_id);
      redirect(`/factures/${id.data}?emise=1`);
    }
    if (!refusCertain(error.code)) {
      const { data: apres, error: eRelecture } = await sb.from('factures').select('statut, pdf_chemin').eq('id', id.data).maybeSingle();
      if (eRelecture || !apres) return { message: 'Le réseau ne répond pas : l’émission n’est pas confirmée. Rechargez la page pour voir le statut de la facture.' };
      if (apres.statut !== 'brouillon') {
        if (apres.pdf_chemin !== chemin) await retirer('documents', session.organisationId, chemin).catch(() => undefined);
        revalider(id.data);
        redirect(`/factures/${id.data}${apres.pdf_chemin === chemin ? '?emise=1' : ''}`);
      }
    }
    await retirer('documents', session.organisationId, chemin).catch(() => undefined);
    if (error.code !== 'HD001') return { message: error.code === 'P0001' ? `Émission refusée : ${error.message}` : ECHEC };
  }
  return { message: 'Émission impossible pour l’instant (numérotation occupée). Réessayez.' };
}

/** XML Factur-X (préparé, À VÉRIFIER) déposé et rattaché une fois après l'émission ; relançable. */
async function enregistrerFacturX(sb: Sb, organisationId: string, factureId: string): Promise<boolean> {
  const c = await chargerFacture(factureId, sb);
  if (!c || c.facture.statut === 'brouillon' || c.facture.facturx_chemin) return !!c?.facture.facturx_chemin;
  const f = c.facture;
  const { emetteur, client } = copiesFigeesFacture(f);
  const lignes = c.lignes.map(ligneFactureDomaine);
  const t = totauxFacture(lignes, f.remise_globale_bp!, f.regime_tva, f.autoliquidation!);
  const xml = xmlFacturX({
    numero: f.numero!, type: f.type, dateEmission: f.date_emission!, dateEcheance: f.date_echeance!,
    datePrestation: f.date_prestation_fin ?? f.date_prestation_debut, emetteur, client, lignes,
    ventilation: t.ventilation, regime: f.regime_tva, autoliquidation: f.autoliquidation!, remiseGlobaleCents: t.remiseGlobaleCents,
    totalHtCents: t.totalHtCents, totalTvaCents: t.totalTvaCents, totalTtcCents: t.totalTtcCents,
    deductions: deductionsDomaine(f.deductions),
    netAPayerCents: BigInt(f.net_a_payer_cents!), factureOrigine: c.origine?.numero ?? null,
  });
  const octets = new TextEncoder().encode(xml);
  // Empreinte dans le nom (imposé par la base) : vérifiée à chaque téléchargement.
  const chemin = `${organisationId}/factures/${factureId}/facturx-${createHash('sha256').update(octets).digest('hex')}.xml`;
  await deposer('documents', organisationId, chemin, octets, 'application/xml');
  const { error } = await sb.rpc('enregistrer_facturx', { p_facture_id: factureId, p_chemin: chemin });
  if (error) { await retirer('documents', organisationId, chemin).catch(() => undefined); return false; }
  return true;
}

export async function genererFacturX(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const ok = await enregistrerFacturX(sb, session.organisationId, id.data).catch(() => false);
  revalider(id.data);
  return ok ? { succes: 'Données Factur-X préparées.' } : { message: 'Préparation impossible pour l’instant. Réessayez.' };
}

// --------------------------------------------------------------------------
// Envoi (lien de consultation + email)
// --------------------------------------------------------------------------

export async function envoyerFacture(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  const envoiId = idDe(fd, 'id_nouveau');
  const canal = fd.get('canal') === 'email' ? 'email' : 'lien';
  if (!id.success || !envoiId.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data: deja } = await sb.from('envois').select('canal, destinataire, statut').eq('id', envoiId.data).maybeSingle();
  if (deja) {
    if (deja.statut === 'echec') return { message: 'L’email précédent n’est pas parti : rechargez la page pour réessayer (aucun email en double).' };
    if (deja.statut === 'en_cours') return { message: 'Cet email est en cours d’envoi ou n’a pas été confirmé : rechargez la page dans un instant (aucun email en double).' };
    return deja.canal === 'email' ? { succes: `Email déjà envoyé à ${deja.destinataire} : rien n’a été renvoyé.` }
      : { message: 'Ce lien a déjà été créé : rechargez la page pour en créer un nouveau.' };
  }
  const c = await chargerFacture(id.data, sb);
  if (!c) return { message: 'Facture introuvable.' };
  if (c.facture.statut === 'brouillon') return { message: 'Émettez la facture avant de l’envoyer.' };
  const email = c.client?.email ?? null;
  if (canal === 'email' && !email) return { message: 'Le client n’a pas d’adresse email : créez un lien à partager.' };
  if (canal === 'email' && !emailConfigure()) return { message: 'Envoi d’emails non configuré sur ce serveur : créez un lien à partager.' };
  const lien = await nouveauLienFacture(sb, session.organisationId, id.data, c.facture.date_echeance!);
  if (!lien) return { message: ECHEC };
  const tracer = async (champs: { canal: 'email' | 'manuel'; destinataire?: string | null; fournisseur_id?: string | null }) => {
    const { error: e } = await sb.from('envois').insert({
      id: envoiId.data, organisation_id: session.organisationId, document_type: 'facture', document_id: id.data, nature: 'envoi', ...champs,
    });
    if (e) console.error('Envoi non tracé', e.code);
  };
  const marquer = async () => {
    const { error: e } = await sb.rpc('marquer_facture_envoyee', { p_facture_id: id.data });
    if (e) console.error('Date d’envoi non enregistrée', e.code);
  };
  if (canal === 'lien') {
    await tracer({ canal: 'manuel' });
    await marquer();
    revalider(id.data);
    return { succes: 'Lien créé. Copiez-le ou partagez-le.', lien };
  }
  const [{ data: modele }, { data: p }] = await Promise.all([
    sb.from('modeles_messages').select('sujet, corps').eq('code', 'envoi_facture').maybeSingle(),
    sb.from('parametres_entreprise').select('raison_sociale, email').eq('organisation_id', session.organisationId).single(),
  ]);
  if (!modele) return { message: 'Modèle de message « envoi de facture » introuvable : partagez le lien.', lien };
  const valeurs = {
    client: (c.facture.copie_client as { nom_affiche?: string } | null)?.nom_affiche ?? '', entreprise: p?.raison_sociale ?? '',
    numero: c.facture.numero!, lien, montant: formaterEuros(BigInt(c.facture.reste_a_payer_cents ?? c.facture.net_a_payer_cents!)),
    echeance: formaterDate(c.facture.date_echeance!),
  };
  // Réservé en base AVANT l'email : un envoi simultané du même formulaire est refusé (jamais deux emails).
  const reservation = await reserverEnvoi(sb, {
    id: envoiId.data, organisation_id: session.organisationId, document_type: 'facture', document_id: id.data, nature: 'envoi', destinataire: email,
  });
  if (reservation === 'deja') return { message: 'Cet email est déjà en cours d’envoi : rechargez la page dans un instant.', lien };
  if (reservation === 'echec') return { message: `${ECHEC} Aucun email n’est parti : partagez le lien.`, lien };
  const r = await envoyerEmail({ a: email!, sujet: remplirModele(modele.sujet, valeurs), texte: remplirModele(modele.corps, valeurs), repondreA: p?.email });
  await conclureEnvoi(sb, envoiId.data, r);
  if (r.ok) await marquer();
  revalider(id.data);
  return r.ok ? { succes: `Email envoyé à ${email}.`, lien } : { message: `${r.erreur} Partagez le lien à la main.`, lien };
}

/**
 * Nouveau lien de consultation : les liens précédents de la facture sont
 * désactivés (un seul lien valable à la fois : un lien parti au mauvais
 * destinataire ne reste pas ouvert). Null si l'écriture échoue.
 */
async function nouveauLienFacture(sb: Sb, organisationId: string, factureId: string, dateEcheance: string): Promise<string | null> {
  const { error: e1 } = await sb.from('liens_publics').update({ revoque_le: new Date().toISOString() })
    .eq('facture_id', factureId).is('revoque_le', null);
  if (e1) return null;
  const { jeton, sha256 } = nouveauJeton();
  const { error } = await sb.from('liens_publics').insert({
    organisation_id: organisationId, facture_id: factureId, finalite: 'consultation', jeton_sha256: sha256,
    expire_le: expirationLienFacture(dateEcheance).toISOString(),
  });
  return error ? null : urlPublique(jeton, 'f');
}

/** Désactive tous les liens de consultation de la facture (lien transmis par erreur, fuite). */
export async function revoquerLiensFacture(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data, error } = await sb.from('liens_publics').update({ revoque_le: new Date().toISOString() })
    .eq('facture_id', id.data).is('revoque_le', null).gt('expire_le', new Date().toISOString()).select('id');
  if (error) return { message: ECHEC };
  revalider(id.data);
  // Redirection : le bouton disparaît (plus aucun lien actif), le message doit rester visible.
  redirect(`/factures/${id.data}?liens=${data?.length ?? 0}`);
}

const NIVEAUX_RELANCE = ['impaye_1', 'impaye_2', 'impaye_3'] as const;

/**
 * Relance MANUELLE d'une facture échue (client sans email, ou relance
 * immédiate) : niveau suivant non encore fait, message du modèle rempli,
 * nouveau lien. Par email si possible, sinon message prêt à partager (SMS,
 * WhatsApp) ; la relance est tracée dans « Envois et relances » (une seule
 * fois par niveau, comme la relance automatique).
 */
export async function relancerFacture(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  const envoiId = idDe(fd, 'id_nouveau');
  const canal = fd.get('canal') === 'email' ? 'email' : 'lien';
  if (!id.success || !envoiId.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const [{ data: f }, { data: faits, error: eFaits }] = await Promise.all([
    sb.from('v_factures').select('id, numero, type, statut, date_echeance, reste_a_payer_cents, copie_client, client_id').eq('id', id.data).maybeSingle(),
    sb.from('envois').select('nature').eq('document_type', 'facture').eq('document_id', id.data).neq('statut', 'echec'),
  ]);
  if (!f || eFaits) return { message: f ? ECHEC : 'Facture introuvable.' };
  if (f.type === 'avoir' || f.statut !== 'emise' || !(f.reste_a_payer_cents! > 0)) return { message: 'Cette facture n’a rien à relancer.' };
  if (f.date_echeance! >= aujourdHuiParis()) return { message: `Pas encore échue (échéance le ${formaterDate(f.date_echeance!)}).` };
  const niveau = NIVEAUX_RELANCE.find((n) => !(faits ?? []).some((e) => e.nature === n));
  if (!niveau) return { message: 'Les trois rappels ont déjà été faits : contactez le client directement.' };
  const [{ data: modele }, { data: p }, { data: client }] = await Promise.all([
    sb.from('modeles_messages').select('sujet, corps').eq('code', niveau).maybeSingle(),
    sb.from('parametres_entreprise').select('raison_sociale, email').eq('organisation_id', session.organisationId).single(),
    sb.from('clients').select('email, anonymise_le').eq('id', f.client_id!).maybeSingle(),
  ]);
  if (!modele) return { message: 'Modèle de relance introuvable (Réglages > Messages et relances).' };
  const email = client && !client.anonymise_le ? client.email : null;
  if (canal === 'email' && (!email || !emailConfigure())) return { message: 'Envoi par email impossible : partagez le message.' };
  const lien = await nouveauLienFacture(sb, session.organisationId, id.data, f.date_echeance!);
  if (!lien) return { message: ECHEC };
  const valeurs = {
    client: (f.copie_client as { nom_affiche?: string } | null)?.nom_affiche ?? '', entreprise: p?.raison_sociale ?? '', numero: f.numero!,
    lien, montant: formaterEuros(f.reste_a_payer_cents!), echeance: formaterDate(f.date_echeance!),
  };
  const texte = remplirModele(modele.corps, valeurs);
  const rang = niveau.slice(-1);
  if (canal === 'lien') {
    const { error } = await sb.from('envois').insert({
      id: envoiId.data, organisation_id: session.organisationId, document_type: 'facture', document_id: id.data, nature: niveau, canal: 'manuel',
    });
    if (error) return { message: error.code === '23505' ? 'Ce rappel vient d’être fait : rechargez la page.' : ECHEC };
    revalider(id.data);
    return { succes: `Rappel ${rang} prêt : copiez ou partagez le message.`, lien, texte };
  }
  const reservation = await reserverEnvoi(sb, {
    id: envoiId.data, organisation_id: session.organisationId, document_type: 'facture', document_id: id.data, nature: niveau, destinataire: email,
  });
  if (reservation === 'deja') return { message: 'Ce rappel est déjà en cours d’envoi ou fait : rechargez la page.' };
  if (reservation === 'echec') return { message: `${ECHEC} Aucun email n’est parti.` };
  const r = await envoyerEmail({ a: email!, sujet: remplirModele(modele.sujet, valeurs), texte, repondreA: p?.email });
  await conclureEnvoi(sb, envoiId.data, r);
  revalider(id.data);
  return r.ok ? { succes: `Rappel ${rang} envoyé par email à ${email}.` } : { message: `${r.erreur} Partagez le message à la main.`, lien, texte };
}

/** Facture remise en main propre ou envoyée autrement : date d'envoi enregistrée (relances possibles ensuite). */
export async function marquerEnvoyee(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { error } = await sb.rpc('marquer_facture_envoyee', { p_facture_id: id.data });
  if (error) return { message: ECHEC };
  revalider(id.data);
  return { succes: 'Facture marquée envoyée.' };
}

// --------------------------------------------------------------------------
// Paiements (registre en ajout seul)
// --------------------------------------------------------------------------

export async function enregistrerPaiement(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const factureId = idDe(fd, 'facture_id');
  const paiementId = idDe(fd, 'id_nouveau');
  if (!factureId.success || !paiementId.success) return { message: INCOMPLET };
  const lu = schemaPaiement.safeParse(lireChamps(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const { data: deja } = await sb.from('paiements').select('id').eq('id', paiementId.data).maybeSingle();
  if (deja) redirect(`/factures/${factureId.data}?paiement=enregistre`);
  const { error } = await sb.from('paiements').insert({
    id: paiementId.data, organisation_id: session.organisationId, facture_id: factureId.data, date_paiement: lu.data.date_paiement,
    montant_cents: lu.data.montant_cents, mode: lu.data.mode, reference: lu.data.reference, notes: null,
  });
  if (error) {
    if (error.code === '23505') redirect(`/factures/${factureId.data}?paiement=enregistre`);
    if (error.code === 'P0001') return { message: error.message.replace(/\.$/, '') + '.', valeurs: valeursTexte(fd) };
    return { message: ECHEC, valeurs: valeursTexte(fd) };
  }
  // Redirection : le formulaire disparaît quand la facture est soldée, le message doit rester visible.
  revalider(factureId.data);
  redirect(`/factures/${factureId.data}?paiement=enregistre`);
}

/** Annulation d'un paiement saisi par erreur : écriture opposée qui le référence (jamais de modification). */
export async function annulerPaiement(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const factureId = idDe(fd, 'facture_id');
  const paiementId = idDe(fd, 'paiement_id');
  const annulationId = idDe(fd, 'id_nouveau');
  if (!factureId.success || !paiementId.success || !annulationId.success) return { message: INCOMPLET };
  if (fd.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer.' };
  const sb = await clientServeur();
  const { data: p } = await sb.from('paiements').select('*').eq('id', paiementId.data).eq('facture_id', factureId.data).maybeSingle();
  if (!p || p.montant_cents <= 0) return { message: 'Paiement introuvable.' };
  if (p.mode === 'stripe') return { message: 'Un paiement par carte en ligne s’annule par un remboursement dans Stripe (À VÉRIFIER).' };
  const { error } = await sb.from('paiements').insert({
    id: annulationId.data, organisation_id: session.organisationId, facture_id: factureId.data, date_paiement: p.date_paiement,
    montant_cents: -p.montant_cents, mode: p.mode, reference: p.reference, annule_paiement_id: p.id,
  });
  if (error) {
    if (error.code === '23505') redirect(`/factures/${factureId.data}?paiement=annule`);
    if (error.code === 'P0001') return { message: error.message };
    return { message: ECHEC };
  }
  revalider(factureId.data);
  redirect(`/factures/${factureId.data}?paiement=annule`);
}

export type { Regime };

/** Paiement par carte encaissé mais refusé par la base : marqué traité une fois remboursé dans Stripe. */
export async function marquerIncidentTraite(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  const factureId = idDe(fd, 'facture_id');
  if (!id.success || !factureId.success) return { message: INCOMPLET };
  if (fd.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer.' };
  const sb = await clientServeur();
  const { error } = await sb.from('incidents_paiement').update({ traite_le: new Date().toISOString() }).eq('id', id.data).is('traite_le', null);
  if (error) return { message: ECHEC };
  revalider(factureId.data);
  return { succes: 'Noté.' };
}
