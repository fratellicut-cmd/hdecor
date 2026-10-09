/**
 * CSV pour Excel en français : séparateur « ; » (« , » accepté à la lecture),
 * guillemets doublés, BOM UTF-8, lignes CRLF.
 */

export class ErreurCsv extends Error {}

/** Taille maximale d'un fichier importé (1 Mo : environ 5 000 produits). */
export const TAILLE_MAX_CSV = 1_000_000;

/**
 * Cellule CSV. Protection contre l'injection de formule : une valeur commençant
 * par = + - @ tabulation ou retour chariot est préfixée d'une apostrophe, sauf
 * un nombre ou un numéro de téléphone (chiffres, espaces, points, virgule, « + » initial).
 */
export function celluleCsv(valeur: string | null | undefined): string {
  let v = valeur ?? '';
  if (/^[=+\-@\t\r]/.test(v) && !/^[+-]?[\d\s.,]+$/.test(v)) v = `'${v}`;
  return /[";\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Fichier CSV complet : BOM UTF-8 (accents corrects dans Excel), lignes CRLF. */
export function fichierCsv(entetes: string[], lignes: (string | null | undefined)[][]): string {
  return `﻿${[entetes, ...lignes].map((l) => l.map(celluleCsv).join(';')).join('\r\n')}\r\n`;
}

/**
 * Lit un CSV (RFC 4180) : guillemets, guillemets doublés, retours à la ligne
 * dans une cellule, BOM, CRLF ou LF. Séparateur détecté sur la première ligne
 * (« ; » d'Excel en français, sinon « , »). Les lignes entièrement vides sont ignorées.
 * L'apostrophe de protection ajoutée à l'export (« '=… ») est retirée.
 */
export function lireCsv(texte: string): string[][] {
  if (texte.length > TAILLE_MAX_CSV) throw new ErreurCsv('Fichier trop volumineux (1 Mo au maximum).');
  const t = texte.replace(/^﻿/, '');
  const premiere = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = premiere.split(';').length >= premiere.split(',').length ? ';' : ',';
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let cellule = '';
  let guillemets = false;
  let citee = false;
  const finCellule = () => {
    ligne.push(citee ? cellule : cellule.trim());
    cellule = '';
    citee = false;
  };
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i]!;
    if (guillemets) {
      if (c === '"') {
        if (t[i + 1] === '"') { cellule += '"'; i += 1; } else guillemets = false;
      } else cellule += c;
    } else if (c === '"' && cellule.trim() === '') { guillemets = true; citee = true; cellule = ''; }
    else if (c === sep) finCellule();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i += 1;
      finCellule();
      lignes.push(ligne);
      ligne = [];
    } else cellule += c;
  }
  if (guillemets) throw new ErreurCsv('Guillemet non refermé : vérifiez le fichier.');
  if (cellule !== '' || ligne.length) { finCellule(); lignes.push(ligne); }
  return lignes
    .filter((l) => l.some((v) => v.trim() !== ''))
    .map((l) => l.map((v) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v)));
}

/**
 * Décode un fichier CSV : UTF-8 (avec ou sans BOM) si l'octet le permet,
 * sinon Windows-1252, l'encodage du « CSV (séparateur : point-virgule) »
 * d'Excel en français. Jamais de caractère remplacé en silence.
 */
export function decoderCsv(octets: Uint8Array): { texte: string; encodage: 'UTF-8' | 'Windows-1252' } {
  try {
    return { texte: new TextDecoder('utf-8', { fatal: true }).decode(octets), encodage: 'UTF-8' };
  } catch {
    return { texte: new TextDecoder('windows-1252').decode(octets), encodage: 'Windows-1252' };
  }
}
