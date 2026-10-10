import 'server-only';

/**
 * Taille d'une page : au plus le plafond de lignes de l'API (supabase/config.toml,
 * max_rows = 1000). Au-delà, la réponse serait COUPÉE sans erreur : un total
 * comptable calculé sur une liste coupée serait faux sans le dire.
 */
export const TAILLE_PAGE = 1000;
const LIGNES_MAX = 200_000;

/**
 * Lit TOUTES les lignes d'une requête, page par page (.range), jusqu'à une page
 * incomplète. La requête doit être triée sur une clé unique (sinon une ligne
 * peut sauter d'une page à l'autre). Erreur explicite plutôt qu'un total faux.
 */
export async function toutLire<T>(page: (de: number, a: number) => PromiseLike<{ data: T[] | null; error: unknown }>, quoi: string): Promise<T[]> {
  const tout: T[] = [];
  for (let de = 0; ; de += TAILLE_PAGE) {
    const { data, error } = await page(de, de + TAILLE_PAGE - 1);
    if (error || !data) throw new Error(`Lecture impossible : ${quoi}.`);
    tout.push(...data);
    if (data.length < TAILLE_PAGE) return tout;
    if (tout.length >= LIGNES_MAX) throw new Error(`Trop de lignes à lire : ${quoi}.`);
  }
}
