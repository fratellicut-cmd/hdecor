import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterDate } from '@/domain/formats';
import { libelleStatut } from '@/domain/statuts';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Chantiers' };

const FILTRES = { actifs: 'En cours et à planifier', termine: 'Terminés', tous: 'Tous' } as const;

export default async function PageChantiers({ searchParams }: PageProps<'/chantiers'>) {
  await verifierSession();
  const sp = await searchParams;
  const filtre = z.enum(['actifs', 'termine', 'tous']).catch('actifs').parse(sp.filtre);
  const supabase = await clientServeur();
  let requete = supabase.from('v_chantiers').select('id, nom, ville, statut, statut_affiche, date_debut_prevue, client_id, created_at')
    .order('created_at', { ascending: false }).limit(200);
  if (filtre === 'actifs') requete = requete.in('statut', ['a_planifier', 'en_cours']);
  if (filtre === 'termine') requete = requete.eq('statut', 'termine');
  const { data, error } = await requete;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Chantiers</h1>
        <Link href="/chantiers/nouveau" className="inline-flex min-h-12 items-center rounded-xl bg-anthracite px-5 font-semibold text-creme">+ Nouveau</Link>
      </div>
      {sp.supprime === '1' ? <Message type="succes">Chantier supprimé.</Message> : null}
      <nav aria-label="Filtres" className="flex flex-wrap gap-2">
        {Object.entries(FILTRES).map(([k, l]) => (
          <Link key={k} href={k === 'actifs' ? '/chantiers' : `/chantiers?filtre=${k}`} aria-current={filtre === k ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border-2 px-4 font-semibold ${filtre === k ? 'border-anthracite bg-anthracite text-creme' : 'border-trait bg-white'}`}>
            {l}
          </Link>
        ))}
      </nav>
      {error ? <Message type="erreur">La liste n’a pas pu être chargée. Rechargez la page.</Message> : null}
      {!error && !data?.length ? <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">Aucun chantier. Touchez « + Nouveau » pour en créer un.</p> : null}
      <ul className="flex flex-col gap-2">
        {(data ?? []).map((c) => (
          <li key={c.id}>
            <Link href={`/chantiers/${c.id}`} className="flex min-h-16 flex-col justify-center rounded-xl border border-trait bg-white px-4 py-2">
              <span className="font-semibold">{c.nom}</span>
              <span className="text-sm text-encre-douce">
                {[libelleStatut(c.statut_affiche), c.ville, c.date_debut_prevue ? `début ${formaterDate(c.date_debut_prevue)}` : null].filter(Boolean).join(' · ')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
