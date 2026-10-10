import 'server-only';
import { PDFDocument, StandardFonts, type PDFImage, type PDFPage } from 'pdf-lib';
import { A4, ANTHRACITE, GRIS, MARGE, aDroite, couper, texteSur } from './commun';
import type { GroupeGalerie } from '@/domain/galerie';

/** Hauteur réservée à une paire avant / après (deux paires par page). */
const HAUTEUR_PAIRE = 340;
const ECART = 12;

/**
 * Galerie avant / après (portfolio, réseaux sociaux) : une ligne par paire,
 * photos côte à côte, proportions conservées. Aucune donnée du client : ni
 * nom, ni adresse ; seulement l'entreprise, la pièce et la légende saisie.
 */
export async function pdfGalerie(entete: { entreprise: string; titre: string }, groupes: GroupeGalerie[],
  image: (id: string) => Promise<Uint8Array | null>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(texteSur(await doc.embedFont(StandardFonts.Helvetica), `${entete.titre} - ${entete.entreprise}`));
  doc.setLanguage('fr-FR');
  doc.setProducer('H\'DECOR');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([A4.l, A4.h]);
  let y = A4.h - MARGE;
  const texte = (t: string, taille: number, police = normal, couleur = ANTHRACITE, x = MARGE, largeur = A4.l - 2 * MARGE) => {
    for (const l of couper(police, t, taille, largeur)) { page.drawText(l, { x, y: y - taille, size: taille, font: police, color: couleur }); y -= taille + 3; }
  };
  texte(entete.entreprise, 12, gras);
  texte(entete.titre, 18, gras);
  y -= 6;

  const largeurCase = (A4.l - 2 * MARGE - ECART) / 2;
  const placer = async (id: string | undefined, x: number, haut: number, etiquette: string) => {
    page.drawText(etiquette, { x, y: haut - 12, size: 11, font: gras, color: ANTHRACITE });
    if (!id) { page.drawText('(pas de photo)', { x, y: haut - 40, size: 9, font: normal, color: GRIS }); return; }
    const octets = await image(id);
    let img: PDFImage | null = null;
    try { img = octets ? await doc.embedJpg(octets) : null; } catch { img = null; }
    if (!img) { page.drawText('(photo illisible)', { x, y: haut - 40, size: 9, font: normal, color: GRIS }); return; }
    const hauteurDispo = HAUTEUR_PAIRE - 40;
    const echelle = Math.min(largeurCase / img.width, hauteurDispo / img.height);
    const l = img.width * echelle;
    const h = img.height * echelle;
    page.drawImage(img, { x: x + (largeurCase - l) / 2, y: haut - 18 - h, width: l, height: h });
  };

  for (const g of groupes) {
    for (const [i, paire] of g.paires.entries()) {
      if (y - HAUTEUR_PAIRE < MARGE + 14) { page = doc.addPage([A4.l, A4.h]); y = A4.h - MARGE; }
      texte(i === 0 ? g.titre : `${g.titre} (suite)`, 12, gras);
      const haut = y;
      await placer(paire.avant?.id, MARGE, haut, 'Avant');
      await placer(paire.apres?.id, MARGE + largeurCase + ECART, haut, 'Après');
      y = haut - HAUTEUR_PAIRE + 22;
      const legendes = [paire.avant?.legende, paire.apres?.legende].filter((l): l is string => !!l);
      if (legendes.length) texte(legendes.join(' / '), 9, normal, GRIS);
      y -= 8;
    }
  }
  if (!groupes.length) texte('Aucune paire avant / après : marquez des photos « en galerie » sur le chantier.', 10, normal, GRIS);
  const pages = doc.getPages();
  pages.forEach((pg, i) => aDroite(pg, normal, `${i + 1} / ${pages.length}`, A4.l - MARGE, MARGE - 14, 8, GRIS));
  return doc.save();
}
