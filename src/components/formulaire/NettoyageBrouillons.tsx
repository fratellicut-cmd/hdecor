'use client';

import { useEffect } from 'react';
import { nettoyerBrouillonsExpires } from './useGardeSaisie';

/** Placé dans la mise en page de l'application : purge les brouillons expirés. */
export function NettoyageBrouillons() {
  useEffect(() => { nettoyerBrouillonsExpires(); }, []);
  return null;
}
