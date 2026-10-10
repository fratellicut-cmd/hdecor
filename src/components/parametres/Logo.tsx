'use client';

import { useState } from 'react';
import { deposerLogo, retirerLogo } from '@/app/(app)/parametres/logo-actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde } from '@/components/formulaire/MessagesGarde';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { Bouton } from '@/components/ui/Bouton';
import { RetourFormulaire } from './RetourFormulaire';

/** Dépôt du logo (PNG ou JPEG, 2 Mo au plus) ; aperçu du logo en place. */
export function DepotLogo({ present, version }: { present: boolean; version: string }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(null, deposerLogo, { viderApresSucces: true });
  const [nom, setNom] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {present ? (
        // eslint-disable-next-line @next/next/no-img-element -- image privée servie par une route authentifiée
        <img src={`/parametres/logo?v=${encodeURIComponent(version)}`} alt="Logo actuel" className="h-20 w-auto max-w-full self-start rounded-lg border border-trait bg-white object-contain p-1" />
      ) : null}
      <form ref={formRef} action={action} onSubmit={surEnvoi} onReset={() => setNom(null)} className="flex flex-col gap-2" noValidate>
        <RetourFormulaire etat={etat} />
        <MessagesGarde garde={garde} />
        <label className="inline-flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-anthracite px-4 text-center font-semibold">
          <input type="file" name="logo" accept="image/png,image/jpeg" className="sr-only" onChange={(ev) => setNom(ev.currentTarget.files?.[0]?.name ?? null)}
            aria-invalid={etat.erreurs?.logo ? true : undefined} />
          {nom ? `Fichier : ${nom}` : present ? 'Choisir un autre logo (PNG ou JPEG)' : 'Choisir le logo (PNG ou JPEG)'}
        </label>
        {etat.erreurs?.logo ? <p role="alert" className="text-sm font-semibold text-danger">{etat.erreurs.logo}</p> : null}
        <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Envoi…' : 'Enregistrer le logo'}</Bouton>
      </form>
      {present ? (
        <ActionConfirmee action={retirerLogo} champs={{ confirmer: 'oui' }} libelle="Retirer le logo"
          confirmation="Je retire le logo des prochains documents (les documents déjà émis gardent le leur)" />
      ) : null}
    </div>
  );
}
