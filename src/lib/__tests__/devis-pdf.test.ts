import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { LigneDevis } from '@/domain/devis';
import { copieChantier, copieClient, copieEmetteur, type ParametresEmetteur } from '@/domain/devis-document';

vi.mock('server-only', () => ({}));
const { pdfDevis, pdfDevisSigne } = await import('../pdf/devis');

/** Texte réel du PDF (pdftotext, poppler). */
function texteDuPdf(octets: Uint8Array): string {
  const dossier = mkdtempSync(path.join(tmpdir(), 'hdecor-devis-'));
  const fichier = path.join(dossier, 'devis.pdf');
  writeFileSync(fichier, octets);
  return execFileSync('pdftotext', ['-layout', fichier, '-'], { encoding: 'utf8' }).replace(/[   ]+/g, ' ');
}
/** PNG 40 × 20 gris (tracé de signature de test), construit à la main. */
function pngDeTest(): Uint8Array {
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const bloc = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type), data]);
    const n = Buffer.alloc(4); n.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(t));
    return Buffer.concat([n, t, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(40, 0); ihdr.writeUInt32BE(20, 4); ihdr[8] = 8; ihdr[9] = 0;
  const brut = Buffer.alloc(20 * 41, 0x80); for (let y = 0; y < 20; y++) brut[y * 41] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', ihdr), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))]);
}
const PNG = pngDeTest();
const pages = (octets: Uint8Array) => texteDuPdf(octets).split('\f').filter((p) => p.trim()).length;

const params: ParametresEmetteur = {
  raison_sociale: 'Entreprise de test', forme_juridique: 'EI', nom_dirigeant: 'Prénom Nom', siret: '12345678900011', immatriculation: 'RNE (exemple fictif)',
  adresse_ligne1: '1 rue de l’Exemple', adresse_ligne2: null, code_postal: '75011', ville: 'Paris', telephone: '06 00 00 00 00', email: 'contact@example.test',
  numero_tva_intra: null, regime_tva: 'franchise', mention_franchise: 'TVA non applicable, art. 293 B du CGI', mediateur_nom: 'Médiateur fictif',
  mediateur_coordonnees: '2 rue du Test, 75001 Paris', mediateur_site: 'https://mediateur.example.test', mentions_pied: 'Mentions de pied (exemple).',
};
const assurances = [
  { type: 'decennale' as const, assureur: 'Assureur fictif', numero_contrat: 'D-123', debut: '2026-01-01', fin: '2026-12-31', zone_couverte: 'France métropolitaine' },
  { type: 'rc_pro' as const, assureur: 'Assureur fictif', numero_contrat: 'R-456', debut: '2025-01-01', fin: '2025-12-31', zone_couverte: null },
];
const particulier = copieClient({
  type: 'particulier', civilite: 'Mme', nom: 'Martin', prenom: 'Alice', raison_sociale: null, siret: null, tva_intra: null, email: 'alice@example.test',
  telephone: null, fact_ligne1: '3 avenue des Lilas', fact_ligne2: null, fact_code_postal: '93260', fact_ville: 'Les Lilas', fact_pays: 'France',
});
const chantier = copieChantier({ nom: 'Appartement Lilas', adresse_ligne1: '3 avenue des Lilas', adresse_ligne2: 'Bât. B', code_postal: '93260', ville: 'Les Lilas' });

const l = (designation: string, qE4: bigint, pu: bigint, taux: number, autres: Partial<LigneDevis> = {}): LigneDevis => ({
  type: 'ligne', designation, quantiteE4: qE4, unite: 'm2', prixUnitaireCents: pu, remiseBp: 0, tauxTvaBp: taux, optionnelle: false, ...autres,
});
const lignesFranchise: LigneDevis[] = [
  { type: 'section', designation: 'Séjour', quantiteE4: null, unite: null, prixUnitaireCents: null, remiseBp: 0, tauxTvaBp: null, optionnelle: false },
  l('Murs : acrylique velours 2 couches', 319_300n, 1_250n, 0, { description: 'Lessivage, rebouchage, ponçage' }),
  l('Plafond', 200_000n, 1_500n, 0, { remiseBp: 1_000 }),
  { type: 'sous_total', designation: 'Sous-total séjour', quantiteE4: null, unite: null, prixUnitaireCents: null, remiseBp: 0, tauxTvaBp: null, optionnelle: false },
  l('Boiseries laquées', 50_000n, 2_000n, 0, { id: 'opt', optionnelle: true, unite: 'ml' }),
];

const base = {
  numero: 'DEV-2026-0001', version: 1, dateEmission: '2026-10-09', validiteJours: 30, brouillon: false,
  emetteur: copieEmetteur(params, assurances, '2026-10-09'), client: particulier, chantier, objet: 'Peinture du séjour',
  dateDebutTravaux: '2026-11-02', delaiDebutTexte: null, dureeEstimeeJours: 3, conditionsPaiement: 'Solde à réception de facture, par virement.',
  horsEtablissement: true, notesClient: null, regime: 'franchise' as const, remiseGlobaleBp: 0, lignes: lignesFranchise,
  echeances: [
    { libelle: 'Acompte', pourcentageBp: 3_000, declencheur: 'signature' as const, datePrevue: null },
    { libelle: 'Solde', pourcentageBp: 7_000, declencheur: 'fin_travaux' as const, datePrevue: null },
  ],
  acomptePctBp: 3_000,
};

describe('devis en PDF : franchise, particulier, hors établissement (PDF réel)', async () => {
  const octets = await pdfDevis(base);
  const t = texteDuPdf(octets);
  it('PDF valide', () => expect(Buffer.from(octets.slice(0, 5)).toString()).toBe('%PDF-'));
  it.each([
    ['numéro', 'Devis n° DEV-2026-0001'], ['date', 'Date : 09/10/2026'], ['validité', 'Valable jusqu’au 08/11/2026 (30 jours)'],
    ['émetteur et forme', 'Entreprise de test EI'], ['SIRET', 'SIRET 12345678900011'], ['immatriculation', 'RNE (exemple fictif)'],
    ['adresse émetteur', '75011 Paris'], ['client', 'Alice Martin'], ['adresse client', '93260 Les Lilas'],
    ['adresse des travaux', 'Adresse des travaux : Appartement Lilas, 3 avenue des Lilas, Bât. B, 93260 Les Lilas'],
    ['description', 'Lessivage, rebouchage, ponçage'], ['quantité', '31,93'], ['unité', 'm²'], ['PU HT', '12,50 €'],
    ['total ligne R4 (399,125)', '399,13 €'], ['remise de ligne', 'Remise 10 % incluse'], ['ligne remisée 20 × 15 × 0,9', '270,00 €'],
    ['sous-total', 'Sous-total séjour HT : 669,13 €'], ['total HT', 'Total HT 669,13 €'], ['net à payer', 'Net à payer 669,13 €'],
    ['mention de franchise', 'TVA non applicable, art. 293 B du CGI'], ['option', 'OPTION : Boiseries laquées'],
    ['option hors total', 'non comprises dans le total'], ['début', 'Début des travaux : à partir du 02/11/2026.'],
    ['durée', 'Durée estimée des travaux : 3 jours.'], ['acompte : 30 % de 669,13 = 200,739 -> 200,74', 'Acompte : 30 % à la signature, soit 200,74 €'],
    ['solde', 'Solde : 70 % à la fin des travaux, soit 468,39 €'], ['conditions', 'Solde à réception de facture, par virement.'],
    ['décennale', 'Assurance décennale : Assureur fictif, contrat n° D-123, du 01/01/2026 au 31/12/2026, couverture : France métropolitaine'],
    ['médiateur', 'Médiateur de la consommation : Médiateur fictif'], ['rétractation', 'quatorze (14) jours'],
    ['exécution anticipée', 'demande expresse'], ['devis reçu', 'Devis reçu avant l’exécution des travaux.'], ['bon pour accord', 'Bon pour accord'],
    ['options à cocher', 'Options retenues : [ ] Boiseries laquées'], ['pied', 'Mentions de pied (exemple).'],
    ['formulaire', 'Formulaire de rétractation'], ['formulaire : rayer', '(*) Rayez la mention inutile.'], ['formulaire : numéro', 'Devis n° : DEV-2026-0001 Commandé le'],
  ])('%s', (_, attendu) => expect(t).toContain(attendu));
  it('pas de TVA ni de TTC en franchise', () => {
    expect(t).not.toMatch(/Total TTC|Total TVA/);
  });
  it('RC Pro expirée à la date du devis : absente', () => expect(t).not.toContain('Responsabilité civile'));
  it('pas de mention d’aperçu sur un devis émis', () => expect(t).not.toMatch(/BROUILLON|APERÇU/));
  it('formulaire de rétractation seul sur la dernière page, pagination complète', () => {
    const p = texteDuPdf(octets).split('\f').filter((x) => x.trim());
    expect(p.at(-1)).toContain('Formulaire de rétractation');
    expect(p.at(-1)).not.toContain('Bon pour accord');
    p.forEach((x, i) => expect(x).toContain(`page ${i + 1} / ${p.length}`));
  });
  it('même entrée, même PDF (empreinte stable)', async () => {
    const h = (o: Uint8Array) => createHash('sha256').update(o).digest('hex');
    expect(h(await pdfDevis(base))).toBe(h(octets));
  });
});

describe('devis en PDF : assujetti, professionnel, en établissement', async () => {
  const emetteur = copieEmetteur({ ...params, regime_tva: 'assujetti', numero_tva_intra: 'FR00123456789' }, assurances, '2026-10-09');
  const pro = copieClient({
    type: 'professionnel', civilite: 'M.', nom: 'Durand', prenom: 'Paul', raison_sociale: 'Société Exemple SARL', siret: '98765432100019',
    tva_intra: null, email: null, telephone: null, fact_ligne1: '10 rue du Commerce', fact_ligne2: null, fact_code_postal: '69001', fact_ville: 'Lyon', fact_pays: null,
  });
  const octets = await pdfDevis({
    ...base, numero: 'DEV-2026-0002', version: 2, emetteur, client: pro, horsEtablissement: false, regime: 'assujetti', remiseGlobaleBp: 1_000,
    lignes: [l('Murs', 10_000n, 30_000n, 2_000), l('Peinture logement', 10_000n, 70_000n, 1_000)], echeances: [], acomptePctBp: 3_000,
  });
  const t = texteDuPdf(octets);
  it.each([
    ['version', 'Devis n° DEV-2026-0002 (version 2)'], ['raison sociale client', 'Société Exemple SARL'], ['contact', 'À l’attention de M. Paul Durand'],
    ['SIRET client', 'SIRET 98765432100019'], ['TVA intracom', 'TVA intracommunautaire FR00123456789'],
    ['total lignes', 'Total des lignes HT 1 000,00 €'], ['remise', 'Remise globale 10 % -100,00 €'],
    ['total HT', 'Total HT 900,00 €'], ['TVA 10 %', 'TVA 10 % sur 630,00 € 63,00 €'], ['TVA 20 %', 'TVA 20 % sur 270,00 € 54,00 €'],
    ['total TVA', 'Total TVA 117,00 €'], ['TTC', 'Total TTC 1 017,00 €'],
    ['acompte : (630 × 30 % + 63 × …) = 189 + 18,90 ; 81 + 16,20', 'Acompte à la signature : 30 %, soit 305,10 € TTC.'],
  ])('%s', (_, attendu) => expect(t).toContain(attendu));
  it('pas de mention de franchise ni de rétractation', () => {
    expect(t).not.toContain('293 B');
    expect(t).not.toContain('rétractation');
    expect(pages(octets)).toBe(1);
  });
});

describe('aperçu d’un brouillon', async () => {
  const t = texteDuPdf(await pdfDevis({ ...base, numero: null, brouillon: true }));
  it('sans numéro, avec filigrane', () => {
    expect(t).toContain('Devis (aperçu, numéro attribué à l’émission)');
    expect(t).toContain('APERÇU : BROUILLON SANS VALEUR CONTRACTUELLE');
  });
});

describe('devis long : saut de page avec en-tête du tableau répété', async () => {
  const lignes = Array.from({ length: 60 }, (_, i) => l(`Poste ${i + 1}`, 10_000n, 1_000n, 0, { description: 'Préparation et deux couches de finition' }));
  const t = texteDuPdf(await pdfDevis({ ...base, lignes, horsEtablissement: false }));
  it('toutes les lignes et le total', () => {
    expect(t).toContain('Poste 60');
    expect(t).toContain('Total HT 600,00 €');
    expect(t.match(/Désignation/g)!.length).toBeGreaterThan(1);
  });
});

describe('PDF signé', async () => {
  const original = await pdfDevis(base);
  const sha = createHash('sha256').update(original).digest('hex');
  const signe = await pdfDevisSigne(original, 'Devis n° DEV-2026-0001', {
    methode: 'lien', signataire: 'Alice Martin', mention: 'Bon pour accord', signeLe: '2026-10-10T08:30:00Z', ip: '203.0.113.7',
    userAgent: 'Navigateur de test', documentSha256: sha, options: ['Boiseries laquées'],
    totalAccepte: { htCents: 76_913n, tvaCents: 0n, ttcCents: 76_913n }, regime: 'franchise', image: PNG,
  });
  const t = texteDuPdf(signe);
  it('pages du devis puis certificat', () => {
    expect(pages(signe)).toBe(pages(original) + 1);
    expect(t).toContain('Devis n° DEV-2026-0001');
    expect(t).toContain('Certificat de signature électronique');
  });
  it.each([
    ['signataire', 'Alice Martin'], ['horodatage (Paris)', '10/10/2026 à 10:30'], ['IP', '203.0.113.7'], ['méthode', 'à distance, par lien personnel'],
    ['empreinte', sha], ['options', 'Boiseries laquées'], ['montant', '769,13 € (TVA non applicable)'],
  ])('%s', (_, attendu) => expect(t).toContain(attendu));
  it('l’original n’est pas modifié', () => expect(createHash('sha256').update(original).digest('hex')).toBe(sha));
});
