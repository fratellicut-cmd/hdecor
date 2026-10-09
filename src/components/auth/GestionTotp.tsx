'use client';

import { useActionState, useState, useTransition } from 'react';
import { commencerTotp, confirmerTotp, desactiverTotp, type EtatTotp } from '@/app/(app)/compte/actions';
import { ETAT_INITIAL } from '@/lib/etat-formulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { Message } from '@/components/ui/Message';

export function GestionTotp({ facteurActifId }: { facteurActifId: string | null }) {
  const [enrolement, setEnrolement] = useState<EtatTotp | null>(null);
  const [preparation, demarrer] = useTransition();
  const [etat, confirmer, confirmationEnCours] = useActionState(confirmerTotp, ETAT_INITIAL as EtatTotp);
  const [etatDesactivation, desactiver, desactivationEnCours] = useActionState(desactiverTotp, ETAT_INITIAL);

  if (etat.succes) return <Message type="succes">{etat.succes}</Message>;

  if (facteurActifId) {
    return (
      <form action={desactiver} className="flex flex-col gap-3">
        <p>La double authentification est <strong>activée</strong>.</p>
        {etatDesactivation.message ? <Message type="erreur">{etatDesactivation.message}</Message> : null}
        {etatDesactivation.succes ? <Message type="succes">{etatDesactivation.succes}</Message> : null}
        <input type="hidden" name="facteurId" value={facteurActifId} />
        <Bouton type="submit" variante="secondaire" disabled={desactivationEnCours}>Désactiver</Bouton>
      </form>
    );
  }

  const courant = etat.facteurId ? etat : enrolement;
  if (!courant?.facteurId) {
    return (
      <div className="flex flex-col gap-3">
        {etatDesactivation.succes ? <Message type="succes">{etatDesactivation.succes}</Message> : null}
        <p>Option recommandée : en plus du mot de passe, un code à 6 chiffres donné par une application (Google Authenticator, Microsoft Authenticator…).</p>
        {enrolement?.message ? <Message type="erreur">{enrolement.message}</Message> : null}
        <Bouton type="button" variante="secondaire" disabled={preparation} onClick={() => demarrer(async () => setEnrolement(await commencerTotp()))}>
          Activer la double authentification
        </Bouton>
      </div>
    );
  }

  return (
    <form action={confirmer} className="flex flex-col gap-3" noValidate>
      <p>1. Dans l’application d’authentification, scannez ce code :</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- QR code SVG fourni en data: par le serveur d’authentification */}
      <img src={courant.qr} alt="QR code à scanner avec l’application d’authentification" className="h-48 w-48 self-center rounded-lg bg-white p-2" />
      <p className="break-all text-sm text-encre-douce">Ou saisissez cette clé : <code>{courant.secret}</code></p>
      <p>2. Saisissez le code affiché par l’application :</p>
      <input type="hidden" name="facteurId" value={courant.facteurId} />
      <Champ libelle="Code à 6 chiffres" nom="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required erreur={etat.erreurs?.code} />
      <Bouton type="submit" disabled={confirmationEnCours}>Confirmer</Bouton>
    </form>
  );
}
