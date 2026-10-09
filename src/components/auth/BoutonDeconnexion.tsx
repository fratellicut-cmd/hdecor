'use client';

import { seDeconnecter } from '@/app/connexion/actions';
import { Bouton } from '@/components/ui/Bouton';
import { effacerTousLesBrouillons } from '@/components/formulaire/useGardeSaisie';

/**
 * Déconnexion volontaire : efface aussi les brouillons gardés sur le
 * téléphone (données de clients). Une session expirée, elle, les conserve.
 */
export function BoutonDeconnexion() {
  return (
    <form action={seDeconnecter} onSubmit={effacerTousLesBrouillons}>
      <Bouton type="submit" variante="secondaire" className="w-full">Se déconnecter</Bouton>
    </form>
  );
}
