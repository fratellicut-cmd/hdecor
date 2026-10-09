import { describe, expect, it } from 'vitest';
import { lireDecimal, lireLongueurMm, lireQuantiteE4, lireSurfaceMm2, longueurVersSaisie, quantiteVersSaisie, surfaceVersSaisie } from '../saisie';

describe('saisie des dimensions (exacte, au mm)', () => {
  it.each([
    ['4', 'm', 4000], ['4,25', 'm', 4250], ['4.25', 'm', 4250], ['2,503', 'm', 2503], ['3,50 ', 'm', 3500],
    ['83', 'cm', 830], ['83,5', 'cm', 835], ['204', 'cm', 2040],
    ['83 cm', 'm', 830], ['2,04 m', 'cm', 2040], ['830 mm', 'm', 830], ['1 250', 'cm', 12500],
  ] as const)('« %s » (%s) -> %s mm', (s, u, mm) => expect(lireLongueurMm(s, u)).toBe(mm));
  it.each([
    ['4,2555', 'm'], ['83,25', 'cm'], ['abc', 'm'], ['-4', 'm'], ['', 'm'], ['4,', 'm'], ['1,5 mm', 'm'],
  ] as const)('refus : « %s » (%s)', (s, u) => expect(lireLongueurMm(s, u)).toBeNull());
});

describe('surfaces et quantités', () => {
  it('1,6932 m² -> 1 693 200 mm² ; « 12 m² » -> 12 000 000', () => {
    expect(lireSurfaceMm2('1,6932')).toBe(1_693_200);
    expect(lireSurfaceMm2('12 m²')).toBe(12_000_000);
  });
  it('quantités : « 14,5 » -> 145 000 ; trop de décimales refusées', () => {
    expect(lireQuantiteE4('14,5')).toBe(145_000);
    expect(lireQuantiteE4('1,00001')).toBeNull();
  });
  it('zéros superflus tolérés : « 4,2500 » m -> 4 250 mm', () => expect(lireDecimal('4,2500', 3)).toBe(4250n));
});

describe('réaffichage', () => {
  it.each([[4250, 'm', '4,25'], [4000, 'm', '4'], [2503, 'm', '2,503'], [830, 'cm', '83'], [835, 'cm', '83,5']] as const)(
    '%s mm (%s) -> « %s »', (mm, u, t) => expect(longueurVersSaisie(mm, u)).toBe(t));
  it('surface et quantité', () => {
    expect(surfaceVersSaisie(1_693_200)).toBe('1,6932');
    expect(quantiteVersSaisie(145_000)).toBe('14,5');
  });
});
