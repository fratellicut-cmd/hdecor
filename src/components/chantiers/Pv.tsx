'use client';

import { creerPv, enregistrerPv, leverReserve, signerPv } from '@/app/(app)/chantiers/pv-actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { AlerteHorsLigne, MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { PadSignature } from '@/components/devis/Signature';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher, Selection, TexteLong } from '@/components/ui/Autres';
import { MENTION_PV } from '@/lib/validation/pv';

export type PvSaisie = {
  id?: string; date_reception: string; travaux: string; reserves: string; observations: string; delai_levee_jours: string; devis_id: string;
};

export function FormulairePv({ chantierId, pv, devis }: { chantierId: string; pv: PvSaisie; devis: { id: string; libelle: string }[] }) {
  const nouveau = !pv.id;
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(nouveau ? `pv:nouveau:${chantierId}` : `pv:${pv.id}`, nouveau ? creerPv : enregistrerPv);
  const e = etat.erreurs ?? {};
  const v = (k: keyof PvSaisie) => etat.valeurs?.[k] ?? String(pv[k] ?? '');
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      {pv.id ? <input type="hidden" name="id" value={pv.id} /> : <input type="hidden" name="chantier_id" value={chantierId} />}
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Champ libelle="Date de la réception" nom="date_reception" type="date" defaultValue={v('date_reception')} erreur={e.date_reception} />
      <TexteLong libelle="Travaux réceptionnés" nom="travaux" defaultValue={v('travaux')} erreur={e.travaux} rows={3}
        placeholder="Exemple : peinture des murs et plafonds du séjour et du couloir" />
      {devis.length ? (
        <Selection libelle="Devis correspondant (facultatif)" nom="devis_id" defaultValue={v('devis_id')} erreur={e.devis_id}>
          <option value="">Aucun</option>
          {devis.map((d) => <option key={d.id} value={d.id}>{d.libelle}</option>)}
        </Selection>
      ) : null}
      <TexteLong libelle="Réserves (une par ligne ; vide = sans réserve)" nom="reserves" defaultValue={v('reserves')} erreur={e.reserves} rows={4}
        placeholder={'Exemple :\nReprendre l’angle du plafond de la chambre\nPlinthe tachée dans le couloir'} />
      <Champ libelle="Délai pour lever les réserves, en jours (facultatif)" nom="delai_levee_jours" inputMode="numeric" defaultValue={v('delai_levee_jours')} erreur={e.delai_levee_jours} />
      <TexteLong libelle="Observations (facultatif)" nom="observations" defaultValue={v('observations')} erreur={e.observations} rows={3} />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" variante={nouveau ? 'principal' : 'secondaire'} disabled={enCours}>{enCours ? 'Un instant…' : nouveau ? 'Créer le PV' : 'Enregistrer'}</Bouton>
    </form>
  );
}

export function FormulaireSignaturePv({ id, documentSha256, nomParDefaut, lienPdf, entreprise }: {
  id: string; documentSha256: string; nomParDefaut: string; lienPdf: string; entreprise: string;
}) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(null, signerPv);
  const e = etat.erreurs ?? {};
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="document_sha256" value={documentSha256} />
      <RetourFormulaire etat={etat} />
      {garde.horsLigne ? <AlerteHorsLigne sansBrouillon /> : null}
      <a href={lienPdf} target="_blank" rel="noopener" className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">
        Relire le procès-verbal (PDF)
      </a>
      <fieldset className="flex flex-col gap-3 rounded-xl border-2 border-trait bg-white p-3">
        <legend className="px-1 font-semibold">Le client</legend>
        <Champ libelle="Nom et prénom du client" nom="nom" defaultValue={etat.valeurs?.nom ?? nomParDefaut} erreur={e.nom} autoComplete="name" />
        <Champ libelle={`Écrivez « ${MENTION_PV} »`} nom="mention" defaultValue={etat.valeurs?.mention ?? ''} erreur={e.mention} autoComplete="off" />
        <PadSignature nom="image" libelle="Signature du client" erreur={e.image} />
        <CaseACocher nom="lu" libelle="J’ai relu le procès-verbal et je prononce la réception des travaux" erreur={e.lu} />
      </fieldset>
      <fieldset className="flex flex-col gap-3 rounded-xl border-2 border-trait bg-white p-3">
        <legend className="px-1 font-semibold">L’entreprise ({entreprise})</legend>
        <PadSignature nom="image_entreprise" libelle="Votre signature" erreur={e.image_entreprise} />
      </fieldset>
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Signature…' : 'Signer le procès-verbal'}</Bouton>
    </form>
  );
}

export function FormulaireLevee({ id, rang, aujourdhui }: { id: string; rang: number; aujourdhui: string }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, leverReserve);
  const e = etat.erreurs ?? {};
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rang" value={String(rang)} />
      <RetourFormulaire etat={etat} />
      <div className="grid grid-cols-2 gap-2">
        <Champ libelle="Levée le" nom="levee_le" type="date" defaultValue={etat.valeurs?.levee_le ?? aujourdhui} erreur={e.levee_le} />
        <Champ libelle="Note (facultatif)" nom="levee_note" defaultValue={etat.valeurs?.levee_note ?? ''} erreur={e.levee_note} />
      </div>
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Un instant…' : 'Noter la levée'}</Bouton>
    </form>
  );
}
