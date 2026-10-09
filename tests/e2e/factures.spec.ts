import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { adminTests, seConnecter, surveillerConsole } from './outils';
import {
  ajouterLigne, chantierAvecClient, completerEtEmettre, nouveauBrouillon, preparerEntreprise, signerDansLeCadre, texteDuPdf, unique,
} from './parcours';

test.beforeAll(preparerEntreprise);
test.beforeEach(async ({ page }) => { await seConnecter(page); });

const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

/** Devis de 1 000 € émis et signé sur place ; renvoie son URL. */
async function devisSigne(page: Page, nom: string): Promise<string> {
  const chantier = await chantierAvecClient(page, nom);
  await nouveauBrouillon(page, chantier);
  await ajouterLigne(page, { designation: 'Murs du séjour', quantite: '10', prix: '100' });
  await completerEtEmettre(page);
  const url = page.url().split('?')[0]!;
  await page.getByRole('link', { name: 'Faire signer sur place' }).click();
  await page.getByLabel('Nom et prénom du signataire').fill('Alice Martin');
  await page.getByLabel('Écrivez « Bon pour accord »').fill('Bon pour accord');
  await signerDansLeCadre(page);
  await page.getByLabel('J’ai lu le devis et je l’accepte').check();
  await page.getByRole('button', { name: 'Signer le devis' }).click();
  await expect(page.getByText('Devis signé.')).toBeVisible();
  return url;
}

/** Date de prestation, puis émission ; renvoie le numéro. */
async function emettre(page: Page, prefixe: 'FAC' | 'AVO'): Promise<string> {
  if (prefixe === 'FAC') {
    await page.getByLabel('Prestation : début').fill(aujourdhui());
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText('En-tête enregistré.')).toBeVisible();
  }
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await expect(page.getByText('Toutes les mentions obligatoires sont renseignées.')).toBeVisible();
  await page.getByLabel(/J’émets avec ces textes/).check();
  await page.getByRole('button', { name: prefixe === 'FAC' ? 'Émettre la facture' : 'Émettre l’avoir' }).click();
  await expect(page.getByText(prefixe === 'FAC' ? /Facture émise : numéro attribué/ : /Avoir émis : numéro attribué/)).toBeVisible();
  const titre = (await page.getByRole('heading', { level: 1 }).textContent())!;
  const numero = titre.match(new RegExp(`${prefixe}-\\d{4}-\\d{4}`))?.[0];
  expect(numero).toBeTruthy();
  return numero!;
}

test('factures : acompte, lien client avec QR, paiement et annulation, finale avec déduction, avoir', async ({ page, browser }) => {
  const erreurs = surveillerConsole(page);
  const devisUrl = await devisSigne(page, `Fact-${unique()}`);

  // Acompte de 30 % depuis le devis signé.
  await page.getByRole('link', { name: /Facturer/ }).click();
  await expect(page.getByLabel('Type de facture')).toHaveValue('acompte');
  await page.getByLabel('Acompte (% du devis signé)').fill('30');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
  await expect(page.getByText(/Acompte de 30\s%\s*sur le devis/)).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^300,00\s*€$/ }).first()).toBeVisible();
  // Émission bloquée tant que la date de prestation manque.
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await expect(page.getByText('Date de la prestation manquante (début ou fin des travaux).')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Émettre la facture' })).toBeDisabled();
  await page.getByRole('link', { name: '← Retour au brouillon' }).click();
  const acompte = await emettre(page, 'FAC');
  const acompteUrl = page.url().split('?')[0]!;
  const pdf = texteDuPdf(await (await page.request.get(`${acompteUrl}/pdf`)).body());
  expect(pdf).toContain(`Facture d’acompte n° ${acompte}`);
  expect(pdf).toContain('Net à payer 300,00 €');
  expect(pdf).toContain(`Référence à indiquer : Facture ${acompte}`);
  expect(pdf).not.toContain('APERÇU');

  // Lien de consultation : le client voit le reste à payer, le QR de virement et le PDF, sans session.
  await page.getByRole('button', { name: 'Créer un lien à partager' }).click();
  const lien = await page.getByLabel('Lien de la facture').inputValue();
  expect(lien).toMatch(/\/f\/[A-Za-z0-9_-]{43}$/);
  const contexte = await browser.newContext({ ...test.info().project.use, baseURL: undefined });
  const client = await contexte.newPage();
  const erreursClient = surveillerConsole(client);
  const lienLocal = lien.replace(/^https?:\/\/[^/]+/, new URL(devisUrl).origin);
  await client.goto(lienLocal);
  await expect(client.getByRole('heading', { level: 1, name: `Facture d’acompte n° ${acompte}` })).toBeVisible();
  await expect(client.getByText(/Reste à payer : 300,00\s*€/)).toBeVisible();
  await expect(client.getByRole('img', { name: 'QR code de virement' })).toBeVisible();
  await expect(client.getByText('FR14 2004 1010 0505 0001 3M02 606')).toBeVisible();
  const pdfClient = await client.request.get(`${lienLocal}/pdf`);
  expect(pdfClient.headers()['content-type']).toBe('application/pdf');
  expect(texteDuPdf(await pdfClient.body())).toContain(acompte);
  expect(erreursClient).toEqual([]);

  // Paiement, puis annulation (écriture opposée), puis paiement définitif.
  await page.reload();
  await page.getByText('Enregistrer un paiement', { exact: true }).click();
  await page.getByLabel('Montant reçu (€)').fill('300');
  await page.getByRole('button', { name: 'Enregistrer le paiement' }).click();
  await expect(page.getByText('Paiement enregistré.')).toBeVisible();
  await page.reload();
  await expect(page.getByText(/^Payée/)).toBeVisible();
  await page.getByText('Annuler ce paiement…').click();
  await page.getByLabel(/saisi par erreur/).check();
  await page.getByRole('button', { name: 'Annuler le paiement' }).click();
  await expect(page.getByText(/Paiement annulé/)).toBeVisible();
  await page.reload();
  await expect(page.getByText('(annulation)')).toBeVisible();
  await page.getByText('Enregistrer un paiement', { exact: true }).click();
  await page.getByLabel('Montant reçu (€)').fill('300');
  await page.getByLabel('Mode').selectOption('cheque');
  await page.getByRole('button', { name: 'Enregistrer le paiement' }).click();
  await expect(page.getByText('Paiement enregistré.')).toBeVisible();

  // Le client revoit son lien : facture réglée.
  await client.goto(lienLocal);
  await expect(client.getByText('Cette facture est réglée. Merci !')).toBeVisible();
  await contexte.close();

  // Facture finale : toutes les lignes, acompte déduit.
  await page.goto(devisUrl);
  await expect(page.getByText(new RegExp(`Facture d’acompte ${acompte}`))).toBeVisible();
  await page.getByRole('link', { name: /Facturer/ }).click();
  await page.getByLabel('Type de facture').selectOption('finale');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
  await expect(page.getByText(`Déjà facturé ${acompte}`)).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^700,00\s*€$/ }).first()).toBeVisible();
  const finale = await emettre(page, 'FAC');
  const finaleUrl = page.url().split('?')[0]!;
  const pdfFinale = texteDuPdf(await (await page.request.get(`${finaleUrl}/pdf`)).body());
  expect(pdfFinale).toContain(`Facture n° ${finale}`);
  expect(pdfFinale).toContain('Total HT 1 000,00 €');
  expect(pdfFinale).toContain(`Acompte ${acompte} déduit -300,00 €`);
  expect(pdfFinale).toContain('Net à payer 700,00 €');

  // Avoir partiel de 100 € sur la finale : reste à payer 600 €.
  await page.getByRole('link', { name: 'Corriger ou annuler : établir un avoir' }).click();
  await page.getByLabel('Montant', { exact: true }).selectOption('montant');
  await page.getByLabel('Montant de l’avoir, TTC (€)').fill('100');
  await page.getByLabel('Motif (imprimé sur l’avoir)').fill('Plinthes non réalisées');
  await page.getByRole('button', { name: 'Créer l’avoir (brouillon)' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
  const avoir = await emettre(page, 'AVO');
  const pdfAvoir = texteDuPdf(await (await page.request.get(`${page.url().split('?')[0]}/pdf`)).body());
  expect(pdfAvoir).toContain(`Avoir n° ${avoir}`);
  expect(pdfAvoir).toContain(`Avoir sur la facture n° ${finale}`);
  expect(pdfAvoir).toContain('Plinthes non réalisées');
  await page.goto(finaleUrl);
  await expect(page.getByRole('definition').filter({ hasText: /^600,00\s*€$/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`${avoir} · 100,00`) })).toBeVisible();

  // Liste : la finale est à encaisser.
  await page.goto('/factures');
  await expect(page.getByRole('link', { name: new RegExp(finale) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(acompte) })).toHaveCount(0);
  expect(erreurs).toEqual([]);
});

test('factures : situation à 40 %, avancement ajusté à 50 % sur la ligne, finale qui la déduit', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  await devisSigne(page, `Sit-${unique()}`);
  await page.getByRole('link', { name: /Facturer/ }).click();
  await page.getByLabel('Type de facture').selectOption('situation');
  await page.getByLabel('Avancement des travaux (%)').fill('40');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^400,00\s*€$/ }).first()).toBeVisible();
  await page.getByLabel('Avancement (%)').fill('50');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText('Ligne modifiée.')).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^500,00\s*€$/ }).first()).toBeVisible();
  const situation = await emettre(page, 'FAC');
  const pdf = texteDuPdf(await (await page.request.get(`${page.url().split('?')[0]}/pdf`)).body());
  expect(pdf).toContain(`Facture de situation n° ${situation}`);
  expect(pdf).toMatch(/Murs du séjour\s+10\s+m²\s+100,00 €\s+50 %\s+500,00 €/);

  await page.getByRole('link', { name: /devis DEV-/ }).click();
  await page.getByRole('link', { name: /Facturer/ }).click();
  await page.getByLabel('Type de facture').selectOption('finale');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText(`Déjà facturé ${situation}`)).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^500,00\s*€$/ }).first()).toBeVisible();
  expect(erreurs).toEqual([]);
});

test('factures : facture libre, ligne ajoutée, aperçu, suppression du brouillon', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  const nom = `Libre-${unique()}`;
  await chantierAvecClient(page, nom);
  await page.goto('/factures/nouvelle');
  await page.getByLabel('Type de facture').selectOption('libre');
  await page.getByLabel('Client').selectOption({ label: `Client-${nom}` });
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
  await ajouterLigne(page, { designation: 'Retouches', quantite: '2', prix: '45,50', unite: 'h' });
  await expect(page.getByRole('definition').filter({ hasText: /^91,00\s*€$/ }).first()).toBeVisible();
  const apercu = texteDuPdf(await (await page.request.get(`${page.url().split('?')[0]}/pdf`)).body());
  expect(apercu).toContain('APERÇU : BROUILLON SANS VALEUR');
  expect(apercu).toContain('Retouches');
  await page.getByText('Supprimer le brouillon…').click();
  await page.getByLabel('Je supprime ce brouillon').check();
  await page.getByRole('button', { name: 'Supprimer le brouillon' }).click();
  await expect(page.getByText('Brouillon supprimé.')).toBeVisible();
  expect(erreurs).toEqual([]);
});

test('réglages : modèles de messages, champ inconnu refusé', async ({ page }) => {
  await page.goto('/parametres/messages');
  const carte = page.locator('section').filter({ hasText: 'Impayé : 1er rappel' });
  await carte.getByLabel('Objet').fill('Rappel {numero} {inconnu}');
  await carte.getByRole('button', { name: 'Enregistrer ce message' }).click();
  await expect(carte.getByText(/Champ inconnu entre accolades/)).toBeVisible();
  await carte.getByLabel('Objet').fill('Rappel : facture {numero}');
  await carte.getByLabel('Jours après l’échéance').fill('10');
  await carte.getByRole('button', { name: 'Enregistrer ce message' }).click();
  await expect(carte.getByText('Enregistré.')).toBeVisible();
  await page.reload();
  await expect(carte.getByLabel('Jours après l’échéance')).toHaveValue('10');
});

test('paiement en ligne : webhook Stripe signé, enregistré une seule fois, signature fausse refusée', async ({ page, request }) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  expect(secret, 'STRIPE_WEBHOOK_SECRET (écrit par npm run local:start)').toBeTruthy();
  const nom = `Stripe-${unique()}`;
  await chantierAvecClient(page, nom);
  await page.goto('/factures/nouvelle');
  await page.getByLabel('Type de facture').selectOption('libre');
  await page.getByLabel('Client').selectOption({ label: `Client-${nom}` });
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await ajouterLigne(page, { designation: 'Peinture du portail', quantite: '1', prix: '250', unite: 'forfait' });
  await emettre(page, 'FAC');
  const factureId = page.url().split('?')[0]!.split('/').pop()!;
  const { data: f } = await adminTests().from('factures').select('organisation_id').eq('id', factureId).single();

  const evenement = JSON.stringify({
    id: `evt_test_${unique()}`, type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_1', payment_status: 'paid', currency: 'eur', amount_total: 25_000, payment_intent: 'pi_test_1',
      metadata: { facture_id: factureId, organisation_id: f!.organisation_id } } },
  });
  const signer = (corps: string, cle = secret!) => {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v1=${createHmac('sha256', cle).update(`${t}.${corps}`).digest('hex')}`;
  };
  const envoyer = (signature: string) => request.post('/api/stripe/webhook', { data: evenement, headers: { 'content-type': 'application/json', 'stripe-signature': signature } });

  expect((await envoyer(signer(evenement, 'whsec_faux'))).status()).toBe(400);
  expect((await envoyer(signer(evenement))).status()).toBe(200);
  expect((await envoyer(signer(evenement))).status()).toBe(200);   // Stripe renvoie l'événement : pas de doublon
  await page.reload();
  await expect(page.getByText(/250,00\s*€ · carte en ligne · pi_test_1/)).toHaveCount(1);
  await expect(page.getByText(/^Payée/)).toBeVisible();
});
