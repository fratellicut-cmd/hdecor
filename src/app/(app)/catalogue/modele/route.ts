import { verifierSession } from '@/lib/dal';
import { modeleImport } from '@/domain/catalogue';

/** Modèle d'import vide (titres des colonnes seulement). */
export async function GET() {
  await verifierSession();
  return new Response(modeleImport(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="modele-catalogue.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
