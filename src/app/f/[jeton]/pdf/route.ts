import { pdfFactureParJeton } from '@/lib/facture-publique';
import { jetonBienForme } from '@/lib/liens';

const texte = (m: string, status: number) => new Response(m, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Referrer-Policy': 'no-referrer' } });

/** PDF d'une facture partagée : accès par le jeton du lien (vérifié par la base). */
export async function GET(_: Request, { params }: RouteContext<'/f/[jeton]/pdf'>) {
  const { jeton } = await params;
  let r;
  try { r = jetonBienForme(jeton) ? await pdfFactureParJeton(jeton) : null; } catch {
    return texte('Service momentanément indisponible : réessayez dans un instant.', 503);
  }
  if (!r) return texte('Lien invalide ou expiré.', 404);
  return new Response(Buffer.from(r.octets), {
    headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${r.nom}"`,
      'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex',
    },
  });
}
