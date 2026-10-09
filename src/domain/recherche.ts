/**
 * Texte « à plat » pour comparer deux noms : minuscules, sans accents,
 * ligatures développées. Même règle que public.texte_recherche (SQL).
 */
export function texteRecherche(t: string): string {
  return t.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/\p{M}/gu, '').trim();
}
