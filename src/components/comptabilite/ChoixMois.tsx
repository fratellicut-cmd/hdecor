import Link from 'next/link';
import { decalerMois, libelleMois } from '@/domain/comptabilite';

const lien = 'inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-3 font-semibold';

/** Mois précédent / suivant (pas au-delà du mois en cours). */
export function ChoixMois({ chemin, mois, moisCourant }: { chemin: string; mois: string; moisCourant: string }) {
  const suivant = decalerMois(mois, 1);
  return (
    <nav aria-label="Mois" className="flex items-center justify-between gap-2">
      <Link href={`${chemin}?mois=${decalerMois(mois, -1)}`} className={lien} aria-label="Mois précédent">←</Link>
      <span className="text-lg font-bold first-letter:uppercase">{libelleMois(mois)}</span>
      {suivant <= moisCourant ? <Link href={`${chemin}?mois=${suivant}`} className={lien} aria-label="Mois suivant">→</Link> : <span className="min-w-12" />}
    </nav>
  );
}
