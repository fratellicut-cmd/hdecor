'use client';

import { useActionState } from 'react';
import { demanderReinitialisation } from './actions';
import { ETAT_INITIAL } from '@/lib/etat-formulaire';
import { Marque } from '@/components/Marque';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { Message } from '@/components/ui/Message';

export default function PageMotDePasseOublie() {
  const [etat, action, enCours] = useActionState(demanderReinitialisation, ETAT_INITIAL);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Marque grande />
      <h1 className="text-2xl font-bold">Mot de passe oublié</h1>
      <p>Indiquez votre adresse email : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
      <form action={action} className="flex flex-col gap-4" noValidate>
        {etat.succes ? <Message type="succes">{etat.succes}</Message> : null}
        <Champ libelle="Adresse email" nom="email" type="email" autoComplete="email" inputMode="email" required erreur={etat.erreurs?.email} />
        <Bouton type="submit" disabled={enCours}>{enCours ? 'Envoi…' : 'Recevoir le lien'}</Bouton>
      </form>
      <a href="/connexion" className="inline-flex min-h-12 items-center justify-center underline underline-offset-4">Retour à la connexion</a>
    </main>
  );
}
