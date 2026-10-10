import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { lire } from '@/lib/stockage';

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
const introuvable = () => new Response('Justificatif introuvable.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/**
 * Justificatif d'un achat, lu par le serveur : l'achat est d'abord lu sous RLS
 * (il appartient à l'organisation de la session), puis le fichier à son chemin.
 */
export async function GET(_: Request, ctx: RouteContext<'/comptabilite/justificatif/[id]'>) {
  const session = await verifierSession();
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return introuvable();
  const sb = await clientServeur();
  const { data } = await sb.from('depenses').select('justificatif_chemin').eq('id', id.data).maybeSingle();
  const chemin = data?.justificatif_chemin;
  if (!chemin) return introuvable();
  const octets = await lire('justificatifs', session.organisationId, chemin);
  const type = TYPES[chemin.split('.').pop() ?? ''];
  if (!octets || !type) return introuvable();
  return new Response(Buffer.from(octets), {
    headers: {
      'Content-Type': type, 'Content-Disposition': `inline; filename="justificatif.${chemin.split('.').pop()}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    },
  });
}
