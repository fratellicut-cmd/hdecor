import 'server-only';
import { headers } from 'next/headers';
import { z } from 'zod';

const ip = z.union([z.ipv4(), z.ipv6()]);

/**
 * IP et navigateur de la requête, pour la preuve de signature. Derrière
 * l'hébergeur (Vercel), l'IP du client est la première de x-forwarded-for.
 * Une valeur non conforme est écartée (null), jamais inventée.
 */
export async function ipEtNavigateur(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const brute = (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim();
  const lue = ip.safeParse(brute);
  const ua = h.get('user-agent');
  return { ip: lue.success ? lue.data : null, userAgent: ua ? ua.slice(0, 500) : null };
}
