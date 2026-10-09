import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jsQR from 'jsqr';
import { describe, expect, it, vi } from 'vitest';
import type { LigneDevis } from '@/domain/devis';
import { copieChantier, copieClient, copieEmetteur, type ParametresEmetteur } from '@/domain/devis-document';
import type { CopieEmetteurFacture, LigneFacture } from '@/domain/factures';

vi.mock('server-only', () => ({}));
const { pdfFacture } = await import('../pdf/facture');

function fichierPdf(octets: Uint8Array): string {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'hdecor-facture-')), 'f.pdf');
  writeFileSync(f, octets);
  return f;
}
const texte = (octets: Uint8Array) => execFileSync('pdftotext', ['-layout', fichierPdf(octets), '-'], { encoding: 'utf8' }).replace(/[   ]+/g, ' ');

/** Rend la 1re page en image (pdftoppm, PPM) et décode le QR code imprimé (jsQR). */
function qrImprime(octets: Uint8Array): string | null {
  const f = fichierPdf(octets);
  execFileSync('pdftoppm', ['-r', '150', '-f', '1', '-l', '1', '-singlefile', f, f.replace(/\.pdf$/, '')]);
  const ppm = readFileSync(f.replace(/\.pdf$/, '.ppm'));
  const entete = ppm.toString('latin1', 0, 64).match(/^P6\s+(\d+)\s+(\d+)\s+255\s/)!;
  const [l, h] = [Number(entete[1]), Number(entete[2])];
  const rgb = ppm.subarray(entete[0].length);
  const rgba = new Uint8ClampedArray(l * h * 4);
  for (let i = 0; i < l * h; i++) { rgba[i * 4] = rgb[i * 3]!; rgba[i * 4 + 1] = rgb[i * 3 + 1]!; rgba[i * 4 + 2] = rgb[i * 3 + 2]!; rgba[i * 4 + 3] = 255; }
  return jsQR(rgba, l, h)?.data ?? null;
}

const params: ParametresEmetteur = {
  raison_sociale: 'Entreprise de test', forme_juridique: 'EI', nom_dirigeant: 'Prénom Nom', siret: '12345678900011', immatriculation: null,
  adresse_ligne1: '1 rue de l’Exemple', adresse_ligne2: null, code_postal: '57100', ville: 'Thionville', telephone: null, email: 'contact@example.test',
  numero_tva_intra: null, regime_tva: 'franchise', mention_franchise: 'TVA non applicable, art. 293 B du CGI', mediateur_nom: 'Médiateur fictif',
  mediateur_coordonnees: null, mediateur_site: null, mentions_pied: null,
};
const assurances = [{ type: 'decennale' as const, assureur: 'Assureur fictif', numero_contrat: 'D-123', debut: '2026-01-01', fin: null, zone_couverte: 'France' }];
const paiement = { iban: 'FR1420041010050500013M02606', bic: 'PSSTFRPPPAR', taux_penalites_bp: 1_000, indemnite_recouvrement_cents: 4_000, escompte_texte: 'Pas d’escompte pour paiement anticipé.' };
const emetteur: CopieEmetteurFacture = { ...copieEmetteur(params, assurances, '2026-10-09'), paiement };
const particulier = copieClient({ type: 'particulier', civilite: null, nom: 'Martin', prenom: 'Alice', raison_sociale: null, siret: null, tva_intra: null,
  email: null, telephone: null, fact_ligne1: '3 avenue des Lilas', fact_ligne2: null, fact_code_postal: '57100', fact_ville: 'Thionville', fact_pays: null });
const chantier = copieChantier({ nom: 'Appartement Lilas', adresse_ligne1: '3 avenue des Lilas', adresse_ligne2: null, code_postal: '57100', ville: 'Thionville' });
const l = (designation: string, qE4: bigint, pu: bigint, taux: number, autres: Partial<LigneFacture> = {}): LigneFacture => ({
  type: 'ligne', designation, quantiteE4: qE4, unite: 'forfait', prixUnitaireCents: pu, remiseBp: 0, tauxTvaBp: taux, optionnelle: false, avancementBp: null, ...autres,
} as LigneDevis & LigneFacture);

const base = {
  numero: 'FAC-2026-0002', type: 'finale' as const, brouillon: false, dateEmission: '2026-10-09', dateEcheance: '2026-11-08',
  datePrestationDebut: '2026-10-01', datePrestationFin: '2026-10-05', emetteur, client: particulier, chantier,
  devis: { numero: 'DEV-2026-0001', version: 1, accepteLe: '2026-09-20' }, origine: null, natureAvoir: null, avancementBp: null,
  regime: 'franchise' as const, autoliquidation: false, remiseGlobaleBp: 0, lignes: [l('Peinture du séjour', 10_000n, 500_000n, 0)],
  deductions: [{ facture_id: 'a1', numero: 'FAC-2026-0001', ht: 150_000n, tva: 0n, ttc: 150_000n }], notesClient: null,
  urlConfidentialite: 'https://exemple.test/confidentialite',
};

describe('facture finale en franchise, particulier, acompte déduit (PDF réel)', async () => {
  const octets = await pdfFacture(base);
  const t = texte(octets);
  it.each([
    ['numéro', 'Facture n° FAC-2026-0002'], ['date d’émission et échéance', 'Date d’émission : 09/10/2026 Échéance : 08/11/2026'],
    ['date de la prestation', 'Date de la prestation : du 01/10/2026 au 05/10/2026'], ['devis accepté', 'Devis n° DEV-2026-0001, accepté le 20/09/2026'],
    ['vendeur + EI', 'Entreprise de test EI'], ['SIRET', 'SIRET 12345678900011'], ['client', 'Alice Martin'], ['adresse des travaux', 'Adresse des travaux : Appartement Lilas'],
    ['total HT', 'Total HT 5 000,00 €'], ['acompte déduit', 'Acompte FAC-2026-0001 déduit -1 500,00 €'], ['net à payer', 'Net à payer 3 500,00 €'],
    ['mention de franchise', 'TVA non applicable, art. 293 B du CGI'], ['échéance du règlement', 'À régler au plus tard le 08/11/2026 : 3 500,00 €.'],
    ['IBAN lisible', 'IBAN FR14 2004 1010 0505 0001 3M02 606, BIC PSSTFRPPPAR'], ['référence', 'Référence à indiquer : Facture FAC-2026-0002'],
    ['pénalités', 'pénalités au taux annuel de 10 % sont exigibles'], ['escompte', 'Escompte : Pas d’escompte pour paiement anticipé.'],
    ['décennale', 'Assurance décennale : Assureur fictif'], ['confidentialité', 'https://exemple.test/confidentialite'],
  ])('%s', (_, attendu) => expect(t).toContain(attendu));
  it('particulier : pas d’indemnité forfaitaire (À VÉRIFIER, signalée à l’émission)', () => expect(t).not.toContain('Indemnité forfaitaire'));
  it('pas de TVA ni d’aperçu', () => { expect(t).not.toMatch(/Total TVA|APERÇU/); });
  it('QR code imprimé : lu par un décodeur, montant et référence exacts', () => {
    expect(qrImprime(octets)).toBe("BCD\n002\n1\nSCT\nPSSTFRPPPAR\nEntreprise de test EI\nFR1420041010050500013M02606\nEUR3500.00\n\n\nFacture FAC-2026-0002");
  });
});

describe('facture assujetti, professionnel, deux taux, acompte déduit', async () => {
  const pro = copieClient({ type: 'professionnel', civilite: null, nom: 'Durand', prenom: null, raison_sociale: 'Société Exemple SARL', siret: '98765432100019',
    tva_intra: 'FR00987654321', email: null, telephone: null, fact_ligne1: '10 rue du Commerce', fact_ligne2: null, fact_code_postal: '69001', fact_ville: 'Lyon', fact_pays: null });
  const t = texte(await pdfFacture({
    ...base, regime: 'assujetti', client: pro,
    emetteur: { ...copieEmetteur({ ...params, regime_tva: 'assujetti', numero_tva_intra: 'FR00123456789' }, assurances, '2026-10-09'), paiement },
    lignes: [l('Murs', 10_000n, 300_000n, 2_000), l('Logement', 10_000n, 700_000n, 1_000)],
    deductions: [{ facture_id: 'a1', numero: 'FAC-2026-0001', ht: 300_000n, tva: 39_000n, ttc: 339_000n }],
  }));
  it.each([
    ['TVA 10 %', 'TVA 10 % sur 7 000,00 € 700,00 €'], ['TVA 20 %', 'TVA 20 % sur 3 000,00 € 600,00 €'], ['total TTC', 'Total TTC 11 300,00 €'],
    ['acompte déduit', 'Acompte FAC-2026-0001 déduit -3 390,00 €'], ['détail HT / TVA de l’acompte', 'dont HT 3 000,00 €, TVA 390,00 €'], ['net', 'Net à payer 7 910,00 €'],
    ['indemnité (professionnel)', 'Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40,00 €.'],
    ['TVA intracom vendeur', 'TVA intracommunautaire FR00123456789'], ['TVA client', 'TVA FR00987654321'],
  ])('%s', (_, attendu) => expect(t).toContain(attendu));
  it('pas de mention de franchise', () => expect(t).not.toContain('293 B'));
});

describe('autoliquidation', async () => {
  const t = texte(await pdfFacture({ ...base, regime: 'assujetti', autoliquidation: true, deductions: [],
    emetteur: { ...copieEmetteur({ ...params, regime_tva: 'assujetti', numero_tva_intra: 'FR00123456789' }, assurances, '2026-10-09'), paiement },
    lignes: [l('Sous-traitance peinture', 10_000n, 100_000n, 1_000)] }));
  it('TVA nulle et mention dédiée', () => {
    expect(t).toContain('TVA 10 % sur 1 000,00 € 0,00 €');
    expect(t).toContain('Autoliquidation : TVA due par le preneur');
  });
});

describe('situation : avancement par ligne', async () => {
  const t = texte(await pdfFacture({ ...base, type: 'situation', numero: 'FAC-2026-0003', avancementBp: 4_000, deductions: [],
    lignes: [l('Murs', 319_300n, 1_250n, 0, { unite: 'm2', avancementBp: 5_000 })] }));
  it('colonne avancement et total arrondi en une fois (199,56 €)', () => {
    expect(t).toContain('Facture de situation n° FAC-2026-0003');
    expect(t).toMatch(/Murs\s+31,93\s+m²\s+12,50 €\s+50 %\s+199,56 €/);
  });
});

describe('avoir', async () => {
  const octets = await pdfFacture({ ...base, type: 'avoir', numero: 'AVO-2026-0001', devis: null, deductions: [],
    origine: { numero: 'FAC-2026-0002', dateEmission: '2026-10-09' }, natureAvoir: 'correction', lignes: [l('Avoir', 10_000n, 50_000n, 0)] });
  const t = texte(octets);
  it('titre, facture d’origine, nature ; ni échéance ni règlement', () => {
    expect(t).toContain('Avoir n° AVO-2026-0001');
    expect(t).toContain('Avoir sur la facture n° FAC-2026-0002 du 09/10/2026 (correction ou annulation)');
    expect(t).toContain('Total HT de l’avoir 500,00 €');
    expect(t).not.toContain('Échéance');
    expect(t).not.toContain('IBAN');
    expect(qrImprime(octets)).toBeNull();
  });
});

describe('avoir d’annulation d’une finale qui déduisait un acompte (1 000,03 € HT à 20 %, acompte 360,01 €)', async () => {
  const emAss = { ...copieEmetteur({ ...params, regime_tva: 'assujetti', numero_tva_intra: 'FR00123456789' }, assurances, '2026-10-09'), paiement };
  const t = texte(await pdfFacture({ ...base, type: 'avoir', numero: 'AVO-2026-0002', devis: null, regime: 'assujetti', emetteur: emAss,
    origine: { numero: 'FAC-2026-0002', dateEmission: '2026-10-09' }, natureAvoir: 'correction', lignes: [l('Murs', 10_000n, 100_003n, 2_000)],
    deductions: [{ facture_id: 'a1', numero: 'FAC-2026-0001', ht: 30_001n, tva: 6_000n, ttc: 36_001n }],
    ventilationsDeduites: [[{ taux_bp: 2_000, base_ht_cents: 30_001n, tva_cents: 6_000n }]] }));
  it('totaux bruts présentés comme ceux de la facture corrigée ; seul le montant de l’avoir porte le crédit, avec sa TVA nette', () => {
    expect(t).toContain('Total HT de la facture corrigée 1 000,03 €');
    expect(t).toContain('Total TTC de la facture corrigée 1 200,04 €');
    expect(t).toContain('Acompte FAC-2026-0001 : facture distincte, non reprise -360,01 €');
    expect(t).toContain('Montant de l’avoir 840,03 €');
    expect(t).toContain('dont HT 700,02 €, TVA 20 % : 140,01 €');
    expect(t).not.toMatch(/Total (HT|TTC) de l’avoir|reste acquis|déduit/);
  });
});

describe('aperçu d’un brouillon', async () => {
  const t = texte(await pdfFacture({ ...base, numero: null, brouillon: true }));
  it('sans numéro, marqué', () => {
    expect(t).toContain('Facture (aperçu, numéro attribué à l’émission)');
    expect(t).toContain('APERÇU : BROUILLON SANS VALEUR');
  });
});
