'use client';

import { useState, type ChangeEvent } from 'react';
import { ajouterDocument, ajouterPhotos, modifierPhoto } from '@/app/(app)/chantiers/documents-actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde } from '@/components/formulaire/MessagesGarde';
import { reduirePhoto } from '@/components/formulaire/reduirePhoto';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher, Selection } from '@/components/ui/Autres';
import { LIBELLES_DOCUMENT, LIBELLES_MOMENT, MOMENTS_PHOTO, PHOTOS_PAR_ENVOI, TAILLE_MAX_ENVOI, TYPES_DOCUMENT } from '@/lib/validation/documents';

type Option = { id: string; libelle: string };

const taille = (o: number) => (o >= 1_048_576 ? `${(o / 1_048_576).toFixed(1).replace('.', ',')} Mo` : `${Math.ceil(o / 1024)} Ko`);

/** Choix de photos : réduites (1600 px) et réencodées en JPEG dans le navigateur, sans métadonnées. */
function ChoixPhotos({ erreur }: { erreur?: string }) {
  const [etat, setEtat] = useState<{ texte: string; trop: boolean } | null>(null);
  const choisir = async (e: ChangeEvent<HTMLInputElement>) => {
    const champ = e.currentTarget;
    const liste = Array.from(champ.files ?? []);
    if (!liste.length) { setEtat(null); return; }
    if (liste.length > PHOTOS_PAR_ENVOI) {
      setEtat({ texte: `${liste.length} photos choisies : ${PHOTOS_PAR_ENVOI} au maximum par envoi.`, trop: true });
      return;
    }
    setEtat({ texte: 'Préparation des photos…', trop: false });
    const reduites = await Promise.all(liste.map((f) => reduirePhoto(f, true)));
    const dt = new DataTransfer();
    for (const f of reduites) dt.items.add(f);
    champ.files = dt.files;
    const total = reduites.reduce((a, f) => a + f.size, 0);
    const trop = total > TAILLE_MAX_ENVOI;
    setEtat({ texte: trop ? `Trop lourd (${taille(total)}) : choisissez moins de photos.` : `${reduites.length} photo${reduites.length > 1 ? 's' : ''} prête${reduites.length > 1 ? 's' : ''} (${taille(total)}).`, trop });
  };
  return (
    <div className="flex flex-col gap-1">
      <label className="inline-flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-anthracite px-4 text-center font-semibold">
        <input type="file" name="photos" accept="image/*" multiple onChange={choisir} className="sr-only" aria-invalid={erreur ? true : undefined} />
        {etat ? 'Changer les photos' : 'Prendre ou choisir des photos'}
      </label>
      {etat ? <p className={`text-sm ${etat.trop ? 'font-semibold text-danger' : 'text-encre-douce'}`}>{etat.texte}</p> : null}
      {erreur ? <p role="alert" className="text-sm font-semibold text-danger">{erreur}</p> : null}
    </div>
  );
}

export function FormulairePhotos({ chantierId, pieces, moment = 'avant' }: { chantierId: string; pieces: Option[]; moment?: string }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(null, ajouterPhotos, { viderApresSucces: true });
  const e = etat.erreurs ?? {};
  const sv = etat.succes ? undefined : etat.valeurs;
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="chantier_id" value={chantierId} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <ChoixPhotos erreur={e.photos} />
      <div className="grid grid-cols-2 gap-3">
        <Selection libelle="Moment" nom="moment" defaultValue={sv?.moment ?? moment} erreur={e.moment}>
          {MOMENTS_PHOTO.map((m) => <option key={m} value={m}>{LIBELLES_MOMENT[m]}</option>)}
        </Selection>
        <Selection libelle="Pièce" nom="piece_id" defaultValue={sv?.piece_id ?? ''} erreur={e.piece_id}>
          <option value="">Tout le chantier</option>
          {pieces.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
        </Selection>
      </div>
      <Champ libelle="Légende (facultatif)" nom="legende" defaultValue={sv?.legende ?? ''} erreur={e.legende} placeholder="Exemple : mur fissuré côté fenêtre" />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Envoi…' : 'Ajouter les photos'}</Bouton>
    </form>
  );
}

export type PhotoSaisie = { id: string; moment: string; piece_id: string; legende: string; en_galerie: boolean };

export function FormulaireModifierPhoto({ photo, pieces }: { photo: PhotoSaisie; pieces: Option[] }) {
  const { etat, action, enCours, formRef, surEnvoi } = useFormulaire(null, modifierPhoto);
  const e = etat.erreurs ?? {};
  const v = (k: keyof PhotoSaisie) => etat.valeurs?.[k] ?? String(photo[k] ?? '');
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="id" value={photo.id} />
      <RetourFormulaire etat={etat} />
      <div className="grid grid-cols-2 gap-3">
        <Selection libelle="Moment" nom="moment" defaultValue={v('moment')} erreur={e.moment}>
          {MOMENTS_PHOTO.map((m) => <option key={m} value={m}>{LIBELLES_MOMENT[m]}</option>)}
        </Selection>
        <Selection libelle="Pièce" nom="piece_id" defaultValue={v('piece_id')} erreur={e.piece_id}>
          <option value="">Tout le chantier</option>
          {pieces.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
        </Selection>
      </div>
      <Champ libelle="Légende (facultatif)" nom="legende" defaultValue={v('legende')} erreur={e.legende} />
      <CaseACocher nom="en_galerie" libelle="Dans la galerie avant / après" defaultChecked={etat.valeurs ? etat.valeurs.en_galerie === 'on' : photo.en_galerie} />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Un instant…' : 'Enregistrer'}</Bouton>
    </form>
  );
}

export function FormulaireDocument({ chantierId }: { chantierId: string }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire(null, ajouterDocument, { viderApresSucces: true });
  const e = etat.erreurs ?? {};
  const sv = etat.succes ? undefined : etat.valeurs;
  const [nomFichier, setNomFichier] = useState<string | null>(null);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="chantier_id" value={chantierId} />
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <label className="inline-flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-anthracite px-4 text-center font-semibold">
        <input type="file" name="fichier" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only"
          onChange={(ev) => setNomFichier(ev.currentTarget.files?.[0]?.name ?? null)} aria-invalid={e.fichier ? true : undefined} />
        {nomFichier ? `Fichier : ${nomFichier}` : 'Choisir un PDF ou une photo'}
      </label>
      {e.fichier ? <p role="alert" className="text-sm font-semibold text-danger">{e.fichier}</p> : null}
      <Selection libelle="Type" nom="type" defaultValue={sv?.type ?? 'fiche_technique'} erreur={e.type}>
        {TYPES_DOCUMENT.map((t) => <option key={t} value={t}>{LIBELLES_DOCUMENT[t]}</option>)}
      </Selection>
      <Champ libelle="Nom" nom="nom" defaultValue={sv?.nom ?? ''} erreur={e.nom} placeholder="Exemple : fiche technique de la peinture du séjour" />
      <Bouton type="submit" variante="secondaire" disabled={enCours}>{enCours ? 'Envoi…' : 'Ajouter le document'}</Bouton>
    </form>
  );
}
