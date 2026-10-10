'use client';

import { enregistrerTextes } from '@/app/(app)/parametres/actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { TexteLong } from '@/components/ui/Autres';
import { CODES_TEXTES, TEXTES, type TextesLegaux } from '@/domain/textes-legaux';
import { RetourFormulaire } from './RetourFormulaire';

/** Textes légaux : préremplis avec le texte en vigueur (personnalisé ou par défaut). */
export function FormulaireTextes({ textes, validesLe, aujourdhui }: { textes: TextesLegaux; validesLe: string | null; aujourdhui: string }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire('parametres:textes', enregistrerTextes);
  const e = etat.erreurs ?? {};
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-5" noValidate>
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      {CODES_TEXTES.map((code) => {
        const t = TEXTES[code];
        return (
          <div key={code} className="flex flex-col gap-1">
            <TexteLong libelle={t.libelle} nom={code} rows={code === 'devis_recu' || code === 'autoliquidation' ? 2 : 6}
              defaultValue={etat.valeurs?.[code] ?? textes[code] ?? t.defaut} erreur={e[code]} aVerifier={!validesLe} />
            <p className="text-sm text-encre-douce">
              Imprimé : {t.ou}.{t.reperes.length ? ` Gardez ${t.reperes.join(' et ')} : remplacé à l’impression.` : ''}
              {textes[code] ? ' Texte personnalisé (videz le champ pour revenir au texte par défaut).' : ' Texte par défaut de l’application.'}
            </p>
          </div>
        );
      })}
      <Champ libelle="Textes validés par mon comptable le (facultatif)" nom="textes_legaux_valides_le" type="date" max={aujourdhui}
        defaultValue={etat.valeurs?.textes_legaux_valides_le ?? validesLe ?? ''} erreur={e.textes_legaux_valides_le}
        aide="Tant que cette date est vide, les textes restent « À VÉRIFIER » et sont rappelés avant chaque émission." />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</Bouton>
    </form>
  );
}
