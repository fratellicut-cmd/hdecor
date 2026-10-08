import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { clientServeur } from '@/lib/supabase/serveur';

/**
 * Couche d'accès aux données (DAL) : point de passage OBLIGATOIRE de toute
 * page protégée, Server Action et route. Vérifie la session auprès du serveur
 * d'authentification (getClaims) et l'appartenance à une organisation.
 */
export type Session = {
  utilisateurId: string;
  email: string | null;
  organisationId: string;
  niveauAuth: 'aal1' | 'aal2';
};

export const verifierSession = cache(async (): Promise<Session> => {
  const supabase = await clientServeur();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) redirect('/connexion');

  // Double authentification : si l'utilisateur l'a activée, la session
  // doit être au niveau aal2 avant d'accéder aux données.
  const { data: niveau } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (niveau && niveau.nextLevel === 'aal2' && niveau.currentLevel !== 'aal2') {
    redirect('/connexion/double-authentification');
  }

  const { data: membre } = await supabase
    .from('membres')
    .select('organisation_id')
    .eq('user_id', claims.sub)
    .limit(1)
    .maybeSingle();
  if (!membre) redirect('/connexion?erreur=sans-organisation');

  return {
    utilisateurId: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    organisationId: membre.organisation_id,
    niveauAuth: niveau?.currentLevel === 'aal2' ? 'aal2' : 'aal1',
  };
});
