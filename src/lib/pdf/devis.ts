import 'server-only';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { acompte, sousTotaux, totalLigne, totauxDevis, type Echeance, type LigneDevis, type Regime } from '@/domain/devis';
import {
  avecRetractation, EXECUTION_ANTICIPEE, formaterJours, formaterQuantiteE4, formulaireRetractation, identiteEmetteur, informationRetractation,
  lignesAdresse, MENTION_DEVIS_RECU, nomAvecForme, texteAssurance, UNITES, ajouterJours,
  type CopieChantier, type CopieClient, type CopieEmetteur,
} from '@/domain/devis-document';
import { formaterDate, formaterDateHeure, formaterEuros, formaterTaux } from '@/domain/formats';
import { A4, aDroite, ALERTE, ANTHRACITE, couper, DORE, ecrire, GRIS, GRIS_CLAIR, MARGE, nouvellePage, place, texteSur, trait, type Contexte } from './commun';

export type DonneesPdfDevis = {
  /** Null : aperçu d'un brouillon (numéro attribué à l'émission). */
  numero: string | null;
  version: number;
  dateEmission: string;
  validiteJours: number;
  /** Aperçu : filigrane « BROUILLON », sans valeur contractuelle. */
  brouillon: boolean;
  emetteur: CopieEmetteur;
  client: CopieClient;
  chantier: CopieChantier;
  objet: string | null;
  dateDebutTravaux: string | null;
  delaiDebutTexte: string | null;
  dureeEstimeeJours: number | null;
  conditionsPaiement: string | null;
  horsEtablissement: boolean;
  notesClient: string | null;
  regime: Regime;
  remiseGlobaleBp: number;
  lignes: LigneDevis[];
  echeances: Echeance[];
  acomptePctBp: number;
  logo?: { octets: Uint8Array; type: 'png' | 'jpg' } | null;
};

const DECLENCHEURS: Record<Echeance['declencheur'], string> = {
  signature: 'à la signature', debut_travaux: 'au début des travaux', mi_chantier: 'à mi-chantier', fin_travaux: 'à la fin des travaux', date: 'le',
};

export function titreDevis(numero: string | null, version: number): string {
  return numero ? `Devis n° ${numero}${version > 1 ? ` (version ${version})` : ''}` : 'Devis (aperçu, numéro attribué à l’émission)';
}

/**
 * Devis en PDF : toutes les mentions du §5.6 depuis les COPIES figées ;
 * totaux recalculés par le domaine (identiques à ceux contrôlés par la base).
 */
export async function pdfDevis(d: DonneesPdfDevis): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const titre = titreDevis(d.numero, d.version);
  doc.setTitle(titre);
  doc.setLanguage('fr-FR');
  doc.setProducer('H\'DECOR');
  doc.setCreationDate(new Date(`${d.dateEmission}T12:00:00Z`));
  doc.setModificationDate(new Date(`${d.dateEmission}T12:00:00Z`));
  const c: Contexte = {
    doc, page: doc.addPage([A4.l, A4.h]), y: A4.h - MARGE, basPage: MARGE + 24,
    normal: await doc.embedFont(StandardFonts.Helvetica), gras: await doc.embedFont(StandardFonts.HelveticaBold),
    italique: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const franchise = d.regime === 'franchise';
  const totaux = totauxDevis(d.lignes, d.remiseGlobaleBp, d.regime);
  const largeur = A4.l - 2 * MARGE;

  // ---- En-tête : émetteur à gauche, client à droite
  const hautEntete = c.y;
  let xTexte = MARGE;
  if (d.logo) {
    const image = d.logo.type === 'png' ? await doc.embedPng(d.logo.octets) : await doc.embedJpg(d.logo.octets);
    const echelle = Math.min(70 / image.width, 70 / image.height);
    c.page.drawImage(image, { x: MARGE, y: c.y - image.height * echelle, width: image.width * echelle, height: image.height * echelle });
    xTexte = MARGE + image.width * echelle + 10;
  }
  identiteEmetteur(d.emetteur).forEach((l, i) => ecrire(c, l, { x: xTexte, largeur: 250 - (xTexte - MARGE), taille: i === 0 ? 12 : 9, gras: i === 0 }));
  const basEmetteur = c.y;
  c.y = hautEntete - 70;
  const xClient = MARGE + 290;
  ecrire(c, 'Client', { x: xClient, taille: 8, couleur: GRIS });
  ecrire(c, d.client.nom_affiche, { x: xClient, gras: true, taille: 11 });
  if (d.client.type === 'professionnel') {
    const contact = [d.client.civilite, d.client.prenom, d.client.nom].filter(Boolean).join(' ');
    if (contact && contact !== d.client.nom_affiche) ecrire(c, `À l’attention de ${contact}`, { x: xClient, taille: 9 });
  }
  for (const l of lignesAdresse(d.client.adresse)) ecrire(c, l, { x: xClient, taille: 10 });
  if (d.client.siret) ecrire(c, `SIRET ${d.client.siret}`, { x: xClient, taille: 9, couleur: GRIS });
  if (d.client.tva_intra) ecrire(c, `TVA ${d.client.tva_intra}`, { x: xClient, taille: 9, couleur: GRIS });
  c.y = Math.min(c.y, basEmetteur) - 14;

  // ---- Titre, dates, chantier
  if (d.brouillon) ecrire(c, 'APERÇU : BROUILLON SANS VALEUR CONTRACTUELLE', { gras: true, taille: 10, couleur: ALERTE });
  c.page.drawRectangle({ x: MARGE, y: c.y - 17, width: 4, height: 17, color: DORE });
  ecrire(c, titre, { x: MARGE + 10, taille: 15, gras: true });
  c.y -= 2;
  const valide = ajouterJours(d.dateEmission, d.validiteJours);
  ecrire(c, `Date : ${formaterDate(d.dateEmission)}    Valable jusqu’au ${formaterDate(valide)} (${d.validiteJours} jours)`, { taille: 10 });
  if (d.chantier) {
    ecrire(c, `Adresse des travaux : ${[d.chantier.nom, ...lignesAdresse(d.chantier.adresse)].join(', ')}`, { taille: 10 });
  }
  if (d.objet) ecrire(c, `Objet : ${d.objet}`, { taille: 10, gras: true });
  c.y -= 8;

  // ---- Tableau des lignes
  const colonnes = franchise
    ? [{ t: 'Désignation', l: 285 }, { t: 'Qté', l: 50 }, { t: 'U', l: 35 }, { t: 'PU HT', l: 65 }, { t: 'Total HT', l: 80 }]
    : [{ t: 'Désignation', l: 225 }, { t: 'Qté', l: 50 }, { t: 'U', l: 35 }, { t: 'PU HT', l: 60 }, { t: 'TVA', l: 45 }, { t: 'Total HT', l: 100 }];
  const xs: number[] = [];
  colonnes.reduce((x, col) => { xs.push(x); return x + col.l; }, MARGE);
  const droite = (i: number) => xs[i]! + colonnes[i]!.l - 4;
  const enteteTableau = () => {
    c.page.drawRectangle({ x: MARGE, y: c.y - 16, width: largeur, height: 16, color: ANTHRACITE });
    colonnes.forEach((col, i) => {
      if (i === 0) c.page.drawText(texteSur(c.gras, col.t), { x: xs[0]! + 4, y: c.y - 12, size: 9, font: c.gras, color: rgb(1, 1, 1) });
      else aDroite(c.page, c.gras, col.t, droite(i), c.y - 12, 9, rgb(1, 1, 1));
    });
    c.y -= 20;
  };
  enteteTableau();
  const st = sousTotaux(d.lignes);
  const options: LigneDevis[] = [];
  d.lignes.forEach((l, index) => {
    if (l.type === 'ligne' && l.optionnelle) { options.push(l); return; }
    if (l.type === 'section') {
      if (place(c, 40)) enteteTableau();
      c.y -= 4;
      ecrire(c, l.designation, { taille: 10.5, gras: true, x: MARGE + 4 });
      if (l.description) ecrire(c, l.description, { taille: 8.5, couleur: GRIS, x: MARGE + 4 });
      return;
    }
    if (l.type === 'texte') {
      if (place(c, 14)) enteteTableau();
      ecrire(c, [l.designation, l.description].filter(Boolean).join('\n'), { taille: 9, italique: true, x: MARGE + 4, largeur: largeur - 8 });
      return;
    }
    if (l.type === 'sous_total') {
      if (place(c, 16)) enteteTableau();
      aDroite(c.page, c.gras, `${l.designation || 'Sous-total'} HT : ${formaterEuros(st.get(index) ?? 0n)}`, droite(colonnes.length - 1), c.y - 10, 9.5);
      c.y -= 16;
      return;
    }
    dessinerLigne(l, false);
  });

  function dessinerLigne(l: LigneDevis, option: boolean) {
    const desig = couper(c.normal, `${option ? 'OPTION : ' : ''}${l.designation}`, 9.5, colonnes[0]!.l - 8);
    const descr = l.description ? couper(c.normal, l.description, 8, colonnes[0]!.l - 8) : [];
    const remise = l.remiseBp > 0 ? couper(c.italique, `Remise ${formaterTaux(l.remiseBp)} incluse`, 8, colonnes[0]!.l - 8) : [];
    const hauteur = desig.length * 12 + (descr.length + remise.length) * 10 + 6;
    if (place(c, Math.min(hauteur, 200))) enteteTableau();
    const yLigne = c.y - 10;
    let y = yLigne;
    for (const t of desig) { if (y < c.basPage) { nouvellePage(c); enteteTableau(); y = c.y - 10; } c.page.drawText(t, { x: xs[0]! + 4, y, size: 9.5, font: c.normal, color: ANTHRACITE }); y -= 12; }
    for (const t of descr) { if (y < c.basPage) { nouvellePage(c); enteteTableau(); y = c.y - 10; } c.page.drawText(t, { x: xs[0]! + 4, y, size: 8, font: c.normal, color: GRIS }); y -= 10; }
    for (const t of remise) { c.page.drawText(t, { x: xs[0]! + 4, y, size: 8, font: c.italique, color: GRIS }); y -= 10; }
    const q = l.quantiteE4 ?? 0n;
    const pu = l.prixUnitaireCents ?? 0n;
    const valeurs = [formaterQuantiteE4(q), UNITES[l.unite ?? ''] ?? (l.unite ?? ''), formaterEuros(pu)];
    if (!franchise) valeurs.push(formaterTaux(l.tauxTvaBp ?? 0));
    valeurs.push(formaterEuros(totalLigne(q, pu, l.remiseBp)));
    valeurs.forEach((v, i) => aDroite(c.page, c.normal, v, droite(i + 1), yLigne, 9.5));
    c.y = y - 2;
    c.page.drawLine({ start: { x: MARGE, y: c.y + 2 }, end: { x: A4.l - MARGE, y: c.y + 2 }, thickness: 0.3, color: GRIS_CLAIR });
  }

  // ---- Totaux
  c.y -= 6;
  const lignesTotaux: [string, string, boolean][] = [];
  if (totaux.remiseGlobaleCents > 0n) {
    lignesTotaux.push(['Total des lignes HT', formaterEuros(totaux.sommeLignesCents), false]);
    lignesTotaux.push([`Remise globale ${formaterTaux(d.remiseGlobaleBp)}`, `-${formaterEuros(totaux.remiseGlobaleCents)}`, false]);
  }
  lignesTotaux.push(['Total HT', formaterEuros(totaux.totalHtCents), true]);
  if (!franchise) {
    for (const v of totaux.ventilation) {
      lignesTotaux.push([`TVA ${formaterTaux(v.taux_bp)} sur ${formaterEuros(v.base_ht_cents)}`, formaterEuros(v.tva_cents), false]);
    }
    lignesTotaux.push(['Total TVA', formaterEuros(totaux.totalTvaCents), false]);
  }
  lignesTotaux.push([franchise ? 'Net à payer' : 'Total TTC', formaterEuros(totaux.totalTtcCents), true]);
  place(c, lignesTotaux.length * 15 + 30);
  const xLib = A4.l - MARGE - 260;
  for (const [lib, val, fort] of lignesTotaux) {
    const f = fort ? c.gras : c.normal;
    if (fort) c.page.drawRectangle({ x: xLib - 6, y: c.y - 14, width: 266, height: 16, color: rgb(0.96, 0.94, 0.89) });
    c.page.drawText(texteSur(f, lib), { x: xLib, y: c.y - 10, size: 10, font: f, color: ANTHRACITE });
    aDroite(c.page, f, val, A4.l - MARGE - 4, c.y - 10, 10);
    c.y -= 16;
  }
  if (franchise && d.emetteur.mention_franchise) ecrire(c, d.emetteur.mention_franchise, { gras: true, taille: 9.5, x: xLib });
  c.y -= 6;

  // ---- Options (hors total)
  if (options.length) {
    place(c, 50);
    ecrire(c, 'Options proposées (non comprises dans le total, à cocher pour les retenir)', { gras: true, taille: 10 });
    c.y -= 2;
    enteteTableau();
    for (const o of options) dessinerLigne(o, true);
    c.y -= 6;
  }

  // ---- Conditions
  place(c, 60);
  ecrire(c, 'Conditions', { gras: true, taille: 11 });
  const debut = d.dateDebutTravaux ? `à partir du ${formaterDate(d.dateDebutTravaux)}` : d.delaiDebutTexte;
  if (debut) ecrire(c, `Début des travaux : ${debut}.`, { taille: 9.5 });
  if (d.dureeEstimeeJours !== null) ecrire(c, `Durée estimée des travaux : ${formaterJours(d.dureeEstimeeJours)}.`, { taille: 9.5 });
  if (d.echeances.length) {
    ecrire(c, 'Échéancier de paiement :', { taille: 9.5 });
    const parTaux = totaux.ventilation;
    for (const e of d.echeances) {
      const m = acompte(parTaux, e.pourcentageBp, d.regime);
      const quand = e.declencheur === 'date' && e.datePrevue ? `le ${formaterDate(e.datePrevue)}` : DECLENCHEURS[e.declencheur];
      ecrire(c, `- ${e.libelle} : ${formaterTaux(e.pourcentageBp)} ${quand}, soit ${formaterEuros(m.ttcCents)}${franchise ? '' : ' TTC'}`, { taille: 9.5, x: MARGE + 8 });
    }
  } else if (d.acomptePctBp > 0) {
    const m = acompte(totaux.ventilation, d.acomptePctBp, d.regime);
    ecrire(c, `Acompte à la signature : ${formaterTaux(d.acomptePctBp)}, soit ${formaterEuros(m.ttcCents)}${franchise ? '' : ' TTC'}.`, { taille: 9.5 });
  }
  if (d.conditionsPaiement) ecrire(c, `Conditions de paiement : ${d.conditionsPaiement}`, { taille: 9.5 });
  if (d.notesClient) { c.y -= 2; ecrire(c, d.notesClient, { taille: 9.5 }); }
  c.y -= 6;

  // ---- Assurances, médiateur, rétractation
  place(c, 50);
  for (const a of d.emetteur.assurances) ecrire(c, texteAssurance(a), { taille: 8.5 });
  const m = d.emetteur.mediateur;
  if (m.nom) {
    ecrire(c, `Médiateur de la consommation : ${[m.nom, m.coordonnees, m.site].filter(Boolean).join(', ')}. `
      + 'En cas de litige, le client consommateur peut le saisir gratuitement après une réclamation écrite restée sans réponse satisfaisante.', { taille: 8.5 });
  }
  const retractation = avecRetractation(d.horsEtablissement, d.client);
  if (retractation) {
    c.y -= 4;
    ecrire(c, 'Droit de rétractation', { gras: true, taille: 9.5 });
    ecrire(c, informationRetractation(d.emetteur), { taille: 8.5 });
    ecrire(c, EXECUTION_ANTICIPEE, { taille: 8.5 });
  }
  if (d.emetteur.mentions_pied) { c.y -= 4; ecrire(c, d.emetteur.mentions_pied, { taille: 8.5, couleur: GRIS }); }
  c.y -= 8;

  // ---- Bon pour accord
  place(c, 130);
  const hautCadre = c.y;
  c.y -= 6;
  ecrire(c, 'Bon pour accord', { gras: true, taille: 11, x: MARGE + 8 });
  ecrire(c, MENTION_DEVIS_RECU, { taille: 9.5, x: MARGE + 8 });
  ecrire(c, 'Date, nom et signature du client, précédés de la mention manuscrite « Bon pour accord » :', { taille: 9, x: MARGE + 8 });
  if (options.length) ecrire(c, 'Options retenues : ' + options.map((o) => `[  ] ${o.designation}`).join('    '), { taille: 9, x: MARGE + 8, largeur: largeur - 16 });
  c.y -= 70;
  c.page.drawRectangle({ x: MARGE, y: c.y, width: largeur, height: hautCadre - c.y, borderColor: GRIS, borderWidth: 0.8 });

  // ---- Formulaire de rétractation (page détachable)
  if (retractation) {
    nouvellePage(c);
    const f = formulaireRetractation(d.emetteur, d.numero);
    ecrire(c, f.titre, { gras: true, taille: 15 });
    c.y -= 8;
    for (const l of f.lignes) { ecrire(c, l, { taille: 10.5 }); c.y -= 8; }
  }

  // ---- Pieds de page et filigrane
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const pied = `${nomAvecForme(d.emetteur)}${d.emetteur.siret ? ` - SIRET ${d.emetteur.siret}` : ''} - ${titre} - page ${i + 1} / ${pages.length}`;
    p.drawText(texteSur(c.normal, pied), { x: MARGE, y: MARGE - 10, size: 7.5, font: c.normal, color: GRIS });
    if (d.brouillon) {
      p.drawText('BROUILLON', { x: 150, y: 280, size: 80, font: c.gras, color: ALERTE, opacity: 0.12, rotate: degrees(40) });
    }
  });
  return doc.save({ useObjectStreams: false });
}

export type SignaturePdf = {
  methode: 'sur_place' | 'lien';
  signataire: string;
  mention: string;
  signeLe: string;
  ip: string | null;
  userAgent: string | null;
  documentSha256: string;
  options: string[];
  totalAccepte: { htCents: bigint; tvaCents: bigint; ttcCents: bigint };
  regime: Regime;
  image: Uint8Array;
};

/**
 * PDF signé : les pages du devis ORIGINAL (archivé à part, inchangé) suivies d'une
 * page de certificat (signataire, mention, horodatage serveur, IP, empreinte
 * SHA-256 du devis original, options retenues, tracé).
 */
export async function pdfDevisSigne(original: Uint8Array, titre: string, s: SignaturePdf): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original);
  doc.setTitle(`${titre} - signé`);
  doc.setModificationDate(new Date(s.signeLe));
  const c: Contexte = {
    doc, page: doc.addPage([A4.l, A4.h]), y: A4.h - MARGE, basPage: MARGE,
    normal: await doc.embedFont(StandardFonts.Helvetica), gras: await doc.embedFont(StandardFonts.HelveticaBold),
    italique: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  ecrire(c, 'Certificat de signature électronique', { gras: true, taille: 15 });
  ecrire(c, titre, { taille: 11 });
  c.y -= 8;
  trait(c);
  c.y -= 8;
  const champs: [string, string][] = [
    ['Signataire', s.signataire],
    ['Mention', s.mention],
    ['Signé le', `${formaterDateHeure(s.signeLe)} (heure de Paris, horloge du serveur)`],
    ['Méthode', s.methode === 'sur_place' ? 'sur place, sur l’appareil de l’entreprise' : 'à distance, par lien personnel'],
    ['Adresse IP', s.ip ?? 'non disponible'],
    ['Navigateur', s.userAgent ?? 'non disponible'],
    ['Options retenues', s.options.length ? s.options.join(', ') : 'aucune'],
    ['Montant accepté', s.regime === 'franchise' ? `${formaterEuros(s.totalAccepte.ttcCents)} (TVA non applicable)`
      : `${formaterEuros(s.totalAccepte.htCents)} HT, ${formaterEuros(s.totalAccepte.tvaCents)} de TVA, ${formaterEuros(s.totalAccepte.ttcCents)} TTC`],
    ['Empreinte SHA-256 du devis signé', s.documentSha256],
  ];
  for (const [k, v] of champs) {
    ecrire(c, k, { gras: true, taille: 9.5 });
    ecrire(c, v, { taille: 10, x: MARGE + 10 });
    c.y -= 4;
  }
  c.y -= 6;
  ecrire(c, 'Signature :', { gras: true, taille: 9.5 });
  const image = await doc.embedPng(s.image);
  const echelle = Math.min(300 / image.width, 120 / image.height, 1);
  place(c, image.height * echelle + 10);
  c.page.drawRectangle({ x: MARGE, y: c.y - image.height * echelle - 8, width: image.width * echelle + 16, height: image.height * echelle + 8, borderColor: GRIS, borderWidth: 0.5 });
  c.page.drawImage(image, { x: MARGE + 8, y: c.y - image.height * echelle - 4, width: image.width * echelle, height: image.height * echelle });
  c.y -= image.height * echelle + 20;
  ecrire(c, 'Les pages précédentes sont le devis tel qu’il a été présenté au signataire. Son empreinte SHA-256 ci-dessus permet de vérifier qu’il n’a pas été modifié.', { taille: 8.5, couleur: GRIS });
  return doc.save({ useObjectStreams: false });
}
