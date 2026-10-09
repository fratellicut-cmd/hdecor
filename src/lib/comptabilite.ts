import 'server-only';
import { clientServeur } from '@/lib/supabase/serveur';
import { toutLire } from '@/lib/lecture';
import { bornesMois } from '@/domain/comptabilite';
import type { Achat, Recette } from '@/domain/comptabilite';
import type { Regime } from '@/domain/devis';

function lu<T>(r: { data: T | null; error: unknown }, quoi: string): NonNullable<T> {
  if (r.error || r.data === null) throw new Error(`Lecture impossible : ${quoi}.`);
  return r.data as NonNullable<T>;
}

/** Période : un mois « AAAA-MM » ou une année « AAAA ». */
export function bornes(periode: string): { du: string; au: string } {
  return periode.length === 4 ? { du: `${periode}-01-01`, au: `${periode}-12-31` } : bornesMois(periode);
}

export async function regimeTva(organisationId: string): Promise<Regime> {
  const sb = await clientServeur();
  const { data, error } = await sb.from('parametres_entreprise').select('regime_tva').eq('organisation_id', organisationId).single();
  if (error || !data) throw new Error('Lecture impossible : paramètres.');
  return data.regime_tva;
}

/** Livre des recettes d'une période, par date puis numéro de facture. */
export async function chargerRecettes(periode: string): Promise<Recette[]> {
  const { du, au } = bornes(periode);
  const sb = await clientServeur();
  const lignes = await toutLire((de, a) => sb.from('v_livre_recettes')
    .select('paiement_id, date_paiement, montant_cents, nature, mode, reference, facture_numero, client, part_ht_cents')
    .gte('date_paiement', du).lte('date_paiement', au)
    .order('date_paiement').order('facture_numero').order('paiement_id').range(de, a), 'livre des recettes');
  return lignes.map((l) => ({
    date: l.date_paiement!, montantCents: BigInt(l.montant_cents!), nature: l.nature!, mode: l.mode, reference: l.reference,
    factureNumero: l.facture_numero, client: l.client ?? '', partHtCents: BigInt(l.part_ht_cents!),
  }));
}

export type AchatListe = Achat & { id: string; chantierId: string | null };

/** Registre des achats d'une période, par date. */
export async function chargerAchats(periode: string): Promise<AchatListe[]> {
  const { du, au } = bornes(periode);
  const sb = await clientServeur();
  const lignes = await toutLire((de, a) => sb.from('depenses')
    .select('id, date_depense, fournisseur, libelle, montant_ht_cents, tva_cents, montant_ttc_cents, mode_paiement, justificatif_chemin, chantier_id, categories_depenses(libelle), chantiers(nom)')
    .gte('date_depense', du).lte('date_depense', au).order('date_depense').order('created_at').order('id').range(de, a), 'registre des achats');
  return lignes.map((l) => ({
    id: l.id, date: l.date_depense, fournisseur: l.fournisseur, libelle: l.libelle,
    categorie: l.categories_depenses?.libelle ?? null, chantier: l.chantiers?.nom ?? null, chantierId: l.chantier_id,
    htCents: BigInt(l.montant_ht_cents), tvaCents: BigInt(l.tva_cents), ttcCents: BigInt(l.montant_ttc_cents),
    mode: l.mode_paiement, justificatif: l.justificatif_chemin !== null,
  }));
}

/** Catégories d'achat ; les catégories par défaut sont créées à la première visite. */
export async function chargerCategories(): Promise<{ id: string; libelle: string }[]> {
  const sb = await clientServeur();
  let categories = lu(await sb.from('categories_depenses').select('id, libelle').order('libelle').limit(500), 'catégories');
  if (!categories.length) {
    const { error } = await sb.rpc('initialiser_categories_depenses');
    if (error) throw new Error('Création des catégories impossible.');
    categories = lu(await sb.from('categories_depenses').select('id, libelle').order('libelle').limit(500), 'catégories');
  }
  return categories;
}

/** Chantiers proposés au rattachement d'un achat (en cours d'abord). */
export async function chantiersPourAchat(): Promise<{ id: string; libelle: string }[]> {
  const sb = await clientServeur();
  const ch = lu(await sb.from('v_chantiers').select('id, nom, ville, statut').order('statut').order('created_at', { ascending: false }).limit(300), 'chantiers');
  return ch.map((c) => ({ id: c.id!, libelle: [c.nom, c.ville].filter(Boolean).join(', ') + (c.statut === 'termine' ? ' (terminé)' : '') }));
}
