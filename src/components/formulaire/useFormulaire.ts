'use client';

import { useActionState, useCallback, useEffect, useRef } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { ETAT_INITIAL, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { effacerBrouillon, useGardeSaisie } from './useGardeSaisie';

export const MESSAGE_RESEAU = 'Le réseau ne répond pas : rien n’a été enregistré. Votre saisie est gardée sur ce téléphone. Réessayez dans un instant.';
export const MESSAGE_INCIDENT = 'Un problème est survenu : rien n’a été enregistré. Votre saisie est gardée sur ce téléphone. Réessayez ; si cela se répète, notez l’heure.';

type Action = (etat: EtatFormulaire, formData: FormData) => Promise<EtatFormulaire>;

/**
 * Formulaire avec Server Action, garde de saisie et retours en français :
 *  - un échec réseau pendant l'envoi (4G « menteuse ») ne quitte pas la page :
 *    message clair, saisie conservée (les redirections de Next passent) ;
 *  - après une erreur, le premier champ fautif reçoit le focus et vient à l'écran.
 */
export function useFormulaire(cle: string, action: Action, options: { version?: string | null } = {}) {
  const actionSure = useCallback<Action>(async (etat, formData) => {
    try {
      return await action(etat, formData);
    } catch (e) {
      unstable_rethrow(e);
      // Échec d'envoi (fetch) : réseau ; toute autre exception : incident serveur.
      const reseau = !navigator.onLine || e instanceof TypeError;
      return { message: reseau ? MESSAGE_RESEAU : MESSAGE_INCIDENT, valeurs: valeursTexte(formData) };
    }
  }, [action]);
  const [etat, actionFormulaire, enCours] = useActionState(actionSure, ETAT_INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const garde = useGardeSaisie(cle, formRef, options.version);

  // Enregistré sans changer de page : le brouillon n'a plus lieu d'être.
  useEffect(() => { if (etat.succes) effacerBrouillon(cle); }, [etat, cle]);

  useEffect(() => {
    const form = formRef.current;
    if (!form || etat === ETAT_INITIAL) return;
    const fautif = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    const cible = fautif ?? form.querySelector<HTMLElement>('[role="alert"]');
    if (!cible) return;
    cible.scrollIntoView({ block: 'center' });
    if (fautif) fautif.focus({ preventScroll: true });
  }, [etat]);

  return { etat, action: actionFormulaire, enCours, formRef, garde };
}
