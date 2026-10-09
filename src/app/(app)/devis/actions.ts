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
  chargerDevis, donneesPdf, posteAReprendre, preparerEmission, recalculerTotaux,
} from '@/lib/devis';
import { calculerChantier } from '@/lib/chantiers';
import { tauxProposes } from '@/lib/taux';
import { pdfDevis } from '@/lib/pdf/devis';
import { deposer, retirer } from '@/lib/stockage';
import { archiverPdfSigne, deposerTrace, messageSignature } from '@/lib/devis-public';
import { emailConfigure, envoyerEmail } from '@/lib/email';
import { expirationLien, nouveauJeton, urlPublique } from '@/lib/liens';
import { ipEtNavigateur } from '@/lib/requete';
import { controlerEcheancier, remplirModele, repriseDePoste, totalLigne } from '@/domain/devis';
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

/** Remplace les achats retenus du brouillon par ceux de la dernière reprise. */
async function remplacerAchats(sb: Awaited<ReturnType<typeof clientServeur>>, devisId: string, achats: Insertion<'devis_achats'>[]) {
  if (!achats.length) return;
  await sb.from('devis_achats').delete().eq('devis_id', devisId);
  await sb.from('devis_achats').insert(achats);
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
  if (error) return { message: messageErreur(error), valeurs: valeursTexte(fd) };

  if (lu.data.importer_postes) {
    try {
      const { lignes, achats } = await lignesDesPostes(chantier.id, nouveau.data, session.organisationId, p.regime_tva, new Set(), 1);
      if (lignes.length) {
        const { error: e } = await sb.from('devis_lignes').insert(lignes);
        if (e) redirect(`/devis/${nouveau.data}?reprise=echec`);
        await recalculerTotaux(sb, nouveau.data);
        await remplacerAchats(sb, nouveau.data, achats);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Aucun taux')) redirect(`/devis/${nouveau.data}?reprise=taux`);
      throw e;
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
  await recalculerTotaux(sb, id.data);
  await remplacerAchats(sb, id.data, res.achats);
  revalider(id.data);
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
  if (!(await recalculerTotaux(sb, id.data))) return { message: ECHEC };
  revalider(id.data);
  return { succes: 'En-tête enregistré.' };
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

  const ligneId = fd.get('id');
  if (ligneId) {
    const lid = identifiant.safeParse(ligneId);
    if (!lid.success) return { message: 'Ligne introuvable.' };
    const { data: avant } = await sb.from('devis_lignes').select('origine').eq('id', lid.data).eq('devis_id', devisId.data).maybeSingle();
    if (!avant) return { message: 'Ligne introuvable.' };
    // Prix saisi à la main : la ligne reprise n'est plus « à compléter ».
    const origine = avant.origine && typeof avant.origine === 'object' && !Array.isArray(avant.origine)
      ? { ...avant.origine, a_completer: false } : avant.origine;
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
  if (!(await recalculerTotaux(sb, devisId.data))) return { message: ECHEC };
  revalider(devisId.data);
  return { succes: ligneId ? 'Ligne modifiée.' : 'Ligne ajoutée.' };
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
  await recalculerTotaux(sb, devisId.data);
  revalider(devisId.data);
  return { succes: 'Ligne supprimée.' };
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

async function synchroniserAcompte(sb: Awaited<ReturnType<typeof clientServeur>>, devisId: string) {
  const { data } = await sb.from('devis_echeances').select('pourcentage_bp, declencheur').eq('devis_id', devisId);
  const acompte = (data ?? []).filter((e) => e.declencheur === 'signature').reduce((a, e) => a + e.pourcentage_bp, 0);
  await sb.from('devis').update({ acompte_pct_bp: acompte }).eq('id', devisId);
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
  await synchroniserAcompte(sb, devisId.data);
  revalider(devisId.data);
  return { succes: 'Échéance ajoutée.' };
}

export async function supprimerEcheance(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const devisId = idDe(fd, 'devis_id');
  const id = idDe(fd, 'id');
  if (!devisId.success || !id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { error } = await sb.from('devis_echeances').delete().eq('id', id.data).eq('devis_id', devisId.data);
  if (error) return { message: messageErreur(error) };
  await synchroniserAcompte(sb, devisId.data);
  revalider(devisId.data);
  return { succes: 'Échéance retirée.' };
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

export async function emettreDevis(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  if (!(await recalculerTotaux(sb, id.data))) return { message: FIGE };

  for (let essai = 0; essai < 3; essai++) {
    const c = await chargerDevis(id.data, sb);
    if (!c) return { message: 'Devis introuvable.' };
    if (c.devis.statut !== 'brouillon') redirect(`/devis/${id.data}`);
    const { data: prev, error: ePrev } = await sb.rpc('numero_devis_previsionnel', { p_devis_id: id.data });
    if (ePrev || !prev) return { message: ECHEC };
    const { numero, date_emission: date } = prev as { numero: string; date_emission: string };
    const prep = await preparerEmission(sb, c, date);
    const bloquants = prep.manques.filter((m) => m.bloquant);
    if (bloquants.length) return { message: `Émission impossible : ${bloquants.map((m) => m.message).join(' ')}` };
    if (prep.aCompleter.length) return { message: `Prix à compléter : ${prep.aCompleter.join(', ')}.` };
    if (!c.lignes.some((l) => l.type === 'ligne' && !l.optionnelle)) return { message: 'Ajoutez au moins une ligne chiffrée (hors option).' };
    if (fd.get('textes_confirmes') !== 'on') return { message: 'Cochez la case : textes légaux À VÉRIFIER par le comptable.' };

    const octets = await pdfDevis(donneesPdf(c, prep, { numero, dateEmission: date, brouillon: false }));
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
    // PDF orphelin (jamais référencé) : retiré.
    await retirer('documents', session.organisationId, chemin).catch(() => undefined);
    if (error.code !== 'HD001') return { message: error.code === 'P0001' ? `Émission refusée : ${error.message}` : ECHEC };
    // HD001 : numéro ou date changés pendant l'émission (autre devis émis, minuit) -> nouveau PDF.
  }
  return { message: 'Émission impossible pour l’instant (numérotation occupée). Réessayez.' };
}

// --------------------------------------------------------------------------
// Envoi, liens, relances
// --------------------------------------------------------------------------

export async function envoyerDevis(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  const canal = fd.get('canal') === 'email' ? 'email' : 'lien';
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const c = await chargerDevis(id.data, sb);
  if (!c) return { message: 'Devis introuvable.' };
  if (c.devis.statut !== 'envoye') return { message: 'Seul un devis émis, ni signé ni refusé, se partage pour signature.' };
  const expire = expirationLien(c.devis.valide_jusqu_au!);
  if (!expire) return { message: 'Ce devis a expiré : créez une nouvelle version.' };
  const { jeton, sha256 } = nouveauJeton();
  const { error } = await sb.from('liens_publics').insert({
    organisation_id: session.organisationId, devis_id: id.data, finalite: 'signature', jeton_sha256: sha256, expire_le: expire.toISOString(),
  });
  if (error) return { message: ECHEC };
  const lien = urlPublique(jeton);

  if (canal === 'lien') {
    await sb.from('envois').insert({ organisation_id: session.organisationId, document_type: 'devis', document_id: id.data, nature: 'envoi', canal: 'manuel' });
    revalider(id.data);
    return { succes: `Lien créé, valable jusqu’au ${formaterDate(expire)}. Copiez-le ou partagez-le.`, lien };
  }

  const email = c.client?.email;
  if (!email) return { message: 'Le client n’a pas d’adresse email : partagez le lien.', lien };
  if (!emailConfigure()) return { message: 'Envoi d’emails non configuré sur ce serveur : partagez le lien à la main.', lien };
  const [{ data: modele }, { data: p }] = await Promise.all([
    sb.from('modeles_messages').select('sujet, corps, actif').eq('code', 'envoi_devis').maybeSingle(),
    sb.from('parametres_entreprise').select('raison_sociale, email').eq('organisation_id', session.organisationId).single(),
  ]);
  if (!modele) return { message: 'Modèle de message « envoi du devis » introuvable.', lien };
  const valeurs = {
    client: (c.devis.copie_client as { nom_affiche?: string } | null)?.nom_affiche ?? '', entreprise: p?.raison_sociale ?? '',
    numero: `${c.devis.numero}${c.devis.version! > 1 ? ` (version ${c.devis.version})` : ''}`, lien,
    valide_jusqu_au: formaterDate(c.devis.valide_jusqu_au!),
  };
  const r = await envoyerEmail({ a: email, sujet: remplirModele(modele.sujet, valeurs), texte: remplirModele(modele.corps, valeurs), repondreA: p?.email });
  await sb.from('envois').insert({
    organisation_id: session.organisationId, document_type: 'devis', document_id: id.data, nature: 'envoi', canal: 'email',
    destinataire: email, fournisseur_id: r.ok ? r.id : null, statut: r.ok ? 'envoye' : 'echec', erreur: r.ok ? null : r.erreur,
  });
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
  const motif = typeof fd.get('motif') === 'string' ? String(fd.get('motif')).trim().slice(0, 500) || null : null;
  const sb = await clientServeur();
  const { error } = await sb.rpc('refuser_devis', { p_devis_id: id.data, p_motif: motif as string });
  if (error) return { message: error.code === 'P0001' ? 'Ce devis ne peut plus être refusé (déjà signé, refusé ou remplacé).' : ECHEC };
  revalider(id.data);
  return { succes: 'Devis marqué refusé.' };
}

export async function nouvelleVersion(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data, error } = await sb.rpc('nouvelle_version_devis', { p_devis_id: id.data });
  if (error || !data) return { message: error?.code === 'P0001' ? 'Seul un devis envoyé, ni signé ni refusé, peut être remplacé.' : ECHEC };
  // Les liens de l'ancienne version ne doivent plus servir.
  await sb.from('liens_publics').update({ revoque_le: new Date().toISOString() }).eq('devis_id', id.data).is('revoque_le', null);
  revalider(id.data);
  redirect(`/devis/${data}?version=1`);
}

export async function dupliquerDevis(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data, error } = await sb.rpc('dupliquer_devis', { p_devis_id: id.data });
  if (error || !data) return { message: ECHEC };
  await recalculerTotaux(sb, data);
  revalidatePath('/devis');
  redirect(`/devis/${data}?duplique=1`);
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
  if (!png) return { erreurs: { image: 'Signature illisible : effacez et recommencez.' }, valeurs: valeursTexte(fd, ['image']) };
  const sb = await clientServeur();
  const { data: d } = await sb.from('devis').select('id, statut').eq('id', id.data).maybeSingle();
  if (!d) return { message: 'Devis introuvable.' };
  if (d.statut !== 'envoye') return { message: 'Ce devis ne peut plus être signé (déjà signé, refusé ou remplacé).' };
  const { ip, userAgent } = await ipEtNavigateur();
  const image = await deposerTrace(session.organisationId, id.data, png);
  const { error } = await sb.rpc('signer_devis_sur_place', {
    p_devis_id: id.data, p_nom: lu.data.nom, p_mention: lu.data.mention, p_image_chemin: image,
    p_document_sha256: lu.data.document_sha256, p_options: lu.data.options, p_ip: ip as string, p_user_agent: userAgent as string,
  });
  if (error) {
    await retirer('signatures', session.organisationId, image).catch(() => undefined);
    return { message: error.code === 'P0001' ? messageSignature(error.message) : ECHEC, valeurs: valeursTexte(fd, ['image']) };
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
