'use client';

import { useActionState, useState } from 'react';
import { envoyerLienDeConnexion, seConnecter } from '@/app/connexion/actions';
import { ETAT_INITIAL } from '@/lib/etat-formulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { Message } from '@/components/ui/Message';

export function FormulaireConnexion({ suite }: { suite: string }) {
  const [mode, setMode] = useState<'motDePasse' | 'lien'>('motDePasse');
  const [etat, actionConnexion, enCours] = useActionState(seConnecter, ETAT_INITIAL);
  const [etatLien, actionLien, envoiEnCours] = useActionState(envoyerLienDeConnexion, ETAT_INITIAL);

  if (mode === 'lien') {
    return (
      <form action={actionLien} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="suite" value={suite} />
        {etatLien.succes ? <Message type="succes">{etatLien.succes}</Message> : null}
        <Champ libelle="Adresse email" nom="email" type="email" autoComplete="email" inputMode="email" required erreur={etatLien.erreurs?.email} />
        <Bouton type="submit" disabled={envoiEnCours}>{envoiEnCours ? 'Envoi…' : 'Recevoir un lien de connexion'}</Bouton>
        <Bouton type="button" variante="discret" onClick={() => setMode('motDePasse')}>Se connecter avec le mot de passe</Bouton>
      </form>
    );
  }

  return (
    <form action={actionConnexion} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="suite" value={suite} />
      {etat.message ? <Message type="erreur">{etat.message}</Message> : null}
      <Champ
        libelle="Adresse email" nom="email" type="email" autoComplete="username" inputMode="email" required
        defaultValue={etat.valeurs?.email} erreur={etat.erreurs?.email}
      />
      <Champ
        libelle="Mot de passe" nom="motDePasse" type="password" autoComplete="current-password" required
        erreur={etat.erreurs?.motDePasse}
      />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Connexion…' : 'Se connecter'}</Bouton>
      <div className="flex flex-col items-center gap-1">
        <Bouton type="button" variante="discret" onClick={() => setMode('lien')}>Recevoir un lien par email</Bouton>
        <a href="/mot-de-passe-oublie" className="inline-flex min-h-12 items-center underline underline-offset-4">Mot de passe oublié</a>
      </div>
    </form>
  );
}
