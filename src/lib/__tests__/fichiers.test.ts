import { describe, expect, it } from 'vitest';
import { fichierConforme, typeReel } from '../fichiers';

const octets = (...p: (number[] | string)[]) =>
  new Uint8Array(p.flatMap((x) => (typeof x === 'string' ? Array.from(x, (c) => c.charCodeAt(0)) : x)));

const PNG = octets([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = octets([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = octets('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 ');
const PDF = octets('%PDF-1.7\n');
const HEIC = octets([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0]);
const SVG = octets('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('signature binaire des fichiers', () => {
  it.each([[PNG, 'image/png'], [JPEG, 'image/jpeg'], [WEBP, 'image/webp'], [PDF, 'application/pdf'], [HEIC, 'image/heic']])(
    'reconnaît %#', (o, type) => expect(typeReel(o)).toBe(type));
  it('ne reconnaît ni SVG, ni HTML, ni fichier vide ou tronqué', () => {
    expect(typeReel(SVG)).toBeNull();
    expect(typeReel(octets('<html>'))).toBeNull();
    expect(typeReel(new Uint8Array())).toBeNull();
    expect(typeReel(octets([0x89, 0x50, 0x4e]))).toBeNull();
    expect(typeReel(octets('RIFF', [0, 0, 0, 0], 'WAVE'))).toBeNull();
  });
  it('refuse un type annoncé qui ne correspond pas au contenu', () => {
    expect(fichierConforme(SVG, 'image/png', ['image/png'])).toBe(false);
    expect(fichierConforme(PDF, 'image/png', ['image/png', 'application/pdf'])).toBe(false);
  });
  it('refuse un type réel non autorisé pour l’espace visé', () => {
    expect(fichierConforme(PDF, 'application/pdf', ['image/png', 'image/jpeg'])).toBe(false);
  });
  it('accepte un logo PNG ou JPEG conforme', () => {
    expect(fichierConforme(PNG, 'image/png', ['image/png', 'image/jpeg'])).toBe(true);
    expect(fichierConforme(JPEG, 'image/jpeg', ['image/png', 'image/jpeg'])).toBe(true);
  });
});
