/** Règles d'affichage et d'export des clients (fonctions pures, testées). */

type ClientNomme = {
  type: 'particulier' | 'professionnel';
  civilite: string | null;
  nom: string;
  prenom: string | null;
  raison_sociale: string | null;
  anonymise_le?: string | null;
};

/** Nom affiché : raison sociale d'un professionnel, sinon « Prénom Nom ». */
export function nomAffiche(c: ClientNomme): string {
  if (c.anonymise_le) return 'Client anonymisé';
  if (c.type === 'professionnel' && c.raison_sociale) return c.raison_sociale;
  return [c.prenom, c.nom].filter(Boolean).join(' ');
}

/** Contact d'un professionnel (personne à joindre), sinon null. */
export function contactProfessionnel(c: ClientNomme): string | null {
  if (c.type !== 'professionnel' || c.anonymise_le) return null;
  return [c.civilite, c.prenom, c.nom].filter(Boolean).join(' ') || null;
}

/** Lien « tel: » : chiffres et « + » initial uniquement. */
export function lienTelephone(telephone: string): string {
  const t = telephone.trim();
  return `tel:${t.startsWith('+') ? '+' : ''}${t.replace(/\D/g, '')}`;
}

/**
 * Cellule CSV pour Excel en français : séparateur « ; », guillemets doublés.
 * Protection contre l'injection de formule : une valeur commençant par
 * = + - @ tabulation ou retour chariot est préfixée d'une apostrophe, sauf un
 * numéro de téléphone (chiffres, espaces, points, « + » initial).
 */
export function celluleCsv(valeur: string | null | undefined): string {
  let v = valeur ?? '';
  if (/^[=+\-@\t\r]/.test(v) && !/^\+?[\d\s.]+$/.test(v)) v = `'${v}`;
  return /[";\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Fichier CSV complet : BOM UTF-8 (accents corrects dans Excel), lignes CRLF. */
export function fichierCsv(entetes: string[], lignes: (string | null | undefined)[][]): string {
  return `﻿${[entetes, ...lignes].map((l) => l.map(celluleCsv).join(';')).join('\r\n')}\r\n`;
}
