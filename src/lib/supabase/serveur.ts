import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { envPublique } from '@/lib/env';
import type { Database } from './types';

/**
 * Client Supabase côté serveur, AVEC LA SESSION DE L'UTILISATEUR : toutes les
 * requêtes passent par la RLS. C'est le client par défaut de l'application.
 */
export async function clientServeur() {
  const magasin = await cookies();
  return createServerClient<Database>(
    envPublique.NEXT_PUBLIC_SUPABASE_URL,
    envPublique.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => magasin.getAll(),
        setAll: (aPoser) => {
          try {
            for (const { name, value, options } of aPoser) magasin.set(name, value, options);
          } catch {
            // Appel depuis un Server Component : les cookies ne sont pas
            // modifiables ici. Le proxy rafraîchit la session à chaque
            // requête, ce cas est donc sans conséquence.
          }
        },
      },
    },
  );
}
