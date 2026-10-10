import { expect, test } from '@playwright/test';
import { seConnecter, surveillerConsole } from './outils';

test('PWA : manifeste installable et icônes servies sans connexion', async ({ request }) => {
  const reponse = await request.get('/manifest.webmanifest');
  expect(reponse.status()).toBe(200);
  const m = await reponse.json();
  expect(m).toMatchObject({ name: "H'DECOR", lang: 'fr', display: 'standalone', start_url: '/' });
  for (const icone of m.icons as { src: string; sizes: string }[]) {
    const r = await request.get(icone.src);
    expect(r.status(), icone.src).toBe(200);
    expect(r.headers()['content-type']).toBe('image/png');
  }
  expect((m.icons as { purpose?: string }[]).some((i) => i.purpose === 'maskable')).toBe(true);
});

test('confidentialité : page publique, points non confirmés signalés', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  await page.goto('/confidentialite');
  await expect(page.getByRole('heading', { level: 1, name: 'Vos données personnelles' })).toBeVisible();
  await expect(page.getByText('À VÉRIFIER').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'www.cnil.fr' })).toBeVisible();
  expect(erreurs).toEqual([]);
});

test('journal : la création d’un client y figure, sans son nom', async ({ page }) => {
  await seConnecter(page);
  const nom = `Journal-${Date.now().toString(36).slice(-5)}`;
  await page.goto('/clients/nouveau');
  await page.getByLabel('Nom', { exact: true }).fill(nom);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: nom })).toBeVisible();

  await page.goto('/parametres');
  await page.getByRole('link', { name: /Journal des actions/ }).click();
  await page.getByLabel('Afficher').selectOption('clients');
  await page.getByRole('button', { name: 'Filtrer' }).click();
  await expect(page).toHaveURL(/table=clients/);
  const premiere = page.getByRole('listitem').filter({ hasText: 'Création : Client' }).first();
  await expect(premiere).toContainText('vous');
  await expect(page.getByText(nom)).toHaveCount(0);
  await premiere.getByRole('link', { name: 'Client' }).click();
  await expect(page.getByRole('heading', { level: 1, name: nom })).toBeVisible();
});

test('paramètres : logo à fournir signalé, dépôt proposé', async ({ page }) => {
  await seConnecter(page);
  await page.goto('/parametres');
  const section = page.getByRole('region', { name: /Logo/ });
  await expect(section.getByRole('heading', { name: /Logo/ })).toBeVisible();
  await expect(section.getByText('À FOURNIR')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Enregistrer le logo' })).toBeVisible();
});
