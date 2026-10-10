import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { Navigation } from '@/components/Navigation';
import { BandeauConnexion } from '@/components/BandeauConnexion';
import { Marque } from '@/components/Marque';
import { NettoyageBrouillons } from '@/components/formulaire/NettoyageBrouillons';

/** Toutes les pages de ce groupe exigent une session valide (DAL). */
export default async function LayoutApplication({ children }: LayoutProps<'/'>) {
  await verifierSession();
  // Notifications non lues (cloche) : une lecture légère, sans les lignes.
  const { count } = await (await clientServeur()).from('notifications').select('id', { count: 'exact', head: true }).is('lu_le', null);
  const nonLues = count ?? 0;
  return (
    <>
      <BandeauConnexion />
      <NettoyageBrouillons />
      <header className="border-b border-trait bg-white px-4 py-3">
        <div className="relative mx-auto flex max-w-3xl items-center justify-center">
          <Marque />
          <Link href="/notifications" aria-label={nonLues ? `Notifications : ${nonLues} non lue${nonLues > 1 ? 's' : ''}` : 'Notifications'}
            className="absolute right-0 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-xl">
            <span aria-hidden>🔔</span>
            {nonLues ? <span aria-hidden className="absolute right-0 top-0 min-w-5 rounded-full bg-danger px-1 text-center text-xs font-bold text-white">{nonLues > 99 ? '99+' : nonLues}</span> : null}
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4">{children}</main>
      <Navigation />
    </>
  );
}
