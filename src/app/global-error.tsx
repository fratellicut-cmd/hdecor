'use client';

import './globals.css';
import { PageErreur } from '@/components/PageErreur';
import { Bouton } from '@/components/ui/Bouton';

/** Dernier recours (erreur dans la mise en page racine) : document complet. */
export default function ErreurGlobale({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh bg-creme antialiased">
        <title>Erreur · H&apos;DECOR</title>
        <PageErreur
          titre="Un problème est survenu"
          texte={`L’application n’a pas pu s’afficher. Vérifiez la connexion puis réessayez.${error.digest ? ` (Référence : ${error.digest})` : ''}`}
          actions={<Bouton type="button" onClick={() => retry()}>Réessayer</Bouton>}
        />
      </body>
    </html>
  );
}
