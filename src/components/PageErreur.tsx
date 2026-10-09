import type { ReactNode } from 'react';

/** Contenu commun des pages d'erreur et 404 (en français, cibles ≥ 48 px). */
export function PageErreur({ titre, texte, actions }: { titre: string; texte: string; actions: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10 text-center">
      <h1 className="text-2xl font-bold">{titre}</h1>
      <p className="text-encre-douce">{texte}</p>
      <div className="flex flex-col gap-3">{actions}</div>
    </div>
  );
}

export const classeLienBouton = 'inline-flex min-h-12 items-center justify-center rounded-xl px-5 font-semibold';
