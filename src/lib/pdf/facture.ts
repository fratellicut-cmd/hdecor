import 'server-only';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import type { Regime, Ventilation } from '@/domain/devis';
import {
  ErreurFacture, formaterIban, libelleDatesPrestation, netParTaux, LIBELLES_TYPE_FACTURE, MENTION_AUTOLIQUIDATION, mentionIndemnite, mentionPenalites, totalLigneFacture, totauxFacture,
  type CopieEmetteurFacture, type Deduction, type LigneFacture, type TypeFacture,
} from '@/domain/factures';
import { formaterQuantiteE4, identiteEmetteur, lignesAdresse, nomAvecForme, texteAssurance, UNITES, type CopieChantier, type CopieClient } from '@/domain/devis-document';
import { payloadVirementSepa } from '@/domain/virement';
import { formaterDate, formaterEuros, formaterTaux } from '@/domain/formats';
import { A4, aDroite, ALERTE, ANTHRACITE, couper, DORE, ecrire, GRIS, GRIS_CLAIR, MARGE, nouvellePage, place, texteSur, type Contexte } from './commun';

export type DonneesPdfFacture = {
  /** Null : aperçu d'un brouillon. */
  numero: string | null;
  type: TypeFacture;
  brouillon: boolean;
  dateEmission: string;
  dateEcheance: string;
  datePrestationDebut: string | null;
  datePrestationFin: string | null;
  emetteur: CopieEmetteurFacture;
  client: CopieClient;
  chantier: CopieChantier;
  devis: { numero: string; version: number; accepteLe: string | null } | null;
  /** Avoir : facture corrigée et nature. */
  origine: { numero: string; dateEmission: string } | null;
  natureAvoir: 'correction' | 'reduction' | null;
  avancementBp: number | null;
  regime: Regime;
  autoliquidation: boolean;
  remiseGlobaleBp: number;
  lignes: LigneFacture[];
  deductions: Deduction[];
  /** Ventilation par taux de chaque facture déduite (même ordre) : TVA nette par taux d'un avoir d'annulation. */
  ventilationsDeduites?: Ventilation[];
  notesClient: string | null;
  urlConfidentialite?: string | null;
  /** Contrat hors établissement émis pendant le délai de rétractation : premier jour où un paiement peut être demandé (pas de QR). */
  paiementApresLe?: string | null;
};

export function titreFacture(type: TypeFacture, numero: string | null): string {
  const libelle = LIBELLES_TYPE_FACTURE[type];
  return numero ? `${libelle} n° ${numero}` : `${libelle} (aperçu, numéro attribué à l’émission)`;
}

/** Dessine le QR code (modules carrés) ; renvoie sa taille en points. */
function dessinerQr(c: Contexte, texte: string, x: number, yHaut: number, taille: number) {
  const qr = QRCode.create(texte, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const pas = taille / n;
  c.page.drawRectangle({ x: x - 4, y: yHaut - taille - 4, width: taille + 8, height: taille + 8, color: rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      if (qr.modules.get(r, col)) c.page.drawRectangle({ x: x + col * pas, y: yHaut - (r + 1) * pas, width: pas, height: pas, color: rgb(0, 0, 0) });
    }
  }
}

/**
 * Facture, facture d'acompte, de situation ou avoir en PDF, depuis les copies
 * figées ; totaux recalculés par le domaine (identiques à ceux contrôlés par la
 * base à l'émission). Mentions du §5.7 ; QR code de virement pour le net à payer.
 */
export async function pdfFacture(d: DonneesPdfFacture): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const titre = titreFacture(d.type, d.numero);
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
  const sansTva = d.regime === 'franchise';
  const avoir = d.type === 'avoir';
  const situation = d.type === 'situation';
  const totaux = totauxFacture(d.lignes, d.remiseGlobaleBp, d.regime, d.autoliquidation);
  const deduit = d.deductions.reduce((a, x) => a + x.ttc, 0n);
  const net = totaux.totalTtcCents - deduit;
  const largeur = A4.l - 2 * MARGE;

  // ---- En-tête : émetteur à gauche, client à droite
  const hautEntete = c.y;
  identiteEmetteur(d.emetteur).forEach((l, i) => ecrire(c, l, { largeur: 250, taille: i === 0 ? 12 : 9, gras: i === 0 }));
  const basEmetteur = c.y;
  c.y = hautEntete - 70;
  const xClient = MARGE + 290;
  ecrire(c, 'Client', { x: xClient, taille: 8, couleur: GRIS });
  ecrire(c, d.client.nom_affiche, { x: xClient, gras: true, taille: 11 });
  for (const l of lignesAdresse(d.client.adresse)) ecrire(c, l, { x: xClient, taille: 10 });
  if (d.client.siret) ecrire(c, `SIRET ${d.client.siret}`, { x: xClient, taille: 9, couleur: GRIS });
  if (d.client.tva_intra) ecrire(c, `TVA ${d.client.tva_intra}`, { x: xClient, taille: 9, couleur: GRIS });
  c.y = Math.min(c.y, basEmetteur) - 14;

  // ---- Titre et références
  if (d.brouillon) ecrire(c, 'APERÇU : BROUILLON SANS VALEUR', { gras: true, taille: 10, couleur: ALERTE });
  c.page.drawRectangle({ x: MARGE, y: c.y - 17, width: 4, height: 17, color: DORE });
  ecrire(c, titre, { x: MARGE + 10, taille: 15, gras: true });
  c.y -= 2;
  ecrire(c, `Date d’émission : ${formaterDate(d.dateEmission)}${avoir ? '' : `    Échéance : ${formaterDate(d.dateEcheance)}`}`, { taille: 10 });
  const dates = libelleDatesPrestation(d.type, d.datePrestationDebut, d.datePrestationFin, formaterDate);
  if (dates) ecrire(c, dates, { taille: 10 });
  if (d.origine) {
    ecrire(c, `Avoir sur la facture n° ${d.origine.numero} du ${formaterDate(d.origine.dateEmission)}`
      + `${d.natureAvoir === 'reduction' ? ' (réduction de prix)' : ' (correction ou annulation)'}`, { taille: 10, gras: true });
  }
  if (d.devis) {
    ecrire(c, `Devis n° ${d.devis.numero}${d.devis.version > 1 ? ` (version ${d.devis.version})` : ''}${d.devis.accepteLe ? `, accepté le ${formaterDate(d.devis.accepteLe)}` : ''}`, { taille: 10 });
  }
  if (situation && d.avancementBp !== null) ecrire(c, `Situation de travaux : avancement cumulé (détail par ligne).`, { taille: 10 });
  if (d.chantier) ecrire(c, `Adresse des travaux : ${[d.chantier.nom, ...lignesAdresse(d.chantier.adresse)].join(', ')}`, { taille: 10 });
  c.y -= 8;

  // ---- Lignes
  const colonnes = [
    { t: 'Désignation', l: 0 }, { t: 'Qté', l: 48 }, { t: 'U', l: 32 }, { t: 'PU HT', l: 60 },
    ...(situation ? [{ t: 'Avanc.', l: 45 }] : []), ...(sansTva ? [] : [{ t: 'TVA', l: 42 }]), { t: 'Total HT', l: 80 },
  ];
  colonnes[0]!.l = largeur - colonnes.slice(1).reduce((a, x) => a + x.l, 0);
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
  for (const l of d.lignes) {
    if (l.type === 'section') {
      if (place(c, 40)) enteteTableau();
      c.y -= 4;
      ecrire(c, l.designation, { taille: 10.5, gras: true, x: MARGE + 4 });
      continue;
    }
    if (l.type === 'texte' || l.type === 'sous_total') {
      if (l.type === 'texte') { if (place(c, 14)) enteteTableau(); ecrire(c, [l.designation, l.description].filter(Boolean).join('\n'), { taille: 9, italique: true, x: MARGE + 4 }); }
      continue;
    }
    const desig = couper(c.normal, l.designation, 9.5, colonnes[0]!.l - 8);
    const descr = l.description ? couper(c.normal, l.description, 8, colonnes[0]!.l - 8) : [];
    if (place(c, Math.min(desig.length * 12 + descr.length * 10 + 6, 200))) enteteTableau();
    const yLigne = c.y - 10;
    let y = yLigne;
    for (const t of desig) { if (y < c.basPage) { nouvellePage(c); enteteTableau(); y = c.y - 10; } c.page.drawText(t, { x: xs[0]! + 4, y, size: 9.5, font: c.normal, color: ANTHRACITE }); y -= 12; }
    for (const t of descr) { if (y < c.basPage) { nouvellePage(c); enteteTableau(); y = c.y - 10; } c.page.drawText(t, { x: xs[0]! + 4, y, size: 8, font: c.normal, color: GRIS }); y -= 10; }
    if (l.remiseBp > 0) { c.page.drawText(texteSur(c.italique, `Remise ${formaterTaux(l.remiseBp)} incluse`), { x: xs[0]! + 4, y, size: 8, font: c.italique, color: GRIS }); y -= 10; }
    const valeurs = [formaterQuantiteE4(l.quantiteE4!), UNITES[l.unite ?? ''] ?? (l.unite ?? ''), formaterEuros(l.prixUnitaireCents!)];
    if (situation) valeurs.push(formaterTaux(l.avancementBp ?? 10_000));
    if (!sansTva) valeurs.push(formaterTaux(l.tauxTvaBp ?? 0));
    valeurs.push(formaterEuros(totalLigneFacture(l.quantiteE4!, l.prixUnitaireCents!, l.remiseBp, l.avancementBp)));
    valeurs.forEach((v, i) => aDroite(c.page, c.normal, v, droite(i + 1), yLigne, 9.5));
    c.y = y - 2;
    c.page.drawLine({ start: { x: MARGE, y: c.y + 2 }, end: { x: A4.l - MARGE, y: c.y + 2 }, thickness: 0.3, color: GRIS_CLAIR });
  }

  // ---- Totaux, acomptes déduits, net à payer
  c.y -= 6;
  // [libellé, montant, en gras, détail en petit dessous]
  const lignesTotaux: [string, string, boolean, string?][] = [];
  if (totaux.remiseGlobaleCents > 0n) {
    lignesTotaux.push(['Total des lignes HT', formaterEuros(totaux.sommeLignesCents), false]);
    lignesTotaux.push([`Remise globale ${formaterTaux(d.remiseGlobaleBp)}`, `-${formaterEuros(totaux.remiseGlobaleCents)}`, false]);
  }
  // Avoir d'annulation d'une facture qui déduisait des acomptes : les totaux bruts sont ceux de la facture corrigée,
  // seul « Montant de l'avoir » (net, avec sa TVA nette par taux) porte ce qui est réellement crédité.
  const avoirNet = avoir && d.deductions.length > 0;
  const suffixe = avoirNet ? ' de la facture corrigée' : avoir ? ' de l’avoir' : '';
  lignesTotaux.push([`Total HT${suffixe}`, formaterEuros(totaux.totalHtCents), !avoirNet]);
  if (!sansTva) {
    for (const v of totaux.ventilation) {
      lignesTotaux.push([`TVA ${formaterTaux(v.taux_bp)} sur ${formaterEuros(v.base_ht_cents)}`, formaterEuros(v.tva_cents), false]);
    }
    lignesTotaux.push(['Total TVA', formaterEuros(totaux.totalTvaCents), false]);
    lignesTotaux.push([`Total TTC${suffixe}`, formaterEuros(totaux.totalTtcCents), !avoirNet]);
  }
  for (const x of d.deductions) {
    // Avoir d'annulation d'une facture qui déduisait des acomptes : ces acomptes restent dus, ils ne sont pas crédités.
    lignesTotaux.push([avoir ? `Acompte ${x.numero} : facture distincte, non reprise` : `Acompte ${x.numero} déduit`, `-${formaterEuros(x.ttc)}`, false,
      sansTva ? undefined : `dont HT ${formaterEuros(x.ht)}, TVA ${formaterEuros(x.tva)}`]);
  }
  if (avoirNet) {
    let detail = `dont HT ${formaterEuros(totaux.totalHtCents - d.deductions.reduce((a, x) => a + x.ht, 0n))}`;
    if (!sansTva) {
      // Sans la ventilation des acomptes, la TVA nette serait fausse : jamais imprimée par défaut.
      if ((d.ventilationsDeduites ?? []).length !== d.deductions.length) throw new Error('PDF d’avoir : ventilation des acomptes déduits manquante.');
      try {
        const nets = netParTaux(totaux.ventilation, d.ventilationsDeduites!);
        detail += `, TVA ${nets.map((v) => `${formaterTaux(v.taux_bp)} : ${formaterEuros(v.tva_cents)}`).join(' ; ')}`;
      } catch (e) {
        // Taux négatif (déduction supérieure au facturé sur un taux) : TVA nette globale, exacte mais non détaillée.
        if (!(e instanceof ErreurFacture)) throw e;
        detail += `, TVA ${formaterEuros(totaux.totalTvaCents - d.deductions.reduce((a, x) => a + x.tva, 0n))}`;
      }
    }
    lignesTotaux.push(['Montant de l’avoir', formaterEuros(net), true, detail]);
  }
  if (!avoir && (d.deductions.length || sansTva)) lignesTotaux.push(['Net à payer', formaterEuros(net), true]);
  place(c, lignesTotaux.length * 16 + d.deductions.length * 11 + 30);
  const xLib = A4.l - MARGE - 300;
  for (const [lib, val, fort, detail] of lignesTotaux) {
    const f = fort ? c.gras : c.normal;
    if (fort) c.page.drawRectangle({ x: xLib - 6, y: c.y - 14, width: 306, height: 16, color: rgb(0.96, 0.94, 0.89) });
    c.page.drawText(texteSur(f, lib), { x: xLib, y: c.y - 10, size: 9.5, font: f, color: ANTHRACITE });
    aDroite(c.page, f, val, A4.l - MARGE - 4, c.y - 10, 10);
    c.y -= 16;
    if (detail) { c.page.drawText(texteSur(c.normal, detail), { x: xLib + 8, y: c.y - 6, size: 8, font: c.normal, color: GRIS }); c.y -= 11; }
  }
  if (sansTva && d.emetteur.mention_franchise) ecrire(c, d.emetteur.mention_franchise, { gras: true, taille: 9.5, x: xLib });
  if (d.autoliquidation) ecrire(c, MENTION_AUTOLIQUIDATION, { gras: true, taille: 9.5, x: xLib, largeur: 300 });
  c.y -= 8;
  if (d.notesClient) { ecrire(c, d.notesClient, { taille: 9.5 }); c.y -= 4; }

  // ---- Règlement (QR de virement) ou avoir
  const p = d.emetteur.paiement;
  if (avoir) {
    ecrire(c, d.natureAvoir === 'reduction'
      ? 'Cet avoir réduit le montant dû au titre de la facture d’origine.'
      : 'Cet avoir corrige ou annule la facture d’origine pour le montant indiqué.', { taille: 9.5 });
  } else if (net > 0n) {
    place(c, 130);
    ecrire(c, 'Règlement', { gras: true, taille: 11 });
    const hautBloc = c.y;
    const reference = d.numero ? `Facture ${d.numero}` : 'Facture';
    if (d.paiementApresLe) {
      // Délai de rétractation (contrat signé hors établissement) : aucun paiement demandé avant son terme, pas de QR.
      ecrire(c, `Aucun paiement n’est demandé avant le ${formaterDate(d.paiementApresLe)} (délai de rétractation). À régler du ${formaterDate(d.paiementApresLe)} au ${formaterDate(d.dateEcheance)} : ${formaterEuros(net)}.`, { taille: 10, largeur: 330 });
    } else {
      ecrire(c, `À régler au plus tard le ${formaterDate(d.dateEcheance)} : ${formaterEuros(net)}.`, { taille: 10, largeur: 330 });
    }
    if (p.iban) {
      ecrire(c, `Virement : IBAN ${formaterIban(p.iban)}${p.bic ? `, BIC ${p.bic}` : ''}`, { taille: 9.5, largeur: 330 });
      ecrire(c, `Référence à indiquer : ${reference}`, { taille: 9.5, largeur: 330 });
      if (!d.paiementApresLe) ecrire(c, 'Ou scannez le QR code avec l’application de votre banque.', { taille: 8.5, couleur: GRIS, largeur: 330 });
      if (!d.paiementApresLe) try {
        dessinerQr(c, payloadVirementSepa({ beneficiaire: nomAvecForme(d.emetteur), iban: p.iban, bic: p.bic, montantCents: net, reference }),
          A4.l - MARGE - 100, hautBloc, 96);
      } catch { /* IBAN refusé : pas de QR (le contrôle d'émission l'exige valide) */ }
      c.y = Math.min(c.y, hautBloc - 108);
    }
    const pen = mentionPenalites(p);
    if (pen) ecrire(c, pen, { taille: 8.5 });
    const ind = mentionIndemnite(p, d.client);
    if (ind) ecrire(c, ind, { taille: 8.5 });
    if (p.escompte_texte) ecrire(c, `Escompte : ${p.escompte_texte}`, { taille: 8.5 });
  }
  c.y -= 4;
  for (const a of d.emetteur.assurances) ecrire(c, texteAssurance(a), { taille: 8.5 });
  if (d.emetteur.mentions_pied) ecrire(c, d.emetteur.mentions_pied, { taille: 8.5, couleur: GRIS });
  if (d.urlConfidentialite) ecrire(c, `Données personnelles (utilisation, durée de conservation, droits) : ${d.urlConfidentialite}`, { taille: 8, couleur: GRIS });

  // ---- Pieds de page et filigrane
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    const pied = `${nomAvecForme(d.emetteur)}${d.emetteur.siret ? ` - SIRET ${d.emetteur.siret}` : ''} - ${titre} - page ${i + 1} / ${pages.length}`;
    pg.drawText(texteSur(c.normal, pied), { x: MARGE, y: MARGE - 10, size: 7.5, font: c.normal, color: GRIS });
    if (d.brouillon) pg.drawText('BROUILLON', { x: 150, y: 280, size: 80, font: c.gras, color: ALERTE, opacity: 0.12, rotate: degrees(40) });
  });
  return doc.save({ useObjectStreams: false });
}
