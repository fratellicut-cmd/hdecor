import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { clientServeur } from '@/lib/supabase/serveur';
import { niveauAuth } from '@/lib/niveau-auth';
import { cheminInterneSur } from '@/lib/redirection';

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
  if (error || !claims?.sub) redirect(await connexionApresExpiration());

  // Double authentification : si l'utilisateur l'a activée, la session
  // doit être au niveau aal2 avant d'accéder aux données.
  const niveau = await niveauAuth(supabase, claims.aal);
  if (niveau.requis === 'aal2' && niveau.actuel !== 'aal2') {
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
    niveauAuth: niveau.actuel,
  };
});

/**
 * Session absente ou expirée pendant une action (envoi d'un formulaire) :
 * retour à la connexion, puis à la page d'origine (même site uniquement).
 * La saisie en cours est gardée sur le téléphone (garde de saisie).
 */
async function connexionApresExpiration(): Promise<string> {
  const h = await headers();
  let suite = '/';
  try {
    const origine = new URL(h.get('referer') ?? '');
    if (origine.host === h.get('host')) suite = cheminInterneSur(origine.pathname + origine.search);
  } catch { /* pas de page d'origine exploitable */ }
  return `/connexion?expiree=1&suite=${encodeURIComponent(suite)}`;
}
