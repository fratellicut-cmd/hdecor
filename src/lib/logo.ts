import 'server-only';
import { lire } from '@/lib/stockage';
import type { Logo } from '@/lib/pdf/commun';

/** Logo de l'organisation pour les documents ; null s'il n'est pas déposé ou introuvable. */
export async function chargerLogo(organisationId: string, chemin: string | null): Promise<Logo | null> {
  if (!chemin) return null;
  const octets = await lire('marque', organisationId, chemin).catch(() => null);
  return octets ? { octets, type: chemin.endsWith('.png') ? 'png' : 'jpg' } : null;
}
