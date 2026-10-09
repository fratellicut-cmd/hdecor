'use client';

import { enregistrerChantier } from '@/app/(app)/chantiers/actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher, Selection, TexteLong } from '@/components/ui/Autres';

export type ChantierSaisi = {
  id?: string; client_id: string; nom: string; adresse_ligne1: string | null; adresse_ligne2: string | null;
  code_postal: string | null; ville: string | null; statut: string; date_debut_prevue: string | null; notes: string | null;
  updated_at?: string;
};

export const LIBELLES_STATUT_CHANTIER = { a_planifier: 'À planifier', en_cours: 'En cours', termine: 'Terminé' } as const;

export function FormulaireChantier({ chantier, clients }: { chantier: ChantierSaisi; clients: { id: string; nom: string }[] }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`chantier:${chantier.id ?? 'nouveau'}`, enregistrerChantier,
    { version: chantier.id ? (chantier.updated_at ?? null) : undefined });
  const e = etat.erreurs ?? {};
  const v = (cle: keyof ChantierSaisi) => (etat.valeurs?.[cle] ?? chantier[cle] ?? '') as string;
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      {chantier.id ? <input type="hidden" name="id" value={chantier.id} /> : null}
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Selection libelle="Client" nom="client_id" defaultValue={v('client_id')} erreur={e.client_id} required>
        <option value="">Choisir…</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
      </Selection>
      <Champ libelle="Nom du chantier" nom="nom" defaultValue={v('nom')} required erreur={e.nom} placeholder="Exemple : Rénovation appartement" />
      <CaseACocher nom="adresse_client" libelle="Même adresse que le client (adresse de facturation)" defaultChecked={!chantier.id && !etat.valeurs} />
      <Champ libelle="Adresse du chantier" nom="adresse_ligne1" defaultValue={v('adresse_ligne1')} erreur={e.adresse_ligne1} autoComplete="address-line1"
        aide="Laissée vide si « même adresse que le client » est coché." />
      <Champ libelle="Complément d’adresse" nom="adresse_ligne2" defaultValue={v('adresse_ligne2')} erreur={e.adresse_ligne2} />
      <div className="grid grid-cols-[8rem_1fr] gap-3">
        <Champ libelle="Code postal" nom="code_postal" defaultValue={v('code_postal')} inputMode="numeric" maxLength={5} erreur={e.code_postal} />
        <Champ libelle="Ville" nom="ville" defaultValue={v('ville')} erreur={e.ville} />
      </div>
      <Selection libelle="Statut" nom="statut" defaultValue={v('statut')} erreur={e.statut}>
        {Object.entries(LIBELLES_STATUT_CHANTIER).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Selection>
      <Champ libelle="Début prévu" nom="date_debut_prevue" type="date" defaultValue={v('date_debut_prevue')} erreur={e.date_debut_prevue} />
      <TexteLong libelle="Notes" nom="notes" defaultValue={v('notes')} erreur={e.notes} placeholder="Accès, code porte, contraintes…" />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</Bouton>
    </form>
  );
}
