import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { finDeJourParis } from '@/domain/dates';
import { lirePngSignature, MESSAGES_TRACE, schemaSignature } from '../validation/devis';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ envPublique: { NEXT_PUBLIC_SITE_URL: 'https://exemple.test/' } }));
vi.mock('@/lib/supabase/admin', () => ({ clientAdmin: () => { throw new Error('non utilisé'); } }));
const { expirationLien, jetonBienForme, nouveauJeton, urlPublique } = await import('../liens');
const { messageSignature } = await import('../devis-public');

// --------------------------------------------------------------------------
// PNG de test (RGBA 8 bits, fond transparent) avec les 5 filtres de ligne
// --------------------------------------------------------------------------

const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const bloc = (type: string, data: Buffer) => {
  const t = Buffer.concat([Buffer.from(type), data]);
  const n = Buffer.alloc(4); n.writeUInt32BE(data.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(t));
  return Buffer.concat([n, t, c]);
};
const paeth = (a: number, b: number, c: number) => { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

/** Image largeur × hauteur ; `encre(x, y)` : pixel noir opaque. Filtre de ligne = y mod 5 (teste le décodeur). */
function png(largeur: number, hauteur: number, encre: (x: number, y: number) => boolean): string {
  const ligne = largeur * 4;
  const brut = Buffer.alloc((ligne + 1) * hauteur);
  let prec = Buffer.alloc(ligne);
  for (let y = 0; y < hauteur; y++) {
    const cour = Buffer.alloc(ligne);
    for (let x = 0; x < largeur; x++) if (encre(x, y)) cour.writeUInt32BE(0x1f1f1fff, x * 4);
    const f = y % 5;
    brut[y * (ligne + 1)] = f;
    for (let i = 0; i < ligne; i++) {
      const a = i >= 4 ? cour[i - 4]! : 0, b = prec[i]!, c = i >= 4 ? prec[i - 4]! : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      brut[y * (ligne + 1) + 1 + i] = (cour[i]! - pred) & 0xff;
    }
    prec = cour;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4); ihdr[8] = 8; ihdr[9] = 6;
  const fichier = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', ihdr), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${fichier.toString('base64')}`;
}

describe('tracé de signature (contrôle serveur)', () => {
  it('cadre vide (tout transparent) : refusé « vide »', () => {
    expect(lirePngSignature(png(600, 200, () => false))).toEqual({ erreur: 'vide' });
  });
  it('simple tapotement (petit point) : refusé « vide »', () => {
    expect(lirePngSignature(png(600, 200, (x, y) => Math.hypot(x - 300, y - 100) < 4))).toEqual({ erreur: 'vide' });
  });
  it('vraie signature (trait de 400 px, épaisseur 5) : acceptée', () => {
    const r = lirePngSignature(png(600, 200, (x, y) => x >= 100 && x < 500 && Math.abs(y - (100 + Math.round(30 * Math.sin(x / 30)))) < 3));
    expect('octets' in r).toBe(true);
  });
  it('PNG altéré ou faux : refusé « illisible »', () => {
    const ok = png(600, 200, (x, y) => x > 50 && x < 550 && y > 90 && y < 96);
    const octets = Buffer.from(ok.split(',')[1]!, 'base64');
    octets[octets.length - 20] ^= 0xff;   // données compressées corrompues
    expect(lirePngSignature(`data:image/png;base64,${octets.toString('base64')}`)).toEqual({ erreur: 'illisible' });
    expect(lirePngSignature('data:image/png;base64,AAAA')).toEqual({ erreur: 'illisible' });
    expect(lirePngSignature(png(30, 10, () => true))).toEqual({ erreur: 'illisible' });   // trop petit
  });
  it('messages en français', () => expect(MESSAGES_TRACE.vide).toMatch(/signez dans le cadre/));
});

describe('formulaire de signature', () => {
  const base = { nom: 'Alice Martin', image: 'data:image/png;base64,AAAA', document_sha256: 'a'.repeat(64), lu: 'on', options: [] };
  it.each(['Bon pour accord', 'bon pour accord', '  Bon  pour   accord ', 'Bon pour accord.', 'Bon pour accord !'])('mention acceptée : « %s »', (m) => {
    expect(schemaSignature.safeParse({ ...base, mention: m }).success).toBe(true);
  });
  it.each(['Bon', 'Lu et approuvé', 'Bon pour accord, sauf options', ''])('mention refusée : « %s »', (m) => {
    expect(schemaSignature.safeParse({ ...base, mention: m }).success).toBe(false);
  });
  it('case « lu » obligatoire, empreinte au bon format', () => {
    expect(schemaSignature.safeParse({ ...base, mention: 'Bon pour accord', lu: undefined }).success).toBe(false);
    expect(schemaSignature.safeParse({ ...base, mention: 'Bon pour accord', document_sha256: 'xyz' }).success).toBe(false);
  });
});

describe('liens publics', () => {
  it('jeton : 32 octets aléatoires en base64url (43 caractères), empreinte SHA-256', () => {
    const { jeton, sha256 } = nouveauJeton();
    expect(jetonBienForme(jeton)).toBe(true);
    expect(sha256).toBe(createHash('sha256').update(jeton).digest('hex'));
    expect(nouveauJeton().jeton).not.toBe(jeton);
    expect(jetonBienForme('a'.repeat(42))).toBe(false);
    expect(jetonBienForme(`${'a'.repeat(42)}/`)).toBe(false);
  });
  it('adresse publique sans double barre', () => expect(urlPublique('abc')).toBe('https://exemple.test/d/abc'));
  it('expiration : fin du dernier jour de validité à Paris', () => {
    const maintenant = new Date('2026-10-09T10:00:00Z');
    expect(expirationLien('2026-11-08', maintenant)!.toISOString()).toBe('2026-11-08T22:59:59.000Z');   // heure d'hiver : UTC+1
    expect(finDeJourParis('2026-07-01').toISOString()).toBe('2026-07-01T21:59:59.000Z');               // heure d'été : UTC+2
  });
  it('expiration : 89 jours au plus (la base refuse au-delà de 90)', () => {
    const maintenant = new Date('2026-10-09T10:00:00Z');
    expect(expirationLien('2027-06-30', maintenant)!.getTime()).toBe(maintenant.getTime() + 89 * 24 * 3600 * 1000);
  });
  it('devis déjà expiré : pas de lien', () => {
    expect(expirationLien('2026-10-08', new Date('2026-10-09T10:00:00Z'))).toBeNull();
  });
});

describe('messages de refus de signature', () => {
  it.each([
    ['Ce devis a expiré.', /expiré/], ['Le document signé ne correspond pas au devis émis.', /rechargez-la/],
    ['Option inconnue.', /Option inconnue/], ['Ce devis ne peut plus être signé.', /déjà signé/], ['autre', /refusée/],
  ])('%s', (m, attendu) => expect(messageSignature(m)).toMatch(attendu));
});
