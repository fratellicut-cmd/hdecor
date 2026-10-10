import 'server-only';
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { A4, ANTHRACITE, GRIS, GRIS_CLAIR, MARGE, aDroite, couper, texteSur } from './commun';
import { valeurCsv, type Tableau, type Valeur } from '@/domain/comptabilite';
import { formaterDate, formaterEuros } from '@/domain/formats';

/** Page paysage : les registres ont jusqu'à dix colonnes. */
const PAGE = { l: A4.h, h: A4.l };
const TAILLE = 8;
const INTERLIGNE = TAILLE + 2;
const LARGEUR_DATE = 54;
const LARGEUR_MONTANT = 70;

type Polices = { normal: PDFFont; gras: PDFFont };

const texteCellule = (v: Valeur) => (v.t === 'montant' ? (v.cents === null ? '' : formaterEuros(v.cents)) : valeurCsv(v));

function largeurs(t: Tableau): number[] {
  const exemple = t.lignes[0] ?? t.total ?? t.entetes.map(() => ({ t: 'texte', v: null }) as Valeur);
  const fixes = exemple.map((v): number => (v.t === 'date' ? LARGEUR_DATE : v.t === 'montant' ? LARGEUR_MONTANT : 0));
  const reste = PAGE.l - 2 * MARGE - fixes.reduce((a, b) => a + b, 0);
  const souples = fixes.filter((f) => f === 0).length;
  return fixes.map((f) => f || reste / Math.max(1, souples));
}

/**
 * Récapitulatif comptable d'une période (PDF, A4 paysage) : un tableau par
 * registre, texte coupé sur plusieurs lignes (jamais tronqué), totaux en gras,
 * en-tête de colonnes répété à chaque page, pages numérotées.
 */
export async function pdfComptabilite(entete: { entreprise: string; periode: string; edition: Date; notes: string[] }, tableaux: Tableau[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Comptabilité - ${entete.periode}`);
  doc.setLanguage('fr-FR');
  doc.setProducer('H\'DECOR');
  const p: Polices = { normal: await doc.embedFont(StandardFonts.Helvetica), gras: await doc.embedFont(StandardFonts.HelveticaBold) };
  let page: PDFPage = doc.addPage([PAGE.l, PAGE.h]);
  let y = PAGE.h - MARGE;
  const nouvelle = () => { page = doc.addPage([PAGE.l, PAGE.h]); y = PAGE.h - MARGE; };
  const ligneTexte = (t: string, taille: number, police: PDFFont, couleur = ANTHRACITE) => {
    for (const l of couper(police, t, taille, PAGE.l - 2 * MARGE)) {
      if (y - taille < MARGE + 14) nouvelle();
      page.drawText(l, { x: MARGE, y: y - taille, size: taille, font: police, color: couleur });
      y -= taille + 3;
    }
  };

  ligneTexte(entete.entreprise, 12, p.gras);
  ligneTexte(`Comptabilité : ${entete.periode}`, 15, p.gras);
  ligneTexte(`Édité le ${formaterDate(entete.edition)}`, 9, p.normal, GRIS);
  for (const n of entete.notes) ligneTexte(n, 8, p.normal, GRIS);

  for (const t of tableaux) {
    const l = largeurs(t);
    const xs = l.map((_, i) => MARGE + l.slice(0, i).reduce((a, b) => a + b, 0));
    const droite = (i: number) => (t.lignes[0] ?? t.total)?.[i]?.t === 'montant';
    const ligne = (cellules: string[], police: PDFFont, fond = false) => {
      const coupees = cellules.map((c, i) => (droite(i) ? [texteSur(police, c)] : couper(police, c, TAILLE, l[i]! - 4)));
      const h = Math.max(...coupees.map((c) => c.length)) * INTERLIGNE + 3;
      if (y - h < MARGE + 14) return false;
      if (fond) page.drawRectangle({ x: MARGE, y: y - h, width: PAGE.l - 2 * MARGE, height: h, color: GRIS_CLAIR });
      coupees.forEach((c, i) => c.forEach((txt, k) => {
        const yy = y - TAILLE - 1 - k * INTERLIGNE;
        if (droite(i)) aDroite(page, police, txt, xs[i]! + l[i]! - 2, yy, TAILLE);
        else page.drawText(txt, { x: xs[i]! + 2, y: yy, size: TAILLE, font: police, color: ANTHRACITE });
      }));
      y -= h;
      page.drawLine({ start: { x: MARGE, y }, end: { x: PAGE.l - MARGE, y }, thickness: 0.3, color: GRIS });
      return true;
    };
    const entetes = () => ligne(t.entetes, p.gras, true);
    y -= 10;
    if (y - 60 < MARGE + 14) nouvelle();
    ligneTexte(t.titre, 11, p.gras);
    entetes();
    if (!t.lignes.length) ligneTexte('Aucune écriture sur la période.', 9, p.normal, GRIS);
    for (const r of [...t.lignes.map((x) => ({ x, gras: false })), ...(t.total ? [{ x: t.total, gras: true }] : [])]) {
      const cellules = r.x.map(texteCellule);
      if (!ligne(cellules, r.gras ? p.gras : p.normal)) {
        nouvelle(); entetes();
        // Une ligne plus haute qu'une page entière ne se coupe pas : erreur explicite plutôt qu'une ligne perdue.
        if (!ligne(cellules, r.gras ? p.gras : p.normal)) throw new Error('Ligne trop longue pour une page du PDF : utilisez l’export Excel.');
      }
    }
  }

  const pages = doc.getPages();
  pages.forEach((pg, i) => aDroite(pg, p.normal, `Page ${i + 1} / ${pages.length}`, PAGE.l - MARGE, MARGE - 14, 8, GRIS));
  return doc.save();
}
