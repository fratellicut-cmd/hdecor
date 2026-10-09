'use client';

import { useCallback, useEffect, useState } from 'react';
import { enregistrerPiece } from '@/app/(app)/chantiers/actions';
import { calculerSurfacesPiece, ErreurMetre, formaterLongueur, formaterSurface } from '@/domain/metre';
import { lireLongueurMm, lireSurfaceMm2, longueurVersSaisie, surfaceVersSaisie } from '@/domain/saisie';
import { MURS_MAX } from '@/lib/validation/chantiers';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { Selection, TexteLong } from '@/components/ui/Autres';

export type PieceSaisie = {
  id?: string; nom: string; etage: string | null; mode_saisie: string; longueur_mm: number | null; largeur_mm: number | null;
  murs_mm: number[] | null; surface_sol_mm2: number | null; hauteur_mm: number; multiplicateur: number;
  etat_support: string | null; notes: string | null; updated_at?: string;
};

type Apercu = { texte: string[]; erreur: string | null };

/** Aperçu immédiat des surfaces (avant ouvertures), calculé comme sur le serveur. */
function apercu(form: HTMLFormElement): Apercu {
  const f = new FormData(form);
  const mode = f.get('mode_saisie') === 'murs' ? 'murs' : 'rectangle';
  const h = lireLongueurMm(String(f.get('hauteur_mm') ?? ''), 'm');
  const mult = Number(f.get('multiplicateur')) || 1;
  if (h === null) return { texte: [], erreur: 'Saisissez la hauteur sous plafond.' };
  try {
    if (mode === 'rectangle') {
      const l = lireLongueurMm(String(f.get('longueur_mm') ?? ''), 'm');
      const w = lireLongueurMm(String(f.get('largeur_mm') ?? ''), 'm');
      if (l === null || w === null) return { texte: [], erreur: 'Saisissez la longueur et la largeur.' };
      const s = calculerSurfacesPiece({ modeSaisie: 'rectangle', longueurMm: l, largeurMm: w, hauteurMm: h, multiplicateur: mult });
      return { texte: [`Périmètre ${formaterLongueur(s.perimetreMm)}`, `Murs bruts ${formaterSurface(s.mursBrutsMm2)}`, `Plafond ${formaterSurface(s.plafondMm2!)}`], erreur: null };
    }
    const nb = Number(f.get('nb_murs')) || 0;
    const murs = Array.from({ length: nb }, (_, i) => lireLongueurMm(String(f.get(`mur_${i + 1}`) ?? ''), 'm'));
    if (murs.some((m) => m === null)) return { texte: [], erreur: 'Saisissez la longueur de chaque mur.' };
    const sol = String(f.get('surface_sol_mm2') ?? '').trim();
    const s = calculerSurfacesPiece({ modeSaisie: 'murs', mursMm: murs as number[], hauteurMm: h, multiplicateur: mult, surfaceSolMm2: sol ? lireSurfaceMm2(sol) : null });
    return { texte: [`Périmètre ${formaterLongueur(s.perimetreMm)}`, `Murs bruts ${formaterSurface(s.mursBrutsMm2)}`,
      s.plafondMm2 === null ? 'Plafond : saisissez la surface au sol' : `Plafond ${formaterSurface(s.plafondMm2)}`], erreur: null };
  } catch (e) {
    return { texte: [], erreur: e instanceof ErreurMetre ? e.message : 'Saisie incomplète.' };
  }
}

export function FormulairePiece({ chantierId, piece }: { chantierId: string; piece: PieceSaisie }) {
  const { etat, action, enCours, formRef, garde } = useFormulaire(`piece:${piece.id ?? `nouvelle:${chantierId}`}`, enregistrerPiece,
    { version: piece.id ? (piece.updated_at ?? null) : undefined });
  const e = etat.erreurs ?? {};
  const v = (cle: string, defaut: string) => etat.valeurs?.[cle] ?? defaut;
  const [mode, setMode] = useState(v('mode_saisie', piece.mode_saisie));
  const [nbMurs, setNbMurs] = useState(Number(v('nb_murs', String(piece.murs_mm?.length ?? 4))));
  const [resume, setResume] = useState<Apercu>({ texte: [], erreur: null });

  const recalculer = useCallback(() => { if (formRef.current) setResume(apercu(formRef.current)); }, [formRef]);
  // Aperçu initial (valeurs déjà enregistrées) : lecture du formulaire après montage.
  useEffect(() => { recalculer(); }, [recalculer, mode, nbMurs]);

  return (
    <form ref={formRef} action={action} onSubmit={garde.surEnvoi} onInput={recalculer} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="chantier_id" value={chantierId} />
      {piece.id ? <input type="hidden" name="id" value={piece.id} /> : null}
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />

      <Champ libelle="Nom de la pièce" nom="nom" defaultValue={v('nom', piece.nom)} required erreur={e.nom} placeholder="Chambre 1, Séjour…" />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="Étage" nom="etage" defaultValue={v('etage', piece.etage ?? '')} erreur={e.etage} placeholder="RDC, 1er…" />
        <Champ libelle="Pièces identiques" nom="multiplicateur" inputMode="numeric" defaultValue={v('multiplicateur', String(piece.multiplicateur))}
          erreur={e.multiplicateur} aide="Ex. 3 chambres identiques." />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Forme de la pièce</legend>
        <div className="grid grid-cols-2 gap-2">
          {([['rectangle', 'Rectangle'], ['murs', 'Mur par mur']] as const).map(([m, l]) => (
            <label key={m} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 px-3 font-semibold ${mode === m ? 'border-anthracite bg-anthracite text-creme' : 'border-trait bg-white'}`}>
              <input type="radio" name="mode_saisie" value={m} defaultChecked={mode === m} onChange={() => setMode(m)} className="sr-only" />
              {l}
            </label>
          ))}
        </div>
      </fieldset>

      <div hidden={mode !== 'rectangle'} className="grid grid-cols-2 gap-3">
        <Champ libelle="Longueur (m)" nom="longueur_mm" inputMode="decimal" defaultValue={v('longueur_mm', longueurVersSaisie(piece.longueur_mm, 'm'))} erreur={e.longueur_mm} placeholder="4,00" />
        <Champ libelle="Largeur (m)" nom="largeur_mm" inputMode="decimal" defaultValue={v('largeur_mm', longueurVersSaisie(piece.largeur_mm, 'm'))} erreur={e.largeur_mm} placeholder="3,00" />
      </div>

      <div hidden={mode !== 'murs'} className="flex flex-col gap-3">
        <Selection libelle="Nombre de murs" nom="nb_murs" value={String(nbMurs)} onChange={(ev) => setNbMurs(Number(ev.target.value))} erreur={e.nb_murs}>
          {Array.from({ length: MURS_MAX - 2 }, (_, i) => i + 3).map((n) => <option key={n} value={n}>{n}</option>)}
        </Selection>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: nbMurs }, (_, i) => (
            <Champ key={i} libelle={`Mur ${i + 1} (m)`} nom={`mur_${i + 1}`} inputMode="decimal" erreur={e[`mur_${i + 1}`]}
              defaultValue={v(`mur_${i + 1}`, longueurVersSaisie(piece.murs_mm?.[i] ?? null, 'm'))} />
          ))}
        </div>
        <Champ libelle="Surface au sol (m²)" nom="surface_sol_mm2" inputMode="decimal" erreur={e.surface_sol_mm2}
          defaultValue={v('surface_sol_mm2', surfaceVersSaisie(piece.surface_sol_mm2))} aide="Pour calculer le plafond d’une pièce non rectangulaire." />
      </div>

      <Champ libelle="Hauteur sous plafond (m)" nom="hauteur_mm" inputMode="decimal" defaultValue={v('hauteur_mm', longueurVersSaisie(piece.hauteur_mm, 'm'))}
        erreur={e.hauteur_mm} placeholder="2,50" aide="En mètres (2,50) ; « 250 cm » est aussi accepté." />

      <div role="status" aria-live="polite" className="rounded-xl border-2 border-trait bg-white p-3">
        <p className="text-sm font-semibold text-encre-douce">Aperçu (avant déduction des ouvertures)</p>
        {resume.erreur ? <p className="text-encre-douce">{resume.erreur}</p> : <p className="font-semibold tabular-nums">{resume.texte.join(' · ')}</p>}
      </div>

      <Champ libelle="État du support" nom="etat_support" defaultValue={v('etat_support', piece.etat_support ?? '')} erreur={e.etat_support} placeholder="Fissures, humidité, ancienne peinture…" />
      <TexteLong libelle="Notes" nom="notes" defaultValue={v('notes', piece.notes ?? '')} erreur={e.notes} />
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer la pièce'}</Bouton>
    </form>
  );
}
