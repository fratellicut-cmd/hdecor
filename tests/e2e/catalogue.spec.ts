import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { adminTests, seConnecter, surveillerConsole } from './outils';

const unique = () => Date.now().toString(36).slice(-5) + Math.floor(Math.random() * 100);

test.beforeEach(async ({ page }) => { await seConnecter(page); });

test('produit : création, formats et prix, historique daté, vérification avec date et source', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  const marque = `Marque-${unique()}`;
  await page.goto('/catalogue');
  await page.getByRole('link', { name: /Produits/ }).first().click();
  await page.getByRole('link', { name: '+ Nouveau' }).click();
  await page.getByLabel('Marque').fill(marque);
  await page.getByLabel('Référence fabricant').fill('REF-E2E');
  await page.getByLabel('Désignation').fill('Acrylique velours e2e');
  await page.getByLabel('Type').selectOption('acrylique');
  await page.getByRole('checkbox', { name: 'Mur' }).check();
  await page.getByLabel('Finition').selectOption('velours');
  await page.getByLabel(/^Rendement/).fill('11,5');
  await page.getByRole('button', { name: 'Enregistrer le produit' }).click();
  await expect(page.getByText('Produit enregistré.')).toBeVisible();
  await expect(page.getByText('À VÉRIFIER').first()).toBeVisible();

  // Formats et prix : 2,5 L à 32,00 €, puis 10 L sans prix.
  await page.getByText('+ Ajouter un format').click();
  await page.getByLabel('Contenance (L)').fill('2,5');
  await page.getByLabel('Prix d’achat HT (€)').fill('32');
  await page.getByRole('button', { name: 'Ajouter le format' }).click();
  await expect(page.getByText('Format ajouté.')).toBeVisible();
  await page.getByLabel('Contenance (L)').fill('10');
  await page.getByRole('button', { name: 'Ajouter le format' }).click();
  await expect(page.getByLabel('Prix HT du pot de 10 L (€)')).toBeVisible();
  // Changement de prix : historisé.
  await page.getByLabel('Prix HT du pot de 2,5 L (€)').fill('34,50');
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await expect(page.getByText('Prix enregistré.')).toBeVisible();
  await page.reload();
  const historique = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Historique des prix d’achat' }) });
  await expect(historique.getByText(/34,50\s*€/)).toBeVisible();
  await expect(historique.getByText(/32,00\s*€/)).toBeVisible();

  // Vérification : la date et la source sont exigées.
  await page.getByRole('link', { name: 'Modifier' }).click();
  await page.getByLabel('J’ai vérifié ces valeurs sur la fiche technique').check();
  await page.getByRole('button', { name: 'Enregistrer le produit' }).click();
  await expect(page.getByText('Date de vérification : obligatoire pour « vérifié ».')).toBeVisible();
  await page.getByLabel('Vérifié le').fill('2026-10-01');
  await page.getByLabel('Source').fill('Fiche technique 2026');
  await page.getByRole('button', { name: 'Enregistrer le produit' }).click();
  await expect(page.getByText('Vérifié', { exact: true })).toBeVisible();
  await expect(page.getByText('Vérifié le 01/10/2026 (Fiche technique 2026).')).toBeVisible();

  // Même référence dans la même marque : refusée.
  await page.goto('/catalogue/produits/nouveau');
  await page.getByLabel('Marque').fill(marque.toUpperCase());
  await page.getByLabel('Référence fabricant').fill('ref-e2e');
  await page.getByLabel('Désignation').fill('Doublon');
  await page.getByLabel('Type').selectOption('acrylique');
  await page.getByRole('button', { name: 'Enregistrer le produit' }).click();
  await expect(page.getByText('Cette référence existe déjà pour cette marque dans le catalogue.')).toBeVisible();
  expect(erreurs).toEqual([]);
});

test('import CSV : aperçu ligne par ligne, lignes valides seules, mise à jour sans doublon ; export réimportable', async ({ page }) => {
  const marque = `Import-${unique()}`;
  const titres = 'Marque;Gamme;Référence fabricant;Désignation;Type;Usages;Finition;Unité (L ou kg);Rendement (m² par L ou kg, par couche);Couches recommandées;Séchage avant recouvrement (h);Formats (L ou kg);Prix d’achat HT par format (€);Fournisseur;Fiche technique (lien)';
  const fichier = (lignes: string[]) => ({ name: 'catalogue.csv', mimeType: 'text/csv', buffer: Buffer.from(`﻿${[titres, ...lignes].join('\r\n')}`) });

  await page.goto('/catalogue/import');
  await page.locator('input[type="file"]').setInputFiles(fichier([
    `${marque};;I-1;Laque satinée import;Laque;boiserie;satin;L;12;2;24;0,5 / 2,5;12,90 / 49,00;;`,
    `${marque};;I-2;Ligne fausse;peinture magique;;;;;;;;;;`,
  ]));
  await expect(page.getByText('1 création(s), 0 mise(s) à jour, 1 ligne(s) en erreur.')).toBeVisible();
  await expect(page.getByText(/Type « peinture magique » inconnu/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Valider l’import' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Importer seulement les 1 ligne(s) valide(s)' }).check();
  await page.getByRole('button', { name: 'Valider l’import' }).click();
  await expect(page.getByText(/Import terminé : 1 produit\(s\) créé\(s\), 0 mis à jour, 1 ligne\(s\) en erreur ignorée\(s\)/)).toBeVisible();

  // Réimport du même produit (référence en minuscules, prix du 0,5 L changé) : mise à jour, pas de doublon.
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(fichier([`${marque.toLowerCase()};;i-1;Laque satinée import v2;Laque;boiserie;satin;L;12;2;24;0,5 / 2,5;13,50 /;;`]));
  await expect(page.getByText('0 création(s), 1 mise(s) à jour, 0 ligne(s) en erreur.')).toBeVisible();
  await page.getByRole('button', { name: 'Valider l’import' }).click();
  await expect(page.getByText(/0 produit\(s\) créé\(s\), 1 mis à jour/)).toBeVisible();

  const admin = adminTests();
  const { data: produits } = await admin.from('produits').select('designation, statut_verification, conditionnements (contenance, prix_achat_ht_cents)').eq('marque', marque);
  expect(produits).toHaveLength(1);
  expect(produits![0]!.designation).toBe('Laque satinée import v2');
  expect(produits![0]!.statut_verification).toBe('a_verifier');
  expect(produits![0]!.conditionnements.sort((a, b) => a.contenance - b.contenance)).toEqual([
    { contenance: 500, prix_achat_ht_cents: 1350 }, { contenance: 2500, prix_achat_ht_cents: 4900 },
  ]);

  // Export : la ligne est présente, au format du modèle (marque et référence gardent leur casse d'origine).
  const [telechargement] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Exporter les produits (CSV)' }).click()]);
  const contenu = readFileSync((await telechargement.path())!, 'utf8');
  expect(contenu.startsWith('﻿')).toBe(true);
  expect(contenu).toContain(`${marque};;I-1;Laque satinée import v2;Laque;boiserie;satin;L;12;2;24;0,5 / 2,5;13,50 / 49,00;;`);
});

test('nuancier et prestation ; teinte proposée sur la pièce et le poste ; prix du catalogue dans le calcul', async ({ page }) => {
  const id = unique();
  await page.goto('/catalogue/teintes');
  await page.getByLabel('Nom').fill(`Gris perle ${id}`);
  await page.getByLabel('Code RAL').fill('RAL 7035');
  await page.getByLabel('Aperçu (code couleur)').fill('#c5c7c4');
  await page.getByRole('button', { name: 'Ajouter la teinte' }).click();
  await expect(page.getByText('Teinte ajoutée.')).toBeVisible();
  await expect(page.getByText(`Gris perle ${id}`).first()).toBeVisible();

  await page.goto('/catalogue/prestations/nouvelle');
  await page.getByLabel('Libellé').fill(`Peinture murs 2 couches ${id}`);
  await page.getByLabel('Prix unitaire HT (€)').fill('18,50');
  await page.getByLabel('Taux de TVA').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Enregistrer la prestation' }).click();
  await expect(page.getByText('Prestation enregistrée.')).toBeVisible();
  await expect(page.getByText(`Peinture murs 2 couches ${id}`)).toBeVisible();

  // Produit chiffré du catalogue (fictif) utilisé par un poste : coût au moindre prix.
  const admin = adminTests();
  const { data: org } = await admin.from('parametres_entreprise').select('organisation_id').eq('raison_sociale', 'Entreprise de test E2E').single();
  const { data: produit } = await admin.from('produits').insert({
    organisation_id: org!.organisation_id, marque: `Fictive ${id}`, designation: 'Acrylique catalogue', type: 'acrylique',
    usages: ['mur'], rendement_m2_par_unite: 10, statut_verification: 'fictif',
  }).select('id').single();
  await admin.from('conditionnements').insert([{ contenance: 2500, prix: 3000 }, { contenance: 5000, prix: 5000 }, { contenance: 10000, prix: 9000 }]
    .map((c) => ({ organisation_id: org!.organisation_id, produit_id: produit!.id, contenance: c.contenance, prix_achat_ht_cents: c.prix })));

  await page.goto('/clients/nouveau');
  await page.getByLabel('Nom', { exact: true }).fill(`Client-cat-${id}`);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('link', { name: '+ Chantier' }).click();
  await page.getByLabel('Nom du chantier').fill(`Cat-${id}`);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('link', { name: /Pièce/ }).first().click();
  await page.getByLabel('Nom de la pièce').fill('Chambre');
  await page.getByLabel('Longueur (m)').fill('4');
  await page.getByLabel('Largeur (m)').fill('3');
  await page.getByLabel('Teinte (nuancier)').selectOption({ label: `Gris perle ${id}` });
  await page.getByRole('button', { name: 'Enregistrer la pièce' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Chambre' })).toBeVisible();
  await page.getByText('+ Ajouter une ouverture').click();
  await page.getByRole('button', { name: 'Ajouter l’ouverture' }).click();
  await expect(page.getByText('Porte : 83 × 204 cm')).toBeVisible();
  await page.getByLabel('Type').selectOption('fenetre');
  await page.getByLabel('Largeur (cm)').fill('120');
  await page.getByLabel('Hauteur (cm)').fill('115');
  await page.getByRole('button', { name: 'Ajouter l’ouverture' }).click();
  await expect(page.getByText('Fenêtre : 120 × 115 cm')).toBeVisible();

  await page.getByRole('link', { name: /Peinture de cette pièce/ }).click();
  // Teinte de la pièce proposée d'office.
  await expect(page.getByLabel('Teinte du catalogue').locator('option:checked')).toHaveText(`Gris perle ${id}`);
  await page.getByLabel('Produit du catalogue').selectOption({ label: `Fictive ${id} Acrylique catalogue (À VÉRIFIER)` });
  await page.getByRole('button', { name: 'Enregistrer et calculer' }).click();
  const carte = page.locator('section[id^="poste-"]').filter({ hasText: 'Chambre : murs' });
  // 7,02 L : 5 + 2,5 L = 80,00 € (moins cher que 10 L à 90,00 €).
  await expect(carte.getByText(/^1 × 5\s*L \+ 1 × 2,5\s*L/)).toBeVisible();
  await expect(carte.getByText('choix au moindre coût')).toBeVisible();
  await expect(carte.getByText(/80,00\s*€/)).toBeVisible();
});

test('import d’un CSV Excel en Windows-1252 : accents intacts ; colonnes absentes conservées', async ({ page }) => {
  const marque = `Ansi-${unique()}`;
  const texte = `Marque;Référence fabricant;Désignation;Type;Usages;Finition;Rendement (m² par L ou kg, par couche)\r\n${marque};A-1;Laque satinée façade;Laque;boiserie, extérieur;satin;12,5\r\n`;
  // Encodage Windows-1252 (un octet par caractère, « ² » = 0xB2).
  const octets = Buffer.from([...texte].map((c) => (c === '²' ? 0xb2 : c.charCodeAt(0))));
  await page.goto('/catalogue/import');
  await page.locator('input[type="file"]').setInputFiles({ name: 'excel.csv', mimeType: 'text/csv', buffer: octets });
  await expect(page.getByText(/Fichier : excel\.csv \(Windows-1252\)/)).toBeVisible();
  await expect(page.getByText('1 création(s), 0 mise(s) à jour, 0 ligne(s) en erreur.')).toBeVisible();
  await page.getByRole('button', { name: 'Valider l’import' }).click();
  await expect(page.getByText(/1 produit\(s\) créé\(s\)/)).toBeVisible();
  // Aperçu relu après l'import : la ligne devient une mise à jour.
  await expect(page.getByText('0 création(s), 1 mise(s) à jour, 0 ligne(s) en erreur.')).toBeVisible();

  // Fichier partiel (marque, référence, désignation, type, formats, prix) : le rendement n'est pas effacé.
  const partiel = `Marque;Référence fabricant;Désignation;Type;Formats (L ou kg);Prix d’achat HT par format (€)\r\n${marque};A-1;Laque satinée façade;Laque;0,5;14,90\r\n`;
  await page.locator('input[type="file"]').setInputFiles({ name: 'prix.csv', mimeType: 'text/csv', buffer: Buffer.from(partiel) });
  await expect(page.getByText('0 création(s), 1 mise(s) à jour, 0 ligne(s) en erreur.')).toBeVisible();
  await expect(page.getByText(/1 produit\(s\) créé\(s\)/)).toHaveCount(0); // ancien message effacé
  await page.getByRole('button', { name: 'Valider l’import' }).click();
  await expect(page.getByText(/0 produit\(s\) créé\(s\), 1 mis à jour/)).toBeVisible();
  const { data } = await adminTests().from('produits').select('designation, usages, rendement_m2_par_unite, finition, conditionnements (contenance, prix_achat_ht_cents)').eq('marque', marque).single();
  expect(data).toEqual({ designation: 'Laque satinée façade', usages: ['boiserie', 'exterieur'], rendement_m2_par_unite: 12.5, finition: 'satin',
    conditionnements: [{ contenance: 500, prix_achat_ht_cents: 1490 }] });
});

