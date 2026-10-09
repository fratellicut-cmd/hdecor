import 'server-only';
import { rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Outils communs aux PDF (A4, polices standard). Jeu de caractères WinAnsi :
 * tout caractère hors de ce jeu est remplacé explicitement (jamais supprimé en
 * silence) : espace fine -> espace, « ≈ » -> « env. », « ² » est conservé.
 */
const REMPLACEMENTS: Record<string, string> = {
  '\u202f': ' ', '\u00a0': ' ', '\u2009': ' ', '≈': 'env.', '⚠': '!', '→': '->', '−': '-', '\u2011': '-',
};

export function texteSur(font: PDFFont, t: string): string {
  const jeu = new Set(font.getCharacterSet());
  return Array.from(t, (c) => REMPLACEMENTS[c] ?? (jeu.has(c.codePointAt(0)!) ? c : '?')).join('');
}

export const A4 = { l: 595.28, h: 841.89 };
export const MARGE = 40;
export const ANTHRACITE = rgb(0.12, 0.12, 0.12);
export const GRIS = rgb(0.29, 0.29, 0.29);
export const GRIS_CLAIR = rgb(0.85, 0.85, 0.85);
export const ALERTE = rgb(0.48, 0.29, 0);
export const DORE = rgb(0.72, 0.53, 0.04);

export type Contexte = { doc: PDFDocument; page: PDFPage; y: number; normal: PDFFont; gras: PDFFont; italique: PDFFont; basPage: number };

export function nouvellePage(c: Contexte) {
  c.page = c.doc.addPage([A4.l, A4.h]);
  c.y = A4.h - MARGE;
}

/** Texte coupé en lignes à la largeur donnée (les retours à la ligne saisis sont gardés). */
export function couper(font: PDFFont, t: string, taille: number, largeur: number): string[] {
  const lignes: string[] = [];
  for (const paragraphe of texteSur(font, t).split(/\r?\n/)) {
    let courante = '';
    for (const m of paragraphe.split(/[ \t]+/)) {
      const essai = courante ? `${courante} ${m}` : m;
      if (font.widthOfTextAtSize(essai, taille) <= largeur || !courante) courante = essai;
      else { lignes.push(courante); courante = m; }
    }
    lignes.push(courante);
  }
  return lignes;
}

export type OptionsTexte = { taille?: number; gras?: boolean; italique?: boolean; x?: number; largeur?: number; couleur?: ReturnType<typeof rgb> };

export function police(c: Contexte, o: OptionsTexte): PDFFont {
  return o.gras ? c.gras : o.italique ? c.italique : c.normal;
}

/** Écrit un paragraphe à la position courante ; change de page si besoin. */
export function ecrire(c: Contexte, t: string, opts: OptionsTexte = {}) {
  const taille = opts.taille ?? 10;
  const font = police(c, opts);
  const x = opts.x ?? MARGE;
  for (const ligne of couper(font, t, taille, opts.largeur ?? A4.l - x - MARGE)) {
    if (c.y < c.basPage + taille) nouvellePage(c);
    c.page.drawText(ligne, { x, y: c.y - taille, size: taille, font, color: opts.couleur ?? ANTHRACITE });
    c.y -= taille + 3;
  }
}

/** Texte aligné à droite (une ligne). */
export function aDroite(page: PDFPage, font: PDFFont, t: string, xDroite: number, y: number, taille: number, couleur = ANTHRACITE) {
  const s = texteSur(font, t);
  page.drawText(s, { x: xDroite - font.widthOfTextAtSize(s, taille), y, size: taille, font, color: couleur });
}

export function trait(c: Contexte, epaisseur = 0.5, couleur = GRIS) {
  c.page.drawLine({ start: { x: MARGE, y: c.y }, end: { x: A4.l - MARGE, y: c.y }, thickness: epaisseur, color: couleur });
}

/** Garantit `hauteur` points libres avant le bas de page. */
export function place(c: Contexte, hauteur: number): boolean {
  if (c.y - hauteur < c.basPage) { nouvellePage(c); return true; }
  return false;
}
