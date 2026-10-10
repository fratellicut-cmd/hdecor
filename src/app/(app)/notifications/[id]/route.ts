import { redirect } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';

/** Ouvrir une notification : marquée lue, puis redirection vers sa page (lien interne, contrôlé en base). */
export async function GET(_: Request, ctx: RouteContext<'/notifications/[id]'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) redirect('/notifications');
  const sb = await clientServeur();
  const { data } = await sb.from('notifications').select('lien').eq('id', id.data).maybeSingle();
  if (!data) redirect('/notifications');
  await sb.from('notifications').update({ lu_le: new Date().toISOString() }).eq('id', id.data).is('lu_le', null);
  // Lien interne uniquement (contrainte en base : « /chemin »), jamais une adresse externe.
  redirect(/^\/[a-z0-9/_-]*$/.test(data.lien) && !data.lien.startsWith('//') ? data.lien : '/notifications');
}
