'use client';

import { enregistrerMentions } from '@/app/(app)/parametres/actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import type { Ligne } from '@/lib/supabase/types';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { TexteLong } from '@/components/ui/Autres';
import { RetourFormulaire } from './RetourFormulaire';

type P = Pick<Ligne<'parametres_entreprise'>, 'mediateur_nom' | 'mediateur_coordonnees' | 'mediateur_site' | 'mentions_pied' | 'avis_google_url'>;

export function FormulaireMentions({ p }: { p: P }) {
  const { etat, action, enCours, formRef, garde } = useFormulaire('parametres:mentions', enregistrerMentions);
  const e = etat.erreurs ?? {};
  const val = (cle: keyof P) => etat.valeurs?.[cle] ?? p[cle] ?? '';
  return (
    <form ref={formRef} action={action} onSubmit={garde.surEnvoi} className="flex flex-col gap-4" noValidate>
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <h3 className="text-lg font-bold">Médiateur de la consommation</h3>
      <Champ libelle="Nom du médiateur" nom="mediateur_nom" defaultValue={val('mediateur_nom')} erreur={e.mediateur_nom} />
      <TexteLong libelle="Coordonnées" nom="mediateur_coordonnees" defaultValue={val('mediateur_coordonnees')} erreur={e.mediateur_coordonnees} />
      <Champ libelle="Site internet" nom="mediateur_site" type="url" inputMode="url" defaultValue={val('mediateur_site')} erreur={e.mediateur_site} placeholder="https://" />
      <h3 className="mt-2 text-lg font-bold">Documents</h3>
      <TexteLong libelle="Mentions en pied de devis et facture" nom="mentions_pied" defaultValue={val('mentions_pied')} erreur={e.mentions_pied} />
      <Champ libelle="Lien de demande d’avis Google" nom="avis_google_url" type="url" inputMode="url" defaultValue={val('avis_google_url')} erreur={e.avis_google_url} placeholder="https://" />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</Bouton>
    </form>
  );
}
