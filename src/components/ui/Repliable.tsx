'use client';

import { useState, type ReactNode } from 'react';

/**
 * Bloc repliable dont l'état initial est fixé à l'affichage, puis laissé à
 * l'utilisateur (un rafraîchissement des données ne le replie pas : le message
 * d'un formulaire qu'il contient reste visible).
 */
export function Repliable({ titre, ouvert, children }: { titre: string; ouvert: boolean; children: ReactNode }) {
  const [estOuvert, setOuvert] = useState(ouvert);
  return (
    <details open={estOuvert} onToggle={(e) => setOuvert(e.currentTarget.open)}>
      <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">{titre}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
