'use client';

import { useState } from 'react';
import type { EtatFormulaire } from '@/lib/etat-formulaire';
import { creerPv, enregistrerPv, leverReserve, signerPv } from '@/app/(app)/chantiers/pv-actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { AlerteHorsLigne, MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { PadSignature } from '@/components/devis/Signature';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher, Selection, TexteLong } from '@/components/ui/Autres';
import { MENTION_PV, mentionPvValide } from '@/lib/validation/pv';

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

type SignatureClient = { nom: string; mention: string; image: string; pour: EtatFormulaire };

/**
 * Signature du PV sur un seul téléphone, en deux étapes : le client d'abord
 * (nom, mention, tracé, case), puis, téléphone rendu, l'entreprise. Un seul
 * cadre à l'écran à la fois : un glissement du pouce pour faire défiler ne
 * peut pas « signer » à la place de l'autre. Un seul envoi pour les deux.
 */
export function FormulaireSignaturePv({ id, documentSha256, nomParDefaut, lienPdf, entreprise, engagement }: {
  id: string; documentSha256: string; nomParDefaut: string; lienPdf: string; entreprise: string;
  /** Phrase simple sur ce que signe le client. */
  engagement: string;
}) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(null, signerPv);
  const e = etat.erreurs ?? {};
  const [client, setClient] = useState<SignatureClient | null>(null);
  const [alerte, setAlerte] = useState<string | null>(null);
  // Retour à l'étape du client si le serveur refuse l'une de ses données.
  const erreurClient = Boolean(e.nom || e.mention || e.image || e.lu);
  const etape = client && (client.pour === etat || !erreurClient) ? 'entreprise' : 'client';

  const validerClient = () => {
    const f = formRef.current!;
    const valeur = (nom: string) => (f.elements.namedItem(nom) as HTMLInputElement | null)?.value.trim() ?? '';
    const nom = valeur('nom');
    const mention = valeur('mention');
    const image = valeur('image');
    const lu = (f.elements.namedItem('lu') as HTMLInputElement | null)?.checked;
    const manque = nom.length < 2 ? 'Indiquez le nom et le prénom du client.'
      : !mentionPvValide(mention) ? `Écrivez « ${MENTION_PV} ».`
        : !image ? 'Le client signe dans le cadre.'
          : !lu ? 'Cochez la case pour confirmer la relecture du procès-verbal.' : null;
    setAlerte(manque);
    if (manque) return;
    setClient({ nom, mention, image, pour: etat });
    window.scrollTo({ top: 0 });
  };

  return (
    <form ref={formRef} action={action} noValidate className="flex flex-col gap-4"
      onSubmit={(ev) => { if (etape === 'client') { ev.preventDefault(); validerClient(); } else surEnvoi(ev); }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="document_sha256" value={documentSha256} />
      <RetourFormulaire etat={etat} />
      {garde.horsLigne ? <AlerteHorsLigne sansBrouillon /> : null}
      {etape === 'client' ? (
        <>
          <p className="font-semibold">Étape 1 sur 2 : tendez le téléphone au client.</p>
          <a href={lienPdf} target="_blank" rel="noopener" className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">
            Relire le procès-verbal (PDF)
          </a>
          <fieldset className="flex flex-col gap-3 rounded-xl border-2 border-trait bg-white p-3">
            <legend className="px-1 font-semibold">Le client signe</legend>
            <p>{engagement}</p>
            <Champ libelle="Nom et prénom du client" nom="nom" defaultValue={client?.nom ?? etat.valeurs?.nom ?? nomParDefaut} erreur={e.nom} autoComplete="name" />
            <Champ libelle={`Écrivez « ${MENTION_PV} »`} nom="mention" defaultValue={client?.mention ?? etat.valeurs?.mention ?? ''} erreur={e.mention} autoComplete="off" />
            <CaseACocher nom="lu" libelle="J’ai relu le procès-verbal et je prononce la réception des travaux" erreur={e.lu} />
            <PadSignature nom="image" libelle="Signature du client" erreur={e.image} />
          </fieldset>
          {alerte ? <p role="alert" className="font-semibold text-danger">{alerte}</p> : null}
          <Bouton type="submit">Valider la signature du client</Bouton>
        </>
      ) : (
        <>
          <input type="hidden" name="nom" value={client!.nom} />
          <input type="hidden" name="mention" value={client!.mention} />
          <input type="hidden" name="image" value={client!.image} />
          <input type="hidden" name="lu" value="on" />
          <p className="font-semibold">Étape 2 sur 2 : reprenez le téléphone.</p>
          <div className="flex flex-col gap-2 rounded-xl border-2 border-trait bg-white p-3">
            <p>✓ Le client <strong>{client!.nom}</strong> a signé.</p>
            <Bouton type="button" variante="discret" onClick={() => setClient(null)}>Refaire la signature du client</Bouton>
          </div>
          <fieldset className="flex flex-col gap-3 rounded-xl border-2 border-trait bg-white p-3">
            <legend className="px-1 font-semibold">L’entreprise signe{entreprise ? ` (${entreprise})` : ''}</legend>
            <PadSignature nom="image_entreprise" libelle="Signature de l’entreprise" erreur={e.image_entreprise} />
          </fieldset>
          <Bouton type="submit" disabled={enCours}>{enCours ? 'Signature…' : 'Signer le procès-verbal'}</Bouton>
        </>
      )}
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
