import 'server-only';
import { headers } from 'next/headers';
import { z } from 'zod';

const ip = z.union([z.ipv4(), z.ipv6()]);

/**
 * IP et navigateur de la requête, pour la preuve de signature. HÉBERGEMENT
 * VERCEL REQUIS (docs/MISE_EN_PRODUCTION.md) : x-vercel-forwarded-for est posé
 * par Vercel et ne peut pas être choisi par le client ; x-forwarded-for n'est
 * lu qu'à défaut (développement local). Ailleurs, l'IP de preuve serait
 * falsifiable. Une valeur non conforme est écartée (null), jamais inventée.
 */
export async function ipEtNavigateur(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const brute = (h.get('x-vercel-forwarded-for') ?? h.get('x-forwarded-for') ?? '').split(',')[0]!.trim();
  const lue = ip.safeParse(brute);
  const ua = h.get('user-agent');
  return { ip: lue.success ? lue.data : null, userAgent: ua ? ua.slice(0, 500) : null };
}
