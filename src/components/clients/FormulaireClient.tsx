'use client';

import Link from 'next/link';
import { useState } from 'react';
import { enregistrerClient } from '@/app/(app)/clients/actions';
import type { Ligne } from '@/lib/supabase/types';
import { CIVILITES } from '@/lib/validation/clients';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { cleBrouillonClient } from '@/components/formulaire/cles';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { Selection, TexteLong } from '@/components/ui/Autres';

type C = Pick<Ligne<'clients'>, 'type' | 'civilite' | 'nom' | 'prenom' | 'raison_sociale' | 'siret' | 'tva_intra' | 'email'
  | 'telephone' | 'fact_ligne1' | 'fact_ligne2' | 'fact_code_postal' | 'fact_ville' | 'notes' | 'source'> & { updated_at?: string };

const VIDE: C = {
  type: 'particulier', civilite: null, nom: '', prenom: null, raison_sociale: null, siret: null, tva_intra: null,
  email: null, telephone: null, fact_ligne1: null, fact_ligne2: null, fact_code_postal: null, fact_ville: null,
  notes: null, source: null,
};

export function FormulaireClient({ id, client = VIDE }: { id?: string; client?: C }) {
  // Version de la fiche : un brouillon plus ancien qu'une modification n'est pas remis d'office.
  const { etat, action, enCours, formRef, garde } = useFormulaire(cleBrouillonClient(id), enregistrerClient,
    { version: id ? (client.updated_at ?? null) : undefined });
  const e = etat.erreurs ?? {};
  const v = (cle: keyof C) => (etat.valeurs?.[cle] ?? client[cle] ?? '') as string;
  const [type, setType] = useState<C['type']>((etat.valeurs?.type as C['type'] | undefined) ?? client.type);
  const pro = type === 'professionnel';

  return (
    <form ref={formRef} action={action} onSubmit={garde.surEnvoi} className="flex flex-col gap-4" noValidate>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <MessagesGarde garde={garde} />
      <RetourFormulaire etat={etat} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Type de client</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['particulier', 'professionnel'] as const).map((t) => (
            <label key={t} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 px-3 font-semibold has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-or-fonce ${type === t ? 'border-anthracite bg-anthracite text-creme' : 'border-trait bg-white'}`}>
              {/* Non contrôlé : React 19 réinitialise le formulaire après chaque envoi ;
                  defaultChecked suit l'état, la réinitialisation remet donc le bon choix. */}
              <input type="radio" name="type" value={t} defaultChecked={type === t} onChange={() => setType(t)} className="sr-only" />
              {t === 'particulier' ? 'Particulier' : 'Professionnel'}
            </label>
          ))}
        </div>
        {e.type ? <p className="text-sm font-semibold text-danger">{e.type}</p> : null}
      </fieldset>

      {/* Toujours présents (masqués pour un particulier) : un brouillon peut
          ainsi être restauré d'un coup ; le serveur ignore ces champs pour un
          particulier. */}
      <div hidden={!pro} className="flex flex-col gap-4">
        <Champ libelle="Raison sociale" nom="raison_sociale" defaultValue={v('raison_sociale')} required={pro} erreur={e.raison_sociale} autoComplete="organization" />
        <Champ libelle="SIRET" nom="siret" defaultValue={v('siret')} inputMode="numeric" erreur={e.siret} aide="14 chiffres (facultatif)." />
        <Champ libelle="N° de TVA intracommunautaire" nom="tva_intra" defaultValue={v('tva_intra')} erreur={e.tva_intra} autoCapitalize="characters" />
      </div>

      <div className="grid grid-cols-[6.5rem_1fr] gap-3">
        <Selection libelle="Civilité" nom="civilite" defaultValue={v('civilite')} erreur={e.civilite}>
          <option value="">—</option>
          {CIVILITES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Selection>
        <Champ libelle={pro ? 'Nom du contact' : 'Nom'} nom="nom" defaultValue={v('nom')} required erreur={e.nom} autoComplete="family-name" />
      </div>
      <Champ libelle="Prénom" nom="prenom" defaultValue={v('prenom')} erreur={e.prenom} autoComplete="given-name" />
      <Champ libelle="Téléphone" nom="telephone" type="tel" defaultValue={v('telephone')} inputMode="tel" erreur={e.telephone} autoComplete="tel" />
      <Champ libelle="Email" nom="email" type="email" defaultValue={v('email')} inputMode="email" erreur={e.email} autoComplete="email" />

      <Champ libelle="Adresse de facturation" nom="fact_ligne1" defaultValue={v('fact_ligne1')} erreur={e.fact_ligne1} autoComplete="address-line1" />
      <Champ libelle="Complément d’adresse" nom="fact_ligne2" defaultValue={v('fact_ligne2')} erreur={e.fact_ligne2} autoComplete="address-line2" />
      <div className="grid grid-cols-[8rem_1fr] gap-3">
        <Champ libelle="Code postal" nom="fact_code_postal" defaultValue={v('fact_code_postal')} inputMode="numeric" maxLength={5} erreur={e.fact_code_postal} autoComplete="postal-code" />
        <Champ libelle="Ville" nom="fact_ville" defaultValue={v('fact_ville')} erreur={e.fact_ville} autoComplete="address-level2" />
      </div>

      <Champ libelle="Comment ce client vous a connu" nom="source" defaultValue={v('source')} erreur={e.source}
        aide="Exemple : bouche-à-oreille, Google, chantier voisin." />
      <TexteLong libelle="Notes" nom="notes" defaultValue={v('notes')} erreur={e.notes}
        placeholder="Informations utiles au chantier. Pas de données sensibles (santé, opinions…)." />

      {etat.doublon ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border-2 border-alerte bg-alerte-fond p-3 text-alerte">
          <p className="font-semibold">Un client « {etat.doublon.nom} » existe déjà (même téléphone, ou même nom et prénom).</p>
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/clients/${etat.doublon.id}`} className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-3 text-center font-semibold text-encre">
              Ouvrir sa fiche
            </Link>
            <Bouton type="submit" name="creer_quand_meme" value="1" variante="secondaire" disabled={enCours}>Créer quand même</Bouton>
          </div>
        </div>
      ) : null}
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</Bouton>
    </form>
  );
}
