import Link from 'next/link';
import { adresseListe, PAR_PAGE, AFFICHAGE_MAX } from '@/domain/listes';

/** Recherche d'une liste (formulaire GET : l'adresse garde la recherche). */
export function RechercheListe({ base, filtre, q, libelle, exemple }: { base: string; filtre: string | null; q: string | null; libelle: string; exemple: string }) {
  return (
    <form action={base} method="get" role="search" className="flex gap-2">
      {filtre ? <input type="hidden" name="filtre" value={filtre} /> : null}
      <label className="sr-only" htmlFor={`recherche-${base}`}>{libelle}</label>
      <input id={`recherche-${base}`} name="q" type="search" defaultValue={q ?? ''} placeholder={exemple} maxLength={60} enterKeyHint="search"
        className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-trait bg-white px-3 text-base" />
      <button type="submit" className="inline-flex min-h-12 items-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">Chercher</button>
      {q ? <Link href={adresseListe(base, { filtre })} className="inline-flex min-h-12 items-center px-2 underline underline-offset-4">Effacer</Link> : null}
    </form>
  );
}

/** Fin de liste tronquée : nombre affiché et lien vers la suite (jamais de disparition silencieuse). */
export function SuiteListe({ base, params, affiches, nombre, encore }: {
  base: string; params: Record<string, string | null>; affiches: number; nombre: number; encore: boolean;
}) {
  if (!encore) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-trait bg-white p-4">
      <p>{affiches} premiers affichés{nombre >= AFFICHAGE_MAX ? ' : affinez avec la recherche ou les filtres pour voir les autres.' : '.'}</p>
      {nombre < AFFICHAGE_MAX ? (
        <Link href={adresseListe(base, { ...params, nombre: nombre + PAR_PAGE })} scroll={false}
          className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite px-4 font-semibold">
          Afficher {PAR_PAGE} de plus
        </Link>
      ) : null}
    </div>
  );
}
