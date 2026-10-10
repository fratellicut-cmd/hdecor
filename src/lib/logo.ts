import 'server-only';
import { clientAdmin } from '@/lib/supabase/admin';
import { lire } from '@/lib/stockage';
import type { Logo } from '@/lib/pdf/commun';

export const LOGO_ILLISIBLE = 'Logo momentanément illisible : réessayez dans un instant (ou retirez le logo dans les Réglages).';

/**
 * Logo de l'organisation pour les documents ; null s'il n'est pas déposé.
 * Logo déposé mais illisible (incident de stockage) : null avec `illisible`,
 * pour que l'émission refuse au lieu de figer un document sans son logo.
 */
export async function chargerLogo(organisationId: string, chemin: string | null): Promise<{ logo: Logo | null; illisible: boolean }> {
  if (!chemin) return { logo: null, illisible: false };
  try {
    const octets = await lire('marque', organisationId, chemin);
    if (octets) return { logo: { octets, type: chemin.endsWith('.png') ? 'png' : 'jpg' }, illisible: false };
    console.error('Logo introuvable dans le stockage', organisationId);
  } catch (e) {
    console.error('Logo illisible', e instanceof Error ? e.message : e);
  }
  return { logo: null, illisible: true };
}

/** Logo pour un document à émettre : une erreur (« réessayez ») s'il est déposé mais illisible. */
export async function logoOuErreur(organisationId: string, chemin: string | null, erreur: (message: string) => Error): Promise<Logo | null> {
  const { logo, illisible } = await chargerLogo(organisationId, chemin);
  if (illisible) throw erreur(LOGO_ILLISIBLE);
  return logo;
}

/**
 * Chemin du logo de l'organisation : écrit par le SERVEUR seulement, après les
 * contrôles du dépôt (la base refuse cette colonne aux sessions).
 */
export async function enregistrerCheminLogo(organisationId: string, chemin: string | null): Promise<boolean> {
  const { error } = await clientAdmin().from('parametres_entreprise').update({ logo_chemin: chemin }).eq('organisation_id', organisationId);
  return !error;
}
