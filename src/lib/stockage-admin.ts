import 'server-only';
import { clientAdmin } from '@/lib/supabase/admin';

/**
 * Vide la file des fichiers à supprimer du stockage (remplie par
 * effacer_client dans la même transaction que l'anonymisation).
 *
 * Le chemin ne dit pas dans quel espace le fichier a été déposé : on le
 * retire de chaque espace qui peut contenir un document nominatif. Supprimer
 * un chemin absent n'est pas une erreur. Les chemins commencent toujours par
 * l'identifiant de l'organisation (contrainte en base) : aucun risque de
 * toucher les fichiers d'une autre organisation.
 *
 * Une ligne n'est retirée de la file qu'après une suppression réussie ; en
 * cas d'échec, elle reste (tentatives + 1) et la tâche planifiée la reprend.
 */
const ESPACES = ['documents', 'photos', 'justificatifs'] as const;

export type BilanSuppression = { supprimes: number; enEchec: number };

export async function viderFileSuppression(options: { organisationId?: string; limite?: number } = {}): Promise<BilanSuppression> {
  const admin = clientAdmin();
  let requete = admin.from('fichiers_a_supprimer').select('id, chemin, tentatives').order('id').limit(options.limite ?? 200);
  if (options.organisationId) requete = requete.eq('organisation_id', options.organisationId);
  const { data: file, error } = await requete;
  if (error) throw new Error(`Lecture de la file des fichiers impossible : ${error.message}`);

  const bilan: BilanSuppression = { supprimes: 0, enEchec: 0 };
  for (const ligne of file ?? []) {
    let erreur: string | null = null;
    for (const espace of ESPACES) {
      const { error: e } = await admin.storage.from(espace).remove([ligne.chemin]);
      if (e) { erreur = `${espace} : ${e.message}`.slice(0, 500); break; }
    }
    if (erreur) {
      bilan.enEchec += 1;
      await admin.from('fichiers_a_supprimer')
        .update({ tentatives: ligne.tentatives + 1, derniere_erreur: erreur }).eq('id', ligne.id);
    } else {
      bilan.supprimes += 1;
      await admin.from('fichiers_a_supprimer').delete().eq('id', ligne.id);
    }
  }
  return bilan;
}
