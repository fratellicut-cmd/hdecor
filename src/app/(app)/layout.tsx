import { verifierSession } from '@/lib/dal';
import { Navigation } from '@/components/Navigation';
import { BandeauConnexion } from '@/components/BandeauConnexion';
import { Marque } from '@/components/Marque';

/** Toutes les pages de ce groupe exigent une session valide (DAL). */
export default async function LayoutApplication({ children }: LayoutProps<'/'>) {
  await verifierSession();
  return (
    <>
      <BandeauConnexion />
      <header className="border-b border-trait bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl"><Marque /></div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4">{children}</main>
      <Navigation />
    </>
  );
}
