import { describe, expect, it } from 'vitest';
import {
  formaterDate, formaterDateHeure, formaterEuros, formaterTaux,
  lireMontantEnCentimes, lirePourcentageEnPointsDeBase,
} from '../formats';

// Attendus écrits à la main (espace fine insécable U+202F avant €, % et
// entre les milliers).
const f = ' ';

describe('formaterEuros', () => {
  it.each([
    [0, `0,00${f}€`],
    [5, `0,05${f}€`],
    [100, `1,00${f}€`],
    [123456, `1${f}234,56${f}€`],
    [110000, `1${f}100,00${f}€`],
    [385000, `3${f}850,00${f}€`],
    [-30000, `−300,00${f}€`],
    [123456789012, `1${f}234${f}567${f}890,12${f}€`],
  ])('%i centimes -> %s', (c, attendu) => {
    expect(formaterEuros(c)).toBe(attendu);
  });
  it('refuse un montant non entier (aucun flottant)', () => {
    expect(() => formaterEuros(12.5)).toThrow();
  });
});

describe('formaterTaux', () => {
  it.each([[2000, `20${f}%`], [1000, `10${f}%`], [550, `5,5${f}%`], [0, `0${f}%`], [1234, `12,34${f}%`]])(
    '%i pb -> %s', (pb, attendu) => expect(formaterTaux(pb)).toBe(attendu));
});

describe('formaterDate', () => {
  it('date ISO -> JJ/MM/AAAA, sans décalage de fuseau', () => {
    expect(formaterDate('2026-01-05')).toBe('05/01/2026');
  });
  it('instant UTC tard le soir -> jour suivant à Paris', () => {
    expect(formaterDate('2026-12-31T23:30:00Z')).toBe('01/01/2027');
  });
  it('heure de Paris (heure d’été)', () => {
    expect(formaterDateHeure('2026-07-14T08:05:00Z')).toBe('14/07/2026 à 10:05');
  });
  it('refuse une date invalide', () => {
    expect(() => formaterDate('pas une date')).toThrow();
  });
});

describe('lireMontantEnCentimes', () => {
  it.each([
    ['1234,56', 123456], ['1 234,56', 123456], [`1${f}234,56 €`, 123456], ['12', 1200],
    ['12,5', 1250], ['12.5', 1250], ['0,05', 5], ['33,33', 3333], ['-300', -30000], ['0', 0],
  ])('« %s » -> %i', (s, attendu) => expect(lireMontantEnCentimes(s)).toBe(attendu));
  it.each(['', 'abc', '12,345', '1,2,3', '12,', ',5', '1e3', '12 €€', '--1'])('« %s » refusé', (s) =>
    expect(lireMontantEnCentimes(s)).toBeNull());
  it('pas d’erreur d’arrondi flottant (0,1 + 0,2)', () => {
    expect(lireMontantEnCentimes('0,1')! + lireMontantEnCentimes('0,2')!).toBe(30);
  });
  it.each(['1 0,5', '12 34', '1 2345', '1234 567'])('« %s » : espace hors séparateur de milliers -> refusé (faute de frappe)', (x) =>
    expect(lireMontantEnCentimes(x)).toBeNull());
  it.each([['1 234 567,89', 123456789], ['12 345', 1234500], ['40 €', 4000]])('« %s » -> %i', (x, attendu) => expect(lireMontantEnCentimes(x)).toBe(attendu));
});

describe('lirePourcentageEnPointsDeBase', () => {
  it.each([['20', 2000], ['5,5', 550], ['5.5 %', 550], ['10,25', 1025], ['0', 0]])(
    '« %s » -> %i', (s, attendu) => expect(lirePourcentageEnPointsDeBase(s)).toBe(attendu));
  it.each(['', '-5', '5,555', 'dix'])('« %s » refusé', (s) =>
    expect(lirePourcentageEnPointsDeBase(s)).toBeNull());
});

import { aujourdHuiParis } from '../dates';
describe('aujourdHuiParis', () => {
  it('23 h 30 UTC le 31/12 = 1er janvier à Paris', () => expect(aujourdHuiParis(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01'));
  it('21 h 59 UTC en été = même jour à Paris (23 h 59)', () => expect(aujourdHuiParis(new Date('2026-07-14T21:59:00Z'))).toBe('2026-07-14'));
});

import { montantVersSaisie, pourcentageVersSaisie } from '../formats';
describe('valeurs vers saisie (aller-retour)', () => {
  it.each([[4000, '40,00'], [123456, '1 234,56'], [5, '0,05']])('%i -> « %s » -> %i', (c, s) => {
    expect(montantVersSaisie(c)).toBe(s);
    expect(lireMontantEnCentimes(montantVersSaisie(c))).toBe(c);
  });
  it.each([[1250, '12,5'], [10000, '100'], [550, '5,5']])('%i pb -> « %s »', (pb, s) => {
    expect(pourcentageVersSaisie(pb)).toBe(s);
    expect(lirePourcentageEnPointsDeBase(s)).toBe(pb);
  });
  it('null -> vide', () => { expect(montantVersSaisie(null)).toBe(''); expect(pourcentageVersSaisie(null)).toBe(''); });
});
