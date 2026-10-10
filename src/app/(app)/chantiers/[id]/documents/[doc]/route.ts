import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { lire } from '@/lib/stockage';
import { nomFichierSur } from '@/domain/galerie';

const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const introuvable = () => new Response('Document introuvable.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/** Document d'un chantier (fiche technique, plan…) : lu sous RLS, servi par le serveur. */
export async function GET(_: Request, ctx: RouteContext<'/chantiers/[id]/documents/[doc]'>) {
  const session = await verifierSession();
  const p = await ctx.params;
  const chantier = z.uuid().safeParse(p.id);
  const doc = z.uuid().safeParse(p.doc);
  if (!chantier.success || !doc.success) return introuvable();
  const sb = await clientServeur();
  const { data } = await sb.from('documents_chantier').select('chemin, nom').eq('id', doc.data).eq('chantier_id', chantier.data).maybeSingle();
  const ext = data?.chemin.split('.').pop() ?? '';
  if (!data || !TYPES[ext]) return introuvable();
  const octets = await lire('justificatifs', session.organisationId, data.chemin);
  if (!octets) return introuvable();
  return new Response(Buffer.from(octets), {
    headers: {
      'Content-Type': TYPES[ext]!, 'Content-Disposition': `inline; filename="${nomFichierSur(data.nom)}.${ext}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    },
  });
}
