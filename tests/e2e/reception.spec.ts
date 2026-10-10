import { expect, test } from '@playwright/test';
import { seConnecter, surveillerConsole } from './outils';
import { chantierAvecClient, preparerEntreprise, signerDansLeCadre, texteDuPdf, unique } from './parcours';

test.beforeAll(preparerEntreprise);
test.beforeEach(async ({ page }) => { await seConnecter(page); });

const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

test('PV de réception : réserves, présentation, signature sur place (client et entreprise), PDF signé, levée d’une réserve', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  const nom = `Recep-${unique()}`;
  const chantier = await chantierAvecClient(page, nom);
  await page.getByRole('link', { name: 'PV de réception' }).click();
  await page.getByLabel('Travaux réceptionnés').fill('Peinture du séjour et du couloir');
  await page.getByLabel(/Réserves/).fill('- Reprendre l’angle du plafond\n- Plinthe tachée');
  await page.getByLabel(/Délai pour lever les réserves/).fill('15');
  await page.getByRole('button', { name: 'Créer le PV' }).click();
  await expect(page.getByText('Brouillon · 2 réserves à lever sur 2')).toBeVisible();
  const urlPv = page.url().split('?')[0]!;

  // Aperçu : document non signé, décision et réserves.
  const apercu = texteDuPdf(await (await page.request.get(`${urlPv}/pdf`)).body());
  expect(apercu).toContain('PROCÈS-VERBAL DE RÉCEPTION DES TRAVAUX');
  expect(apercu).toContain('AVEC 2 RÉSERVES');
  expect(apercu).toContain('Reprendre l’angle du plafond');
  expect(apercu).toContain('dans un délai de 15 jours');
  expect(apercu).toContain('Références À VÉRIFIER');
  expect(apercu).toContain('qui ne vaut réception qu’une fois signé');

  await page.getByRole('button', { name: 'Présenter au client pour signature' }).click();
  await expect(page.getByRole('heading', { name: /Réception des travaux du/ })).toBeVisible();
  await page.getByLabel('Nom et prénom du client').fill('Alice Martin');
  await page.getByLabel(/Écrivez « Lu et approuvé »/).fill('lu et approuve');
  await expect(page.getByText('En signant, vous acceptez les travaux, sauf les 2 points listés, que l’entreprise doit reprendre au plus tard le')).toBeVisible();
  // Étape 1 : le client seul (un seul cadre à l'écran).
  await expect(page.getByRole('img', { name: 'Signature de l’entreprise' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Valider la signature du client' }).click();
  await expect(page.getByText('Le client signe dans le cadre.')).toBeVisible();
  await signerDansLeCadre(page, 'Signature du client');
  await page.getByRole('button', { name: 'Valider la signature du client' }).click();
  await expect(page.getByText('Cochez la case pour confirmer la relecture du procès-verbal.')).toBeVisible();
  await page.getByLabel(/J’ai relu le procès-verbal/).check();
  await page.getByRole('button', { name: 'Valider la signature du client' }).click();
  // Étape 2 : l'entreprise, téléphone rendu.
  await expect(page.getByText('✓ Le client Alice Martin a signé.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Signature du client' })).toHaveCount(0);
  await signerDansLeCadre(page, 'Signature de l’entreprise');
  await page.getByRole('button', { name: 'Signer le procès-verbal' }).click();
  await expect(page.getByText('Procès-verbal signé.')).toBeVisible();
  await expect(page.getByText(/Signé le .* par Alice Martin/)).toBeVisible();

  // PDF signé : signatures, empreinte du PV présenté.
  const signe = texteDuPdf(await (await page.request.get(`${urlPv}/pdf`)).body());
  expect(signe).toContain('Signé sur place le');
  expect(signe).toContain('par Alice Martin, mention : « lu et approuve »');
  expect(signe).toMatch(/Empreinte SHA-256 du procès-verbal présenté et signé \(pages 1[^)]*\) :\s*[0-9a-f]{64}/);

  // Levée de la première réserve.
  const premiere = page.getByRole('listitem').filter({ hasText: '1. Reprendre l’angle du plafond' });
  await premiere.getByLabel('Note (facultatif)').fill('Angle repris');
  await premiere.getByRole('button', { name: 'Noter la levée' }).click();
  await expect(page.getByText(/✓ Levée déclarée par l’entreprise le .* : Angle repris/)).toBeVisible();
  await expect(page.getByText(/1 réserve à lever sur 2/)).toBeVisible();
  expect(page.url()).toContain(`/chantiers/${chantier}/pv/`);
  expect(erreurs).toEqual([]);
});

test('PV : un brouillon modifié après présentation doit être représenté', async ({ page }) => {
  const chantier = await chantierAvecClient(page, `Recep2-${unique()}`);
  await page.goto(`/chantiers/${chantier}/pv`);
  await page.getByRole('button', { name: 'Créer le PV' }).click();
  await expect(page.getByText('Brouillon · Sans réserve')).toBeVisible();
  const urlPv = page.url().split('?')[0]!;
  await page.getByRole('button', { name: 'Présenter au client pour signature' }).click();
  await expect(page.getByRole('button', { name: 'Valider la signature du client' })).toBeVisible();
  // Retour, modification : la page de signature renvoie au PV.
  await page.goto(urlPv);
  await page.getByLabel('Observations (facultatif)').fill('Client absent le matin');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('PV enregistré.')).toBeVisible();
  await page.goto(`${urlPv}/signer`);
  await expect(page).toHaveURL(urlPv);
});

test('liste de fin de chantier : modèle, cases datées, élément ajouté', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  const chantier = await chantierAvecClient(page, `Fin-${unique()}`);
  await page.getByRole('link', { name: 'Liste de fin' }).click();
  const nettoyage = page.getByRole('button', { name: /Nettoyage du chantier/ });
  await nettoyage.click();
  await expect(page.getByRole('button', { name: /Nettoyage du chantier/ })).toHaveAttribute('aria-pressed', 'true');
  const [a, m, j] = aujourdhui().split('-');
  await expect(page.getByText(`Fait le ${j}/${m}/${a}`)).toBeVisible();
  await page.getByLabel('Ajouter un élément').fill('Reboucher les trous des chevilles');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('button', { name: /Reboucher les trous des chevilles/ })).toBeVisible();
  await page.goto(`/chantiers/${chantier}`);
  await expect(page.getByText(/Liste : 1 sur 7\./)).toBeVisible();
  expect(erreurs).toEqual([]);
});
