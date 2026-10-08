import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Couleurs lues dans la charte (globals.css) : le test suit toute modification.
const css = readFileSync(path.resolve(import.meta.dirname, '../../app/globals.css'), 'utf8');
const couleur = (nom: string) => {
  const m = css.match(new RegExp(`--color-${nom}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!m) throw new Error(`Couleur --color-${nom} absente de globals.css`);
  return m[1]!;
};

/** Contraste WCAG 2.x entre deux couleurs hexadécimales. */
function contraste(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

describe('contrastes de la charte (lecture en plein soleil : AA minimum, 4,5:1)', () => {
  it('calcul de référence : noir sur blanc = 21:1', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
  it.each([
    ['encre', 'creme'], ['encre-douce', 'creme'], ['encre-douce', 'blanc'],
    ['creme', 'anthracite'], ['danger', 'danger-fond'], ['danger', 'blanc'],
    ['succes', 'succes-fond'], ['alerte', 'alerte-fond'], ['or-clair', 'anthracite'],
  ])('%s sur %s', (texte, fond) => {
    const c = (n: string) => (n === 'blanc' ? '#ffffff' : couleur(n));
    expect(contraste(c(texte), c(fond))).toBeGreaterThanOrEqual(4.5);
  });
});
