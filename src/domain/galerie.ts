/**
 * Galerie avant / après : les photos retenues (« en galerie ») sont groupées
 * par pièce (ou « Chantier » sans pièce), puis appariées dans l'ordre de prise
 * de vue : 1re photo « avant » avec 1re photo « après », etc. Une photo sans
 * vis-à-vis reste seule. Les photos « pendant » et « autre » n'entrent pas
 * dans les paires (comptées à part).
 */
export type PhotoGalerie = { id: string; moment: string; piece: string | null; legende: string | null; priseLe: string };
export type Paire = { avant: PhotoGalerie | null; apres: PhotoGalerie | null };
export type GroupeGalerie = { titre: string; paires: Paire[] };

export function pairesAvantApres(photos: PhotoGalerie[]): { groupes: GroupeGalerie[]; horsPaires: number } {
  const tri = [...photos].sort((a, b) => (a.priseLe === b.priseLe ? a.id.localeCompare(b.id) : a.priseLe < b.priseLe ? -1 : 1));
  const groupes = new Map<string, { avant: PhotoGalerie[]; apres: PhotoGalerie[] }>();
  let horsPaires = 0;
  for (const p of tri) {
    if (p.moment !== 'avant' && p.moment !== 'apres') { horsPaires += 1; continue; }
    const titre = p.piece ?? 'Chantier';
    const g = groupes.get(titre) ?? { avant: [], apres: [] };
    (p.moment === 'avant' ? g.avant : g.apres).push(p);
    groupes.set(titre, g);
  }
  return {
    groupes: [...groupes].map(([titre, g]) => ({
      titre,
      paires: Array.from({ length: Math.max(g.avant.length, g.apres.length) }, (_, i) => ({ avant: g.avant[i] ?? null, apres: g.apres[i] ?? null })),
    })),
    horsPaires,
  };
}

/** Nom de fichier sûr pour une archive : lettres, chiffres, tirets (accents retirés). */
export function nomFichierSur(texte: string, max = 60): string {
  const s = texte.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
  return s || 'photo';
}
