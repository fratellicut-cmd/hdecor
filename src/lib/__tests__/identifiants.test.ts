import { describe, expect, it } from 'vitest';
import { bicValide, formaterIban, ibanValide, siretValide, tvaIntraFrValide } from '../validation/identifiants';

// Attendus calculés indépendamment (script Python séparé : Luhn et mod 97).
describe('SIRET', () => {
  it.each([
    ['73282932000074', true],
    ['732 829 320 00074', true],
    ['73282932000075', false], // clé fausse
    ['12345678901234', false],
    ['7328293200007', false], // 13 chiffres
    ['7328293200007A', false],
    ['35600000000001', true], // La Poste : somme des chiffres multiple de 5
    ['35600000000002', false],
  ])('%s -> %s', (s, attendu) => expect(siretValide(s)).toBe(attendu));
});

describe('IBAN', () => {
  it.each([
    ['FR76 3000 6000 0112 3456 7890 189', true],
    ['fr7630006000011234567890189', true],
    ['FR76 3000 6000 0112 3456 7890 188', false],
    ['DE89 3704 0044 0532 0130 00', true],
    ['GB82 WEST 1234 5698 7654 32', true],
    ['FR76 3000 6000 0112 3456 7890', false], // longueur FR incorrecte
    ['pas un iban', false],
  ])('%s -> %s', (s, attendu) => expect(ibanValide(s)).toBe(attendu));
  it('affichage par groupes de 4', () => {
    expect(formaterIban('fr7630006000011234567890189')).toBe('FR76 3000 6000 0112 3456 7890 189');
  });
});

describe('BIC et TVA intracommunautaire', () => {
  it.each([['BNPAFRPP', true], ['BNPAFRPPXXX', true], ['BNPAFRP', false], ['1NPAFRPP', false]])(
    'BIC %s -> %s', (s, attendu) => expect(bicValide(s)).toBe(attendu));
  // Clé TVA = (12 + 3 × (SIREN mod 97)) mod 97 ; SIREN 732829320 -> clé 44.
  it.each([['FR44732829320', true], ['FR 44 732829320', true], ['FR45732829320', false], ['DE123456789', false]])(
    'TVA %s -> %s', (s, attendu) => expect(tvaIntraFrValide(s)).toBe(attendu));
});
