'use client';

import { useSyncExternalStore } from 'react';

function sAbonner(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/**
 * Bandeau affiché pendant une coupure réseau. L'application n'a pas de mode
 * hors-ligne (décision du directeur) : les saisies en cours sont gardées
 * dans le téléphone par les formulaires (voir useGardeSaisie) et envoyées au
 * retour du réseau.
 */
export function BandeauConnexion() {
  const enLigne = useSyncExternalStore(sAbonner, () => navigator.onLine, () => true);
  if (enLigne) return null;
  return (
    <div role="status" className="sticky top-0 z-30 bg-alerte-fond px-4 py-3 text-center font-semibold text-alerte">
      Hors connexion : vos saisies sont gardées sur ce téléphone. Enregistrez au retour du réseau.
    </div>
  );
}
