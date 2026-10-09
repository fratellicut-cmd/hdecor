import type { Regime } from './devis';
import { formaterDate } from './formats';

/**
 * Comptabilité simplifiée d'une micro-entreprise : livre des recettes
 * (encaissements) et registre des achats, par mois, et leurs exports.
 * Une même description de tableau sert au CSV, au classeur Excel et au PDF.
 */

// --------------------------------------------------------------------------
// Mois
// --------------------------------------------------------------------------

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 2026-02 » -> du 2026-02-01 au 2026-02-28. */
export function bornesMois(mois: string): { du: string; au: string } {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  const dernier = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { du: `${mois}-01`, au: `${mois}-${String(dernier).padStart(2, '0')}` };
}

/** Mois décalé de n (négatif : en arrière). */
export function decalerMois(mois: string, n: number): string {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** « octobre 2026 » */
export function libelleMois(mois: string): string {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  return `${MOIS[m - 1]} ${a}`;
}

// --------------------------------------------------------------------------
// Tableaux d'export
// --------------------------------------------------------------------------

export type Valeur =
  | { t: 'texte'; v: string | null }
  | { t: 'montant'; cents: bigint | null }
  | { t: 'date'; iso: string | null };

export type Tableau = { titre: string; entetes: string[]; lignes: Valeur[][]; total?: Valeur[] };

const tx = (v: string | null | undefined): Valeur => ({ t: 'texte', v: v ?? null });
const mt = (cents: bigint | null | undefined): Valeur => ({ t: 'montant', cents: cents ?? null });
const dt = (iso: string | null | undefined): Valeur => ({ t: 'date', iso: iso ?? null });

/** Centimes -> « 1234,56 » (virgule décimale, sans séparateur de milliers : relisible par un tableur). */
export function montantCsv(cents: bigint): string {
  const a = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${a / 100n},${String(a % 100n).padStart(2, '0')}`;
}

/** Valeur -> texte de cellule CSV (dates JJ/MM/AAAA, montants à virgule). */
export function valeurCsv(v: Valeur): string {
  switch (v.t) {
    case 'texte': return v.v ?? '';
    case 'montant': return v.cents === null ? '' : montantCsv(v.cents);
    case 'date': return v.iso ? formaterDate(v.iso) : '';
  }
}

export const LIBELLES_MODE: Record<string, string> = {
  virement: 'Virement', cheque: 'Chèque', especes: 'Espèces', carte: 'Carte', stripe: 'Carte (en ligne)',
};

export type Recette = {
  date: string;
  /** Signé : un remboursement est négatif. */
  montantCents: bigint;
  nature: string;
  mode: string | null;
  reference: string | null;
  factureNumero: string | null;
  client: string;
  /** Part HT (livre des recettes, répartie en cumulé par facture : voir repartirHt). */
  partHtCents: bigint;
};

export type TotauxRecettes = { ttcCents: bigint; htCents: bigint; nombre: number };

export function totauxRecettes(recettes: Recette[]): TotauxRecettes {
  return recettes.reduce((a, r) => ({ ttcCents: a.ttcCents + r.montantCents, htCents: a.htCents + partHtRecette(r), nombre: a.nombre + 1 }),
    { ttcCents: 0n, htCents: 0n, nombre: 0 });
}

const partHtRecette = (r: Recette) => r.partHtCents;

/**
 * Livre des recettes : date, client, facture, nature, mode, référence, montant
 * encaissé. Entreprise soumise à la TVA : colonne « dont HT » en plus (part HT
 * au prorata de la facture, À VÉRIFIER avec le comptable).
 */
export function tableauRecettes(recettes: Recette[], regime: Regime, periode: string): Tableau {
  const avecHt = regime !== 'franchise';
  const t = totauxRecettes(recettes);
  const vide = tx(null);
  return {
    titre: `Livre des recettes, ${periode}`,
    entetes: ['Date', 'Client', 'Facture', 'Nature', 'Mode de paiement', 'Référence', 'Montant encaissé', ...(avecHt ? ['Dont HT (à vérifier)'] : [])],
    lignes: recettes.map((r) => [dt(r.date), tx(r.client), tx(r.factureNumero), tx(r.nature === 'remboursement' ? 'Remboursement' : 'Encaissement'),
      tx(r.mode ? LIBELLES_MODE[r.mode] ?? r.mode : null), tx(r.reference), mt(r.montantCents), ...(avecHt ? [mt(partHtRecette(r))] : [])]),
    total: [tx('Total'), vide, vide, vide, vide, vide, mt(t.ttcCents), ...(avecHt ? [mt(t.htCents)] : [])],
  };
}

export type Achat = {
  date: string;
  fournisseur: string;
  libelle: string | null;
  categorie: string | null;
  chantier: string | null;
  htCents: bigint;
  tvaCents: bigint;
  ttcCents: bigint;
  mode: string | null;
  justificatif: boolean;
};

export type TotauxAchats = { htCents: bigint; tvaCents: bigint; ttcCents: bigint; nombre: number; sansJustificatif: number };

export function totauxAchats(achats: Achat[]): TotauxAchats {
  return achats.reduce((a, x) => ({
    htCents: a.htCents + x.htCents, tvaCents: a.tvaCents + x.tvaCents, ttcCents: a.ttcCents + x.ttcCents,
    nombre: a.nombre + 1, sansJustificatif: a.sansJustificatif + (x.justificatif ? 0 : 1),
  }), { htCents: 0n, tvaCents: 0n, ttcCents: 0n, nombre: 0, sansJustificatif: 0 });
}

/** Total TTC par catégorie (« Sans catégorie » pour les achats non classés), du plus gros au plus petit. */
export function achatsParCategorie(achats: Achat[]): { categorie: string; ttcCents: bigint }[] {
  const m = new Map<string, bigint>();
  for (const a of achats) m.set(a.categorie ?? 'Sans catégorie', (m.get(a.categorie ?? 'Sans catégorie') ?? 0n) + a.ttcCents);
  return [...m].map(([categorie, ttcCents]) => ({ categorie, ttcCents }))
    .sort((x, y) => (x.ttcCents === y.ttcCents ? x.categorie.localeCompare(y.categorie, 'fr') : x.ttcCents > y.ttcCents ? -1 : 1));
}

export function tableauAchats(achats: Achat[], periode: string): Tableau {
  const t = totauxAchats(achats);
  const vide = tx(null);
  return {
    titre: `Registre des achats, ${periode}`,
    entetes: ['Date', 'Fournisseur', 'Libellé', 'Catégorie', 'Chantier', 'HT', 'TVA', 'TTC', 'Mode de paiement', 'Justificatif'],
    lignes: achats.map((a) => [dt(a.date), tx(a.fournisseur), tx(a.libelle), tx(a.categorie), tx(a.chantier), mt(a.htCents), mt(a.tvaCents), mt(a.ttcCents),
      tx(a.mode ? LIBELLES_MODE[a.mode] ?? a.mode : null), tx(a.justificatif ? 'Oui' : 'Non')]),
    total: [tx('Total'), vide, vide, vide, vide, mt(t.htCents), mt(t.tvaCents), mt(t.ttcCents), vide, vide],
  };
}

/** Lignes d'un tableau (total compris) en texte CSV. */
export function lignesCsv(t: Tableau): string[][] {
  return [...t.lignes, ...(t.total ? [t.total] : [])].map((l) => l.map(valeurCsv));
}
