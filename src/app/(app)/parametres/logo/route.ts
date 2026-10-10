import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { lire } from '@/lib/stockage';

/** Logo de l'organisation de la session (aperçu dans les Paramètres). */
export async function GET() {
  const session = await verifierSession();
  const sb = await clientServeur();
  const { data: p } = await sb.from('parametres_entreprise').select('logo_chemin').eq('organisation_id', session.organisationId).single();
  const octets = p?.logo_chemin ? await lire('marque', session.organisationId, p.logo_chemin) : null;
  if (!octets) return new Response('Aucun logo.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(Buffer.from(octets), {
    headers: { 'Content-Type': p!.logo_chemin!.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
