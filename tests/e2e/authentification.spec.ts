import { expect, test } from '@playwright/test';
import { COMPTE, seConnecter, surveillerConsole } from './outils';

test('une page protégée renvoie vers la connexion et y revient après', async ({ page }) => {
  await page.goto('/compte');
  await expect(page).toHaveURL(/\/connexion\?suite=%2Fcompte/);
  await page.getByLabel('Adresse email').fill(COMPTE.email);
  await page.getByLabel('Mot de passe').fill(COMPTE.motDePasse);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/compte$/);
  await expect(page.getByRole('heading', { name: 'Mon compte' })).toBeVisible();
});

test('mauvais mot de passe : message neutre, email conservé', async ({ page }) => {
  await page.goto('/connexion');
  await page.getByLabel('Adresse email').fill(COMPTE.email);
  await page.getByLabel('Mot de passe').fill('pas-le-bon-mot-de-passe');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Email ou mot de passe incorrect.' })).toBeVisible();
  await expect(page.getByLabel('Adresse email')).toHaveValue(COMPTE.email);
});

test('compte inexistant : même message (pas d’énumération)', async ({ page }) => {
  await page.goto('/connexion');
  await page.getByLabel('Adresse email').fill('inconnu@hdecor.test');
  await page.getByLabel('Mot de passe').fill('nimporte-quoi-long');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Email ou mot de passe incorrect.' })).toBeVisible();
});

test('redirection externe refusée après connexion', async ({ page }) => {
  await page.goto('/connexion?suite=https%3A%2F%2Fpirate.example');
  await page.getByLabel('Adresse email').fill(COMPTE.email);
  await page.getByLabel('Mot de passe').fill(COMPTE.motDePasse);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
});

test('connexion puis déconnexion, sans erreur console ni violation CSP', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  await seConnecter(page);
  await expect(page.getByRole('heading', { name: 'Bonjour' })).toBeVisible();
  await page.getByRole('link', { name: /Compte/ }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/connexion/);
  expect(erreurs).toEqual([]);
});

test('lien de connexion : réponse identique pour un compte inconnu', async ({ page }) => {
  await page.goto('/connexion');
  await page.getByRole('button', { name: 'Recevoir un lien par email' }).click();
  await page.getByLabel('Adresse email').fill('inconnu@hdecor.test');
  await page.getByRole('button', { name: 'Recevoir un lien de connexion' }).click();
  await expect(page.getByRole('status')).toContainText('Si un compte correspond à cette adresse');
});
