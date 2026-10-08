import type { z } from 'zod';

/** État renvoyé par une Server Action à son formulaire (useActionState). */
export type EtatFormulaire = {
  message?: string;
  succes?: string;
  erreurs?: Record<string, string>;
  valeurs?: Record<string, string>;
  /** Fiche existante qui ressemble à la saisie (création d'un client). */
  doublon?: { id: string; nom: string };
};

export const ETAT_INITIAL: EtatFormulaire = {};

/** Première erreur zod par champ, en français, pour l'affichage. */
export function erreursParChamp(erreur: z.ZodError): Record<string, string> {
  const res: Record<string, string> = {};
  for (const issue of erreur.issues) {
    const cle = issue.path.join('.') || '_';
    if (!res[cle]) res[cle] = issue.message;
  }
  return res;
}

/** Valeurs texte d'un FormData (pour réafficher la saisie après erreur). */
export function valeursTexte(formData: FormData, sauf: string[] = []): Record<string, string> {
  const res: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === 'string' && !sauf.includes(k) && !k.startsWith('$')) res[k] = v;
  }
  return res;
}
