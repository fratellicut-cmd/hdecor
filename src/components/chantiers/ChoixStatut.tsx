'use client';

import { useActionState } from 'react';
import { changerStatutChantier } from '@/app/(app)/chantiers/actions';
import { ETAT_INITIAL } from '@/lib/etat-formulaire';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { LIBELLES_STATUT_CHANTIER } from './FormulaireChantier';

/** Statut en un toucher : chaque bouton envoie directement. */
export function ChoixStatut({ id, statut }: { id: string; statut: keyof typeof LIBELLES_STATUT_CHANTIER }) {
  const [etat, action, enCours] = useActionState(changerStatutChantier, ETAT_INITIAL);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <fieldset className="grid grid-cols-3 gap-2" disabled={enCours}>
        <legend className="sr-only">Statut du chantier</legend>
        {Object.entries(LIBELLES_STATUT_CHANTIER).map(([k, l]) => (
          <button key={k} type="submit" name="statut" value={k} aria-pressed={statut === k}
            className={`min-h-12 rounded-xl border-2 px-2 text-sm font-semibold ${statut === k ? 'border-anthracite bg-anthracite text-creme' : 'border-trait bg-white'}`}>
            {l}
          </button>
        ))}
      </fieldset>
      <RetourFormulaire etat={etat} />
    </form>
  );
}
