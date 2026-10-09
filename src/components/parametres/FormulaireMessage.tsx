'use client';

import { enregistrerModeleMessage } from '@/app/(app)/parametres/actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher, TexteLong } from '@/components/ui/Autres';
import { RetourFormulaire } from './RetourFormulaire';

export type ModeleSaisie = { code: string; sujet: string; corps: string; delai_jours: string | null; actif: boolean; champs: readonly string[] };

export function FormulaireMessage({ m, version }: { m: ModeleSaisie; version: string }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`parametres:message:${m.code}`, enregistrerModeleMessage, { version });
  const e = etat.erreurs ?? {};
  const v = (k: 'sujet' | 'corps' | 'delai_jours', d: string) => etat.valeurs?.[k] ?? d;
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="code" value={m.code} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      {m.delai_jours !== null ? (
        <>
          <CaseACocher nom="actif" libelle="Envoyer cette relance automatiquement" defaultChecked={etat.valeurs ? etat.valeurs.actif === 'on' : m.actif} />
          <Champ libelle="Jours après l’échéance" nom="delai_jours" inputMode="numeric" defaultValue={v('delai_jours', m.delai_jours)} erreur={e.delai_jours} />
        </>
      ) : null}
      <Champ libelle="Objet" nom="sujet" defaultValue={v('sujet', m.sujet)} erreur={e.sujet} />
      <TexteLong libelle="Message" nom="corps" rows={9} defaultValue={v('corps', m.corps)} erreur={e.corps} />
      <p className="text-sm text-encre-douce">Champs remplacés à l’envoi : {m.champs.map((c) => `{${c}}`).join(' ')}</p>
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer ce message'}</Bouton>
    </form>
  );
}
