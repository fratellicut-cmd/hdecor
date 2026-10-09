import { z } from 'zod';
import { chargerDevis, donneesPdf, preparerEmission } from '@/lib/devis';
import { clientServeur } from '@/lib/supabase/serveur';
import { verifierSession } from '@/lib/dal';
import { lire } from '@/lib/stockage';
import { pdfDevis } from '@/lib/pdf/devis';
import { aujourdHuiParis } from '@/domain/dates';

const texte = (m: string, status: number) => new Response(m, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const pdf = (octets: Uint8Array, nom: string) => new Response(Buffer.from(octets), {
  headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nom}.pdf"`, 'Cache-Control': 'no-store' },
});

/**
 * PDF d'un devis (session et RLS : organisation de l'utilisateur).
 * Brouillon : APERÇU recalculé (filigrane, sans numéro). Devis émis : le PDF
 * FIGÉ déposé à l'émission (ou le PDF signé avec ?signe=1), jamais régénéré.
 */
export async function GET(requete: Request, { params }: RouteContext<'/devis/[id]/pdf'>) {
  const session = await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return texte('Devis introuvable.', 404);
  const sb = await clientServeur();
  const c = await chargerDevis(id.data, sb);
  if (!c) return texte('Devis introuvable.', 404);
  const d = c.devis;

  if (d.statut === 'brouillon') {
    try {
      const date = aujourdHuiParis();
      const prep = await preparerEmission(sb, c, date);
      return pdf(await pdfDevis(donneesPdf(c, prep, { numero: null, dateEmission: date, brouillon: true })), 'apercu-devis');
    } catch (e) {
      console.error('Aperçu du devis', e instanceof Error ? e.message : e);
      return texte('L’aperçu n’a pas pu être créé : vérifiez le client et les lignes du devis.', 500);
    }
  }

  let chemin = d.pdf_chemin;
  let suffixe = '';
  if (new URL(requete.url).searchParams.get('signe') === '1' && d.signature_id) {
    const { data: s } = await sb.from('signatures').select('pdf_signe_chemin').eq('id', d.signature_id).maybeSingle();
    if (!s?.pdf_signe_chemin) return texte('Le PDF signé n’est pas encore archivé.', 404);
    chemin = s.pdf_signe_chemin;
    suffixe = '-signe';
  }
  if (!chemin) return texte('PDF introuvable.', 404);
  const octets = await lire('documents', session.organisationId, chemin);
  if (!octets) return texte('PDF introuvable dans le stockage.', 404);
  return pdf(octets, `devis-${d.numero}${d.version! > 1 ? `-v${d.version}` : ''}${suffixe}`);
}
