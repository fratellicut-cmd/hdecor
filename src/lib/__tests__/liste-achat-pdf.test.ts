import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { calculerPoste, listeAchat, type ParametresCalcul, type PosteCalc } from '@/domain/calculateur';
import { texteListeAchat } from '@/domain/liste-texte';

vi.mock('server-only', () => ({}));
const { pdfListeAchat } = await import('../pdf/liste-achat');

const params: ParametresCalcul = {
  margePerteBp: 1000, coefMargeBp: 13_000, tauxHoraireCents: 4500n, formatsDefautMl: [1000, 2500, 5000, 10_000, 15_000],
  formatsDefautG: [5000, 15_000, 25_000], hauteurAlerteMm: 3000, toleranceResteBp: 1000, coefSupport: { ancienne_peinture: { bp: 10_000, aVerifier: true } },
  referentiel: { acrylique: { rendementMinCentiemes: 1000, minutesParM2CoucheCentiemes: 15, sechageDixiemesH: null, aVerifier: true } },
};
const poste: PosteCalc = {
  id: 'm', libelle: 'Chambre : murs', surface: { mm2: 31_926_800n }, cleSurface: 'c|murs|', hauteurMm: 2500, cible: 'murs',
  support: 'ancienne_peinture', zoneHumide: false, taches: false, exterieur: false,
  etapes: [], couches: 2, rendementForceCentiemes: null, margePerteBp: null, majorationTempsBp: 0, typeProduit: null,
  teinte: { id: 't', nom: 'Blanc cassé (fictif)' }, finition: 'velours',
  produit: { id: 'p', libelle: 'Acrylique mat (fictif)', reference: 'REF-FICTIVE', type: 'acrylique', unite: 'L', rendementCentiemes: 1000,
    couchesRecommandees: 2, sechageDixiemesH: null, usages: ['mur'], aVerifier: true, archive: false,
    formats: [{ contenanceMl: 2500, prixCents: 3000n }, { contenanceMl: 5000, prixCents: 5000n }, { contenanceMl: 10_000, prixCents: 9000n }] },
};
const liste = listeAchat([{ poste, resultat: calculerPoste(poste, params) }],
  [{ id: 'k', libelle: 'Bâches et adhésif', mode: 'par_chantier', prixCents: 2500n, aVerifier: true }], params);

/** Texte réel du PDF (pdftotext, poppler). */
function texteDuPdf(octets: Uint8Array): string {
  const dossier = mkdtempSync(path.join(tmpdir(), 'hdecor-pdf-'));
  const fichier = path.join(dossier, 'liste.pdf');
  writeFileSync(fichier, octets);
  return execFileSync('pdftotext', ['-layout', fichier, '-'], { encoding: 'utf8' });
}

describe('liste d’achat en PDF (PDF réel, texte extrait)', () => {
  it('contient produit, référence, teinte, besoin, pots, coûts, total et avertissements', async () => {
    const octets = await pdfListeAchat({ entreprise: 'Entreprise de test', chantier: 'Appartement Lilas', date: new Date('2026-10-09T10:00:00Z') }, liste);
    expect(Buffer.from(octets.slice(0, 5)).toString()).toBe('%PDF-');
    const t = texteDuPdf(octets).replace(/\s+/g, ' ');
    for (const attendu of [
      'Liste d’achat : Appartement Lilas', 'Établie le 09/10/2026', 'Acrylique mat (fictif) [À VÉRIFIER]', 'Réf. REF-FICTIVE',
      'Teinte : Blanc cassé (fictif)', 'Besoin : 7,02 L', 'À acheter : 1 × 5 L + 1 × 2,5 L', 'reste 0,476 L', 'Coût HT : 80,00 €',
      'Bâches et adhésif : 25,00 €', 'Total matière HT : 105,00 €', 'Rendements indicatifs : se référer à la fiche technique du fabricant',
    ]) expect(t).toContain(attendu);
  });
  it('caractères hors du jeu de la police remplacés, pas d’erreur', async () => {
    const octets = await pdfListeAchat({ entreprise: 'A B ≈ ⚠', chantier: 'Test 😀', date: new Date('2026-10-09T10:00:00Z') }, liste);
    const t = texteDuPdf(octets);
    expect(t).toContain('A B env. !');
    expect(t).toContain('Test ?');
  });
});

describe('texte à partager', () => {
  it('liste lisible dans un message, sans donnée du client', () => {
    const t = texteListeAchat('Appartement Lilas', liste);
    expect(t).toContain('• Acrylique mat (fictif) (réf. REF-FICTIVE), finition velours, teinte Blanc cassé (fictif)');
    expect(t).toContain('7,02 L -> 1 × 5 L + 1 × 2,5 L');
    expect(t).toContain('Rendements indicatifs');
  });
});
