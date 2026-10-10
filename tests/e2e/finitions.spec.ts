import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { adminTests, seConnecter, surveillerConsole } from './outils';
import { ajouterLigne, chantierAvecClient, preparerEntreprise, unique } from './parcours';

test.beforeAll(preparerEntreprise);
test.beforeEach(async ({ page }) => { await seConnecter(page); });

const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

/** Facture libre émise (montant en euros) ; renvoie son identifiant. */
async function factureEmise(page: Page, nom: string, prix: string): Promise<string> {
  await chantierAvecClient(page, nom);
  await page.goto('/factures/nouvelle');
  await page.getByLabel('Type de facture').selectOption('libre');
  await page.getByLabel('Client').selectOption({ label: `Client-${nom}` });
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await ajouterLigne(page, { designation: 'Peinture du portail', quantite: '1', prix, unite: 'forfait' });
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await page.getByLabel(/J’émets avec ces textes/).check();
  await page.getByRole('button', { name: 'Émettre la facture' }).click();
  await expect(page.getByText(/Facture émise : numéro attribué/)).toBeVisible();
  return page.url().split('?')[0]!.split('/').pop()!;
}

test('demande d’avis : seulement une fois la facture payée, message à partager noté une fois, opposition du client respectée', async ({ page, context }) => {
  const erreurs = surveillerConsole(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const admin = adminTests();
  const { data: m } = await admin.from('membres').select('organisation_id').limit(1).single();
  await admin.from('parametres_entreprise').update({ avis_google_url: 'https://g.page/r/exemple-test/review' }).eq('organisation_id', m!.organisation_id);

  const nom = `Avis-${unique()}`;
  const facture = await factureEmise(page, nom, '120');
  await expect(page.getByRole('heading', { name: 'Demander un avis' })).toHaveCount(0);

  await page.getByText('Enregistrer un paiement', { exact: true }).click();
  await page.getByLabel('Montant reçu (€)').fill('120');
  await page.getByLabel('Mode').selectOption('virement');
  await page.getByRole('button', { name: 'Enregistrer le paiement' }).click();
  await expect(page.getByText(/Reste à payer : 0,00\s€/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Demander un avis' })).toBeVisible();

  await page.getByRole('button', { name: 'Préparer un message à partager (SMS, WhatsApp)' }).click();
  const message = page.getByLabel('Message de demande d’avis');
  await expect(message).toHaveValue(/https:\/\/g\.page\/r\/exemple-test\/review/);
  await expect(message).toHaveValue(new RegExp(`Bonjour Client-${nom}`));
  await page.getByRole('button', { name: 'Copier' }).click();
  await expect(page.getByText(/Avis demandé le/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Avis demandé le/)).toBeVisible();
  const { count } = await admin.from('envois').select('id', { count: 'exact', head: true }).eq('document_id', facture).eq('nature', 'demande_avis');
  expect(count).toBe(1);

  // Opposition : notée sur la fiche du client.
  await page.goto('/clients');
  await page.getByRole('link', { name: new RegExp(`Client-${nom}`) }).click();
  await page.getByRole('button', { name: 'Le client ne veut pas être sollicité' }).click();
  await expect(page.getByText('Noté : ce client ne recevra plus de demande d’avis.')).toBeVisible();
  expect(erreurs).toEqual([]);
});

test('notifications : paiement en ligne et rappel échu signalés, cloche, tout marquer comme lu', async ({ page, request }) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const cron = process.env.CRON_SECRET;
  expect(secret && cron, 'STRIPE_WEBHOOK_SECRET et CRON_SECRET (écrits par npm run local:start)').toBeTruthy();
  const admin = adminTests();
  // Point de départ connu : notifications précédentes lues.
  const { data: m } = await admin.from('membres').select('organisation_id').limit(1).single();
  await admin.from('notifications').update({ lu_le: new Date().toISOString() }).eq('organisation_id', m!.organisation_id).is('lu_le', null);

  const facture = await factureEmise(page, `Notif-${unique()}`, '80');
  const { data: f } = await admin.from('factures').select('organisation_id, numero').eq('id', facture).single();
  const evenement = JSON.stringify({
    id: `evt_test_${unique()}`, type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_n', payment_status: 'paid', currency: 'eur', amount_total: 8_000, payment_intent: `pi_test_${unique()}`,
      metadata: { facture_id: facture, organisation_id: f!.organisation_id } } },
  });
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac('sha256', secret!).update(`${t}.${evenement}`).digest('hex')}`;
  expect((await request.post('/api/stripe/webhook', { data: evenement, headers: { 'content-type': 'application/json', 'stripe-signature': signature } })).status()).toBe(200);

  // Rappel échu (ce matin à 00:01), signalé par la tâche planifiée.
  const titre = `Commander la sous-couche ${unique()}`;
  await page.goto(`/planning?vue=jour&date=${aujourdhui()}`);
  await page.getByText('+ Un rappel').click();
  await page.getByLabel('Me rappeler de').fill(titre);
  await page.getByLabel('À (sinon 8 h)').fill('00:01');
  await page.getByRole('button', { name: 'Ajouter le rappel' }).click();
  await expect(page.getByText(/Rappel noté pour le/)).toBeVisible();
  expect((await request.get('/api/cron/notifications')).status()).toBe(401);
  const r = await request.get('/api/cron/notifications', { headers: { authorization: `Bearer ${cron}` } });
  expect(r.status()).toBe(200);

  await page.goto('/');
  await expect(page.getByRole('link', { name: /Notifications : [2-9]\d* non lues|Notifications : \d{2,} non lues/ })).toBeVisible();
  await page.getByRole('link', { name: /^Notifications/ }).click();
  await expect(page.getByText(`● Paiement en ligne reçu : 80,00 € sur la facture ${f!.numero}`)).toBeVisible();
  await expect(page.getByText(`● Rappel : ${titre}`)).toBeVisible();
  await page.getByRole('button', { name: /Tout marquer comme lu/ }).click();
  await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(page.getByText(`Rappel : ${titre}`)).toBeVisible();
  await expect(page.getByText(`● Rappel : ${titre}`)).toHaveCount(0);
});
