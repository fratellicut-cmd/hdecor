'use client';

import { useEffect } from 'react';
import { effacerBrouillon } from './useGardeSaisie';

/** Placé sur la page atteinte après un enregistrement réussi. */
export function EffacerBrouillon({ cles }: { cles: string[] }) {
  const liste = cles.join('\n');
  useEffect(() => { for (const c of liste.split('\n')) effacerBrouillon(c); }, [liste]);
  return null;
}
