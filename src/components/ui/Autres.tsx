import { useId, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { BadgeAVerifier } from './Champ';

export function Selection({ libelle, nom, erreur, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & {
  libelle: string; nom: string; erreur?: string; children: ReactNode;
}) {
  const id = `${nom}-${useId()}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">{libelle}</label>
      <select id={id} name={nom} aria-invalid={erreur ? true : undefined}
        aria-describedby={erreur ? `${id}-erreur` : undefined}
        className="min-h-12 rounded-xl border-2 border-trait bg-white px-3 text-base" {...props}>
        {children}
      </select>
      {erreur ? <p id={`${id}-erreur`} className="text-sm font-semibold text-danger">{erreur}</p> : null}
    </div>
  );
}

export function TexteLong({ libelle, nom, erreur, aVerifier, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  libelle: string; nom: string; erreur?: string; aVerifier?: boolean;
}) {
  const id = `${nom}-${useId()}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex flex-wrap items-center gap-2 font-semibold">{libelle}{aVerifier ? <BadgeAVerifier /> : null}</label>
      <textarea id={id} name={nom} rows={3} aria-invalid={erreur ? true : undefined}
        aria-describedby={erreur ? `${id}-erreur` : undefined}
        className="rounded-xl border-2 border-trait bg-white p-3 text-base" {...props} />
      {erreur ? <p id={`${id}-erreur`} className="text-sm font-semibold text-danger">{erreur}</p> : null}
    </div>
  );
}

export function CaseACocher({ libelle, nom, valeur, erreur, ...props }: React.InputHTMLAttributes<HTMLInputElement> & {
  libelle: ReactNode; nom: string; valeur?: string; erreur?: string;
}) {
  // Identifiant unique : plusieurs cases du même nom peuvent cohabiter (une par carte).
  const id = `${nom}-${valeur ?? 'on'}-${useId()}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex min-h-12 cursor-pointer items-center gap-3">
        <input id={id} type="checkbox" name={nom} value={valeur ?? 'on'} className="h-6 w-6 accent-anthracite"
          aria-invalid={erreur ? true : undefined} aria-describedby={erreur ? `${id}-erreur` : undefined} {...props} />
        <span>{libelle}</span>
      </label>
      {erreur ? <p id={`${id}-erreur`} className="text-sm font-semibold text-danger">{erreur}</p> : null}
    </div>
  );
}
