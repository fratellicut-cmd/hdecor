'use client';

import { enregistrerEntreprise } from '@/app/(app)/parametres/actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import type { Ligne } from '@/lib/supabase/types';
import { formaterIban } from '@/lib/validation/identifiants';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { RetourFormulaire } from './RetourFormulaire';

type P = Pick<Ligne<'parametres_entreprise'>, 'raison_sociale' | 'forme_juridique' | 'nom_dirigeant' | 'siret' | 'immatriculation'
  | 'adresse_ligne1' | 'adresse_ligne2' | 'code_postal' | 'ville' | 'telephone' | 'email' | 'iban' | 'bic'>;

export function FormulaireEntreprise({ p }: { p: P }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire('parametres:entreprise', enregistrerEntreprise);
  const e = etat.erreurs ?? {};
  const v = (cle: keyof P) => (etat.valeurs?.[cle] ?? p[cle] ?? '') as string;
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Champ libelle="Raison sociale" nom="raison_sociale" defaultValue={v('raison_sociale')} required erreur={e.raison_sociale} />
      <Champ libelle="Forme juridique" nom="forme_juridique" defaultValue={v('forme_juridique')} required erreur={e.forme_juridique}
        aide="Pour une entreprise individuelle : « EI » (mention à faire valider par le comptable)." />
      <Champ libelle="Nom du dirigeant" nom="nom_dirigeant" defaultValue={v('nom_dirigeant')} erreur={e.nom_dirigeant} autoComplete="name" />
      <Champ libelle="SIRET" nom="siret" defaultValue={v('siret')} inputMode="numeric" erreur={e.siret} aide="14 chiffres." />
      <Champ libelle="Immatriculation (RNE / RM)" nom="immatriculation" defaultValue={v('immatriculation')} erreur={e.immatriculation} aVerifier
        aide="Libellé exact à faire valider par le comptable." />
      <Champ libelle="Adresse" nom="adresse_ligne1" defaultValue={v('adresse_ligne1')} erreur={e.adresse_ligne1} autoComplete="address-line1" />
      <Champ libelle="Complément d’adresse" nom="adresse_ligne2" defaultValue={v('adresse_ligne2')} erreur={e.adresse_ligne2} autoComplete="address-line2" />
      <div className="grid grid-cols-[8rem_1fr] gap-3">
        <Champ libelle="Code postal" nom="code_postal" defaultValue={v('code_postal')} inputMode="numeric" maxLength={5} erreur={e.code_postal} autoComplete="postal-code" />
        <Champ libelle="Ville" nom="ville" defaultValue={v('ville')} erreur={e.ville} autoComplete="address-level2" />
      </div>
      <Champ libelle="Téléphone" nom="telephone" type="tel" defaultValue={v('telephone')} inputMode="tel" erreur={e.telephone} autoComplete="tel" />
      <Champ libelle="Email" nom="email" type="email" defaultValue={v('email')} inputMode="email" erreur={e.email} autoComplete="email" />
      <Champ libelle="IBAN" nom="iban" defaultValue={etat.valeurs?.iban ?? (p.iban ? formaterIban(p.iban) : '')} erreur={e.iban} autoCapitalize="characters" />
      <Champ libelle="BIC" nom="bic" defaultValue={v('bic')} erreur={e.bic} autoCapitalize="characters" />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</Bouton>
    </form>
  );
}
