'use client';

import { useActionState } from 'react';
import { supprimerAssurance } from '@/app/(app)/parametres/actions';
import { ETAT_INITIAL } from '@/lib/etat-formulaire';
import { Bouton } from '@/components/ui/Bouton';
import { CaseACocher } from '@/components/ui/Autres';
import { RetourFormulaire } from './RetourFormulaire';

/** Suppression d'une assurance : confirmation explicite (mention obligatoire des devis). */
export function SuppressionAssurance({ id }: { id: string }) {
  const [etat, action, enCours] = useActionState(supprimerAssurance, ETAT_INITIAL);
  return (
    <details className="mt-3">
      <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">Supprimer…</summary>
      <form action={action} className="mt-2 flex flex-col gap-3">
        <input type="hidden" name="id" value={id} />
        <RetourFormulaire etat={etat} />
        <CaseACocher nom="confirmation" libelle="Je confirme la suppression de cette assurance." required />
        <Bouton type="submit" variante="danger" disabled={enCours}>{enCours ? 'Suppression…' : 'Supprimer l’assurance'}</Bouton>
      </form>
    </details>
  );
}
