import { describe, expect, it } from 'vitest';
import { arrondi, calculerTemps, centiemes, coutConsommable, coutMainOeuvre, formaterDuree, prixVenteMatiere } from '../chiffrage';
import { avertissementsSysteme, type EntreeSysteme } from '../systemes';

describe('temps de main-d’œuvre', () => {
  // 31,9268 m² × (0,15 × 2 + 0,05) = 31,9268 × 0,35 = 11,17438 min -> 11 min.
  const base = { surfaceMm2: 31_926_800n, minutesParM2CoucheCentiemes: 15, couches: 2, preparationsCentiemes: [5], majorationBp: 0 };
  it('11 minutes', () => expect(calculerTemps(base)).toEqual({ minutes: 11n, complet: true }));
  it('majoration 20 % (mobilier, hauteur) : 13,409256 -> 13 minutes', () => {
    expect(calculerTemps({ ...base, majorationBp: 2000 }).minutes).toBe(13n);
  });
  it('temps de finition inconnu : préparation seule, signalé incomplet', () => {
    // 31,9268 × 0,05 = 1,59634 -> 2 min.
    expect(calculerTemps({ ...base, minutesParM2CoucheCentiemes: null })).toEqual({ minutes: 2n, complet: false });
  });
  it('surface nulle : 0 minute', () => expect(calculerTemps({ ...base, surfaceMm2: 0n }).minutes).toBe(0n));
  it('majoration négative refusée', () => expect(() => calculerTemps({ ...base, majorationBp: -1 })).toThrow());
  it('affichage', () => {
    expect(formaterDuree(125n)).toBe('2 h 05');
    expect(formaterDuree(45n)).toBe('45 min');
  });
});

describe('argent (centimes entiers, demi supérieur)', () => {
  it('main-d’œuvre : 11 min à 45,00 €/h = 8,25 €', () => expect(coutMainOeuvre(11n, 4500n)).toBe(825n));
  it('main-d’œuvre : 1 min à 45,50 €/h = 0,758333… -> 0,76 €', () => expect(coutMainOeuvre(1n, 4550n)).toBe(76n));
  it('vente matière : 80,00 € × 130 % = 104,00 €', () => expect(prixVenteMatiere(8000n, 13_000)).toBe(10_400n));
  it('vente matière : 33,33 € × 130 % = 43,329 -> 43,33 €', () => expect(prixVenteMatiere(3333n, 13_000)).toBe(4333n));
  it('consommable 0,15 €/m² × 31,9268 m² = 4,78902 -> 4,79 €', () => expect(coutConsommable('par_m2', 15n, 31_926_800n)).toBe(479n));
  it('consommable forfait chantier : inchangé', () => expect(coutConsommable('par_chantier', 2500n, 31_926_800n)).toBe(2500n));
  it('arrondi : 0,5 -> 1 ; 0,4999 -> 0 ; 2,5 -> 3', () => {
    expect(arrondi(1n, 2n)).toBe(1n);
    expect(arrondi(4999n, 10_000n)).toBe(0n);
    expect(arrondi(5n, 2n)).toBe(3n);
  });
});

describe('lecture des décimaux de la base', () => {
  it.each([['10.5', 1050], [12.35, 1235], [10, 1000], ['0,15', 15], [null, null]])('%s -> %s', (v, attendu) => {
    expect(centiemes(v as never)).toBe(attendu);
  });
  it.each(['abc', '1.234', '-1'])('refus : %s', (v) => expect(() => centiemes(v)).toThrow());
});

describe('cohérence des systèmes (avertissements)', () => {
  const base: EntreeSysteme = {
    cible: 'murs', support: 'ancienne_peinture', zoneHumide: false, taches: false, preparations: ['lessivage'],
    typeProduit: 'acrylique', usagesProduit: [], couches: 2, couchesRecommandees: null,
  };
  it('système correct : aucun avertissement', () => expect(avertissementsSysteme(base)).toEqual([]));
  it.each([
    [{ support: 'platre_neuf' as const }, /Plâtre neuf/],
    [{ preparations: [] }, /lessivage/],
    [{ support: 'bois_brut' as const, cible: 'element' as const, typeProduit: 'laque' as const }, /ponçage/],
    [{ support: 'metal' as const }, /antirouille/],
    [{ support: 'papier_peint' as const }, /dépose/],
    [{ taches: true }, /sous-couche bloquante/],
    [{ zoneHumide: true }, /pièces humides/],
    [{ couches: 1 }, /seule couche/],
    [{ couchesRecommandees: 3 }, /recommande 3 couches/],
    [{ usagesProduit: ['plafond'] }, /usage « mur »/],
  ])('avertit (%#)', (modif, motif) => {
    expect(avertissementsSysteme({ ...base, ...modif }).join(' ')).toMatch(motif);
  });
  it('plâtre neuf avec impression cochée : plus d’avertissement d’impression', () => {
    expect(avertissementsSysteme({ ...base, support: 'platre_neuf', preparations: ['impression'] })).toEqual([]);
  });
});
