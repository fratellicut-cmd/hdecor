import type { InputHTMLAttributes, ReactNode } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  libelle: string;
  nom: string;
  erreur?: string;
  aide?: ReactNode;
  aVerifier?: boolean;
};

/**
 * Champ de saisie avec libellé, aide et message d'erreur reliés pour les
 * lecteurs d'écran. Hauteur ≥ 48 px. Pour les nombres, passer
 * inputMode="decimal" (clavier numérique, virgule acceptée).
 */
export function Champ({ libelle, nom, erreur, aide, aVerifier, className = '', ...props }: Props) {
  const idAide = aide ? `${nom}-aide` : undefined;
  const idErreur = erreur ? `${nom}-erreur` : undefined;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={nom} className="flex flex-wrap items-center gap-2 font-semibold">
        {libelle}
        {aVerifier ? <BadgeAVerifier /> : null}
      </label>
      <input
        id={nom}
        name={nom}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={[idAide, idErreur].filter(Boolean).join(' ') || undefined}
        className={`min-h-12 rounded-xl border-2 bg-white px-3 text-base ${erreur ? 'border-danger' : 'border-trait'} focus:border-anthracite`}
        {...props}
      />
      {aide ? <p id={idAide} className="text-sm text-encre-douce">{aide}</p> : null}
      {erreur ? <p id={idErreur} className="text-sm font-semibold text-danger">{erreur}</p> : null}
    </div>
  );
}

/** Marque visible de toute donnée non confirmée (règle « À VÉRIFIER »). */
export function BadgeAVerifier({ texte = 'À VÉRIFIER' }: { texte?: string }) {
  return (
    <span className="rounded-md border border-alerte bg-alerte-fond px-2 py-0.5 text-xs font-bold tracking-wide text-alerte">
      {texte}
    </span>
  );
}
