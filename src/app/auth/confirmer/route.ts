import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { clientServeur } from '@/lib/supabase/serveur';
import { cheminInterneSur } from '@/lib/redirection';

const TYPES: EmailOtpType[] = ['magiclink', 'recovery', 'email', 'invite', 'email_change'];

/**
 * Arrivée depuis un lien reçu par email (connexion, mot de passe oublié,
 * invitation). Le modèle d'email Supabase doit pointer ici :
 *   {{ .SiteURL }}/auth/confirmer?token_hash={{ .TokenHash }}&type=<type>&suite=…
 */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const tokenHash = p.get('token_hash');
  const type = p.get('type') as EmailOtpType | null;
  const suite = cheminInterneSur(p.get('suite'));
  const echec = new URL('/connexion?erreur=lien', request.url);

  if (!tokenHash || !type || !TYPES.includes(type) || tokenHash.length > 200) {
    return NextResponse.redirect(echec);
  }
  const supabase = await clientServeur();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return NextResponse.redirect(echec);
  const destination = type === 'recovery' ? '/compte/nouveau-mot-de-passe' : suite;
  return NextResponse.redirect(new URL(destination, request.url));
}
