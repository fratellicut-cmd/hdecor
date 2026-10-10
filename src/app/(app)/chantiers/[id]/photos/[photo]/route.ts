import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { lire } from '@/lib/stockage';

const introuvable = () => new Response('Photo introuvable.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/** Photo d'un chantier : lue sous RLS (organisation de la session), puis servie par le serveur. */
export async function GET(_: Request, ctx: RouteContext<'/chantiers/[id]/photos/[photo]'>) {
  const session = await verifierSession();
  const p = await ctx.params;
  const chantier = z.uuid().safeParse(p.id);
  const photo = z.uuid().safeParse(p.photo);
  if (!chantier.success || !photo.success) return introuvable();
  const sb = await clientServeur();
  const { data } = await sb.from('photos').select('chemin').eq('id', photo.data).eq('chantier_id', chantier.data).maybeSingle();
  if (!data || !data.chemin.endsWith('.jpg')) return introuvable();
  const octets = await lire('photos', session.organisationId, data.chemin);
  if (!octets) return introuvable();
  return new Response(Buffer.from(octets), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
}
