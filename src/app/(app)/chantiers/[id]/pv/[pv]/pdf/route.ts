import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { lire } from '@/lib/stockage';
import { chargerPv, donneesPdfPv } from '@/lib/pv';
import { pdfPv } from '@/lib/pdf/pv';

const texte = (t: string, status: number) => new Response(t, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/**
 * PDF du PV : exemplaire signé archivé ; sinon le PDF présenté au client (celui
 * qu'il signe) ; sinon un aperçu du brouillon (non enregistré).
 */
export async function GET(_: Request, ctx: RouteContext<'/chantiers/[id]/pv/[pv]/pdf'>) {
  const session = await verifierSession();
  const p = await ctx.params;
  const chantierId = z.uuid().safeParse(p.id);
  const pvId = z.uuid().safeParse(p.pv);
  if (!chantierId.success || !pvId.success) return texte('PV introuvable.', 404);
  const sb = await clientServeur();
  const c = await chargerPv(sb, pvId.data);
  if (!c || c.chantier.id !== chantierId.data) return texte('PV introuvable.', 404);
  let octets: Uint8Array | null = null;
  let nom = 'pv-reception-apercu.pdf';
  if (c.pv.statut === 'signe') {
    if (!c.signature?.pdf_signe_chemin) return texte('PDF signé pas encore archivé : touchez « Archiver maintenant » sur le PV.', 409);
    octets = await lire('documents', session.organisationId, c.signature.pdf_signe_chemin);
    nom = 'pv-reception-signe.pdf';
  } else if (c.pv.pdf_chemin) {
    octets = await lire('documents', session.organisationId, c.pv.pdf_chemin);
    nom = 'pv-reception.pdf';
  } else {
    const d = await donneesPdfPv(sb, c);
    if ('erreur' in d) return texte(d.erreur, 409);
    octets = await pdfPv(d);
  }
  if (!octets) return texte('PDF introuvable.', 404);
  return new Response(Buffer.from(octets), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nom}"`, 'Cache-Control': 'private, no-store' },
  });
}
