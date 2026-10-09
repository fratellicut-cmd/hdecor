import { expect, test, type Page } from '@playwright/test';
import { seConnecter, surveillerConsole } from './outils';

const unique = () => Date.now().toString(36).slice(-5);

/** Réseau « menteur » : le téléphone se croit connecté, mais l'envoi échoue. */
async function couperLesEnvois(page: Page) {
  await page.route('**/*', (route) => (route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue()));
}

test.beforeEach(async ({ page }) => { await seConnecter(page); });

test('page introuvable en français, avec retour à l’accueil', async ({ page }) => {
  const reponse = await page.goto('/clients/00000000-0000-4000-8000-000000000000');
  expect(reponse?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page introuvable' })).toBeVisible();
  await expect(page.getByText('could not be found')).toHaveCount(0);
  await page.getByRole('link', { name: 'Retour à l’accueil' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bonjour' })).toBeVisible();
});

test('4G « menteuse » à l’envoi d’un client : message en français, page et saisie conservées', async ({ page }) => {
  const nom = `Reseau-${unique()}`;
  await page.goto('/clients/nouveau');
  await page.getByLabel('Nom', { exact: true }).fill(nom);
  await couperLesEnvois(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Le réseau ne répond pas : l’enregistrement n’est pas confirmé.').first()).toBeVisible();
  await expect(page.getByLabel('Nom', { exact: true })).toHaveValue(nom);
  await page.unroute('**/*');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: nom })).toBeVisible();
});

test('paramètres : coupure pendant la saisie, rien n’est perdu (Conditions, cases comprises)', async ({ page, context }) => {
  await page.goto('/parametres/conditions');
  const taux = page.getByLabel('Taux horaire de main-d’œuvre (€ HT)');
  await taux.fill('47,50');
  const relance = page.getByLabel('Relancer automatiquement les devis non signés');
  const etaitCochee = await relance.isChecked();
  await relance.setChecked(!etaitCochee);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Hors connexion : rien n’a été envoyé').first()).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText('Saisie non enregistrée récupérée sur ce téléphone.')).toBeVisible();
  await expect(taux).toHaveValue('47,50');
  await expect(relance).toBeChecked({ checked: !etaitCochee });
  // « Annuler ces changements » revient aux valeurs enregistrées.
  await page.getByRole('button', { name: 'Annuler ces changements' }).click();
  await expect(page.getByText('Saisie non enregistrée récupérée')).toHaveCount(0);
  await expect(relance).toBeChecked({ checked: etaitCochee });
});

test('paramètres : 4G « menteuse » à l’envoi de l’entreprise, saisie conservée', async ({ page }) => {
  await page.goto('/parametres/entreprise');
  const tel = page.getByLabel('Téléphone');
  await tel.fill('03 82 00 00 00');
  await couperLesEnvois(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Le réseau ne répond pas').first()).toBeVisible();
  await expect(tel).toHaveValue('03 82 00 00 00');
  await page.unroute('**/*');
  await page.reload();
  await expect(tel).toHaveValue('03 82 00 00 00');
});

test('doublon signalé à la création, création possible quand même', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  const nom = `Doublon-${unique()}`;
  for (let i = 0; i < 2; i += 1) {
    await page.goto('/clients/nouveau');
    await page.getByLabel('Nom', { exact: true }).fill(nom);
    await page.getByLabel('Prénom').fill('Anne');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
  }
  await expect(page.getByText(`Un client « Anne ${nom} » existe déjà`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ouvrir sa fiche' })).toBeVisible();
  await page.getByRole('button', { name: 'Créer quand même' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Anne ${nom}` })).toBeVisible();
  await page.goto(`/clients?q=${nom.toLowerCase()}`);
  await expect(page.getByRole('link', { name: new RegExp(nom) })).toHaveCount(2);
  expect(erreurs).toEqual([]);
});

test('erreur de saisie : le premier champ fautif reçoit le focus', async ({ page }) => {
  await page.goto('/clients/nouveau');
  await page.getByLabel('Code postal').fill('57');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByLabel('Nom', { exact: true })).toBeFocused();
  await expect(page.getByText('Corrigez les champs signalés en rouge.')).toBeVisible();
});

test('modification : un vieux brouillon ne remplace pas une fiche modifiée depuis', async ({ page }) => {
  const nom = `Conflit-${unique()}`;
  await page.goto('/clients/nouveau');
  await page.getByLabel('Nom', { exact: true }).fill(nom);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: nom })).toBeVisible();
  const fiche = page.url().split('?')[0]!;

  // Brouillon abandonné…
  await page.goto(`${fiche}/modifier`);
  await page.getByLabel('Ville').fill('Brouillon-Ville');
  // … puis fiche modifiée et enregistrée ailleurs (autre onglet).
  const autre = await page.context().newPage();
  await autre.goto(`${fiche}/modifier`);
  await expect(autre.getByText('Saisie non enregistrée récupérée')).toBeVisible();
  await autre.getByRole('button', { name: 'Annuler ces changements' }).click();
  await autre.getByLabel('Ville').fill('Metz');
  await autre.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(autre.getByText('Metz')).toBeVisible();
  await autre.close();

  // Le brouillon du premier onglet date d'avant : conflit signalé, rien remis.
  await page.getByLabel('Ville').fill('Brouillon-Ville');
  await page.goto(`${fiche}/modifier`);
  await expect(page.getByText('la fiche a été modifiée depuis')).toBeVisible();
  await expect(page.getByLabel('Ville')).toHaveValue('Metz');
  await page.getByRole('button', { name: 'Reprendre ma saisie' }).click();
  await expect(page.getByLabel('Ville')).toHaveValue('Brouillon-Ville');
});

test('session expirée pendant la saisie : reconnexion, retour au formulaire, saisie récupérée', async ({ page, context }) => {
  const nom = `Expire-${unique()}`;
  await page.goto('/clients/nouveau');
  await page.getByLabel('Nom', { exact: true }).fill(nom);
  await context.clearCookies();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page).toHaveURL(/\/connexion\?expiree=1&suite=%2Fclients%2Fnouveau/);
  await expect(page.getByText('Votre session a expiré.')).toBeVisible();
  await page.getByLabel('Adresse email').fill('e2e-yorick@hdecor.test');
  await page.getByLabel('Mot de passe').fill('mot-de-passe-e2e-tres-long');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/clients\/nouveau$/);
  await expect(page.getByLabel('Nom', { exact: true })).toHaveValue(nom);
});
