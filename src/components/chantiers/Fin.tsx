'use client';

import { ajouterElementFin, cocherElementFin, enregistrerModeleFin } from '@/app/(app)/chantiers/fin-actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { TexteLong } from '@/components/ui/Autres';

/** Une ligne de la liste : toute la ligne est le bouton (cible large, avec des gants). */
export function ElementFin({ chantierId, rang, libelle, faitLe }: { chantierId: string; rang: number; libelle: string; faitLe: string | null }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, cocherElementFin);
  const fait = !!faitLe;
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi}>
      <input type="hidden" name="chantier_id" value={chantierId} />
      <input type="hidden" name="rang" value={String(rang)} />
      <input type="hidden" name="libelle" value={libelle} />
      <input type="hidden" name="fait" value={fait ? '0' : '1'} />
      {etat.message ? <RetourFormulaire etat={etat} /> : null}
      <button type="submit" disabled={enCours} aria-pressed={fait}
        className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-3 text-left ${fait ? 'border-anthracite bg-creme' : 'border-trait bg-white'}`}>
        <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 border-anthracite text-lg font-bold ${fait ? 'bg-anthracite text-creme' : ''}`}>{fait ? '✓' : ''}</span>
        <span className="flex flex-col">
          <span className={`font-semibold ${fait ? 'line-through' : ''}`}>{libelle}</span>
          {fait ? <span className="text-sm text-encre-douce">Fait le {faitLe!.split('-').reverse().join('/')} · toucher pour décocher</span> : null}
        </span>
      </button>
    </form>
  );
}

export function FormulaireAjoutFin({ chantierId }: { chantierId: string }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, ajouterElementFin, { viderApresSucces: true });
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="chantier_id" value={chantierId} />
      <RetourFormulaire etat={etat} />
      <Champ libelle="Ajouter un élément" nom="libelle" defaultValue={etat.succes ? '' : etat.valeurs?.libelle ?? ''} erreur={etat.erreurs?.libelle}
        placeholder="Exemple : reboucher les trous des chevilles" />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Un instant…' : 'Ajouter'}</Bouton>
    </form>
  );
}

export function FormulaireModeleFin({ liste }: { liste: string[] }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire('parametres:fin-de-chantier', enregistrerModeleFin);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <RetourFormulaire etat={etat} />
      <TexteLong libelle="Éléments (un par ligne)" nom="liste" rows={10} defaultValue={etat.valeurs?.liste ?? liste.join('\n')} erreur={etat.erreurs?.liste} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Un instant…' : 'Enregistrer le modèle'}</Bouton>
    </form>
  );
}
