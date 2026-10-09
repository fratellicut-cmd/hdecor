import { describe, expect, it } from 'vitest';
import { analyserImport, COLONNES, exporterProduits, modeleImport } from '../catalogue';
import { celluleCsv, fichierCsv, lireCsv } from '../csv';

const TITRES = COLONNES.map((c) => c.titre).join(';');

describe('CSV', () => {
  it('lit le format d’Excel en français : « ; », guillemets, retour à la ligne dans une cellule, BOM, CRLF', () => {
    const t = '﻿A;B;C\r\n1;"deux; trois";"ligne 1\nligne 2"\r\n\r\n"il dit ""oui""";;x\r\n';
    expect(lireCsv(t)).toEqual([['A', 'B', 'C'], ['1', 'deux; trois', 'ligne 1\nligne 2'], ['il dit "oui"', '', 'x']]);
  });
  it('détecte la virgule quand il n’y a pas de point-virgule ; ignore les lignes vides', () => {
    expect(lireCsv('a,b\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('guillemet non refermé : erreur claire', () => {
    expect(() => lireCsv('a;b\n"x;y\n')).toThrow('Guillemet non refermé');
  });
  it('injection de formule neutralisée à l’export, retirée à la relecture ; nombres négatifs intacts', () => {
    expect(celluleCsv('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(celluleCsv('-12,5')).toBe('-12,5');
    expect(lireCsv(fichierCsv(['t'], [['=1+1']]))).toEqual([['t'], ['=1+1']]);
  });
});

describe('import du catalogue', () => {
  const fichier = (...lignes: string[]) => [TITRES, ...lignes].join('\r\n');

  it('ligne complète : types, usages, finition, formats et prix exacts (centimes, ml)', () => {
    const a = analyserImport(fichier('Tollens;Gamme X;REF 1;Acrylique velours;acrylique;Mur, plafond;Velours;L;10,5;2;6;1 / 2,5 / 10;15,90 / 33,50 / 89;Fournisseur;https://exemple.fr/fiche.pdf'));
    expect(a.erreursFichier).toEqual([]);
    expect(a.lignes[0]!.erreurs).toEqual([]);
    expect(a.lignes[0]!.produit).toEqual({
      marque: 'Tollens', gamme: 'Gamme X', reference_fabricant: 'REF 1', designation: 'Acrylique velours', type: 'acrylique',
      usages: ['mur', 'plafond'], finition: 'velours', unite_mesure: 'L', rendement: '10.50', couches: 2, sechage_h: '6.0',
      fournisseur: 'Fournisseur', fiche_technique_url: 'https://exemple.fr/fiche.pdf',
      formats: [{ contenance: 1000, prix_cents: 1590 }, { contenance: 2500, prix_cents: 3350 }, { contenance: 10000, prix_cents: 8900 }],
    });
  });
  it('libellés français acceptés (accents, casse) ; enduit au kg par défaut ; prix vide permis', () => {
    const a = analyserImport(fichier('Marque;;;Enduit de lissage;ENDUIT;métal, Extérieur;;;;;;5 / 25;/ 30'));
    const p = a.lignes[0]!.produit!;
    expect(p.unite_mesure).toBe('kg');
    expect(p.usages).toEqual(['metal', 'exterieur']);
    expect(p.formats).toEqual([{ contenance: 5000, prix_cents: null }, { contenance: 25000, prix_cents: 3000 }]);
  });
  it('erreurs ligne par ligne, en français, avec le numéro de ligne du fichier', () => {
    const a = analyserImport(fichier(
      ';;;Sans marque;acrylique;;;;;;;;;;',
      'M;;;Type inconnu;peinture magique;sol, toit;brillante;litre;dix;7;-1;0 / 2,5 / 2,5;abc;;ftp://x',
    ));
    expect(a.lignes.map((l) => l.numero)).toEqual([2, 3]);
    expect(a.lignes[0]!.erreurs).toEqual(['Marque : obligatoire.']);
    expect(a.lignes[1]!.erreurs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Type « peinture magique » inconnu/),
      expect.stringMatching(/^Usage « toit » inconnu/),
      expect.stringMatching(/^Finition « brillante » inconnue/),
      'Unité « litre » : L ou kg.',
      expect.stringMatching(/^Rendement : nombre invalide/),
      expect.stringMatching(/^Couches recommandées : de 1 à 5/),
      expect.stringMatching(/^Séchage : nombre invalide/),
      expect.stringMatching(/^Format « 0 » invalide/),
      'Format « 2,5 » en double.',
      'Fiche technique : lien commençant par http:// ou https://.',
    ]));
    expect(a.lignes[1]!.produit).toBeNull();
  });
  it('même produit deux fois dans le fichier (marque + référence, casse ignorée) : la seconde ligne est refusée', () => {
    const a = analyserImport(fichier('M;;R1;A;acrylique', 'm;;r1;B;acrylique', 'M;;;Sans réf;acrylique', 'M;;;sans réf;laque'));
    expect(a.lignes.map((l) => l.erreurs)).toEqual([[], ['Même produit qu’à la ligne 2 (marque et référence ou désignation).'], [],
      ['Même produit qu’à la ligne 4 (marque et référence ou désignation).']]);
  });
  it('colonnes obligatoires absentes, colonnes inconnues signalées, fichier vide', () => {
    expect(analyserImport('Nom;Prix\nx;1').erreursFichier[0]).toMatch(/Colonnes obligatoires absentes : « Marque », « Désignation », « Type »/);
    const a = analyserImport('Marque;Désignation;Type;Couleur préférée\nM;D;acrylique;bleu');
    expect(a.colonnesIgnorees).toEqual(['Couleur préférée']);
    expect(a.lignes[0]!.produit?.formats).toEqual([]);
    expect(analyserImport('').erreursFichier).toEqual(['Fichier vide.']);
    expect(analyserImport(TITRES).erreursFichier).toEqual(['Aucune ligne de produit sous les titres.']);
  });
  it('plus de prix que de formats ; plus de 2 000 lignes refusées', () => {
    expect(analyserImport(fichier('M;;;D;acrylique;;;;;;;2,5;10 / 20')).lignes[0]!.erreurs).toContain('Prix : plus de prix que de formats.');
    const beaucoup = fichier(...Array.from({ length: 2001 }, (_, i) => `M;;R${i};D;acrylique`));
    expect(analyserImport(beaucoup).erreursFichier[0]).toMatch(/2001 lignes : 2000 au maximum/);
  });
  it('export -> import : aller-retour sans perte ; le modèle ne contient que les titres', () => {
    const csv = exporterProduits([{
      marque: '=Marque', gamme: null, reference_fabricant: 'R-2', designation: 'Laque; satinée "pro"', type: 'laque', usages: ['boiserie', 'exterieur'],
      finition: 'satin', unite_mesure: 'L', rendement_m2_par_unite: 12.5, couches_recommandees: 2, sechage_recouvrable_h: 24,
      fournisseur: null, fiche_technique_url: null, formats: [{ contenance: 2500, prix_achat_ht_cents: null }, { contenance: 500, prix_achat_ht_cents: 1290 }],
    }]);
    const p = analyserImport(csv).lignes[0]!.produit!;
    expect(p).toMatchObject({
      marque: '=Marque', designation: 'Laque; satinée "pro"', type: 'laque', usages: ['boiserie', 'exterieur'], finition: 'satin',
      rendement: '12.50', couches: 2, sechage_h: '24.0',
      formats: [{ contenance: 500, prix_cents: 1290 }, { contenance: 2500, prix_cents: null }],
    });
    expect(lireCsv(modeleImport())).toEqual([COLONNES.map((c) => c.titre)]);
  });
});
