import 'server-only';
import type { clientServeur } from '@/lib/supabase/serveur';
import { motifContient } from '@/domain/listes';

type Sb = Awaited<ReturnType<typeof clientServeur>>;

/**
 * Condition « or » de l'API pour une liste : colonnes texte qui contiennent la
 * recherche, ou client dont le nom, l'email, le téléphone ou la ville
 * correspondent (même recherche que la liste des clients).
 */
export async function filtreRecherche(sb: Sb, texte: string, colonnes: string[]): Promise<string> {
  const { data } = await sb.rpc('rechercher_clients', { p_texte: texte, p_limite: 200 });
  const motif = motifContient(texte);
  const ids = (data ?? []).map((c) => c.id);
  return [...colonnes.map((c) => `${c}.ilike.${motif}`), ids.length ? `client_id.in.(${ids.join(',')})` : null].filter(Boolean).join(',');
}
