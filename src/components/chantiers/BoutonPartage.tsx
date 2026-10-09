'use client';

import { useState } from 'react';
import { Bouton } from '@/components/ui/Bouton';

/**
 * Partage de la liste par message : feuille de partage du téléphone si elle
 * existe, sinon SMS prérempli, sinon copie dans le presse-papiers.
 */
export function BoutonPartage({ titre, texte }: { titre: string; texte: string }) {
  const [retour, setRetour] = useState<string | null>(null);
  const partager = async () => {
    setRetour(null);
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: titre, text: texte }); return; } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return; // annulé par l'utilisateur
      }
    }
    try {
      await navigator.clipboard.writeText(texte);
      setRetour('Liste copiée : collez-la dans votre message.');
    } catch {
      window.location.href = `sms:?&body=${encodeURIComponent(texte)}`;
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Bouton type="button" variante="secondaire" onClick={partager}>Partager par message</Bouton>
      {retour ? <p role="status" className="text-sm font-semibold">{retour}</p> : null}
    </div>
  );
}
