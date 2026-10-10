'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { EtatFormulaire } from '@/lib/etat-formulaire';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { AlerteHorsLigne } from '@/components/formulaire/MessagesGarde';
import { RetourFormulaire } from '@/components/parametres/RetourFormulaire';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher } from '@/components/ui/Autres';

/** Longueur minimale du tracé (px à l'écran) : un tapotement n'est pas une signature. Le serveur revérifie l'encre. */
const LONGUEUR_MIN = 80;
/** Étendue minimale dans les deux sens (px à l'écran) : un trait droit (glissement du pouce) n'est pas une signature. */
const ETENDUE_MIN = 12;

/**
 * Cadre de signature au doigt (événements « pointer » : doigt, stylet, souris).
 * Le tracé est envoyé en PNG (champ caché « image ») ; le serveur le contrôle.
 * Si le cadre change de taille (téléphone tourné), il est remis à l'échelle et
 * vidé : on demande de signer à nouveau plutôt que de garder un tracé faux.
 */
export function PadSignature({ erreur, nom = 'image', libelle = 'Signature' }: { erreur?: string; nom?: string; libelle?: string }) {
  const idLibelle = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const [etatTrace, setEtatTrace] = useState<'vide' | 'court' | 'ok' | 'tourne'>('vide');
  const dessin = useRef(false);
  const longueur = useRef(0);
  const dernier = useRef<{ x: number; y: number } | null>(null);
  const boite = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const taille = useRef({ l: 0, h: 0 });

  useEffect(() => {
    const c = canvas.current!;
    let actif = true;
    const preparer = () => {
      // Le rappel peut arriver après le départ de la page (signature envoyée) : rien à faire.
      if (!actif || !champ.current || !c.isConnected) return;
      const l = c.clientWidth;
      const h = c.clientHeight;
      if (l === taille.current.l && h === taille.current.h) return;
      const avait = taille.current.l > 0 && longueur.current > 0;
      taille.current = { l, h };
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(l * ratio);
      c.height = Math.round(h * ratio);
      const ctx = c.getContext('2d')!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1F1F1F';
      longueur.current = 0;
      boite.current = null;
      champ.current!.value = '';
      setEtatTrace(avait ? 'tourne' : 'vide');
    };
    preparer();
    const obs = new ResizeObserver(preparer);
    obs.observe(c);
    return () => { actif = false; obs.disconnect(); };
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const etendre = (p: { x: number; y: number }) => {
    const b = boite.current;
    boite.current = b ? { x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) } : { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  };
  const debut = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dessin.current = true;
    const ctx = e.currentTarget.getContext('2d')!;
    const p = point(e);
    etendre(p);
    dernier.current = p;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
  };
  const trace = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dessin.current) return;
    const ctx = e.currentTarget.getContext('2d')!;
    const p = point(e);
    if (dernier.current) longueur.current += Math.hypot(p.x - dernier.current.x, p.y - dernier.current.y);
    dernier.current = p;
    etendre(p);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const fin = () => {
    if (!dessin.current) return;
    dessin.current = false;
    dernier.current = null;
    const b = boite.current;
    const assez = longueur.current >= LONGUEUR_MIN && !!b && Math.min(b.x1 - b.x0, b.y1 - b.y0) >= ETENDUE_MIN;
    setEtatTrace(assez ? 'ok' : 'court');
    champ.current!.value = assez ? canvas.current!.toDataURL('image/png') : '';
  };
  const effacer = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    champ.current!.value = '';
    longueur.current = 0;
    boite.current = null;
    setEtatTrace('vide');
  };
  const MESSAGES = {
    vide: 'Signez avec le doigt dans le cadre.',
    court: 'Signature trop courte ou trop simple : signez en entier dans le cadre.',
    ok: 'Signature tracée.',
    tourne: 'Le téléphone a tourné : le cadre a été vidé, signez à nouveau.',
  };

  return (
    <div className="flex flex-col gap-1">
      <p id={idLibelle} className="font-semibold">{libelle}</p>
      {/* Au-dessus du cadre : reste visible en paysage, quand le cadre occupe l'écran. */}
      <div className="flex items-center justify-between gap-2">
        <p role="status" className={`text-sm ${etatTrace === 'court' || etatTrace === 'tourne' ? 'font-semibold text-alerte' : 'text-encre-douce'}`}>{MESSAGES[etatTrace]}</p>
        <Bouton type="button" variante="discret" onClick={effacer}>Effacer</Bouton>
      </div>
      <canvas ref={canvas} aria-labelledby={idLibelle} role="img"
        className={`h-44 w-full touch-none rounded-xl border-2 bg-white ${erreur && etatTrace !== 'ok' ? 'border-danger' : 'border-anthracite'}`}
        onPointerDown={debut} onPointerMove={trace} onPointerUp={fin} onPointerCancel={fin} onPointerLeave={fin} />
      <input ref={champ} type="hidden" name={nom} aria-invalid={erreur ? true : undefined} />
      {/* Erreur du dernier envoi : masquée dès qu'une nouvelle signature est tracée. */}
      {erreur && etatTrace !== 'ok' ? <p className="text-sm font-semibold text-danger">{erreur}</p> : null}
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
  /** Lien vers le PDF à relire (absent si la page l'affiche déjà). */
  lienPdf?: string;
}) {
  const { etat, action: envoyer, enCours, formRef, garde, surEnvoi } = useFormulaire(null, action);
  const e = etat.erreurs ?? {};
  return (
    <form ref={formRef} action={envoyer} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      {Object.entries(champs).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name="document_sha256" value={documentSha256} />
      <RetourFormulaire etat={etat} />
      {garde.horsLigne ? <AlerteHorsLigne sansBrouillon /> : null}
      {lienPdf ? (
        <a href={lienPdf} target="_blank" rel="noopener" className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">
          Lire le devis (PDF)
        </a>
      ) : null}
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

/** Information du signataire au moment de la collecte (RGPD, art. 13) : données, finalité, renvoi aux détails. */
export function NoticeSignature({ entreprise, document = 'le devis signé' }: { entreprise: string; document?: string }) {
  return (
    <p className="text-sm text-encre-douce">
      Pour prouver votre accord, {entreprise || 'l’entreprise'} conserve votre nom, votre signature, la date et l’heure, l’adresse IP et le
      navigateur utilisés, avec {document}.{' '}
      <a href="/confidentialite" className="inline-flex min-h-11 items-center underline underline-offset-4">Vos données personnelles</a>
    </p>
  );
}
