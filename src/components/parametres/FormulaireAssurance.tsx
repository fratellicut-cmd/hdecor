'use client';

import { useActionState } from 'react';
import { ajouterAssurance } from '@/app/(app)/parametres/actions';
import { ETAT_INITIAL } from '@/lib/etat-formulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { Selection } from '@/components/ui/Autres';
import { RetourFormulaire } from './RetourFormulaire';

export function FormulaireAssurance() {
  const [etat, action, enCours] = useActionState(ajouterAssurance, ETAT_INITIAL);
  const e = etat.erreurs ?? {};
  const v = etat.valeurs ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate key={etat.succes ?? 'saisie'}>
      <RetourFormulaire etat={etat} />
      <Selection libelle="Type" nom="type" defaultValue={v.type ?? 'decennale'} erreur={e.type}>
        <option value="decennale">Assurance décennale</option>
        <option value="rc_pro">Responsabilité civile professionnelle</option>
      </Selection>
      <Champ libelle="Assureur" nom="assureur" defaultValue={v.assureur} required erreur={e.assureur} />
      <Champ libelle="Numéro de contrat" nom="numero_contrat" defaultValue={v.numero_contrat} required erreur={e.numero_contrat} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Début" nom="debut" defaultValue={v.debut} type="date" required erreur={e.debut} />
        <Champ libelle="Fin (si connue)" nom="fin" defaultValue={v.fin} type="date" erreur={e.fin} />
      </div>
      <Champ libelle="Zone géographique couverte" nom="zone_couverte" defaultValue={v.zone_couverte} required erreur={e.zone_couverte} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Ajout…' : 'Ajouter l’assurance'}</Bouton>
    </form>
  );
}
