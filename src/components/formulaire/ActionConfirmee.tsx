'use client';

import type { EtatFormulaire } from '@/lib/etat-formulaire';
import { useFormulaire } from './useFormulaire';
import { AlerteHorsLigne } from './MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { CaseACocher } from '@/components/ui/Autres';

type Props = {
  action: (etat: EtatFormulaire, formData: FormData) => Promise<EtatFormulaire>;
  champs: Record<string, string>;
  libelle: string;
  /** Avec confirmation : repliée derrière « libelle… », case à cocher exigée. */
  confirmation?: string;
  variante?: 'danger' | 'secondaire' | 'discret';
  explication?: string;
};

/** Petite action serveur (retrait, suppression, changement d'état) avec retour affiché. */
export function ActionConfirmee({ action, champs, libelle, confirmation, variante = 'secondaire', explication }: Props) {
  // Coupure réseau : envoi bloqué ou message clair, jamais la page d'erreur.
  const { etat, action: envoyer, enCours, formRef, garde, surEnvoi } = useFormulaire(null, action);
  const formulaire = (
    <form ref={formRef} action={envoyer} onSubmit={surEnvoi} className="flex flex-col gap-2">
      {Object.entries(champs).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <RetourFormulaire etat={etat} />
      {garde.horsLigne ? <AlerteHorsLigne sansBrouillon /> : null}
      {explication ? <p className="text-sm">{explication}</p> : null}
      {confirmation ? <CaseACocher nom="confirmation" libelle={confirmation} required /> : null}
      <Bouton type="submit" variante={variante} disabled={enCours}>{enCours ? 'Un instant…' : libelle}</Bouton>
    </form>
  );
  if (!confirmation) return formulaire;
  return (
    <details>
      <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">{libelle}…</summary>
      <div className="mt-2">{formulaire}</div>
    </details>
  );
}
