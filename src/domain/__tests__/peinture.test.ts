import { describe, expect, it } from 'vitest';
import { additionner, calculerQuantite, ErreurCalcul, formaterContenance, formaterQuantite, quantiteDepuisFraction } from '../peinture';

const base = { rendementCentiemes: 1000, coefSupportBp: 10_000, couches: 2, margePerteBp: 1000 };

describe('litres (R2) : cas de référence', () => {
  // 31,9268 ÷ 10 × 2 = 6,38536 L ; × 1,10 = 7,023896 L -> 7,0239 L ; à couvrir 7 024 ml.
  const q = calculerQuantite({ ...base, surfaceMm2: 31_926_800n });
  it('7,0239 L (4 décimales, demi supérieur)', () => {
    expect(q.dixMilliemes).toBe(70_239n);
    expect(formaterQuantite(q.dixMilliemes, 4)).toBe('7,0239');
    expect(formaterQuantite(q.dixMilliemes)).toBe('7,02');
  });
  it('7 024 ml à couvrir (arrondi au ml SUPÉRIEUR)', () => expect(q.aCouvrirMl).toBe(7_024n));
});

describe('litres : autres cas calculés à la main', () => {
  it('plafond 12 m², 12 m²/L, support 0,80, 2 couches, 5 % : 12 ÷ 9,6 × 2 × 1,05 = 2,625 L', () => {
    const q = calculerQuantite({ surfaceMm2: 12_000_000n, rendementCentiemes: 1200, coefSupportBp: 8000, couches: 2, margePerteBp: 500 });
    expect(q.dixMilliemes).toBe(26_250n);
    expect(q.aCouvrirMl).toBe(2_625n);
  });
  it('10 m² à 12 m²/L, 1 couche, sans perte : 0,83333… -> 0,8333 L et 834 ml', () => {
    const q = calculerQuantite({ surfaceMm2: 10_000_000n, rendementCentiemes: 1200, coefSupportBp: 10_000, couches: 1, margePerteBp: 0 });
    expect(q.dixMilliemes).toBe(8_333n);
    expect(q.aCouvrirMl).toBe(834n);
  });
  it('demi exact arrondi au supérieur : 500 mm² à 10 m²/L = 0,00005 L -> 0,0001', () => {
    const q = calculerQuantite({ surfaceMm2: 500n, rendementCentiemes: 1000, coefSupportBp: 10_000, couches: 1, margePerteBp: 0 });
    expect(q.dixMilliemes).toBe(1n);
    expect(q.aCouvrirMl).toBe(1n);
  });
  it('enduit 1 kg/m² par mm, 2 mm (2 passes), 8 m² : 16 kg', () => {
    const q = calculerQuantite({ surfaceMm2: 8_000_000n, rendementCentiemes: 100, coefSupportBp: 10_000, couches: 2, margePerteBp: 0 });
    expect(q.dixMilliemes).toBe(160_000n);
  });
  it('surface nulle : 0 L, rien à couvrir', () => {
    const q = calculerQuantite({ ...base, surfaceMm2: 0n });
    expect(q.dixMilliemes).toBe(0n);
    expect(q.aCouvrirMl).toBe(0n);
  });
  it.each([
    [{ rendementCentiemes: 0 }, 'Rendement'],
    [{ couches: 0 }, 'couches'],
    [{ coefSupportBp: 0 }, 'Coefficient'],
    [{ margePerteBp: -1 }, 'perte'],
    [{ rendementCentiemes: 10.5 }, 'Rendement'],
  ])('rendement nul, aucune couche, valeurs invalides : refus (%#)', (modif, message) => {
    expect(() => calculerQuantite({ ...base, surfaceMm2: 1_000_000n, ...modif })).toThrow(ErreurCalcul);
    expect(() => calculerQuantite({ ...base, surfaceMm2: 1_000_000n, ...modif })).toThrow(message);
  });
  it('surface négative refusée', () => {
    expect(() => calculerQuantite({ ...base, surfaceMm2: -1n })).toThrow(ErreurCalcul);
  });
});

describe('cumul exact (liste d’achat)', () => {
  it('7,023896 L + 2,625 L = 9,648896 L -> 9,6489 L, 9 649 ml', () => {
    const a = calculerQuantite({ ...base, surfaceMm2: 31_926_800n }).exacte;
    const b = calculerQuantite({ surfaceMm2: 12_000_000n, rendementCentiemes: 1200, coefSupportBp: 8000, couches: 2, margePerteBp: 500 }).exacte;
    const q = quantiteDepuisFraction(additionner(a, b));
    expect(q.dixMilliemes).toBe(96_489n);
    expect(q.aCouvrirMl).toBe(9_649n);
  });
  it('trois tiers font exactement un (pas d’erreur d’arrondi cumulée)', () => {
    const tiers = { num: 1n, den: 3n };
    const q = quantiteDepuisFraction(additionner(additionner(tiers, tiers), tiers));
    expect(q.dixMilliemes).toBe(10_000n);
    expect(q.aCouvrirMl).toBe(1_000n);
  });
});

describe('affichage des contenances', () => {
  it.each([[1000, '1 L'], [2500, '2,5 L'], [750, '0,75 L'], [15000, '15 L']])('%s ml', (ml, t) => {
    expect(formaterContenance(ml)).toBe(t);
  });
  it('kg', () => expect(formaterContenance(25000, 'kg')).toBe('25 kg'));
});
