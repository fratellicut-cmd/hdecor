'use client';

import { startTransition, useActionState, useCallback, useEffect, useRef, type FormEvent } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { ETAT_INITIAL, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { effacerBrouillon, useGardeSaisie } from './useGardeSaisie';

// La réponse peut s'être perdue APRÈS l'enregistrement : on ne prétend pas que rien n'a été fait.
// Un nouvel envoi est sans risque : chaque création porte un identifiant fixé (id_nouveau).
export const MESSAGE_RESEAU = 'Le réseau ne répond pas : l’enregistrement n’est pas confirmé. Votre saisie est gardée sur ce téléphone ; renvoyez-la dans un instant (sans risque de doublon).';
/** Petites actions sans brouillon (retrait, statut, réglage) : rien à garder. */
export const MESSAGE_RESEAU_SIMPLE = 'Le réseau ne répond pas : l’enregistrement n’est pas confirmé. Réessayez dans un instant.';
export const MESSAGE_INCIDENT_SIMPLE = 'Un problème est survenu : rien n’a été enregistré. Réessayez ; si cela se répète, notez l’heure.';
export const MESSAGE_INCIDENT = 'Un problème est survenu : rien n’a été enregistré. Votre saisie est gardée sur ce téléphone. Réessayez ; si cela se répète, notez l’heure.';

type Action = (etat: EtatFormulaire, formData: FormData) => Promise<EtatFormulaire>;

/**
 * Formulaire avec Server Action, garde de saisie et retours en français :
 *  - un échec réseau pendant l'envoi (4G « menteuse ») ne quitte pas la page :
 *    message clair, saisie conservée (les redirections de Next passent) ;
 *  - l'envoi passe par `surEnvoi` : React ne vide PAS le formulaire après une
 *    erreur (sinon les listes reviendraient à leur valeur de départ et le nouvel
 *    essai partirait sur une autre pièce) ; `viderApresSucces` le vide après un ajout ;
 *  - chaque envoi porte `id_nouveau`, fixe jusqu'au succès : renvoyer après une
 *    réponse perdue ne crée pas de doublon ;
 *  - après une erreur, le premier champ fautif reçoit le focus et vient à l'écran.
 * `cle` null : pas de brouillon sur le téléphone (petite action), mêmes protections sinon.
 */
export function useFormulaire(cle: string | null, action: Action, options: { version?: string | null; viderApresSucces?: boolean } = {}) {
  const actionSure = useCallback<Action>(async (etat, formData) => {
    try {
      return await action(etat, formData);
    } catch (e) {
      unstable_rethrow(e);
      // Échec d'envoi (fetch) : réseau ; toute autre exception : incident serveur.
      const reseau = !navigator.onLine || e instanceof TypeError;
      const message = cle === null ? (reseau ? MESSAGE_RESEAU_SIMPLE : MESSAGE_INCIDENT_SIMPLE) : (reseau ? MESSAGE_RESEAU : MESSAGE_INCIDENT);
      return { message, valeurs: valeursTexte(formData) };
    }
  }, [action, cle]);
  const [etat, actionFormulaire, enCours] = useActionState(actionSure, ETAT_INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const idNouveau = useRef<string | null>(null);
  const garde = useGardeSaisie(cle, formRef, options.version);
  const vider = options.viderApresSucces ?? false;

  const surEnvoi = useCallback((e: FormEvent<HTMLFormElement>) => {
    garde.surEnvoi(e);
    if (e.defaultPrevented) return;
    e.preventDefault();
    const formData = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    idNouveau.current ??= crypto.randomUUID();
    if (!formData.has('id_nouveau')) formData.set('id_nouveau', idNouveau.current);
    startTransition(() => actionFormulaire(formData));
  }, [garde, actionFormulaire]);

  useEffect(() => {
    if (!etat.succes) return;
    // Enregistré sans changer de page : le brouillon n'a plus lieu d'être, la fiche suivante aura son propre identifiant.
    if (cle !== null) effacerBrouillon(cle);
    idNouveau.current = null;
    if (vider) formRef.current?.reset();
  }, [etat, cle, vider]);

  useEffect(() => {
    const form = formRef.current;
    if (!form || etat === ETAT_INITIAL) return;
    const fautif = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    const cible = fautif ?? form.querySelector<HTMLElement>('[role="alert"]');
    if (!cible) return;
    cible.scrollIntoView({ block: 'center' });
    if (fautif) fautif.focus({ preventScroll: true });
  }, [etat]);

  return { etat, action: actionFormulaire, enCours, formRef, garde, surEnvoi };
}
