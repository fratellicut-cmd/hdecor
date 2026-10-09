import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { aujourdHuiParis } from '@/domain/dates';
import { ajouterJours } from '@/domain/devis-document';
import { fichierIcs, type EvenementIcs } from '@/domain/pilotage';

/**
 * Planning exporté au format iCalendar (.ics), à importer dans Google Agenda :
 * événements des 30 derniers jours et de l'année à venir, et rappels en attente.
 * Fichier téléchargé (pas d'abonnement public : aucune adresse ne donne accès au planning sans session).
 */
export async function GET() {
  await verifierSession();
  const sb = await clientServeur();
  const aujourdhui = aujourdHuiParis();
  const du = `${ajouterJours(aujourdhui, -30)}T00:00:00Z`;
  const au = `${ajouterJours(aujourdhui, 366)}T00:00:00Z`;
  const [{ data: ev, error }, { data: rappels, error: e2 }, { data: chantiers }] = await Promise.all([
    sb.from('evenements').select('id, titre, debut, fin, journee_entiere, notes, chantier_id').gte('fin', du).lte('debut', au).order('debut').limit(2_000),
    sb.from('rappels').select('id, titre, echeance').eq('statut', 'a_envoyer').gte('echeance', du).lte('echeance', au).limit(1_000),
    sb.from('chantiers').select('id, adresse_ligne1, code_postal, ville').limit(2_000),
  ]);
  if (error || e2) return new Response('Planning illisible : réessayez.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const lieu = (id: string | null) => {
    const c = chantiers?.find((x) => x.id === id);
    return c ? [c.adresse_ligne1, [c.code_postal, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null : null;
  };
  const elements: EvenementIcs[] = [
    ...(ev ?? []).map((e) => ({
      id: e.id, titre: e.titre, journeeEntiere: e.journee_entiere, description: e.notes, lieu: lieu(e.chantier_id),
      debut: e.journee_entiere ? aujourdHuiParis(new Date(e.debut)) : e.debut, fin: e.journee_entiere ? aujourdHuiParis(new Date(e.fin)) : e.fin,
    })),
    ...(rappels ?? []).map((r) => ({
      id: `rappel-${r.id}`, titre: `Rappel : ${r.titre}`, journeeEntiere: false, debut: r.echeance,
      fin: new Date(new Date(r.echeance).getTime() + 15 * 60_000).toISOString(),
    })),
  ];
  return new Response(fichierIcs(elements, new Date()), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="hdecor-planning.ics"', 'Cache-Control': 'no-store',
    },
  });
}
