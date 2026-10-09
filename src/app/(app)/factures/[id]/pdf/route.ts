import { createHash } from 'node:crypto';
import { z } from 'zod';
import { chargerFacture, donneesPdfFacture, preparerEmissionFacture } from '@/lib/factures';
import { clientServeur } from '@/lib/supabase/serveur';
import { verifierSession } from '@/lib/dal';
import { lire } from '@/lib/stockage';
import { pdfFacture } from '@/lib/pdf/facture';
import { aujourdHuiParis } from '@/domain/dates';
import { ajouterJours } from '@/domain/devis-document';

const texte = (m: string, status: number) => new Response(m, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const pdf = (octets: Uint8Array, nom: string) => new Response(Buffer.from(octets), {
  headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nom}.pdf"`, 'Cache-Control': 'no-store' },
});

/**
 * PDF d'une facture (session et RLS). Brouillon : APERÇU recalculé (filigrane,
 * sans numéro). Document émis : le PDF FIGÉ déposé à l'émission, contrôlé par
 * son empreinte, jamais régénéré.
 */
export async function GET(_: Request, { params }: RouteContext<'/factures/[id]/pdf'>) {
  const session = await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return texte('Facture introuvable.', 404);
  const sb = await clientServeur();
  const c = await chargerFacture(id.data, sb);
  if (!c) return texte('Facture introuvable.', 404);
  const f = c.facture;

  if (f.statut === 'brouillon') {
    try {
      const date = aujourdHuiParis();
      const prep = await preparerEmissionFacture(sb, c, date);
      const echeance = ajouterJours(date, f.delai_paiement_jours!);
      return pdf(await pdfFacture(donneesPdfFacture(c, prep, { numero: null, dateEmission: date, dateEcheance: echeance, brouillon: true })), 'apercu-facture');
    } catch (e) {
      console.error('Aperçu de la facture', e instanceof Error ? e.message : e);
      return texte('L’aperçu n’a pas pu être créé : vérifiez le client et les lignes de la facture.', 500);
    }
  }
  if (!f.pdf_chemin) return texte('PDF introuvable.', 404);
  const octets = await lire('documents', session.organisationId, f.pdf_chemin);
  if (!octets) return texte('PDF introuvable dans le stockage.', 404);
  if (createHash('sha256').update(octets).digest('hex') !== f.pdf_sha256) {
    console.error('Empreinte du PDF de facture différente de celle enregistrée', f.id);
    return texte('Le PDF stocké ne correspond pas à celui émis : contactez le support.', 500);
  }
  return pdf(octets, `${f.type === 'avoir' ? 'avoir' : 'facture'}-${f.numero}`);
}
