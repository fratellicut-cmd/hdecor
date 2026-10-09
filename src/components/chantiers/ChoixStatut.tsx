'use client';

import { changerStatutChantier } from '@/app/(app)/chantiers/actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { AlerteHorsLigne } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { LIBELLES_STATUT_CHANTIER } from './FormulaireChantier';

/** Statut en un toucher : chaque bouton envoie directement. */
export function ChoixStatut({ id, statut }: { id: string; statut: keyof typeof LIBELLES_STATUT_CHANTIER }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(null, changerStatutChantier);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-2">
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
      {garde.horsLigne ? <AlerteHorsLigne sansBrouillon /> : null}
      <RetourFormulaire etat={etat} />
    </form>
  );
}
