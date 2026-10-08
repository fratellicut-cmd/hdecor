'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { PageErreur, classeLienBouton } from '@/components/PageErreur';
import { Bouton } from '@/components/ui/Bouton';

/** Erreur inattendue dans une page de l'application : rien de technique n'est affiché. */
export default function ErreurApplication({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error('Erreur de page', error.digest ?? error.message); }, [error]);
  return (
    <PageErreur
      titre="Un problème est survenu"
      texte={`La page n’a pas pu s’afficher. Vérifiez la connexion puis réessayez. Les données déjà enregistrées ne sont pas perdues.${error.digest ? ` (Référence : ${error.digest})` : ''}`}
      actions={(
        <>
          <Bouton type="button" onClick={() => retry()}>Réessayer</Bouton>
          <Link href="/" className={`${classeLienBouton} border-2 border-anthracite bg-white`}>Retour à l’accueil</Link>
        </>
      )}
    />
  );
}
