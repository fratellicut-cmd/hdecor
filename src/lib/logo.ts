import 'server-only';
import { clientAdmin } from '@/lib/supabase/admin';
import { lire } from '@/lib/stockage';
import type { Logo } from '@/lib/pdf/commun';

/** Logo de l'organisation pour les documents ; null s'il n'est pas déposé ou introuvable. */
export async function chargerLogo(organisationId: string, chemin: string | null): Promise<Logo | null> {
  if (!chemin) return null;
  const octets = await lire('marque', organisationId, chemin).catch(() => null);
  return octets ? { octets, type: chemin.endsWith('.png') ? 'png' : 'jpg' } : null;
}

/**
 * Chemin du logo de l'organisation : écrit par le SERVEUR seulement, après les
 * contrôles du dépôt (la base refuse cette colonne aux sessions).
 */
export async function enregistrerCheminLogo(organisationId: string, chemin: string | null): Promise<boolean> {
  const { error } = await clientAdmin().from('parametres_entreprise').update({ logo_chemin: chemin }).eq('organisation_id', organisationId);
  return !error;
}
