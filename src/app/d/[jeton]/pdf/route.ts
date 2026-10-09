import { pdfParJeton } from '@/lib/devis-public';
import { jetonBienForme } from '@/lib/liens';

/** PDF d'un devis partagé : accès par le jeton du lien (vérifié par la base). */
export async function GET(requete: Request, { params }: RouteContext<'/d/[jeton]/pdf'>) {
  const { jeton } = await params;
  const signe = new URL(requete.url).searchParams.get('signe') === '1';
  const r = jetonBienForme(jeton) ? await pdfParJeton(jeton, signe) : null;
  if (!r) return new Response('Lien invalide ou expiré.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Referrer-Policy': 'no-referrer' } });
  return new Response(Buffer.from(r.octets), {
    headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${r.nom}"`,
      'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex',
    },
  });
}
