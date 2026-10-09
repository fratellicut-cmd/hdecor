import { createHmac } from 'node:crypto';

/** Code TOTP (RFC 6238, SHA-1, 6 chiffres, pas de 30 s) à partir d'un secret base32. */
export function codeTotp(secretBase32: string, instant = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = secretBase32.replace(/=+$/, '').toUpperCase().split('')
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const octets = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(Math.floor(instant / 1000 / 30)));
  const h = createHmac('sha1', octets).update(compteur).digest();
  const decalage = h[h.length - 1] & 0x0f;
  const n = (h.readUInt32BE(decalage) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, '0');
}
