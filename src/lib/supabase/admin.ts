import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { envPublique } from '@/lib/env';
import type { Database } from './types';

/**
 * Client « service » : CONTOURNE LA RLS. Réservé à quelques usages listés
 * (suppression de fichiers après anonymisation, cron de conservation, liens
 * publics en Phase 4). Une règle ESLint interdit de l'importer ailleurs
 * (voir eslint.config.mjs). Ne jamais l'utiliser pour lire des données à la
 * place de l'utilisateur.
 */
export function clientAdmin() {
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cle) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante (variable d’environnement serveur).');
  return createClient<Database>(envPublique.NEXT_PUBLIC_SUPABASE_URL, cle, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
