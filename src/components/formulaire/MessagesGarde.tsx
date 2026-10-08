'use client';

import type { EtatFormulaire } from '@/lib/etat-formulaire';
import { formaterDateHeure } from '@/domain/formats';
import { Bouton } from '@/components/ui/Bouton';
import { Message } from '@/components/ui/Message';
import type { Garde } from './useGardeSaisie';

/** En haut du formulaire : brouillon récupéré, conflit avec la fiche, coupure. */
export function MessagesGarde({ garde }: { garde: Garde }) {
  return (
    <>
      {garde.conflit ? (
        <div className="flex flex-col gap-2 rounded-xl border-2 border-alerte bg-alerte-fond p-3 text-alerte">
          <p className="font-semibold">
            Une saisie non enregistrée du {formaterDateHeure(new Date(garde.conflit.enregistre_le).toISOString())} existe,
            mais la fiche a été modifiée depuis. Elle n’a pas été remise.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Bouton type="button" variante="secondaire" onClick={garde.reprendre}>Reprendre ma saisie</Bouton>
            <Bouton type="button" variante="secondaire" onClick={garde.annuler}>L’oublier</Bouton>
          </div>
        </div>
      ) : null}
      {garde.recupere ? (
        <div className="flex flex-col gap-2 rounded-xl border-2 border-trait bg-white p-3">
          <p role="status" className="font-semibold">Saisie non enregistrée récupérée sur ce téléphone. Vérifiez-la puis enregistrez.</p>
          <Bouton type="button" variante="secondaire" onClick={garde.annuler}>Annuler ces changements</Bouton>
        </div>
      ) : null}
    </>
  );
}

/** Juste au-dessus du bouton d'envoi : le retour arrive là où le pouce a appuyé. */
export function RappelEnvoi({ garde, etat }: { garde: Garde; etat: EtatFormulaire }) {
  if (garde.horsLigne) {
    return <Message type="alerte">Hors connexion : rien n’a été envoyé, votre saisie est gardée sur ce téléphone. Réessayez au retour du réseau.</Message>;
  }
  if (etat.message) return <p className="font-semibold text-danger">{etat.message}</p>;
  if (etat.erreurs && Object.keys(etat.erreurs).length) return <p className="font-semibold text-danger">Corrigez les champs signalés en rouge.</p>;
  return null;
}
