import 'server-only';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { A4, ALERTE, GRIS, MARGE, aDroite, dessinerLogo, ecrire, nouvellePage, place, texteSur, trait, type Contexte, type Logo } from './commun';
import { identiteEmetteur, lignesAdresse, type CopieChantier, type CopieClient, type CopieEmetteur } from '@/domain/devis-document';
import { dateLimiteLevee, texteDecision, type Reserve } from '@/domain/pv';
import { formaterDate, formaterDateHeure } from '@/domain/formats';
import { texteLegal } from '@/domain/textes-legaux';

export type DonneesPv = {
  emetteur: CopieEmetteur;
  client: CopieClient;
  chantier: CopieChantier;
  dateReception: string;
  travaux: string | null;
  devisNumero: string | null;
  reserves: Reserve[];
  delaiLeveeJours: number | null;
  observations: string | null;
  logo?: Logo | null;
};

export type SignaturesPv = {
  nom: string; mention: string; signeLe: string; client: Uint8Array; entreprise: Uint8Array;
  /** Empreinte SHA-256 du PV présenté et signé (preuve d'intégrité). */
  documentSha256: string;
  entrepriseNom: string;
};

const LARGEUR_SIGNATURE = 220;
const HAUTEUR_SIGNATURE = 70;

/** PV de réception des travaux (A4), tel que présenté au client avant signature. */
export async function pdfPv(d: DonneesPv): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Procès-verbal de réception des travaux');
  doc.setLanguage('fr-FR');
  doc.setProducer('H\'DECOR');
  const c: Contexte = { doc, page: doc.addPage([A4.l, A4.h]), y: A4.h - MARGE, normal: await doc.embedFont(StandardFonts.Helvetica),
    gras: await doc.embedFont(StandardFonts.HelveticaBold), italique: await doc.embedFont(StandardFonts.HelveticaOblique), basPage: MARGE + 14 };

  const hautEntete = c.y;
  const xTexte = await dessinerLogo(c, d.logo);
  identiteEmetteur(d.emetteur).forEach((l, i) => ecrire(c, l, { x: xTexte, taille: i === 0 ? 12 : 9, gras: i === 0 }));
  c.y = Math.min(c.y, hautEntete - (xTexte > MARGE ? 70 : 0));
  c.y -= 10;
  ecrire(c, 'PROCÈS-VERBAL DE RÉCEPTION DES TRAVAUX', { taille: 15, gras: true });
  c.y -= 6;
  trait(c);
  c.y -= 8;

  ecrire(c, 'Maître d’ouvrage', { gras: true, taille: 10.5 });
  ecrire(c, d.client.nom_affiche);
  for (const l of lignesAdresse(d.client.adresse)) ecrire(c, l);
  c.y -= 4;
  ecrire(c, 'Lieu des travaux', { gras: true, taille: 10.5 });
  const lieu = d.chantier ? lignesAdresse(d.chantier.adresse) : [];
  if (lieu.length) for (const l of lieu) ecrire(c, l);
  else ecrire(c, 'Adresse du maître d’ouvrage');
  c.y -= 4;
  ecrire(c, 'Travaux réceptionnés', { gras: true, taille: 10.5 });
  ecrire(c, d.travaux || (d.chantier?.nom ?? 'Travaux du chantier'));
  if (d.devisNumero) ecrire(c, `Selon le devis n° ${d.devisNumero}`);
  c.y -= 4;
  ecrire(c, `Date de la réception : ${formaterDate(d.dateReception)}`, { gras: true, taille: 10.5 });
  c.y -= 8;

  ecrire(c, texteDecision(d.reserves), { gras: true, taille: 11 });
  if (d.reserves.length) {
    c.y -= 2;
    d.reserves.forEach((r, i) => ecrire(c, `${i + 1}. ${r.description}`, { x: MARGE + 10 }));
    if (d.delaiLeveeJours) {
      c.y -= 2;
      ecrire(c, `L’entreprise s’engage à lever ces réserves dans un délai de ${d.delaiLeveeJours} jour${d.delaiLeveeJours > 1 ? 's' : ''} à compter de la réception, soit au plus tard le ${formaterDate(dateLimiteLevee(d.dateReception, d.delaiLeveeJours)!)}.`);
    }
  }
  if (d.observations) {
    c.y -= 6;
    ecrire(c, 'Observations', { gras: true, taille: 10.5 });
    ecrire(c, d.observations);
  }
  c.y -= 8;
  ecrire(c, texteLegal('rappel_reception', d.emetteur.textes), { taille: 8.5, couleur: ALERTE });
  if (d.emetteur.mentions_pied) ecrire(c, d.emetteur.mentions_pied, { taille: 8, couleur: GRIS });
  c.y -= 10;

  // Cadres de signature (vides) : les tracés sont apposés sur une page ajoutée à CE document (pdfPvSigne).
  place(c, HAUTEUR_SIGNATURE + 40);
  const haut = c.y;
  for (const col of [{ x: MARGE, titre: 'Le maître d’ouvrage', nom: d.client.nom_affiche }, { x: A4.l / 2 + 10, titre: 'L’entreprise', nom: d.emetteur.nom_dirigeant ?? d.emetteur.raison_sociale ?? '' }]) {
    c.page.drawText(texteSur(c.gras, col.titre), { x: col.x, y: haut - 11, size: 10.5, font: c.gras });
    c.page.drawText(texteSur(c.normal, col.nom).slice(0, 60), { x: col.x, y: haut - 25, size: 9.5, font: c.normal });
    c.page.drawRectangle({ x: col.x, y: haut - 32 - HAUTEUR_SIGNATURE, width: LARGEUR_SIGNATURE, height: HAUTEUR_SIGNATURE, borderColor: GRIS, borderWidth: 0.5 });
  }
  c.y = haut - 32 - HAUTEUR_SIGNATURE - 8;
  ecrire(c, 'Les signatures sont apposées sur la page de signatures jointe à ce procès-verbal, qui ne vaut réception qu’une fois signé par les deux parties.', { taille: 8.5, couleur: GRIS });
  if (c.y < MARGE + 20) nouvellePage(c);
  const pages = doc.getPages();
  pages.forEach((pg, i) => aDroite(pg, c.normal, `${i + 1} / ${pages.length}`, A4.l - MARGE, MARGE - 14, 8, GRIS));
  return doc.save();
}

/**
 * Exemplaire signé : le PDF PRÉSENTÉ au client (pages inchangées) suivi d'une
 * page de signatures (tracés du client et de l'entreprise, nom, mention, date,
 * empreinte SHA-256 du PDF présenté). Rien n'est recalculé depuis la base.
 */
export async function pdfPvSigne(presente: Uint8Array, s: SignaturesPv): Promise<Uint8Array> {
  const doc = await PDFDocument.load(presente);
  const n = doc.getPageCount();
  const c: Contexte = { doc, page: doc.addPage([A4.l, A4.h]), y: A4.h - MARGE, normal: await doc.embedFont(StandardFonts.Helvetica),
    gras: await doc.embedFont(StandardFonts.HelveticaBold), italique: await doc.embedFont(StandardFonts.HelveticaOblique), basPage: MARGE + 14 };
  ecrire(c, 'PAGE DE SIGNATURES DU PROCÈS-VERBAL DE RÉCEPTION', { taille: 13, gras: true });
  ecrire(c, `Elle se rapporte au procès-verbal ${n > 1 ? `des pages 1 à ${n}` : 'de la page 1'} de ce document (numérotées sur ${n}), présenté au maître d’ouvrage et signé sur place.`, { taille: 9.5 });
  c.y -= 12;
  const haut = c.y;
  const colonnes = [{ x: MARGE, titre: 'Le maître d’ouvrage', nom: s.nom, image: s.client }, { x: A4.l / 2 + 10, titre: 'L’entreprise', nom: s.entrepriseNom, image: s.entreprise }];
  for (const col of colonnes) {
    c.page.drawText(texteSur(c.gras, col.titre), { x: col.x, y: haut - 11, size: 10.5, font: c.gras });
    c.page.drawText(texteSur(c.normal, col.nom).slice(0, 60), { x: col.x, y: haut - 25, size: 9.5, font: c.normal });
    const img = await doc.embedPng(col.image);
    const e = Math.min(LARGEUR_SIGNATURE / img.width, HAUTEUR_SIGNATURE / img.height);
    c.page.drawImage(img, { x: col.x, y: haut - 32 - img.height * e, width: img.width * e, height: img.height * e });
  }
  c.y = haut - 32 - HAUTEUR_SIGNATURE - 12;
  ecrire(c, `Signé sur place le ${formaterDateHeure(s.signeLe)} par ${s.nom}, mention : « ${s.mention} ».`, { taille: 9 });
  ecrire(c, `Empreinte SHA-256 du procès-verbal présenté et signé (pages 1${n > 1 ? ` à ${n}` : ''}) : ${s.documentSha256}`, { taille: 7.5, couleur: GRIS });
  // Les pages présentées gardent leur numérotation (empreinte) : celle-ci est désignée comme page jointe.
  aDroite(c.page, c.normal, 'Page de signatures jointe', A4.l - MARGE, MARGE - 14, 8, GRIS);
  return doc.save();
}
