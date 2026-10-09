import 'server-only';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { A4, ALERTE, GRIS, MARGE, ecrire, nouvellePage, type Contexte } from './commun';
import type { ListeAchat } from '@/domain/calculateur';
import { formaterEuros, formaterDate } from '@/domain/formats';
import { formaterContenance, formaterQuantiteCourte } from '@/domain/peinture';
import { totalMatiere } from '@/domain/liste-texte';
import { AVERTISSEMENT_RENDEMENT } from '@/domain/systemes';

/** Liste d'achat en PDF (A4). */
export async function pdfListeAchat(entete: { entreprise: string; chantier: string; date: Date }, liste: ListeAchat): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Liste d’achat - ${entete.chantier}`);
  doc.setLanguage('fr-FR');
  doc.setProducer('H\'DECOR');
  const c: Contexte = { doc, page: doc.addPage([A4.l, A4.h]), y: A4.h - MARGE, normal: await doc.embedFont(StandardFonts.Helvetica), gras: await doc.embedFont(StandardFonts.HelveticaBold),
    italique: await doc.embedFont(StandardFonts.HelveticaOblique), basPage: MARGE };

  ecrire(c, entete.entreprise, { taille: 12, gras: true });
  ecrire(c, `Liste d’achat : ${entete.chantier}`, { taille: 16, gras: true });
  ecrire(c, `Établie le ${formaterDate(entete.date)}`, { couleur: GRIS });
  c.y -= 8;

  if (liste.nonChiffres.length) {
    ecrire(c, `ATTENTION : liste incomplète, ${liste.nonChiffres.length} poste(s) non chiffré(s)`, { taille: 11, gras: true, couleur: ALERTE });
    for (const n of liste.nonChiffres) ecrire(c, `- ${n.libelle} : ${n.raison}`, { couleur: ALERTE });
    c.y -= 6;
  }
  if (liste.doublons.length) {
    ecrire(c, 'ATTENTION : comptés plusieurs fois', { taille: 11, gras: true, couleur: ALERTE });
    for (const d of liste.doublons) ecrire(c, `- ${d}`, { couleur: ALERTE });
    c.y -= 6;
  }
  if (!liste.lignes.length) ecrire(c, 'Aucun produit chiffré : complétez les postes de peinture du chantier.');
  for (const l of liste.lignes) {
    if (c.y < MARGE + 70) nouvellePage(c);
    c.page.drawLine({ start: { x: MARGE, y: c.y }, end: { x: A4.l - MARGE, y: c.y }, thickness: 0.5, color: GRIS });
    c.y -= 6;
    ecrire(c, `${l.libelle}${l.aVerifier ? '  [À VÉRIFIER]' : ''}`, { taille: 11, gras: true });
    const details = [l.reference ? `Réf. ${l.reference}` : null, l.finition ? `Finition : ${l.finition}` : null, l.teinte ? `Teinte : ${l.teinte}` : null].filter(Boolean).join('   ');
    if (details) ecrire(c, details, { couleur: GRIS });
    ecrire(c, `Besoin : ${formaterQuantiteCourte(l.quantite)} ${l.unite}`);
    if (l.pots) {
      const pots = l.pots.retenue.pots.map((p) => `${p.nombre} × ${formaterContenance(p.contenanceMl, l.unite)}`).join(' + ');
      ecrire(c, `À acheter : ${pots}   (reste ${formaterContenance(Number(l.pots.retenue.resteMl), l.unite)})`, { gras: true });
    } else ecrire(c, l.probleme ?? 'Pots à déterminer', { couleur: ALERTE });
    ecrire(c, `Coût HT : ${l.coutCents === null ? 'prix à renseigner' : `${formaterEuros(l.coutCents)}${l.coutIndicatif ? ' (indicatif : prix de certains formats inconnus)' : ''}`}`);
    c.y -= 4;
  }

  if (liste.consommables.length) {
    c.y -= 6;
    ecrire(c, 'Consommables', { taille: 11, gras: true });
    for (const k of liste.consommables) ecrire(c, `${k.libelle} : ${formaterEuros(k.coutCents)}${k.aVerifier ? '  [À VÉRIFIER]' : ''}`);
  }

  c.y -= 10;
  ecrire(c, `Total matière HT : ${totalMatiere(liste)}`, { taille: 12, gras: true });
  c.y -= 10;
  ecrire(c, AVERTISSEMENT_RENDEMENT, { taille: 9, couleur: ALERTE });
  ecrire(c, 'Les valeurs marquées [À VÉRIFIER] ne sont pas encore confirmées (fiche technique, prix fournisseur).', { taille: 9, couleur: GRIS });

  return doc.save();
}
