import { createHash } from 'node:crypto';
import { z } from 'zod';
import { clientServeur } from '@/lib/supabase/serveur';
import { verifierSession } from '@/lib/dal';
import { lire } from '@/lib/stockage';

/** XML Factur-X préparé (À VÉRIFIER) d'une facture émise. */
export async function GET(_: Request, { params }: RouteContext<'/factures/[id]/facturx'>) {
  const session = await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  const introuvable = new Response('Données Factur-X introuvables.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (!id.success) return introuvable;
  const sb = await clientServeur();
  const { data: f } = await sb.from('factures').select('numero, facturx_chemin').eq('id', id.data).maybeSingle();
  if (!f?.facturx_chemin) return introuvable;
  const octets = await lire('documents', session.organisationId, f.facturx_chemin);
  if (!octets) return introuvable;
  // Empreinte inscrite dans le nom du fichier à l'enregistrement : le contenu doit y correspondre.
  const attendu = /facturx-([0-9a-f]{64})\.xml$/.exec(f.facturx_chemin)?.[1];
  if (!attendu || createHash('sha256').update(octets).digest('hex') !== attendu) {
    console.error('Empreinte du XML Factur-X différente de celle enregistrée', id.data);
    return new Response('Le fichier stocké ne correspond pas à celui préparé.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return new Response(Buffer.from(octets), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="factur-x-${f.numero}.xml"`, 'Cache-Control': 'no-store' },
  });
}
