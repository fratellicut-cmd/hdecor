import { expect, test } from '@playwright/test';
import { adminTests, seConnecter, surveillerConsole } from './outils';

test.beforeEach(async ({ page }) => { await seConnecter(page); });

test('entreprise : SIRET et IBAN contrôlés, enregistrement conservé', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  await page.goto('/parametres/entreprise');
  await page.getByLabel('SIRET').fill('732 829 320 00075');
  await page.getByLabel('IBAN').fill('FR76 3000 6000 0112 3456 7890 188');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('SIRET invalide : vérifiez les 14 chiffres.')).toBeVisible();
  await expect(page.getByText('IBAN invalide : vérifiez la saisie.')).toBeVisible();
  await expect(page.getByLabel('SIRET')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('SIRET').fill('732 829 320 00074');
  await page.getByLabel('IBAN').fill('fr76 3000 6000 0112 3456 7890 189');
  await page.getByLabel('Code postal').fill('57290');
  await page.getByLabel('Ville').fill('Serémange-Erzange');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Enregistré.' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('SIRET')).toHaveValue('73282932000074');
  await expect(page.getByLabel('IBAN')).toHaveValue('FR76 3000 6000 0112 3456 7890 189');
  await expect(page.getByLabel('Ville')).toHaveValue('Serémange-Erzange');
  expect(erreurs).toEqual([]);
});

test('conditions : une valeur À VÉRIFIER se confirme une par une', async ({ page }) => {
  // État de départ rejouable : toutes les valeurs par défaut à vérifier.
  await adminTests().from('parametres_entreprise').update({
    taux_penalites_bp: null,
    valeurs_a_verifier: ['delai_paiement_jours', 'delai_paiement_max_jours', 'indemnite_recouvrement_cents',
      'escompte_texte', 'validite_devis_jours', 'acompte_pct_defaut_bp', 'taux_penalites_bp'],
  }).eq('raison_sociale', 'Entreprise de test E2E');
  await page.goto('/parametres/conditions');
  const champ = page.locator('label[for="taux_penalites_bp"]');
  await expect(champ.getByText('À VÉRIFIER')).toBeVisible();
  await page.getByLabel('Taux des pénalités de retard (% par an)').fill('abc');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Pourcentage invalide (exemple : 10 ou 5,5).')).toBeVisible();
  await expect(page.getByLabel('Taux des pénalités de retard (% par an)')).toHaveValue('abc');
  await page.getByLabel('Taux des pénalités de retard (% par an)').fill('12,5');
  await page.locator('input[name="confirmes"][value="taux_penalites_bp"]').check();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Enregistré.' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Taux des pénalités de retard (% par an)')).toHaveValue('12,5');
  await expect(champ.getByText('À VÉRIFIER')).toHaveCount(0);
  // Les autres valeurs par défaut restent à vérifier.
  await expect(page.locator('label[for="indemnite_recouvrement_cents"]').getByText('À VÉRIFIER')).toBeVisible();
});

test('assurances : ajout puis suppression', async ({ page }) => {
  await page.goto('/parametres/assurances');
  await page.getByLabel('Assureur').fill('Assureur Exemple');
  await page.getByLabel('Numéro de contrat').fill('DEC-0001');
  await page.getByLabel('Début').fill('2026-01-01');
  await page.getByLabel('Fin (si connue)').fill('2025-01-01');
  await page.getByLabel('Zone géographique couverte').fill('France métropolitaine');
  await page.getByRole('button', { name: 'Ajouter l’assurance' }).click();
  await expect(page.getByText('La fin doit suivre le début.')).toBeVisible();
  // La saisie n'est pas perdue après une erreur.
  await expect(page.getByLabel('Assureur')).toHaveValue('Assureur Exemple');
  await expect(page.getByLabel('Zone géographique couverte')).toHaveValue('France métropolitaine');
  await page.getByLabel('Fin (si connue)').fill('2026-12-31');
  await page.getByRole('button', { name: 'Ajouter l’assurance' }).click();
  await expect(page.getByRole('heading', { name: 'Décennale : Assureur Exemple' })).toBeVisible();
  await expect(page.getByText('Du 01/01/2026 au 31/12/2026')).toBeVisible();
  const carte = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Décennale : Assureur Exemple' }) });
  await carte.getByText('Supprimer…').click();
  // Sans la case : le navigateur bloque ; on retire le contrôle pour vérifier le refus du serveur.
  await carte.locator('input[name="confirmation"]').evaluate((e) => e.removeAttribute('required'));
  await carte.getByRole('button', { name: 'Supprimer l’assurance' }).click();
  await expect(carte.getByText('Cochez la case pour confirmer la suppression.')).toBeVisible();
  await carte.getByLabel('Je confirme la suppression de cette assurance.').check();
  await carte.getByRole('button', { name: 'Supprimer l’assurance' }).click();
  await expect(page.getByRole('heading', { name: 'Décennale : Assureur Exemple' })).toHaveCount(0);
});

test('statut fiscal : paliers incohérents refusés, franchise par défaut', async ({ page }) => {
  await page.goto('/parametres/fiscal');
  await expect(page.getByLabel(/Franchise en base de TVA/)).toBeChecked();
  await page.getByLabel('1re alerte (%)').fill('96');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Le premier palier d’alerte doit être inférieur ou égal au second.')).toBeVisible();
});

test('statut fiscal : une mention confirmée puis modifiée repasse À VÉRIFIER', async ({ page }) => {
  await page.goto('/parametres/fiscal');
  const mention = page.getByLabel(/Mention de franchise/);
  const texte = await mention.inputValue();
  await page.getByLabel('Je confirme cette mention (validée par le comptable)').check();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Enregistré.' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('État : mention confirmée.')).toBeVisible();
  // La case n'est jamais pré-cochée : modifier le texte suffit à le repasser À VÉRIFIER.
  await expect(page.getByLabel('Je confirme cette mention (validée par le comptable)')).not.toBeChecked();
  await mention.fill(`${texte} `.trim() + ' (modifiée)');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Enregistré.' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('État : mention À VÉRIFIER.')).toBeVisible();
  // Remise en état pour les autres parcours.
  await mention.fill(texte);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Enregistré.' })).toBeVisible();
});
