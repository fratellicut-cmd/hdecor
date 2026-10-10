import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fichierConforme, jpegSansMetadonnees, typeReel } from '../fichiers';

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

describe('photo JPEG sans métadonnées', () => {
  /** Vraie photo JPEG (Pillow) portant une position GPS, un appareil et un commentaire. */
  function jpegAvecGps(): Uint8Array {
    const script = [
      'import io, sys',
      'from PIL import Image',
      'im = Image.new("RGB", (64, 48), (200, 120, 40))',
      'exif = Image.Exif()',
      'exif[0x010F] = "Fabricant secret"',
      'exif[0x8825] = {1: "N", 2: (49.0, 21.0, 30.0), 3: "E", 4: (6.0, 10.0, 5.0)}',
      'b = io.BytesIO()',
      'im.save(b, "JPEG", exif=exif.tobytes(), comment=b"Chez Mme Martin, 3 rue des Lilas")',
      'sys.stdout.buffer.write(b.getvalue())',
    ].join('\n');
    return new Uint8Array(execFileSync('python3', ['-I', '-c', script]));
  }
  const relire = (o: Uint8Array) => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), 'hdecor-jpeg-')), 'p.jpg');
    writeFileSync(f, o);
    const script = 'import json,sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]); im.load()\nprint(json.dumps([im.size, len(im.getexif()), "comment" in im.info, im.getpixel((10,10))]))';
    return JSON.parse(execFileSync('python3', ['-I', '-c', script, f], { encoding: 'utf8' }));
  };

  it('retire GPS, appareil et commentaire ; l’image reste lisible et identique ; dimensions lues', () => {
    const avant = jpegAvecGps();
    expect(relire(avant)[1]).toBeGreaterThan(0);
    expect(new TextDecoder('latin1').decode(avant)).toContain('Mme Martin');
    const r = jpegSansMetadonnees(avant)!;
    expect(r).not.toBeNull();
    expect([r.largeur, r.hauteur]).toEqual([64, 48]);
    const [taille, nbExif, commentaire, pixel] = relire(r.octets);
    expect(taille).toEqual([64, 48]);
    expect(nbExif).toBe(0);
    expect(commentaire).toBe(false);
    expect(pixel).toEqual(relire(avant)[3]);
    expect(new TextDecoder('latin1').decode(r.octets)).not.toContain('Mme Martin');
    expect(new TextDecoder('latin1').decode(r.octets)).not.toContain('Fabricant secret');
  });
  it('refuse ce qui n’est pas un JPEG lisible', () => {
    expect(jpegSansMetadonnees(PNG)).toBeNull();
    expect(jpegSansMetadonnees(octets([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBeNull();
  });
});
