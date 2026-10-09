import { z } from 'zod';
import { calculerChantier } from '@/lib/chantiers';
import { lireParametres } from '@/lib/parametres';
import { pdfListeAchat } from '@/lib/pdf/liste-achat';

/** Liste d'achat du chantier en PDF (session et RLS : organisation de l'utilisateur). */
export async function GET(_: Request, { params }: RouteContext<'/chantiers/[id]/liste-achat/pdf'>) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response('Chantier introuvable.', { status: 404 });
  const c = await calculerChantier(id.data);
  if (!c) return new Response('Chantier introuvable.', { status: 404 });
  const p = await lireParametres();
  const octets = await pdfListeAchat({ entreprise: p.raison_sociale ?? 'Entreprise', chantier: c.chantier.nom ?? 'Chantier', date: new Date() }, c.liste);
  const nom = (c.chantier.nom ?? 'chantier').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'chantier';
  return new Response(Buffer.from(octets), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="liste-achat-${nom}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
