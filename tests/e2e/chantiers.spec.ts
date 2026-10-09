import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { adminTests, seConnecter, surveillerConsole } from './outils';

const unique = () => Date.now().toString(36).slice(-5);
const telephone = () => `07 ${String(Math.floor(Math.random() * 1e8)).padStart(8, '0').replace(/(\d\d)(?=\d)/g, '$1 ')}`;

test.beforeEach(async ({ page }) => { await seConnecter(page); });

/** Client + chantier vides ; renvoie l'URL du chantier. */
async function nouveauChantier(page: Page, nom: string): Promise<string> {
  await page.goto('/clients/nouveau');
  await page.getByLabel('Nom', { exact: true }).fill(`Client-${nom}`);
  await page.getByLabel('Téléphone').fill(telephone());
  await page.getByLabel('Ville').fill('Thionville');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('link', { name: '+ Chantier' }).click();
  await page.getByLabel('Nom du chantier').fill(nom);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: nom })).toBeVisible();
  return page.url().split('?')[0]!;
}

/** Pièce de référence du cahier des charges : 4 × 3 m, H 2,50, porte + fenêtre. */
async function pieceReference(page: Page, chantier: string) {
  await page.goto(`${chantier}/pieces/nouvelle`);
  await page.getByLabel('Nom de la pièce').fill('Chambre');
  await page.getByLabel('Longueur (m)').fill('4');
  await page.getByLabel('Largeur (m)').fill('3');
  await page.getByLabel('Hauteur sous plafond (m)').fill('2,50');
  await expect(page.getByText(/Périmètre 14,00\s*m · Murs bruts 35,00\s*m² · Plafond 12,00\s*m²/)).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer la pièce' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Chambre' })).toBeVisible();

  await page.getByText('+ Ajouter une ouverture').click();
  // Porte pré-remplie aux dimensions par défaut (83 × 204 cm).
  await expect(page.getByLabel('Largeur (cm)')).toHaveValue('83');
  await expect(page.getByLabel('Hauteur (cm)')).toHaveValue('204');
  await page.getByRole('button', { name: 'Ajouter l’ouverture' }).click();
  await expect(page.getByText('Porte : 83 × 204 cm')).toBeVisible();
  await page.getByLabel('Type').selectOption('fenetre');
  await page.getByLabel('Largeur (cm)').fill('120');
  await page.getByLabel('Hauteur (cm)').fill('115');
  await page.getByRole('button', { name: 'Ajouter l’ouverture' }).click();
  await expect(page.getByText('Fenêtre : 120 × 115 cm')).toBeVisible();
}

test('métré de référence : 31,93 m² de murs, 12,00 m² de plafond, détail visible', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  const chantier = await nouveauChantier(page, `Metre-${unique()}`);
  await pieceReference(page, chantier);
  // Les surfaces s'écrivent avec une espace insécable avant « m² ».
  await expect(page.getByRole('definition').filter({ hasText: /^31,93\s*m²$/ })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^12,00\s*m²$/ })).toBeVisible();
  await page.getByText('Détail du calcul').click();
  await expect(page.getByRole('cell', { name: '2 × (4,00 m + 3,00 m) = 14,00 m' })).toBeVisible();
  await page.goto(chantier);
  await expect(page.getByText(/Total : murs 31,93\s*m² · plafonds 12,00\s*m²/)).toBeVisible();
  expect(erreurs).toEqual([]);
});

test('calcul peinture : 7,02 L, pots 5 + 2,5 L, avertissements, puis coût avec un produit chiffré', async ({ page }) => {
  const nom = `Peinture-${unique()}`;
  const chantier = await nouveauChantier(page, nom);
  await pieceReference(page, chantier);

  // Sans produit : type « acrylique », rendement 10 m²/L (bas de la fourchette), formats sans prix.
  await page.getByRole('link', { name: /Peinture de cette pièce/ }).click();
  await page.getByRole('button', { name: 'Enregistrer et calculer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Calcul peinture' })).toBeVisible();
  const carte = page.locator('section').filter({ hasText: 'Chambre : murs' });
  await expect(carte.getByText('7,02 L')).toBeVisible();
  await expect(carte.getByText('1 × 5 L + 1 × 2,5 L')).toBeVisible();
  await expect(carte.getByText('prix inconnus : choix au moindre reste')).toBeVisible();
  await expect(carte.getByText(/Ancienne peinture : prévoir un lessivage/)).toBeVisible();
  await expect(carte.getByText('À VÉRIFIER')).toBeVisible();
  await expect(page.getByText('Rendements indicatifs : se référer à la fiche technique du fabricant et au support réel.')).toBeVisible();

  // Produit chiffré (fictif), créé par l'administration de test.
  const admin = adminTests();
  const { data: org } = await admin.from('parametres_entreprise').select('organisation_id').eq('raison_sociale', 'Entreprise de test E2E').single();
  const { data: produit } = await admin.from('produits').insert({
    organisation_id: org!.organisation_id, marque: 'Fictive', designation: `Acrylique test ${nom}`, type: 'acrylique',
    usages: ['mur', 'plafond'], rendement_m2_par_unite: 10, statut_verification: 'fictif',
  }).select('id').single();
  await admin.from('conditionnements').insert([
    { contenance: 1000, prix: 1500 }, { contenance: 2500, prix: 3000 }, { contenance: 5000, prix: 5000 }, { contenance: 10000, prix: 9000 },
  ].map((c) => ({ organisation_id: org!.organisation_id, produit_id: produit!.id, contenance: c.contenance, prix_achat_ht_cents: c.prix })));

  await carte.getByRole('link', { name: 'Modifier' }).click();
  await page.getByLabel('Produit du catalogue').selectOption({ label: `Fictive Acrylique test ${nom} (À VÉRIFIER)` });
  await page.getByRole('checkbox', { name: /Lessivage/ }).check();
  await page.getByRole('button', { name: 'Enregistrer et calculer' }).click();
  const carte2 = page.locator('section').filter({ hasText: 'Chambre : murs' });
  await expect(carte2.getByText('choix au moindre coût')).toBeVisible();
  await expect(carte2.getByText('80,00 €')).toBeVisible();
  await expect(carte2.getByText(/prévoir un lessivage/)).toHaveCount(0);
  await carte2.getByText('Détail du calcul').click();
  await expect(carte2.getByText(/1 × 10\s*L \(90,00\s*€, reste 2,976\s*L\)/)).toBeVisible();
});

test('liste d’achat : cumul, PDF réel contrôlé, partage', async ({ page }) => {
  const nom = `Achat-${unique()}`;
  const chantier = await nouveauChantier(page, nom);
  await pieceReference(page, chantier);
  for (const cible of ['Murs', 'Plafond']) {
    await page.goto(`${chantier}/peinture/nouveau`);
    await page.getByText(cible, { exact: true }).click();
    await page.getByRole('checkbox', { name: /Lessivage/ }).check();
    await page.getByRole('button', { name: 'Enregistrer et calculer' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Calcul peinture' })).toBeVisible();
  }
  await page.goto(`${chantier}/liste-achat`);
  // Murs 7,023896 L + plafond 12 ÷ 10 × 2 × 1,1 = 2,64 L -> 9,66 L sur une seule ligne.
  await expect(page.getByText('Acrylique (produit à choisir)')).toHaveCount(1);
  await expect(page.getByText('9,66 L')).toBeVisible();
  await expect(page.getByText('1 × 10 L')).toBeVisible();

  const [telechargement] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Télécharger le PDF' }).click()]);
  expect(telechargement.suggestedFilename()).toBe(`liste-achat-${nom}.pdf`);
  const texte = execFileSync('pdftotext', ['-layout', (await telechargement.path())!, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  for (const attendu of [`Liste d’achat : ${nom}`, 'Acrylique (produit à choisir) [À VÉRIFIER]', 'Besoin : 9,66 L', 'À acheter : 1 × 10 L',
    'Rendements indicatifs : se référer à la fiche technique']) expect(texte).toContain(attendu);
  expect(texte).not.toContain(`Client-${nom}`); // aucune donnée du client

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => { (navigator as { share?: unknown }).share = undefined; });
  await page.getByRole('button', { name: 'Partager par message' }).click();
  await expect(page.getByText('Liste copiée : collez-la dans votre message.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('9,66 L -> 1 × 10 L');
});

test('mur par mur : la saisie revient après une coupure, plafond par surface au sol, duplication', async ({ page, context }) => {
  const chantier = await nouveauChantier(page, `Murs-${unique()}`);
  await page.goto(`${chantier}/pieces/nouvelle`);
  await page.getByLabel('Nom de la pièce').fill('Séjour en L');
  await page.getByText('Mur par mur').click();
  await page.getByLabel('Nombre de murs').selectOption('6');
  for (const [i, m] of ['5', '3', '2', '1,5', '3', '1,5'].entries()) await page.getByLabel(`Mur ${i + 1} (m)`).fill(m);
  await page.getByLabel('Hauteur sous plafond (m)').fill('2,5');
  await expect(page.getByText(/Périmètre 16,00\s*m · Murs bruts 40,00\s*m² · Plafond : saisissez la surface au sol/)).toBeVisible();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Enregistrer la pièce' }).click();
  await expect(page.getByText('Hors connexion : rien n’a été envoyé').first()).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText('Saisie non enregistrée récupérée sur ce téléphone.')).toBeVisible();
  await expect(page.getByLabel('Mur 6 (m)')).toHaveValue('1,5');
  await expect(page.getByText(/Périmètre 16,00\s*m · Murs bruts 40,00\s*m²/)).toBeVisible();

  await page.getByLabel('Surface au sol (m²)').fill('12');
  await page.getByRole('button', { name: 'Enregistrer la pièce' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Séjour en L' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^12,00\s*m²$/ })).toBeVisible();

  await page.getByText('Dupliquer la pièce…').click();
  await page.getByRole('button', { name: 'Dupliquer la pièce' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Séjour en L (copie)' })).toBeVisible();
  await page.goto(chantier);
  await expect(page.getByText(/Total : murs 80,00\s*m² · plafonds 24,00\s*m²/)).toBeVisible();
});

test('éléments : plinthes 14 ml × 10 cm = 1,40 m² ; développé manquant signalé', async ({ page }) => {
  const chantier = await nouveauChantier(page, `Plinthes-${unique()}`);
  await pieceReference(page, chantier);
  await page.getByText('+ Ajouter un élément').click();
  await page.getByLabel(/Quantité \(m\)/).fill('14');
  await page.getByRole('button', { name: 'Ajouter l’élément' }).click();
  await expect(page.getByText('Renseignez la largeur développée à peindre')).toBeVisible();
  await page.getByLabel(/Quantité \(m\)/).fill('14');
  await page.getByLabel('Largeur développée à peindre (cm)').fill('10');
  await page.getByRole('button', { name: 'Ajouter l’élément' }).click();
  await expect(page.getByText(/À peindre : 1,40\s*m²/)).toBeVisible();
});

test('suppression : chantier vide supprimé (avec confirmation)', async ({ page }) => {
  const nom = `Supprime-${unique()}`;
  await nouveauChantier(page, nom);
  await page.getByText('Supprimer ce chantier…').click();
  await page.getByLabel('Je confirme la suppression du chantier, de ses pièces et de son métré.').check();
  await page.getByRole('button', { name: 'Supprimer ce chantier' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Chantier supprimé.' })).toBeVisible();
  await expect(page.getByText(nom)).toHaveCount(0);
});

test('réglages : un rendement confirmé perd son « À VÉRIFIER », puis le retrouve s’il change', async ({ page }) => {
  // État de départ rejouable : laque 12 à 14 m²/L, À VÉRIFIER.
  const admin = adminTests();
  const { data: org } = await admin.from('parametres_entreprise').select('organisation_id').eq('raison_sociale', 'Entreprise de test E2E').single();
  await admin.from('referentiel_calcul').update({ rendement_min: 12, rendement_max: 14, statut_verification: 'a_verifier' })
    .eq('organisation_id', org!.organisation_id).eq('type_produit', 'laque');
  await page.goto('/parametres/calcul');
  const ligne = page.locator('form').filter({ has: page.getByText(/^Laque/) });
  await ligne.getByLabel('Valeur confirmée (fiche technique, comptable ou expérience)').check();
  await ligne.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(ligne.getByText('Enregistré.')).toBeVisible();
  await page.reload();
  const ligne2 = page.locator('form').filter({ has: page.getByText(/^Laque/) });
  await expect(ligne2.getByText('À VÉRIFIER')).toHaveCount(0);
  await ligne2.getByLabel('Rendement maxi (m²/L)').fill('13,5');
  await ligne2.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(ligne2.getByText('Enregistré.')).toBeVisible();
  await page.reload();
  const ligne3 = page.locator('form').filter({ has: page.getByText(/^Laque/) });
  await expect(ligne3.getByText('À VÉRIFIER')).toBeVisible();
  // Remise en état.
  await ligne3.getByLabel('Rendement maxi (m²/L)').fill('14');
  await ligne3.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(ligne3.getByText('Enregistré.')).toBeVisible();
});
