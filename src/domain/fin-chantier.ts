/** Liste de fin de chantier : éléments { libelle, fait_le } ; créée depuis le modèle des Réglages. */
export type ElementFin = { libelle: string; fait_le: string | null };

export const ELEMENTS_FIN_MAX = 50;
export const LIBELLE_FIN_MAX = 120;

/** Liste du chantier si elle existe, sinon le modèle (rien de coché). */
export function listeFin(existante: ElementFin[] | null, modele: string[]): ElementFin[] {
  return existante ?? modele.map((libelle) => ({ libelle, fait_le: null }));
}

/** Modèle saisi une ligne par élément (lignes vides ignorées, doublons retirés). */
export function lireModeleFin(saisie: string): { elements: string[] } | { erreur: string } {
  const lignes = [...new Set(saisie.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
  if (lignes.length > 30) return { erreur: '30 éléments au maximum.' };
  if (lignes.some((l) => l.length > LIBELLE_FIN_MAX)) return { erreur: `${LIBELLE_FIN_MAX} caractères au maximum par élément.` };
  return { elements: lignes };
}

export function avancementFin(liste: ElementFin[]): { faits: number; total: number; termine: boolean } {
  const faits = liste.filter((e) => e.fait_le).length;
  return { faits, total: liste.length, termine: liste.length > 0 && faits === liste.length };
}
