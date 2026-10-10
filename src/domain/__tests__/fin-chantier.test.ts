import { describe, expect, it } from 'vitest';
import { avancementFin, lireModeleFin, listeFin } from '../fin-chantier';

describe('liste de fin de chantier', () => {
  it('reprend le modèle tant que le chantier n’a pas sa liste', () => {
    expect(listeFin(null, ['Nettoyage', 'Clés rendues'])).toEqual([{ libelle: 'Nettoyage', fait_le: null }, { libelle: 'Clés rendues', fait_le: null }]);
    const propre = [{ libelle: 'Retouches', fait_le: '2026-10-09' }];
    expect(listeFin(propre, ['Nettoyage'])).toBe(propre);
  });
  it('modèle : une ligne par élément, doublons et lignes vides retirés, bornes', () => {
    expect(lireModeleFin('Nettoyage\n\n Nettoyage \nClés rendues')).toEqual({ elements: ['Nettoyage', 'Clés rendues'] });
    expect(lireModeleFin(Array.from({ length: 31 }, (_, i) => `E${i}`).join('\n'))).toEqual({ erreur: '30 éléments au maximum.' });
    expect('erreur' in lireModeleFin('x'.repeat(121))).toBe(true);
  });
  it('avancement', () => {
    expect(avancementFin([{ libelle: 'a', fait_le: '2026-10-09' }, { libelle: 'b', fait_le: null }])).toEqual({ faits: 1, total: 2, termine: false });
    expect(avancementFin([{ libelle: 'a', fait_le: '2026-10-09' }]).termine).toBe(true);
    expect(avancementFin([]).termine).toBe(false);
  });
});
