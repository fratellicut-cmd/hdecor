import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { finDeJourParis } from '@/domain/dates';
import { envPublique } from '@/lib/env';

/** Jeton de lien public : 32 octets aléatoires (256 bits). Seule son empreinte est stockée. */
export function nouveauJeton(): { jeton: string; sha256: string } {
  const jeton = randomBytes(32).toString('base64url');
  return { jeton, sha256: createHash('sha256').update(jeton).digest('hex') };
}

/** Durée maximale d'un lien (la base refuse au-delà de 90 jours) : marge d'un jour. */
const DUREE_MAX_MS = 89 * 24 * 3600 * 1000;

/** Expiration : fin du dernier jour de validité du devis (Paris), 89 jours au plus. Null si déjà expiré. */
export function expirationLien(valideJusquAu: string, maintenant = new Date()): Date | null {
  const fin = finDeJourParis(valideJusquAu);
  if (fin.getTime() <= maintenant.getTime()) return null;
  return new Date(Math.min(fin.getTime(), maintenant.getTime() + DUREE_MAX_MS));
}

export const urlPublique = (jeton: string) => `${envPublique.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}/d/${jeton}`;

/** Forme d'un jeton reçu dans l'URL (avant tout appel à la base). */
export const jetonBienForme = (j: string) => /^[A-Za-z0-9_-]{43}$/.test(j);
