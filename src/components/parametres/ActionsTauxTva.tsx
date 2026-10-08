'use client';

import { useActionState } from 'react';
import { majTauxTva } from '@/app/(app)/parametres/actions';
import { ETAT_INITIAL } from '@/lib/etat-formulaire';
import { Bouton } from '@/components/ui/Bouton';
import { RetourFormulaire } from './RetourFormulaire';

export function ActionsTauxTva({ tauxBp, aVerifier, actif }: { tauxBp: number; aVerifier: boolean; actif: boolean }) {
  const [etat, action, enCours] = useActionState(majTauxTva, ETAT_INITIAL);
  return (
    <div className="mt-3 flex flex-col gap-2">
      <RetourFormulaire etat={etat} />
      <div className="flex flex-wrap gap-2">
        {aVerifier ? (
          <form action={action}>
            <input type="hidden" name="taux_bp" value={tauxBp} /><input type="hidden" name="champ" value="confirmer" />
            <Bouton type="submit" variante="secondaire" disabled={enCours}>Confirmé par le comptable</Bouton>
          </form>
        ) : null}
        <form action={action}>
          <input type="hidden" name="taux_bp" value={tauxBp} /><input type="hidden" name="champ" value="actif" />
          <input type="hidden" name="valeur" value={actif ? '0' : '1'} />
          <Bouton type="submit" variante="discret" disabled={enCours}>{actif ? 'Ne plus proposer' : 'Proposer à nouveau'}</Bouton>
        </form>
      </div>
    </div>
  );
}
