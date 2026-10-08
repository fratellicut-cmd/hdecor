'use client';

import { useActionState } from 'react';
import { changerMotDePasse } from '@/app/(app)/compte/actions';
import { ETAT_INITIAL } from '@/lib/etat-formulaire';
import { MOT_DE_PASSE_MIN } from '@/lib/validation/auth';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { Message } from '@/components/ui/Message';

export function FormulaireMotDePasse({ apresOubli = false }: { apresOubli?: boolean }) {
  const [etat, action, enCours] = useActionState(changerMotDePasse, ETAT_INITIAL);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {apresOubli ? <input type="hidden" name="apresOubli" value="1" /> : null}
      {etat.message ? <Message type="erreur">{etat.message}</Message> : null}
      {etat.succes ? <Message type="succes">{etat.succes}</Message> : null}
      <Champ libelle="Nouveau mot de passe" nom="motDePasse" type="password" autoComplete="new-password" required
        aide={`${MOT_DE_PASSE_MIN} caractères au minimum. Une phrase facile à retenir convient très bien.`} erreur={etat.erreurs?.motDePasse} />
      <Champ libelle="Confirmez le mot de passe" nom="confirmation" type="password" autoComplete="new-password" required erreur={etat.erreurs?.confirmation} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer le mot de passe'}</Bouton>
    </form>
  );
}
