'use client';

import { useState } from 'react';
import { noterDemandeAvisPartagee, opposerSollicitations, preparerDemandeAvis } from '@/app/(app)/factures/avis-actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { TexteLong } from '@/components/ui/Autres';

/** Demande d'avis après paiement : email, ou message à partager (noté quand il est copié ou partagé). */
export function DemandeAvis({ factureId, email, emailActif }: { factureId: string; email: string | null; emailActif: boolean }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, preparerDemandeAvis);
  const { etat: etatNote, action: noter, enCours: noteEnCours, formRef: noteRef, surEnvoi: surNote } = useFormulaire(null, noterDemandeAvisPartagee);
  const [fait, setFait] = useState<string | null>(null);
  const texte = etat.texte;
  const marquer = (comment: string) => { setFait(comment); noteRef.current?.requestSubmit(); };
  const copier = async () => { if (texte) { await navigator.clipboard.writeText(texte); marquer('Copié ✓'); } };
  const partager = async () => {
    if (!texte) return;
    if (navigator.share) { try { await navigator.share({ text: texte }); marquer('Partagé ✓'); } catch { /* partage annulé : rien n'est noté */ } }
    else await copier();
  };
  return (
    <div className="flex flex-col gap-3">
      <form ref={formRef} action={action} onSubmit={(e) => { setFait(null); surEnvoi(e); }} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={factureId} />
        <RetourFormulaire etat={etat} />
        <p className="text-sm">Facture payée : proposez au client de laisser un avis (une seule fois). Le message se règle dans Réglages &gt; Messages et relances.</p>
        {emailActif && email ? (
          <Bouton type="submit" name="canal" value="email" disabled={enCours}>{enCours ? 'Envoi…' : `Demander un avis par email (${email})`}</Bouton>
        ) : null}
        <Bouton type="submit" name="canal" value="lien" variante={emailActif && email ? 'secondaire' : 'principal'} disabled={enCours}>
          Préparer un message à partager (SMS, WhatsApp)
        </Bouton>
      </form>
      {texte && etat.niveau === 'demande_avis' ? (
        <div className="flex flex-col gap-2 rounded-xl border-2 border-anthracite bg-white p-3">
          <TexteLong libelle="Message de demande d’avis" nom="texte_avis" readOnly rows={7} value={texte} />
          <div className="grid grid-cols-2 gap-2">
            <Bouton type="button" variante="secondaire" onClick={copier} disabled={noteEnCours}>{fait === 'Copié ✓' ? fait : 'Copier'}</Bouton>
            <Bouton type="button" variante="secondaire" onClick={partager} disabled={noteEnCours}>{fait === 'Partagé ✓' ? fait : 'Partager (SMS…)'}</Bouton>
          </div>
          <form ref={noteRef} action={noter} onSubmit={surNote}>
            <input type="hidden" name="id" value={factureId} />
            <RetourFormulaire etat={etatNote} />
          </form>
        </div>
      ) : null}
    </div>
  );
}

/** Opposition du client aux demandes d'avis (case datée, réversible à sa demande). */
export function OppositionSollicitations({ clientId, refusLe }: { clientId: string; refusLe: string | null }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, opposerSollicitations);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-2">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="refus" value={refusLe ? 'non' : 'oui'} />
      <RetourFormulaire etat={etat} />
      <p className="text-sm">
        {refusLe ? `Le client ne veut pas recevoir de demande d’avis (noté le ${refusLe.slice(0, 10).split('-').reverse().join('/')}).`
          : 'Le client peut recevoir une demande d’avis après le paiement de sa facture.'}
      </p>
      <Bouton type="submit" variante="secondaire" disabled={enCours}>
        {refusLe ? 'Le client accepte de nouveau' : 'Le client ne veut pas être sollicité'}
      </Bouton>
    </form>
  );
}
