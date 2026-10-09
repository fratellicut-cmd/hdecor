'use client';

import { useState } from 'react';
import { ajouterElement, ajouterOuverture, dupliquerPiece } from '@/app/(app)/chantiers/actions';
import type { EtatFormulaire } from '@/lib/etat-formulaire';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { Selection } from '@/components/ui/Autres';

/**
 * Suit les retours de l'action pendant le rendu (sans effet) : après un ajout
 * réussi, l'état qui pilote l'affichage revient au départ ; après une erreur,
 * il reprend la saisie renvoyée. React réinitialise le formulaire après chaque
 * envoi : les listes, non contrôlées, sont remontées (clé « tour ») avec la
 * bonne valeur par défaut, sinon elles reviendraient à leur première valeur.
 */
function useSuiviEtat(etat: EtatFormulaire, surSucces: () => void, surValeurs: (v: Record<string, string>) => void) {
  const [vu, setVu] = useState(etat);
  const [tour, setTour] = useState(0);
  if (vu !== etat) {
    setVu(etat);
    setTour(tour + 1);
    if (etat.succes) surSucces();
    else if (etat.valeurs) surValeurs(etat.valeurs);
  }
  return tour;
}

/** Ajout d'une ouverture : porte pré-remplie aux dimensions par défaut (paramètres). */
export function FormulaireOuverture({ pieceId, porte }: { pieceId: string; porte: { largeurCm: string; hauteurCm: string } }) {
  const { etat, action, enCours, formRef, garde } = useFormulaire(`ouverture:${pieceId}`, ajouterOuverture);
  const [type, setType] = useState('porte');
  const [parSurface, setParSurface] = useState(false);
  const tour = useSuiviEtat(etat, () => { setType('porte'); setParSurface(false); }, (v) => {
    if (v.type) setType(v.type);
    setParSurface(Boolean(v.surface_directe_mm2));
  });
  const e = etat.erreurs ?? {};
  const v = etat.succes ? {} : (etat.valeurs ?? {});
  return (
    // React vide le formulaire après un envoi réussi : prêt pour l'ouverture suivante.
    <form ref={formRef} action={action} onSubmit={garde.surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="piece_id" value={pieceId} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <Selection key={`type-${tour}`} libelle="Type" nom="type" defaultValue={type} onChange={(ev) => setType(ev.target.value)}>
        <option value="porte">Porte</option>
        <option value="fenetre">Fenêtre</option>
        <option value="baie">Baie vitrée</option>
        <option value="autre">Autre ouverture</option>
      </Selection>
      <label className="flex min-h-12 items-center gap-3 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-or-fonce">
        <input type="checkbox" checked={parSurface} onChange={(ev) => setParSurface(ev.target.checked)} className="h-6 w-6 accent-anthracite" />
        Saisir directement la surface (m²)
      </label>
      {parSurface ? (
        <Champ libelle="Surface (m²)" nom="surface_directe_mm2" inputMode="decimal" defaultValue={v.surface_directe_mm2} erreur={e.surface_directe_mm2} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Champ key={`l-${type}`} libelle="Largeur (cm)" nom="largeur_mm" inputMode="decimal" erreur={e.largeur_mm}
            defaultValue={v.largeur_mm ?? (type === 'porte' ? porte.largeurCm : '')} />
          <Champ key={`h-${type}`} libelle="Hauteur (cm)" nom="hauteur_mm" inputMode="decimal" erreur={e.hauteur_mm}
            defaultValue={v.hauteur_mm ?? (type === 'porte' ? porte.hauteurCm : '')} />
        </div>
      )}
      <Champ libelle="Quantité" nom="quantite" inputMode="numeric" defaultValue={v.quantite ?? '1'} erreur={e.quantite} />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Ajout…' : 'Ajouter l’ouverture'}</Bouton>
    </form>
  );
}

const UNITE_PAR_TYPE: Record<string, string> = {
  plinthe: 'ml', corniche: 'ml', porte: 'u', fenetre: 'u', radiateur: 'u', volet: 'u', escalier: 'm2', rambarde: 'ml', facade: 'm2', autre: 'm2',
};

export function FormulaireElement({ pieceId }: { pieceId: string }) {
  const { etat, action, enCours, formRef, garde } = useFormulaire(`element:${pieceId}`, ajouterElement);
  const [type, setType] = useState('plinthe');
  const [unite, setUnite] = useState('ml');
  const tour = useSuiviEtat(etat, () => { setType('plinthe'); setUnite('ml'); }, (v) => {
    if (v.type) setType(v.type);
    if (v.unite) setUnite(v.unite);
  });
  const e = etat.erreurs ?? {};
  const v = etat.succes ? {} : (etat.valeurs ?? {});
  return (
    <form ref={formRef} action={action} onSubmit={garde.surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="piece_id" value={pieceId} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <div className="grid grid-cols-2 gap-3">
        <Selection key={`type-${tour}`} libelle="Élément" nom="type" defaultValue={type} onChange={(ev) => { setType(ev.target.value); setUnite(UNITE_PAR_TYPE[ev.target.value] ?? 'u'); }}>
          <option value="plinthe">Plinthes</option>
          <option value="corniche">Corniches</option>
          <option value="porte">Portes à peindre</option>
          <option value="fenetre">Fenêtres à peindre</option>
          <option value="radiateur">Radiateurs</option>
          <option value="volet">Volets</option>
          <option value="escalier">Escalier</option>
          <option value="rambarde">Rambarde</option>
          <option value="facade">Façade (pan de mur)</option>
          <option value="autre">Autre</option>
        </Selection>
        <Selection key={`unite-${tour}-${type}`} libelle="Compté en" nom="unite" defaultValue={unite} onChange={(ev) => setUnite(ev.target.value)}>
          <option value="ml">mètres linéaires</option>
          <option value="m2">m²</option>
          <option value="u">unités</option>
        </Selection>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle={`Quantité (${unite === 'ml' ? 'm' : unite === 'm2' ? 'm²' : 'u'})`} nom="quantite_e4" inputMode="decimal" defaultValue={v.quantite_e4} erreur={e.quantite_e4} />
        <Selection libelle="Faces peintes" nom="faces" defaultValue={v.faces ?? '1'}>
          <option value="1">1 face</option>
          <option value="2">2 faces</option>
        </Selection>
      </div>
      {unite === 'ml' ? (
        <Champ libelle="Largeur développée à peindre (cm)" nom="developpe_mm" inputMode="decimal" defaultValue={v.developpe_mm} erreur={e.developpe_mm}
          aide="Ex. hauteur de la plinthe. Nécessaire pour calculer la peinture." />
      ) : null}
      {unite === 'u' ? (
        <Champ libelle="Surface à peindre d’une unité (m²)" nom="surface_unitaire_mm2" inputMode="decimal" defaultValue={v.surface_unitaire_mm2}
          erreur={e.surface_unitaire_mm2} aide="Ex. porte 83 × 204 cm : 1,69 m² par face. Nécessaire pour calculer la peinture." />
      ) : null}
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Ajout…' : 'Ajouter l’élément'}</Bouton>
    </form>
  );
}

export function FormulaireDuplication({ pieceId, chantierId, nom }: { pieceId: string; chantierId: string; nom: string }) {
  const { etat, action, enCours, formRef, garde } = useFormulaire(null, dupliquerPiece);
  return (
    <form ref={formRef} action={action} onSubmit={garde.surEnvoi} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={pieceId} />
      <input type="hidden" name="chantier_id" value={chantierId} />
      <RetourFormulaire etat={etat} />
      <Champ libelle="Nom de la copie" nom="nom" defaultValue={etat.valeurs?.nom ?? `${nom} (copie)`} erreur={etat.erreurs?.nom} />
      <RappelEnvoi garde={garde} etat={etat} sansBrouillon />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Copie…' : 'Dupliquer la pièce'}</Bouton>
    </form>
  );
}
