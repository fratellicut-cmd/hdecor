import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Niveau d'authentification à partir des claims VÉRIFIÉS (getClaims) et des
 * facteurs du compte (listFactors interroge le serveur d'authentification).
 * N'utilise jamais getSession(), dont le contenu vient du cookie sans
 * vérification.
 */
export async function niveauAuth(supabase: SupabaseClient, aal: unknown) {
  const actuel = aal === 'aal2' ? 'aal2' : 'aal1';
  const { data } = await supabase.auth.mfa.listFactors();
  const totpVerifie = (data?.totp ?? []).some((f) => f.status === 'verified');
  return { actuel, requis: totpVerifie ? 'aal2' : 'aal1' } as const;
}
