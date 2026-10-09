'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LIENS = [
  { href: '/', libelle: 'Accueil', icone: '⌂', aussi: [] },
  { href: '/chantiers', libelle: 'Chantiers', icone: '▦', aussi: [] },
  { href: '/devis', libelle: 'Devis', icone: '✎', aussi: [] },
  { href: '/clients', libelle: 'Clients', icone: '☺', aussi: [] },
  // Le compte et le catalogue s'ouvrent depuis les Paramètres.
  { href: '/parametres', libelle: 'Réglages', icone: '⚙', aussi: ['/compte', '/catalogue'] },
];

/** Barre de navigation fixe en bas de l'écran (utilisable au pouce). */
export function Navigation() {
  const chemin = usePathname();
  return (
    <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-20 border-t border-trait bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-3xl grid-cols-5">
        {LIENS.map((l) => {
          const actif = l.href === '/' ? chemin === '/' : [l.href, ...l.aussi].some((h) => chemin.startsWith(h));
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={actif ? 'page' : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-sm font-semibold ${actif ? 'text-encre' : 'text-encre-douce'}`}
              >
                <span aria-hidden className="text-xl leading-none">{l.icone}</span>
                {l.libelle}
                {actif ? <span aria-hidden className="filet-or mt-0.5 h-1 w-8 rounded-full" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
