import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { adminTests, seConnecter, surveillerConsole } from './outils';

// Noms uniques : les parcours sont rejouables sans remise à zéro de la base.
const unique = () => Date.now().toString(36).slice(-5);
// Numéro différent à chaque fiche : sinon l'alerte de doublon (même téléphone) s'affiche.
const telephone = () => `07 ${String(Math.floor(Math.random() * 1e8)).padStart(8, '0').replace(/(\d\d)(?=\d)/g, '$1 ')}`;

test.beforeEach(async ({ page }) => { await seConnecter(page); });

async function creerParticulier(page: Page, nom: string, prenom = 'Hélène') {
  const tel = telephone();
  await page.goto('/clients/nouveau');
  await page.getByLabel('Nom', { exact: true }).fill(nom);
  await page.getByLabel('Prénom').fill(prenom);
  await page.getByLabel('Téléphone').fill(tel);
  await page.getByLabel('Ville').fill('Thionville');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `${prenom} ${nom}` })).toBeVisible();
}

test('création : erreurs signalées sans perte de saisie, puis fiche et recherche sans accent', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  const nom = `Müller-${unique()}`;
  const tel = telephone();
  await page.goto('/clients');
  await page.getByRole('link', { name: '+ Nouveau' }).click();
  await page.getByLabel('Prénom').fill('Hélène');
  await page.getByLabel('Email').fill('pas-un-email');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Nom : champ obligatoire.')).toBeVisible();
  await expect(page.getByText('Adresse email invalide.')).toBeVisible();
  await expect(page.getByLabel('Prénom')).toHaveValue('Hélène');

  await page.getByLabel('Nom', { exact: true }).fill(nom);
  await page.getByLabel('Email').fill('helene@exemple.test');
  await page.getByLabel('Téléphone').fill(tel);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Fiche enregistrée.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Appeler' })).toHaveAttribute('href', `tel:${tel.replace(/\s/g, '')}`);

  // Recherche instantanée : sans accent, en minuscules.
  await page.goto('/clients');
  await page.getByLabel('Rechercher un client').fill(`muller-${nom.split('-')[1]}`);
  await expect(page.getByRole('link', { name: new RegExp(nom) })).toBeVisible();
  await expect(page).toHaveURL(/q=muller/);
  await page.getByRole('button', { name: 'Professionnels' }).click();
  await expect(page.getByText('Aucun client ne correspond à la recherche.')).toBeVisible();
  expect(erreurs).toEqual([]);
});

test('professionnel : raison sociale exigée, SIRET contrôlé, modification', async ({ page }) => {
  const rs = `SCI Les Lilas ${unique()}`;
  await page.goto('/clients/nouveau');
  await page.getByText('Professionnel', { exact: true }).click();
  await page.getByLabel('Nom du contact').fill('Petit');
  await page.getByLabel('SIRET').fill('732 829 320 00075');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Raison sociale obligatoire pour un professionnel.')).toBeVisible();
  await expect(page.getByText('SIRET invalide : vérifiez les 14 chiffres.')).toBeVisible();
  // Le type choisi est conservé après l'erreur.
  await expect(page.getByLabel('Raison sociale')).toBeVisible();

  await page.getByLabel('Raison sociale').fill(rs);
  await page.getByLabel('SIRET').fill('732 829 320 00074');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: rs })).toBeVisible();
  await expect(page.getByText('73282932000074')).toBeVisible();

  await page.getByRole('link', { name: 'Modifier' }).click();
  await page.getByLabel('Ville').fill('Metz');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Fiche enregistrée.' })).toBeVisible();
  await expect(page.getByText('Metz')).toBeVisible();
});

test('coupure réseau : rien n’est perdu, la saisie revient après rechargement', async ({ page, context }) => {
  const nom = `Coupure-${unique()}`;
  await page.goto('/clients/nouveau');
  await page.getByLabel('Nom', { exact: true }).fill(nom);
  await page.getByLabel('Notes').fill('Code portail 1234');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Hors connexion : rien n’a été envoyé')).toBeVisible();
  await expect(page.getByLabel('Nom', { exact: true })).toHaveValue(nom);

  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText('Saisie non enregistrée récupérée sur ce téléphone.')).toBeVisible();
  await expect(page.getByLabel('Nom', { exact: true })).toHaveValue(nom);
  await expect(page.getByLabel('Notes')).toHaveValue('Code portail 1234');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: nom })).toBeVisible();

  // Enregistré : le brouillon est effacé du téléphone.
  await page.goto('/clients/nouveau');
  await expect(page.getByLabel('Nom', { exact: true })).toHaveValue('');
  await expect(page.getByText('Saisie non enregistrée récupérée')).toHaveCount(0);
});

test('exports : tableur (BOM, « ; ») et données d’un client (JSON)', async ({ page }) => {
  const nom = `Export-${unique()}`;
  await creerParticulier(page, nom, 'Zoé');

  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Exporter les données de ce client' }).click()]);
  const donnees = JSON.parse(await readFile((await json.path())!, 'utf8'));
  expect(donnees.client).toMatchObject({ nom, prenom: 'Zoé', fact_ville: 'Thionville' });
  expect(donnees).toHaveProperty('devis');
  expect(donnees.client).not.toHaveProperty('organisation_id');

  await page.goto('/clients');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Exporter tous les clients (tableur)' }).click()]);
  expect(csv.suggestedFilename()).toMatch(/^clients-\d{4}-\d{2}-\d{2}\.csv$/);
  const contenu = await readFile((await csv.path())!, 'utf8');
  expect(contenu.charCodeAt(0)).toBe(0xfeff);
  expect(contenu).toContain('Type;Civilité;Nom;Prénom');
  expect(contenu).toContain(`Particulier;;${nom};Zoé;`);
});

test('effacement RGPD : confirmation exigée, fiche anonymisée, recherche vide', async ({ page }) => {
  const nom = `Efface-${unique()}`;
  await creerParticulier(page, nom, 'Paul');
  const url = page.url().split('?')[0]!;

  await page.getByText('Effacer ce client (droit à l’effacement)').click();
  await page.getByRole('button', { name: 'Effacer définitivement' }).click();
  // Case non cochée : refus par le navigateur (required) ; on vérifie que rien n'a changé.
  await expect(page.getByRole('heading', { level: 1, name: `Paul ${nom}` })).toBeVisible();

  await page.getByLabel('Je confirme l’effacement définitif de ce client.').check();
  await page.getByRole('button', { name: 'Effacer définitivement' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Client anonymisé.' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Client anonymisé' })).toBeVisible();
  await expect(page.getByText(nom)).toHaveCount(0);

  // Plus modifiable.
  const reponse = await page.goto(`${url}/modifier`);
  expect(reponse?.status()).toBe(404);

  await page.goto(`/clients?q=${encodeURIComponent(nom)}`);
  await expect(page.getByText('Aucun client ne correspond à la recherche.')).toBeVisible();

  // En base : plus aucune donnée personnelle.
  const id = url.split('/').pop()!;
  const { data } = await adminTests().from('clients').select('nom, prenom, telephone, anonymise_le').eq('id', id).single();
  expect(data).toMatchObject({ nom: 'Client anonymisé', prenom: null, telephone: null });
  expect(data?.anonymise_le).not.toBeNull();
});

test('effacement : refusé côté serveur sans la case de confirmation', async ({ page }) => {
  const nom = `SansCase-${unique()}`;
  await creerParticulier(page, nom, 'Léa');
  await page.getByText('Effacer ce client (droit à l’effacement)').click();
  // Contourne le contrôle du navigateur : le serveur doit refuser seul.
  await page.locator('input[name="confirmation"]').evaluate((e) => e.removeAttribute('required'));
  await page.getByRole('button', { name: 'Effacer définitivement' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Cochez la case de confirmation' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: `Léa ${nom}` })).toBeVisible();
});

test('tâche planifiée : refusée sans le secret', async ({ request }) => {
  expect((await request.get('/api/cron/conservation')).status()).toBe(401);
  expect((await request.get('/api/cron/conservation', { headers: { authorization: 'Bearer faux' } })).status()).toBe(401);
  const ok = await request.get('/api/cron/conservation', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ ok: true });
});

test.describe('sans JavaScript (téléphone lent, page pas encore prête)', () => {
  test.use({ javaScriptEnabled: false });
  test('la recherche fonctionne avec la touche Entrée', async ({ page }) => {
    const nom = `Lent-${unique()}`;
    const { data: org } = await adminTests().from('parametres_entreprise').select('organisation_id')
      .eq('raison_sociale', 'Entreprise de test E2E').single();
    await adminTests().from('clients').insert({ organisation_id: org!.organisation_id, nom, prenom: 'Noé' });
    await page.goto('/clients');
    await page.getByLabel('Rechercher un client').fill(nom.toLowerCase());
    await page.getByLabel('Rechercher un client').press('Enter');
    await expect(page).toHaveURL(new RegExp(`q=${nom.toLowerCase()}`));
    await expect(page.getByRole('link', { name: new RegExp(nom) })).toBeVisible();
  });
});
