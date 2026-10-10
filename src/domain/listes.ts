/**
 * Recherche et pagination des listes (devis, factures, chantiers).
 * Le texte cherché est réduit aux lettres, chiffres, tirets et espaces : il
 * entre dans un filtre de l'API, aucun caractère de syntaxe n'y passe.
 */

export const PAR_PAGE = 100;
export const AFFICHAGE_MAX = 1000;

/** Texte de recherche nettoyé (60 caractères au plus) ; null si rien d'utile. */
export function texteCherche(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.normalize('NFC').replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
  return t.length >= 2 ? t : null;
}

/** Motif « contient » pour un filtre ilike de l'API (les espaces valent n'importe quelle suite). */
export const motifContient = (t: string) => `*${t.replace(/ /g, '*')}*`;

/** Nombre de lignes à afficher : multiple de PAR_PAGE, borné. */
export function nombreAffiche(v: unknown): number {
  const n = typeof v === 'string' && /^\d{1,4}$/.test(v) ? Number(v) : PAR_PAGE;
  return Math.min(AFFICHAGE_MAX, Math.max(PAR_PAGE, Math.ceil(n / PAR_PAGE) * PAR_PAGE));
}

/** Adresse d'une liste avec ses paramètres (vides omis). */
export function adresseListe(base: string, params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
