import { timingSafeEqual } from 'node:crypto';
import { clientAdmin } from '@/lib/supabase/admin';
import { viderFileSuppression } from '@/lib/stockage-admin';

/**
 * Tâche planifiée quotidienne (vercel.json) :
 *  1. anonymise les prospects inactifs (durée paramétrable, À VÉRIFIER) ;
 *  2. reprend la suppression des fichiers restés en file après un effacement.
 * Protégée par CRON_SECRET (en-tête « Authorization: Bearer … » envoyé par
 * Vercel). Sans secret configuré, la route refuse tout.
 */
export const dynamic = 'force-dynamic';

function autorise(requete: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const attendu = Buffer.from(`Bearer ${secret}`);
  const recu = Buffer.from(requete.headers.get('authorization') ?? '');
  return recu.length === attendu.length && timingSafeEqual(recu, attendu);
}

export async function GET(requete: Request) {
  if (!autorise(requete)) return new Response('Non autorisé.', { status: 401 });

  const { data: prospects, error } = await clientAdmin().rpc('purger_prospects_inactifs');
  if (error) {
    console.error('Conservation : échec de la purge des prospects', error.code);
    return Response.json({ ok: false, etape: 'prospects' }, { status: 500 });
  }
  try {
    const fichiers = await viderFileSuppression({ limite: 500 });
    return Response.json({ ok: fichiers.enEchec === 0, prospects_anonymises: prospects, fichiers });
  } catch (e) {
    console.error('Conservation : échec de la reprise des fichiers', e instanceof Error ? e.message : e);
    return Response.json({ ok: false, etape: 'fichiers', prospects_anonymises: prospects }, { status: 500 });
  }
}
