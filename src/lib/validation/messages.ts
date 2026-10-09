import { z } from 'zod';
import { caseACocher, entier, texteObligatoire } from './champs';

export const CODES_MESSAGES = ['envoi_devis', 'relance_devis', 'envoi_facture', 'impaye_1', 'impaye_2', 'impaye_3'] as const;
export type CodeMessage = (typeof CODES_MESSAGES)[number];

/** Champs remplacés à l'envoi, par modèle (un champ inconnu resterait tel quel dans l'email : refusé). */
export const CHAMPS_MESSAGES: Record<CodeMessage, readonly string[]> = {
  envoi_devis: ['client', 'entreprise', 'numero', 'lien', 'valide_jusqu_au'],
  relance_devis: ['client', 'entreprise', 'numero', 'lien', 'valide_jusqu_au'],
  envoi_facture: ['client', 'entreprise', 'numero', 'lien', 'montant', 'echeance'],
  impaye_1: ['client', 'entreprise', 'numero', 'lien', 'montant', 'echeance'],
  impaye_2: ['client', 'entreprise', 'numero', 'lien', 'montant', 'echeance'],
  impaye_3: ['client', 'entreprise', 'numero', 'lien', 'montant', 'echeance'],
};

export const estRelanceImpaye = (code: CodeMessage) => code.startsWith('impaye_');

const champsUtilises = (t: string) => [...t.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]!);

export function schemaModeleMessage(code: CodeMessage) {
  const permis = CHAMPS_MESSAGES[code];
  const inconnus = (t: string) => champsUtilises(t).filter((c) => !permis.includes(c));
  const verifier = (libelle: string, max: number) => texteObligatoire(libelle, max)
    .refine((t) => inconnus(t).length === 0, { error: `Champ inconnu entre accolades. Champs possibles : ${permis.map((c) => `{${c}}`).join(', ')}.` });
  return z.object({
    sujet: verifier('Objet', 200),
    corps: verifier('Message', 5000).refine((t) => t.includes('{lien}'), { error: 'Le message doit contenir {lien} (le lien vers le document).' }),
    delai_jours: estRelanceImpaye(code) ? entier(1, 365, 'Délai') : z.unknown().transform(() => undefined),
    actif: estRelanceImpaye(code) ? caseACocher : z.unknown().transform(() => undefined),
  });
}

/** Délais des rappels strictement croissants (1er < 2e < dernier) : null si c'est le cas, sinon le message. */
export function controlerDelaisRelances(delais: Partial<Record<'impaye_1' | 'impaye_2' | 'impaye_3', number>>): string | null {
  const [a, b, c] = [delais.impaye_1, delais.impaye_2, delais.impaye_3];
  if (a !== undefined && b !== undefined && b <= a) return `Le 2e rappel doit partir après le 1er (plus de ${a} jours).`;
  if (b !== undefined && c !== undefined && c <= b) return `Le dernier rappel doit partir après le 2e (plus de ${b} jours).`;
  return null;
}
