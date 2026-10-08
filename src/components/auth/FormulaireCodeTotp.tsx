'use client';

import { useActionState } from 'react';
import { verifierCodeTotp } from '@/app/connexion/actions';
import { ETAT_INITIAL } from '@/lib/etat-formulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';

export function FormulaireCodeTotp({ facteurId, suite }: { facteurId: string; suite: string }) {
  const [etat, action, enCours] = useActionState(verifierCodeTotp, ETAT_INITIAL);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="facteurId" value={facteurId} />
      <input type="hidden" name="suite" value={suite} />
      <Champ
        libelle="Code à 6 chiffres" nom="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
        required erreur={etat.erreurs?.code}
      />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Vérification…' : 'Valider'}</Bouton>
    </form>
  );
}
