import { describe, expect, it } from 'vitest';
import { nomFichierSur, pairesAvantApres, type PhotoGalerie } from '../galerie';

const p = (id: string, moment: string, piece: string | null, priseLe: string): PhotoGalerie => ({ id, moment, piece, legende: null, priseLe });

describe('galerie avant / après', () => {
  it('groupe par pièce, apparie dans l’ordre de prise de vue, laisse seules les photos sans vis-à-vis', () => {
    const r = pairesAvantApres([
      p('a2', 'avant', 'Séjour', '2026-10-02T09:00:00Z'), p('a1', 'avant', 'Séjour', '2026-10-01T09:00:00Z'),
      p('b1', 'apres', 'Séjour', '2026-10-09T09:00:00Z'), p('c1', 'apres', null, '2026-10-09T10:00:00Z'),
      p('d1', 'pendant', 'Séjour', '2026-10-05T09:00:00Z'),
    ]);
    expect(r.horsPaires).toBe(1);
    expect(r.groupes.map((g) => g.titre)).toEqual(['Séjour', 'Chantier']);
    expect(r.groupes[0]!.paires.map((x) => [x.avant?.id ?? null, x.apres?.id ?? null])).toEqual([['a1', 'b1'], ['a2', null]]);
    expect(r.groupes[1]!.paires.map((x) => [x.avant?.id ?? null, x.apres?.id ?? null])).toEqual([[null, 'c1']]);
  });
  it('aucune photo : aucun groupe', () => expect(pairesAvantApres([])).toEqual({ groupes: [], horsPaires: 0 }));
  it('noms de fichiers sûrs', () => {
    expect(nomFichierSur('Salle de bain (étage) / « avant »')).toBe('Salle-de-bain-etage-avant');
    expect(nomFichierSur('../../etc')).toBe('etc');
    expect(nomFichierSur('***')).toBe('photo');
  });
});
