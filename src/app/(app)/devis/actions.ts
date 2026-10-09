'use server';

import { createHash, randomUUID } from 'node:crypto';
import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import type { Insertion } from '@/lib/supabase/types';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import {
  chargerDevis, donneesPdf, ErreurPreparation, ligneDomaine, posteAReprendre, preparerEmission, recalculerTotaux, type ResultatRecalcul,
} from '@/lib/devis';
import { calculerChantier } from '@/lib/chantiers';
import { tauxProposes } from '@/lib/taux';
import { pdfDevis } from '@/lib/pdf/devis';
import { deposer, retirer } from '@/lib/stockage';
import { archiverPdfSigne, deposerTrace, messageSignature } from '@/lib/devis-public';
import { MESSAGES_TRACE } from '@/lib/validation/devis';
import { emailConfigure, envoyerEmail } from '@/lib/email';
import { expirationLien, nouveauJeton, urlPublique } from '@/lib/liens';
import { ipEtNavigateur } from '@/lib/requete';
import { controlerEcheancier, ErreurDevis, remplirModele, repriseDePoste, TOTAL_MAX_CENTS, totalLigne } from '@/domain/devis';
import { formaterDate } from '@/domain/formats';
import { lirePngSignature, schemaEcheance, schemaEntete, schemaLigne, schemaNouveauDevis, schemaSignature } from '@/lib/validation/devis';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const REFUS = 'Ces informations ont été refusées (valeur hors limites ou incohérente). Vérifiez la saisie.';
const FIGE = 'Ce devis a été émis : il ne se modifie plus. Créez une nouvelle version.';
const INCOMPLET = 'Formulaire incomplet : rechargez la page.';
const identifiant = z.uuid();
const idDe = (fd: FormData, cle: string) => identifiant.safeParse(fd.get(cle));

const messageErreur = (e: { code?: string; message?: string } | null) =>
  e?.message?.includes('figé') ? FIGE : e?.code?.startsWith('23') || e?.code === 'P0001' ? REFUS : ECHEC;

function lireChamps(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (!k.startsWith('$')) o[k] = v;
  return o;
}

/** Brouillon de l'organisation (RLS), sinon message. */
async function brouillon(sb: Awaited<ReturnType<typeof clientServeur>>, id: string) {
  const { data } = await sb.from('devis').select('id, statut, regime_tva, chantier_id').eq('id', id).maybeSingle();
  if (!data) return { erreur: 'Devis introuvable.' } as const;
  if (data.statut !== 'brouillon') return { erreur: FIGE } as const;
  return { devis: data } as const;
}

async function prochainOrdre(sb: Awaited<ReturnType<typeof clientServeur>>, devisId: string): Promise<number> {
  const { data } = await sb.from('devis_lignes').select('ordre').eq('devis_id', devisId).order('ordre', { ascending: false }).limit(1).maybeSingle();
  return (data?.ordre ?? 0) + 1;
}

const revalider = (id: string) => { revalidatePath(`/devis/${id}`); revalidatePath('/devis'); };

// --------------------------------------------------------------------------
// Création et reprise des postes
// --------------------------------------------------------------------------

/** Lignes reprises des postes de peinture du chantier, sauf ceux déjà repris dans ce devis. */
async function lignesDesPostes(chantierId: string, devisId: string, organisationId: string, regime: 'franchise' | 'assujetti', dejaRepris: Set<string>, ordre: number) {
  const calcul = await calculerChantier(chantierId);
  if (!calcul) return { lignes: [], ignores: 0, achats: [] };
  const taux = regime === 'franchise' ? 0 : (await tauxProposes())[0]?.taux_bp ?? null;
  if (taux === null) throw new Error('Aucun taux de TVA actif : renseignez-les dans les Paramètres.');
  const lignes = calcul.postes.filter((p) => !dejaRepris.has(p.poste.id)).map((p, i) => {
    const l = repriseDePoste(posteAReprendre(p, chantierId), calcul.parametres.coef_marge_bp, taux);
    return {
      id: randomUUID(), organisation_id: organisationId, devis_id: devisId, ordre: ordre + i, type: 'ligne' as const,
      designation: l.designation.slice(0, 300), description: l.description?.slice(0, 2000) ?? null,
      quantite_e4: Number(l.quantiteE4), unite: l.unite, prix_unitaire_ht_cents: Number(l.prixUnitaireCents), remise_bp: 0,
      taux_tva_bp: taux, total_ht_cents: Number(totalLigne(l.quantiteE4!, l.prixUnitaireCents!, 0)), optionnelle: false,
      origine: l.origine, cout_matiere_prevu_cents: l.coutMatierePrevuCents === null ? null : Number(l.coutMatierePrevuCents),
      minutes_prevues: l.minutesPrevues,
    };
  });
  // Achats retenus (alerte « prix d'achat changé depuis le devis ») : pots de la liste d'achat du chantier.
  const achats = calcul.liste.lignes.flatMap((a) => a.pots?.retenue.pots ?? [])
    .filter((p): p is typeof p & { id: string } => typeof p.id === 'string')
    .map((p) => ({
      organisation_id: organisationId, devis_id: devisId, conditionnement_id: p.id, nombre: p.nombre,
      prix_achat_retenu_cents: p.prixUnitaireCents === null ? null : Number(p.prixUnitaireCents),
    }));
  return { lignes, ignores: calcul.postes.length - lignes.length, achats };
}

/** Remplace les achats retenus du brouillon par ceux de la dernière reprise (une transaction, en base). */
async function remplacerAchats(sb: Awaited<ReturnType<typeof clientServeur>>, devisId: string, achats: Insertion<'devis_achats'>[]): Promise<boolean> {
  if (!achats.length) return true;
  const { error } = await sb.rpc('remplacer_achats_devis', {
    p_devis_id: devisId,
    p_achats: achats.map((a) => ({ conditionnement_id: a.conditionnement_id, nombre: a.nombre, prix_achat_retenu_cents: a.prix_achat_retenu_cents ?? null })),
  });
  if (error) console.error('Achats retenus non enregistrés', error.code);
  return !error;
}

/** Message de l'échec d'un recalcul des totaux (null : tout va bien ou lignes à corriger, signalées sur la page). */
function messageRecalcul(r: ResultatRecalcul): string | null {
  if (r === 'ok' || r === 'a_corriger') return null;
  if (r === 'fige') return FIGE;
  if (r === 'introuvable') return 'Devis introuvable.';
  return 'Les totaux n’ont pas pu être recalculés. Rechargez la page et réessayez.';
}

export async function creerDevis(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaNouveauDevis.safeParse(lireChamps(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const nouveau = idDe(fd, 'id_nouveau');
  if (!nouveau.success) return { message: INCOMPLET };
  const sb = await clientServeur();

  // Réponse perdue puis nouvel envoi : le devis existe déjà, on y va.
  const { data: existant } = await sb.from('devis').select('id').eq('id', nouveau.data).maybeSingle();
  if (existant) redirect(`/devis/${existant.id}`);

  const [{ data: chantier }, { data: p }] = await Promise.all([
    sb.from('chantiers').select('id, client_id, date_debut_prevue, duree_estimee_jours').eq('id', lu.data.chantier_id).maybeSingle(),
    sb.from('parametres_entreprise').select('validite_devis_jours, acompte_pct_defaut_bp, regime_tva, delai_paiement_jours')
      .eq('organisation_id', session.organisationId).single(),
  ]);
  if (!chantier) return { erreurs: { chantier_id: 'Chantier introuvable.' }, valeurs: valeursTexte(fd) };
  if (!p) return { message: ECHEC };
  const { data: client } = await sb.from('clients').select('anonymise_le').eq('id', chantier.client_id).maybeSingle();
  if (!client || client.anonymise_le) return { erreurs: { chantier_id: 'Le client de ce chantier est introuvable ou anonymisé.' } };

  const { error } = await sb.from('devis').insert({
    id: nouveau.data, organisation_id: session.organisationId, client_id: chantier.client_id, chantier_id: chantier.id,
    objet: lu.data.objet, validite_jours: p.validite_devis_jours, regime_tva: p.regime_tva, acompte_pct_bp: p.acompte_pct_defaut_bp,
    date_debut_travaux: chantier.date_debut_prevue, duree_estimee_jours: chantier.duree_estimee_jours,
    conditions_paiement: `Solde à réception de la facture, payable sous ${p.delai_paiement_jours} jours.`,
    hors_etablissement: true,
  });
  if (error) {
    // Deux envois du même formulaire (réponse perdue) : le premier a créé le devis.
    if (error.code === '23505') redirect(`/devis/${nouveau.data}`);
    return { message: messageErreur(error), valeurs: valeursTexte(fd) };
  }

  if (lu.data.importer_postes) {
    try {
      const { lignes, achats } = await lignesDesPostes(chantier.id, nouveau.data, session.organisationId, p.regime_tva, new Set(), 1);
      if (lignes.length) {
        const { error: e } = await sb.from('devis_lignes').insert(lignes);
        if (e) redirect(`/devis/${nouveau.data}?reprise=echec`);
        const r = await recalculerTotaux(sb, nouveau.data);
        if (r === 'echec') redirect(`/devis/${nouveau.data}?reprise=totaux`);
        if (!(await remplacerAchats(sb, nouveau.data, achats))) redirect(`/devis/${nouveau.data}?cree=1&achats=echec`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Aucun taux')) redirect(`/devis/${nouveau.data}?reprise=taux`);
      unstable_rethrow(e);
      // Le brouillon existe : on y va, la reprise peut être relancée depuis le devis.
      console.error('Reprise des postes', e instanceof Error ? e.message : e);
      redirect(`/devis/${nouveau.data}?reprise=echec`);
    }
  }
  revalidatePath('/devis');
  redirect(`/devis/${nouveau.data}?cree=1`);
}

export async function importerPostes(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'devis_id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const b = await brouillon(sb, id.data);
  if ('erreur' in b) return { message: b.erreur };
  if (!b.devis.chantier_id) return { message: 'Ce devis n’est rattaché à aucun chantier.' };
  const { data: existantes } = await sb.from('devis_lignes').select('origine').eq('devis_id', id.data);
  const deja = new Set((existantes ?? []).map((l) => (l.origine as { poste_id?: string } | null)?.poste_id).filter((x): x is string => !!x));
  let res;
  try {
    res = await lignesDesPostes(b.devis.chantier_id, id.data, session.organisationId, b.devis.regime_tva, deja, await prochainOrdre(sb, id.data));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Aucun taux')) return { message: e.message };
    throw e;
  }
  if (!res.lignes.length) return { succes: res.ignores ? 'Tous les postes du chantier sont déjà repris dans ce devis.' : 'Aucun poste de peinture sur ce chantier.' };
  const { error } = await sb.from('devis_lignes').insert(res.lignes);
  if (error) return { message: messageErreur(error) };
  const recalcul = messageRecalcul(await recalculerTotaux(sb, id.data));
  const achatsOk = await remplacerAchats(sb, id.data, res.achats);
  revalider(id.data);
  if (recalcul) return { message: recalcul };
  if (!achatsOk) return { message: 'Postes repris, mais les achats retenus (alerte de prix) n’ont pas été enregistrés : relancez la reprise.' };
  const n = res.lignes.length;
  return { succes: `${n} poste${n > 1 ? 's' : ''} repris${res.ignores ? ` (${res.ignores} déjà présent${res.ignores > 1 ? 's' : ''}, non dupliqué${res.ignores > 1 ? 's' : ''})` : ''}. Vérifiez chaque prix et le taux de TVA.` };
}

// --------------------------------------------------------------------------
// Brouillon : en-tête, lignes, échéancier
// --------------------------------------------------------------------------

export async function enregistrerEntete(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'devis_id');
  if (!id.success) return { message: INCOMPLET };
  const lu = schemaEntete.safeParse(lireChamps(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const b = await brouillon(sb, id.data);
  if ('erreur' in b) return { message: b.erreur };
  // Avec un échéancier, l'acompte est celui des échéances « à la signature » (la base l'exige).
  const { data: echeances } = await sb.from('devis_echeances').select('pourcentage_bp, declencheur').eq('devis_id', id.data);
  const valeurs = echeances?.length
    ? { ...lu.data, acompte_pct_bp: echeances.filter((e) => e.declencheur === 'signature').reduce((a, e) => a + e.pourcentage_bp, 0) }
    : lu.data;
  const { error } = await sb.from('devis').update(valeurs).eq('id', id.data);
  if (error) return { message: messageErreur(error), valeurs: valeursTexte(fd) };
  const recalcul = messageRecalcul(await recalculerTotaux(sb, id.data));
  revalider(id.data);
  return recalcul ? { message: recalcul } : { succes: 'En-tête enregistré.' };
}

export async function enregistrerLigne(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const devisId = idDe(fd, 'devis_id');
  if (!devisId.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const b = await brouillon(sb, devisId.data);
  if ('erreur' in b) return { message: b.erreur };
  const champs = lireChamps(fd);
  // Franchise en base : taux 0 imposé (la saisie est ignorée).
  if (b.devis.regime_tva === 'franchise') champs.taux_tva_bp = '0';
  const lu = schemaLigne.safeParse(champs);
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const l = lu.data;
  if (l.type === 'ligne' && b.devis.regime_tva === 'assujetti') {
    const proposes = (await tauxProposes()).map((t) => t.taux_bp);
    if (!proposes.includes(l.taux_tva_bp)) return { erreurs: { taux_tva_bp: 'Taux non proposé dans les Paramètres.' }, valeurs: valeursTexte(fd) };
  }
  const colonnes = l.type === 'ligne' ? {
    type: l.type, designation: l.designation, description: l.description, quantite_e4: l.quantite_e4, unite: l.unite,
    prix_unitaire_ht_cents: l.prix_unitaire_ht_cents, remise_bp: l.remise_bp, taux_tva_bp: l.taux_tva_bp, optionnelle: l.optionnelle,
    total_ht_cents: Number(totalLigne(BigInt(l.quantite_e4), BigInt(l.prix_unitaire_ht_cents), l.remise_bp)),
  } : {
    type: l.type, designation: l.designation, description: l.description, quantite_e4: null, unite: null, prix_unitaire_ht_cents: null,
    remise_bp: 0, taux_tva_bp: null, optionnelle: false, total_ht_cents: null,
  };

  // Plafond du devis (options comprises) vérifié AVANT d'enregistrer.
  const ligneId = fd.get('id');
  if (l.type === 'ligne') {
    const { data: autres } = await sb.from('devis_lignes').select('*').eq('devis_id', devisId.data);
    const simulees = (autres ?? []).filter((x) => x.id !== ligneId).map(ligneDomaine);
    simulees.push({ type: 'ligne', designation: l.designation, quantiteE4: BigInt(l.quantite_e4), unite: l.unite,
      prixUnitaireCents: BigInt(l.prix_unitaire_ht_cents), remiseBp: l.remise_bp, tauxTvaBp: l.taux_tva_bp, optionnelle: l.optionnelle });
    const limite = simulees.reduce((a, x) => a + (x.type === 'ligne' && x.quantiteE4 !== null && x.prixUnitaireCents !== null
      ? totalLigne(x.quantiteE4, x.prixUnitaireCents, x.remiseBp) : 0n), 0n);
    if (limite > TOTAL_MAX_CENTS) return { message: 'Devis trop élevé : 10 000 000 € HT au plus (options comprises).', valeurs: valeursTexte(fd) };
  }
  if (ligneId) {
    const lid = identifiant.safeParse(ligneId);
    if (!lid.success) return { message: 'Ligne introuvable.' };
    const { data: avant } = await sb.from('devis_lignes').select('origine').eq('id', lid.data).eq('devis_id', devisId.data).maybeSingle();
    if (!avant) return { message: 'Ligne introuvable.' };
    // Prix saisi à la main (non nul) : la ligne reprise n'est plus « à compléter ».
    const origine = avant.origine && typeof avant.origine === 'object' && !Array.isArray(avant.origine)
      ? { ...avant.origine, a_completer: l.type === 'ligne' && l.prix_unitaire_ht_cents === 0 && avant.origine.a_completer === true } : avant.origine;
    const { error } = await sb.from('devis_lignes').update({ ...colonnes, origine }).eq('id', lid.data).eq('devis_id', devisId.data);
    if (error) return { message: messageErreur(error), valeurs: valeursTexte(fd) };
  } else {
    const nouveau = idDe(fd, 'id_nouveau');
    if (!nouveau.success) return { message: INCOMPLET };
    let error = null;
    for (let essai = 0; essai < 2; essai++) {
      ({ error } = await sb.from('devis_lignes').upsert({
        ...colonnes, id: nouveau.data, organisation_id: session.organisationId, devis_id: devisId.data, ordre: await prochainOrdre(sb, devisId.data),
      }, { onConflict: 'id', ignoreDuplicates: true }));
      if (error?.code !== '23505') break;   // ordre pris entre-temps : on recommence une fois
    }
    if (error) return { message: messageErreur(error), valeurs: valeursTexte(fd) };
  }
  const recalcul = messageRecalcul(await recalculerTotaux(sb, devisId.data));
  revalider(devisId.data);
  return recalcul ? { message: recalcul } : { succes: ligneId ? 'Ligne modifiée.' : 'Ligne ajoutée.' };
}

export async function supprimerLigne(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const devisId = idDe(fd, 'devis_id');
  const id = idDe(fd, 'id');
  if (!devisId.success || !id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data, error } = await sb.from('devis_lignes').delete().eq('id', id.data).eq('devis_id', devisId.data).select('id');
  if (error) return { message: messageErreur(error) };
  if (!data?.length) return { message: 'Ligne déjà supprimée.' };
  const recalcul = messageRecalcul(await recalculerTotaux(sb, devisId.data));
  revalider(devisId.data);
  return recalcul ? { message: recalcul } : { succes: 'Ligne supprimée.' };
}

export async function deplacerLigne(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const devisId = idDe(fd, 'devis_id');
  const id = idDe(fd, 'id');
  const sens = fd.get('sens') === 'haut' ? -1 : fd.get('sens') === 'bas' ? 1 : null;
  if (!devisId.success || !id.success || sens === null) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { error } = await sb.rpc('deplacer_ligne_devis', { p_ligne_id: id.data, p_sens: sens });
  if (error) return { message: messageErreur(error) };
  revalider(devisId.data);
  return {};
}

/**
 * Acompte du devis = échéances « à la signature » (la base l'exige). Sans
 * échéancier, retour à l'acompte par défaut des Paramètres. Renvoie un message
 * en cas d'échec (sinon l'émission serait refusée sans explication).
 */
async function synchroniserAcompte(sb: Awaited<ReturnType<typeof clientServeur>>, devisId: string, organisationId: string): Promise<string | null> {
  const [{ data, error }, { data: p }] = await Promise.all([
    sb.from('devis_echeances').select('pourcentage_bp, declencheur').eq('devis_id', devisId),
    sb.from('parametres_entreprise').select('acompte_pct_defaut_bp').eq('organisation_id', organisationId).single(),
  ]);
  if (error || !p) return 'L’acompte n’a pas pu être mis à jour : rechargez la page et réessayez.';
  const acompte = data?.length ? data.filter((e) => e.declencheur === 'signature').reduce((a, e) => a + e.pourcentage_bp, 0) : p.acompte_pct_defaut_bp;
  const { error: e2 } = await sb.from('devis').update({ acompte_pct_bp: acompte }).eq('id', devisId);
  return e2 ? 'L’acompte n’a pas pu être mis à jour : rechargez la page et réessayez.' : null;
}

export async function ajouterEcheance(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const devisId = idDe(fd, 'devis_id');
  const nouveau = idDe(fd, 'id_nouveau');
  if (!devisId.success || !nouveau.success) return { message: INCOMPLET };
  const lu = schemaEcheance.safeParse(lireChamps(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const b = await brouillon(sb, devisId.data);
  if ('erreur' in b) return { message: b.erreur };
  const { data: existantes } = await sb.from('devis_echeances').select('*').eq('devis_id', devisId.data).order('ordre');
  if (existantes?.some((e) => e.id === nouveau.data)) return { succes: 'Échéance ajoutée.' };
  const controle = controlerEcheancier([...(existantes ?? []).map((e) => ({
    libelle: e.libelle, pourcentageBp: e.pourcentage_bp, declencheur: e.declencheur as 'signature', datePrevue: e.date_prevue,
  })), { libelle: lu.data.libelle, pourcentageBp: lu.data.pourcentage_bp, declencheur: lu.data.declencheur, datePrevue: lu.data.date_prevue }]);
  if (controle.erreurs.length) return { message: controle.erreurs.join(' '), valeurs: valeursTexte(fd) };
  const { error } = await sb.from('devis_echeances').insert({
    ...lu.data, id: nouveau.data, organisation_id: session.organisationId, devis_id: devisId.data,
    ordre: (existantes?.at(-1)?.ordre ?? 0) + 1,
  });
  if (error) return { message: messageErreur(error), valeurs: valeursTexte(fd) };
  const probleme = await synchroniserAcompte(sb, devisId.data, session.organisationId);
  revalider(devisId.data);
  return probleme ? { message: probleme } : { succes: 'Échéance ajoutée.' };
}

export async function supprimerEcheance(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const devisId = idDe(fd, 'devis_id');
  const id = idDe(fd, 'id');
  if (!devisId.success || !id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { error } = await sb.from('devis_echeances').delete().eq('id', id.data).eq('devis_id', devisId.data);
  if (error) return { message: messageErreur(error) };
  const probleme = await synchroniserAcompte(sb, devisId.data, session.organisationId);
  revalider(devisId.data);
  return probleme ? { message: probleme } : { succes: 'Échéance retirée.' };
}

export async function supprimerBrouillon(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  if (fd.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer.' };
  const sb = await clientServeur();
  const { data, error } = await sb.from('devis').delete().eq('id', id.data).eq('statut', 'brouillon').select('id');
  if (error || !data?.length) return { message: error ? messageErreur(error) : 'Seul un brouillon peut être supprimé.' };
  revalidatePath('/devis');
  redirect('/devis?supprime=1');
}

// --------------------------------------------------------------------------
// Émission
// --------------------------------------------------------------------------

/** Erreur certaine de la base (refus métier) : rien n'a été enregistré. Sinon (réseau, réponse perdue) : on ne sait pas. */
const refusCertain = (code: string | undefined) => code === 'HD001' || code === 'P0001' || code === 'P0002' || !!code?.startsWith('23');

export async function emettreDevis(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  if (fd.get('textes_confirmes') !== 'on') return { message: 'Cochez la case : textes légaux À VÉRIFIER par le comptable.' };
  const sb = await clientServeur();
  const recalcul = await recalculerTotaux(sb, id.data);
  if (recalcul === 'fige') redirect(`/devis/${id.data}`);
  const probleme = messageRecalcul(recalcul);
  if (probleme) return { message: probleme };

  for (let essai = 0; essai < 3; essai++) {
    const c = await chargerDevis(id.data, sb);
    if (!c) return { message: 'Devis introuvable.' };
    if (c.devis.statut !== 'brouillon') redirect(`/devis/${id.data}`);
    const { data: prev, error: ePrev } = await sb.rpc('numero_devis_previsionnel', { p_devis_id: id.data });
    if (ePrev || !prev) return { message: ECHEC };
    const { numero, date_emission: date } = prev as { numero: string; date_emission: string };
    let octets: Uint8Array;
    let prep;
    try {
      prep = await preparerEmission(sb, c, date);
      const bloquants = prep.manques.filter((m) => m.bloquant);
      if (bloquants.length) return { message: `Émission impossible : ${bloquants.map((m) => m.message).join(' ')}` };
      if (prep.aCompleter.length) return { message: `Prix à compléter : ${prep.aCompleter.join(', ')}.` };
      if (!c.lignes.some((l) => l.type === 'ligne' && !l.optionnelle)) return { message: 'Ajoutez au moins une ligne chiffrée (hors option).' };
      if ((c.devis.total_ht_cents ?? 0) <= 0) return { message: 'Un devis à 0 € HT ne peut pas être émis.' };
      octets = await pdfDevis(donneesPdf(c, prep, { numero, dateEmission: date, brouillon: false }));
    } catch (e) {
      if (e instanceof ErreurPreparation || e instanceof ErreurDevis) return { message: `Émission impossible : ${e.message}` };
      throw e;
    }
    const sha = createHash('sha256').update(octets).digest('hex');
    const chemin = `${session.organisationId}/devis/${id.data}/${randomUUID()}.pdf`;
    await deposer('documents', session.organisationId, chemin, octets, 'application/pdf');
    const { error } = await sb.rpc('emettre_devis', {
      p_devis_id: id.data, p_copie_emetteur: prep.emetteur, p_copie_client: prep.client, p_copie_chantier: prep.chantier ?? {},
      p_pdf_chemin: chemin, p_pdf_sha256: sha, p_numero_attendu: numero, p_date_attendue: date,
    });
    if (!error) {
      revalider(id.data);
      redirect(`/devis/${id.data}?emis=1`);
    }
    if (!refusCertain(error.code)) {
      // Réponse perdue : l'émission a peut-être été validée. On relit AVANT de toucher au fichier.
      const { data: apres, error: eRelecture } = await sb.from('devis').select('statut, pdf_chemin').eq('id', id.data).maybeSingle();
      // Statut inconnu : le fichier est gardé (jamais d'effacement à l'aveugle) et on le dit.
      if (eRelecture || !apres) return { message: 'Le réseau ne répond pas : l’émission n’est pas confirmée. Rechargez la page pour voir le statut du devis.' };
      if (apres.statut !== 'brouillon') {
        // Une autre émission l'a emporté : notre PDF n'est référencé nulle part.
        if (apres.pdf_chemin !== chemin) await retirer('documents', session.organisationId, chemin).catch(() => undefined);
        revalider(id.data);
        redirect(`/devis/${id.data}${apres.pdf_chemin === chemin ? '?emis=1' : ''}`);
      }
    }
    // Refus certain, ou devis resté brouillon : ce PDF n'est référencé nulle part.
    await retirer('documents', session.organisationId, chemin).catch(() => undefined);
    if (error.code !== 'HD001') return { message: error.code === 'P0001' ? `Émission refusée : ${error.message}` : ECHEC };
    // HD001 : numéro ou date changés pendant l'émission (autre devis émis, minuit) -> nouveau PDF.
  }
  return { message: 'Émission impossible pour l’instant (numérotation occupée). Réessayez.' };
}

// --------------------------------------------------------------------------
// Envoi, liens, relances
// --------------------------------------------------------------------------

/**
 * Envoi pour signature : nouveau lien (affiché une fois) et, si demandé,
 * email. Idempotent : l'envoi porte l'identifiant fixé par le formulaire
 * (id_nouveau) ; un nouvel essai après une réponse perdue ne renvoie pas
 * d'email en double.
 */
export async function envoyerDevis(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  const envoiId = idDe(fd, 'id_nouveau');
  const canal = fd.get('canal') === 'email' ? 'email' : 'lien';
  if (!id.success || !envoiId.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data: deja } = await sb.from('envois').select('canal, destinataire, statut').eq('id', envoiId.data).maybeSingle();
  if (deja) {
    if (deja.statut === 'echec') return { message: 'L’email précédent n’est pas parti : rechargez la page pour réessayer (aucun email en double).' };
    return deja.canal === 'email'
      ? { succes: `Email déjà envoyé à ${deja.destinataire} : rien n’a été renvoyé.` }
      : { message: 'Ce lien a déjà été créé : rechargez la page pour en créer un nouveau.' };
  }
  const c = await chargerDevis(id.data, sb);
  if (!c) return { message: 'Devis introuvable.' };
  if (c.devis.statut !== 'envoye') return { message: 'Seul un devis émis, ni signé ni refusé, se partage pour signature.' };
  const expire = expirationLien(c.devis.valide_jusqu_au!);
  if (!expire) return { message: 'Ce devis a expiré : créez une nouvelle version.' };
  const email = c.client?.email ?? null;
  if (canal === 'email' && !email) return { message: 'Le client n’a pas d’adresse email : créez un lien à partager.' };
  if (canal === 'email' && !emailConfigure()) return { message: 'Envoi d’emails non configuré sur ce serveur : créez un lien à partager.' };

  const { jeton, sha256 } = nouveauJeton();
  const { error } = await sb.from('liens_publics').insert({
    organisation_id: session.organisationId, devis_id: id.data, finalite: 'signature', jeton_sha256: sha256, expire_le: expire.toISOString(),
  });
  if (error) return { message: ECHEC };
  const lien = urlPublique(jeton);
  const tracer = async (champs: { canal: 'email' | 'manuel'; destinataire?: string | null; fournisseur_id?: string | null; statut?: 'envoye' | 'echec'; erreur?: string | null }) => {
    const { error: e } = await sb.from('envois').insert({
      id: envoiId.data, organisation_id: session.organisationId, document_type: 'devis', document_id: id.data, nature: 'envoi', ...champs,
    });
    if (e) console.error('Envoi non tracé', e.code);
  };

  if (canal === 'lien') {
    await tracer({ canal: 'manuel' });
    revalider(id.data);
    return { succes: `Lien créé, valable jusqu’au ${formaterDate(expire)}. Copiez-le ou partagez-le.`, lien };
  }

  const [{ data: modele }, { data: p }] = await Promise.all([
    sb.from('modeles_messages').select('sujet, corps').eq('code', 'envoi_devis').maybeSingle(),
    sb.from('parametres_entreprise').select('raison_sociale, email').eq('organisation_id', session.organisationId).single(),
  ]);
  if (!modele) return { message: 'Modèle de message « envoi du devis » introuvable : partagez le lien.', lien };
  const valeurs = {
    client: (c.devis.copie_client as { nom_affiche?: string } | null)?.nom_affiche ?? '', entreprise: p?.raison_sociale ?? '',
    numero: `${c.devis.numero}${c.devis.version! > 1 ? ` (version ${c.devis.version})` : ''}`, lien,
    valide_jusqu_au: formaterDate(c.devis.valide_jusqu_au!),
  };
  const r = await envoyerEmail({ a: email!, sujet: remplirModele(modele.sujet, valeurs), texte: remplirModele(modele.corps, valeurs), repondreA: p?.email });
  await tracer({ canal: 'email', destinataire: email, fournisseur_id: r.ok ? r.id : null, statut: r.ok ? 'envoye' : 'echec', erreur: r.ok ? null : r.erreur });
  revalider(id.data);
  return r.ok ? { succes: `Email envoyé à ${email}.`, lien } : { message: `${r.erreur} Partagez le lien à la main.`, lien };
}

export async function revoquerLiens(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data, error } = await sb.from('liens_publics').update({ revoque_le: new Date().toISOString() })
    .eq('devis_id', id.data).is('revoque_le', null).gt('expire_le', new Date().toISOString()).select('id');
  if (error) return { message: ECHEC };
  revalider(id.data);
  return { succes: data?.length ? `${data.length} lien${data.length > 1 ? 's' : ''} désactivé${data.length > 1 ? 's' : ''}.` : 'Aucun lien actif.' };
}

// --------------------------------------------------------------------------
// Cycle de vie : refus, versions, duplication
// --------------------------------------------------------------------------

export async function refuserDevis(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  if (fd.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer le refus.' };
  const motif = typeof fd.get('motif') === 'string' ? String(fd.get('motif')).trim().slice(0, 500) || null : null;
  const sb = await clientServeur();
  // Les types générés déclarent tous les paramètres non nuls ; la fonction SQL accepte un motif absent.
  const { error } = await sb.rpc('refuser_devis', { p_devis_id: id.data, p_motif: motif as string });
  if (error) return { message: error.code === 'P0001' ? 'Ce devis ne peut plus être refusé (déjà signé, refusé ou remplacé).' : ECHEC };
  revalider(id.data);
  redirect(`/devis/${id.data}?refuse=1`);
}

export async function nouvelleVersion(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data, error } = await sb.rpc('nouvelle_version_devis', { p_devis_id: id.data });
  // Les liens de l'ancienne version sont désactivés par la base, dans la même transaction.
  if (error || !data) return { message: error?.code === 'P0001' ? 'Seul un devis envoyé, ni signé ni refusé, peut être remplacé.' : ECHEC };
  revalider(id.data);
  redirect(`/devis/${data}?version=1`);
}

export async function dupliquerDevis(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data: source } = await sb.from('devis').select('regime_tva').eq('id', id.data).maybeSingle();
  const { data, error } = await sb.rpc('dupliquer_devis', { p_devis_id: id.data });
  if (error || !data) return { message: ECHEC };
  const { data: copie } = await sb.from('devis').select('regime_tva').eq('id', data).maybeSingle();
  const recalcul = await recalculerTotaux(sb, data);
  revalidatePath('/devis');
  // Copie créée, totaux non recalculés : la page du brouillon le dit (ils le seront à la prochaine modification et à l'émission).
  if (recalcul === 'echec') redirect(`/devis/${data}?duplique=1&totaux=echec`);
  // Régime de TVA changé depuis le devis copié : les taux des lignes sont à revoir (signalé sur le brouillon).
  redirect(`/devis/${data}?duplique=1${source && copie && source.regime_tva !== copie.regime_tva ? '&regime=1' : ''}`);
}

// --------------------------------------------------------------------------
// Signature sur place (téléphone de l'entreprise, session authentifiée)
// --------------------------------------------------------------------------

export async function signerSurPlace(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const lu = schemaSignature.safeParse({ ...lireChamps(fd), options: fd.getAll('options').map(String) });
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd, ['image']) };
  const png = lirePngSignature(lu.data.image);
  if ('erreur' in png) return { erreurs: { image: MESSAGES_TRACE[png.erreur] }, valeurs: valeursTexte(fd, ['image']) };
  const sb = await clientServeur();
  const { data: d } = await sb.from('devis').select('id, statut').eq('id', id.data).maybeSingle();
  if (!d) return { message: 'Devis introuvable.' };
  if (d.statut !== 'envoye') return { message: 'Ce devis ne peut plus être signé (déjà signé, refusé ou remplacé).' };
  const { ip, userAgent } = await ipEtNavigateur();
  const image = await deposerTrace(session.organisationId, id.data, png.octets);
  // IP et navigateur peuvent manquer (null) ; les types générés déclarent les paramètres non nuls.
  const { error } = await sb.rpc('signer_devis_sur_place', {
    p_devis_id: id.data, p_nom: lu.data.nom, p_mention: lu.data.mention, p_image_chemin: image,
    p_document_sha256: lu.data.document_sha256, p_options: lu.data.options, p_ip: ip as string, p_user_agent: userAgent as string,
  });
  if (error) {
    if (refusCertain(error.code)) {
      await retirer('signatures', session.organisationId, image).catch(() => undefined);
      return { message: error.code === 'P0001' ? messageSignature(error.message) : ECHEC, valeurs: valeursTexte(fd, ['image']) };
    }
    // Réponse perdue : la signature a peut-être été enregistrée ; le tracé est gardé.
    const { data: apres } = await sb.from('devis').select('statut').eq('id', id.data).maybeSingle();
    // Issue incertaine : le tracé est GARDÉ (la signature a pu être validée juste après la relecture).
    if (apres?.statut !== 'accepte') {
      return { message: 'Le réseau ne répond pas : la signature n’est pas confirmée. Rechargez la page avant de réessayer.', valeurs: valeursTexte(fd, ['image']) };
    }
  }
  const archive = await archiverPdfSigne(session.organisationId, id.data).catch(() => false);
  revalider(id.data);
  redirect(`/devis/${id.data}?signe=1${archive ? '' : '&archive=0'}`);
}

export async function archiverSigne(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  // Contrôle d'accès par la session (RLS) avant l'archivage.
  const sb = await clientServeur();
  const { data } = await sb.from('devis').select('id').eq('id', id.data).eq('statut', 'accepte').maybeSingle();
  if (!data) return { message: 'Devis introuvable ou non signé.' };
  const ok = await archiverPdfSigne(session.organisationId, id.data).catch(() => false);
  revalider(id.data);
  return ok ? { succes: 'PDF signé archivé.' } : { message: 'Archivage impossible pour l’instant. Réessayez plus tard.' };
}
