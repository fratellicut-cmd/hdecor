import 'server-only';
import { clientAdmin } from '@/lib/supabase/admin';

/**
 * Vide la file des fichiers à supprimer du stockage (remplie en base, dans la
 * même transaction que l'anonymisation). Chaque ligne indique son espace :
 * on ne supprime jamais « au hasard » dans un autre espace.
 *
 * Une ligne n'est retirée de la file qu'après une suppression réussie ; en
 * cas d'échec elle reste (tentatives + 1, dernière erreur) et la tâche
 * planifiée la reprend. Les lignes les moins tentées passent d'abord ; au-delà
 * de TENTATIVES_MAX, la ligne n'est plus retentée et une alerte est journalisée
 * (intervention manuelle : voir docs/MISE_EN_PRODUCTION.md).
 */
export const TENTATIVES_MAX = 10;

export type BilanSuppression = { supprimes: number; enEchec: number; abandonnes: number };

type LigneFile = { id: number; espace: string; chemin: string; tentatives: number };
type Resultat<T> = { data: T | null; error: { message: string } | null };

/** Sous-ensemble du client Supabase utilisé (permet un test sans réseau). */
export type ClientFile = {
  lire(limite: number, organisationId?: string): PromiseLike<Resultat<LigneFile[]>>;
  supprimerFichier(espace: string, chemin: string): PromiseLike<{ error: { message: string } | null }>;
  retirer(id: number): PromiseLike<{ error: { message: string } | null }>;
  noterEchec(id: number, tentatives: number, erreur: string): PromiseLike<{ error: { message: string } | null }>;
  compterAbandonnes(organisationId?: string): PromiseLike<{ count: number | null; error: { message: string } | null }>;
};

function clientFileSupabase(): ClientFile {
  const admin = clientAdmin();
  const file = () => admin.from('fichiers_a_supprimer');
  return {
    lire: (limite, organisationId) => {
      let q = file().select('id, espace, chemin, tentatives').lt('tentatives', TENTATIVES_MAX)
        .order('tentatives').order('id').limit(limite);
      if (organisationId) q = q.eq('organisation_id', organisationId);
      return q;
    },
    supprimerFichier: (espace, chemin) => admin.storage.from(espace).remove([chemin]),
    retirer: (id) => file().delete().eq('id', id),
    noterEchec: (id, tentatives, erreur) => file().update({ tentatives, derniere_erreur: erreur }).eq('id', id),
    compterAbandonnes: (organisationId) => {
      let q = file().select('id', { count: 'exact', head: true }).gte('tentatives', TENTATIVES_MAX);
      if (organisationId) q = q.eq('organisation_id', organisationId);
      return q;
    },
  };
}

export async function viderFileSuppression(
  options: { organisationId?: string; limite?: number } = {},
  client: ClientFile = clientFileSupabase(),
): Promise<BilanSuppression> {
  const { data: file, error } = await client.lire(options.limite ?? 200, options.organisationId);
  if (error) throw new Error(`Lecture de la file des fichiers impossible : ${error.message}`);

  const bilan: BilanSuppression = { supprimes: 0, enEchec: 0, abandonnes: 0 };
  for (const ligne of file ?? []) {
    const { error: e } = await client.supprimerFichier(ligne.espace, ligne.chemin);
    if (e) {
      bilan.enEchec += 1;
      const { error: e2 } = await client.noterEchec(ligne.id, ligne.tentatives + 1, e.message.slice(0, 500));
      if (e2) throw new Error(`Mise à jour de la file impossible : ${e2.message}`);
      continue;
    }
    const { error: e3 } = await client.retirer(ligne.id);
    // Fichier supprimé mais ligne restée : la reprise retentera une
    // suppression sans effet (chemin absent), sans risque.
    if (e3) throw new Error(`Retrait de la file impossible : ${e3.message}`);
    bilan.supprimes += 1;
  }

  const { count, error: e4 } = await client.compterAbandonnes(options.organisationId);
  if (e4) throw new Error(`Comptage de la file impossible : ${e4.message}`);
  bilan.abandonnes = count ?? 0;
  if (bilan.abandonnes > 0) {
    console.error(`Stockage : ${bilan.abandonnes} fichier(s) non supprimé(s) après ${TENTATIVES_MAX} tentatives : intervention requise.`);
  }
  return bilan;
}
