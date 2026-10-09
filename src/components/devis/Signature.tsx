'use client';

import { useEffect, useRef, useState } from 'react';
import type { EtatFormulaire } from '@/lib/etat-formulaire';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { AlerteHorsLigne } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher } from '@/components/ui/Autres';

/**
 * Cadre de signature au doigt (événements « pointer » : doigt, stylet, souris).
 * Le tracé est envoyé en PNG (champ caché « image ») ; le serveur le contrôle.
 */
function PadSignature({ erreur }: { erreur?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const [vide, setVide] = useState(true);
  const dessin = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1F1F1F';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const debut = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dessin.current = true;
    const ctx = e.currentTarget.getContext('2d')!;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
  };
  const trace = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dessin.current) return;
    const ctx = e.currentTarget.getContext('2d')!;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const fin = () => {
    if (!dessin.current) return;
    dessin.current = false;
    setVide(false);
    champ.current!.value = canvas.current!.toDataURL('image/png');
  };
  const effacer = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    champ.current!.value = '';
    setVide(true);
  };

  return (
    <div className="flex flex-col gap-1">
      <p id="libelle-signature" className="font-semibold">Signature</p>
      <canvas ref={canvas} aria-labelledby="libelle-signature" role="img"
        className={`h-44 w-full touch-none rounded-xl border-2 bg-white ${erreur ? 'border-danger' : 'border-anthracite'}`}
        onPointerDown={debut} onPointerMove={trace} onPointerUp={fin} onPointerCancel={fin} onPointerLeave={fin} />
      <input ref={champ} type="hidden" name="image" aria-invalid={erreur ? true : undefined} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-encre-douce">{vide ? 'Signez avec le doigt dans le cadre.' : 'Signature tracée.'}</p>
        <Bouton type="button" variante="discret" onClick={effacer}>Effacer</Bouton>
      </div>
      {erreur ? <p className="text-sm font-semibold text-danger">{erreur}</p> : null}
    </div>
  );
}

export type OptionASigner = { id: string; designation: string; montant: string };

export function FormulaireSignature({ action, champs, documentSha256, options, nomParDefaut, lienPdf }: {
  action: (etat: EtatFormulaire, fd: FormData) => Promise<EtatFormulaire>;
  champs: Record<string, string>;
  documentSha256: string;
  options: OptionASigner[];
  nomParDefaut: string;
  lienPdf: string;
}) {
  const { etat, action: envoyer, enCours, formRef, garde, surEnvoi } = useFormulaire(null, action);
  const e = etat.erreurs ?? {};
  return (
    <form ref={formRef} action={envoyer} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      {Object.entries(champs).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name="document_sha256" value={documentSha256} />
      <RetourFormulaire etat={etat} />
      {garde.horsLigne ? <AlerteHorsLigne sansBrouillon /> : null}
      <a href={lienPdf} target="_blank" rel="noopener" className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">
        Lire le devis (PDF)
      </a>
      {options.length ? (
        <fieldset className="flex flex-col gap-1 rounded-xl border-2 border-trait bg-white p-3">
          <legend className="px-1 font-semibold">Options à retenir (facultatif)</legend>
          {options.map((o) => (
            <CaseACocher key={o.id} nom="options" valeur={o.id} libelle={`${o.designation} : ${o.montant}`} />
          ))}
        </fieldset>
      ) : null}
      <Champ libelle="Nom et prénom du signataire" nom="nom" defaultValue={etat.valeurs?.nom ?? nomParDefaut} erreur={e.nom} autoComplete="name" />
      <Champ libelle="Écrivez « Bon pour accord »" nom="mention" defaultValue={etat.valeurs?.mention ?? ''} erreur={e.mention} autoComplete="off" />
      <PadSignature erreur={e.image} />
      <CaseACocher nom="lu" libelle="J’ai lu le devis et je l’accepte" erreur={e.lu} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Signature…' : 'Signer le devis'}</Bouton>
    </form>
  );
}
