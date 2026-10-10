'use client';

import { useState } from 'react';
import { ajouterRappel, ajouterRappelSechage, ajouterTemps, enregistrerEvenement, planifierChantier } from '@/app/(app)/planning/actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher, Selection, TexteLong } from '@/components/ui/Autres';
import { LIBELLES_EVENEMENT, TYPES_EVENEMENT } from '@/lib/validation/planning';

export type EvenementSaisie = {
  id?: string; type: string; chantier_id: string; titre: string; date_debut: string; date_fin: string;
  journee_entiere: boolean; heure_debut: string; heure_fin: string; notes: string;
};

export function FormulaireEvenement({ evenement, chantiers }: { evenement: EvenementSaisie; chantiers: { id: string; libelle: string }[] }) {
  const nouveau = !evenement.id;
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`planning:evenement:${evenement.id ?? 'nouveau'}`, enregistrerEvenement,
    { viderApresSucces: nouveau });
  const e = etat.erreurs ?? {};
  const sv = etat.succes && nouveau ? undefined : etat.valeurs;
  const v = (k: keyof EvenementSaisie) => sv?.[k] ?? String(evenement[k] ?? '');
  const [type, setType] = useState(v('type') || 'rendez_vous');
  const [journee, setJournee] = useState(sv ? sv.journee_entiere === 'on' : evenement.journee_entiere);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      {evenement.id ? <input type="hidden" name="id" value={evenement.id} /> : null}
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Selection libelle="Type" nom="type" value={type} onChange={(ev) => setType(ev.target.value)} erreur={e.type}>
        {/* Un chantier se planifie depuis sa fiche (plages de jours ouvrés). */}
        {TYPES_EVENEMENT.filter((t) => t !== 'chantier').map((t) => <option key={t} value={t}>{LIBELLES_EVENEMENT[t]}</option>)}
      </Selection>
      <Selection libelle="Chantier (facultatif)" nom="chantier_id" defaultValue={v('chantier_id')} erreur={e.chantier_id}>
        <option value="">Aucun</option>
        {chantiers.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
      </Selection>
      <Champ libelle="Titre" nom="titre" defaultValue={v('titre')} erreur={e.titre} placeholder="Exemple : métré chez Mme Martin" />
      <CaseACocher nom="journee_entiere" libelle="Toute la journée" checked={journee} onChange={(ev) => setJournee(ev.target.checked)} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Début" nom="date_debut" type="date" defaultValue={v('date_debut')} erreur={e.date_debut} />
        {journee ? <Champ libelle="Fin (facultatif)" nom="date_fin" type="date" defaultValue={v('date_fin')} erreur={e.date_fin} />
          : <Champ libelle="Heure de début" nom="heure_debut" type="time" defaultValue={v('heure_debut')} erreur={e.heure_debut} />}
      </div>
      {!journee ? (
        <div className="grid grid-cols-2 gap-3">
          <Champ libelle="Heure de fin" nom="heure_fin" type="time" defaultValue={v('heure_fin')} erreur={e.heure_fin} />
          <Champ libelle="Jour de fin (facultatif)" nom="date_fin" type="date" defaultValue={v('date_fin')} erreur={e.date_fin} />
        </div>
      ) : null}
      <TexteLong libelle="Notes (facultatif)" nom="notes" defaultValue={v('notes')} erreur={e.notes} />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : nouveau ? 'Ajouter au planning' : 'Enregistrer'}</Bouton>
    </form>
  );
}

export function FormulaireRappel({ aujourdhui, chantierId }: { aujourdhui: string; chantierId?: string }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`planning:rappel:${chantierId ?? ''}`, ajouterRappel, { viderApresSucces: true });
  const e = etat.erreurs ?? {};
  const sv = etat.succes ? undefined : etat.valeurs;
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      {chantierId ? <input type="hidden" name="chantier_id" value={chantierId} /> : null}
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Champ libelle="Me rappeler de" nom="titre" defaultValue={sv?.titre ?? ''} erreur={e.titre} placeholder="Exemple : commander la peinture" />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Le" nom="date" type="date" defaultValue={sv?.date ?? aujourdhui} erreur={e.date} />
        <Champ libelle="À (sinon 8 h)" nom="heure" type="time" defaultValue={sv?.heure ?? ''} erreur={e.heure} />
      </div>
      <p className="text-sm text-encre-douce">Le rappel s’affiche dans « À faire » sur l’accueil et dans le planning. Pas d’alerte sur le téléphone.</p>
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Un instant…' : 'Ajouter le rappel'}</Bouton>
    </form>
  );
}

export function FormulairePlanification({ chantierId, debut, duree }: { chantierId: string; debut: string; duree: string }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`chantier:planning:${chantierId}`, planifierChantier);
  const e = etat.erreurs ?? {};
  const v = (k: string, d: string) => (etat.succes ? d : etat.valeurs?.[k] ?? d);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="chantier_id" value={chantierId} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Début" nom="date_debut" type="date" defaultValue={v('date_debut', debut)} erreur={e.date_debut} />
        <Champ libelle="Durée (jours ouvrés)" nom="duree_jours" inputMode="decimal" defaultValue={v('duree_jours', duree)} erreur={e.duree_jours} />
      </div>
      <p className="text-sm text-encre-douce">Week-ends exclus. Les jours fériés ne sont pas retirés : vérifiez la date de fin.</p>
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Un instant…' : 'Planifier'}</Bouton>
    </form>
  );
}

export function FormulaireTemps({ chantierId, aujourdhui }: { chantierId: string; aujourdhui: string }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(`chantier:temps:${chantierId}`, ajouterTemps, { viderApresSucces: true });
  const e = etat.erreurs ?? {};
  const sv = etat.succes ? undefined : etat.valeurs;
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="chantier_id" value={chantierId} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Jour" nom="jour" type="date" defaultValue={sv?.jour ?? aujourdhui} erreur={e.jour} />
        <Champ libelle="Durée" nom="minutes" defaultValue={sv?.minutes ?? ''} erreur={e.minutes} placeholder="7h30" aide="7h30, 2,5 ou 45 min" />
      </div>
      <Champ libelle="Tâche (facultatif)" nom="tache" defaultValue={sv?.tache ?? ''} erreur={e.tache} placeholder="Exemple : ponçage, 1re couche" />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Un instant…' : 'Noter le temps'}</Bouton>
    </form>
  );
}

export function FormulaireSechage({ chantierId, heures }: { chantierId: string; heures: string }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, ajouterRappelSechage);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="chantier_id" value={chantierId} />
      <RetourFormulaire etat={etat} />
      <Champ libelle="Séchage avant la couche suivante (heures)" nom="heures" inputMode="decimal" defaultValue={etat.valeurs?.heures ?? heures}
        erreur={etat.erreurs?.heures} aide="D’après la fiche technique du produit." />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Un instant…' : 'Noter la fin du séchage'}</Bouton>
      <p className="text-sm text-encre-douce">L’heure de fin s’affichera dans « À faire » sur l’accueil. L’appli n’envoie pas d’alerte sur le téléphone : pensez à l’ouvrir.</p>
    </form>
  );
}
