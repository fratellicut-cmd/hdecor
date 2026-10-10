/**
 * Galerie avant / après : les photos retenues (« en galerie ») sont groupées
 * par pièce (par identifiant : deux pièces de même nom restent distinctes ;
 * « Chantier » sans pièce), puis appariées dans l'ordre de prise
 * de vue : 1re photo « avant » avec 1re photo « après », etc. Une photo sans
 * vis-à-vis reste seule. Les photos « pendant » et « autre » n'entrent pas
 * dans les paires (comptées à part).
 */
export type PhotoGalerie = { id: string; moment: string; pieceId?: string | null; piece: string | null; legende: string | null; priseLe: string };
export type Paire = { avant: PhotoGalerie | null; apres: PhotoGalerie | null };
export type GroupeGalerie = { titre: string; paires: Paire[] };

export function pairesAvantApres(photos: PhotoGalerie[]): { groupes: GroupeGalerie[]; horsPaires: number } {
  const tri = [...photos].sort((a, b) => (a.priseLe === b.priseLe ? a.id.localeCompare(b.id) : a.priseLe < b.priseLe ? -1 : 1));
  const groupes = new Map<string, { titre: string; avant: PhotoGalerie[]; apres: PhotoGalerie[] }>();
  let horsPaires = 0;
  for (const p of tri) {
    if (p.moment !== 'avant' && p.moment !== 'apres') { horsPaires += 1; continue; }
    const cle = p.pieceId ?? (p.piece === null ? '' : `nom:${p.piece}`);
    const g = groupes.get(cle) ?? { titre: p.piece ?? 'Chantier', avant: [], apres: [] };
    (p.moment === 'avant' ? g.avant : g.apres).push(p);
    groupes.set(cle, g);
  }
  return {
    groupes: [...groupes.values()].map((g) => ({
      titre: g.titre,
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

/** Noms d'une archive rendus uniques (sans tenir compte de la casse) : « nom », « nom-2 », « nom-3 »… avant l'extension. */
export function nomsUniques(noms: string[]): string[] {
  const vus = new Set<string>();
  return noms.map((nom) => {
    const point = nom.lastIndexOf('.');
    const [base, ext] = point > nom.lastIndexOf('/') ? [nom.slice(0, point), nom.slice(point)] : [nom, ''];
    let candidat = nom;
    for (let n = 2; vus.has(candidat.toLowerCase()); n += 1) candidat = `${base}-${n}${ext}`;
    vus.add(candidat.toLowerCase());
    return candidat;
  });
}
