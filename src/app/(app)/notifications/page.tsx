import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterDateHeure } from '@/domain/formats';
import { toutMarquerLu } from './actions';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';

export const metadata: Metadata = { title: 'Notifications' };

export default async function PageNotifications() {
  await verifierSession();
  const sb = await clientServeur();
  const { data, error } = await sb.from('notifications').select('id, titre, lien, cree_le, lu_le').order('cree_le', { ascending: false }).limit(100);
  if (error) throw new Error('Lecture impossible : notifications.');
  const nonLues = data.filter((n) => !n.lu_le).length;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Notifications</h1>
      <p className="text-encre-douce">Devis ouverts ou signés à distance, paiements en ligne, rappels arrivés à échéance.</p>
      {nonLues ? <ActionConfirmee action={toutMarquerLu} champs={{ tout: 'oui' }} libelle={`Tout marquer comme lu (${nonLues})`} variante="secondaire" /> : null}
      {!data.length ? <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">Aucune notification.</p> : (
        <ul className="flex flex-col gap-2">
          {data.map((n) => (
            <li key={n.id}>
              <a href={`/notifications/${n.id}`} className={`flex min-h-14 flex-col justify-center rounded-xl border bg-white px-4 py-2 ${n.lu_le ? 'border-trait' : 'border-anthracite'}`}>
                <span className={n.lu_le ? '' : 'font-semibold'}>{n.lu_le ? '' : '● '}{n.titre}</span>
                <span className="text-sm text-encre-douce">{formaterDateHeure(n.cree_le)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <Link href="/parametres/notifications" className="inline-flex min-h-12 items-center underline underline-offset-4">Recevoir aussi par email…</Link>
    </div>
  );
}
