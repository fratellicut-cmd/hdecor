import { expect, test, type Page } from '@playwright/test';
import { adminTests, seConnecter } from './outils';
import { chantierAvecClient, preparerEntreprise, signerDansLeCadre, texteDuPdf, unique } from './parcours';

/**
 * Régime assujetti de bout en bout (E2) : la TVA calculée par taux, imprimée
 * sur le devis, l'acompte et la finale (acompte déduit HT, TVA et TTC).
 * Le taux réduit (10 %) est BLOQUÉ tant que l'attestation du client n'est pas
 * produite (décision de Yorick, Phase 8) : le cas chiffré du cahier des charges
 * (§6, 10 %) est couvert par les tests unitaires ; ici le même schéma à 20 %.
 */
let org = '';
test.beforeAll(async () => {
  await preparerEntreprise();
  const admin = adminTests();
  const { data: m } = await admin.from('membres').select('organisation_id').limit(1).single();
  org = m!.organisation_id;
  // Numéro de TVA FICTIF (format seulement) : exigé sur les factures d'une entreprise assujettie.
  const { error } = await admin.from('parametres_entreprise').update({ regime_tva: 'assujetti', numero_tva_intra: 'FR00123456789' }).eq('organisation_id', org);
  if (error) throw new Error(error.message);
});
test.afterAll(async () => {
  await adminTests().from('parametres_entreprise').update({ regime_tva: 'franchise', numero_tva_intra: null }).eq('organisation_id', org);
});
test.beforeEach(async ({ page }) => { await seConnecter(page); });

async function ligne(page: Page, designation: string, prix: string, tauxBp: string) {
  const bloc = page.locator('details').filter({ hasText: '+ Ajouter une ligne' });
  if (!(await bloc.evaluate((d) => (d as HTMLDetailsElement).open))) await bloc.locator('summary').click();
  await bloc.getByLabel('Désignation').fill(designation);
  await bloc.getByLabel('Quantité').fill('1');
  await bloc.getByLabel('Unité').selectOption('forfait');
  await bloc.getByLabel('Prix unitaire HT (€)').fill(prix);
  await bloc.getByLabel('TVA').selectOption(tauxBp);
  await bloc.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByText('Ligne ajoutée.')).toBeVisible();
}

async function entete(page: Page) {
  await page.getByLabel('Durée (jours)').fill('5');
  await page.getByLabel(/Signé chez le client \(hors établissement\)/).setChecked(false);
  await page.getByLabel('Ou délai de début (texte)').fill('Sous un mois');
  await page.getByRole('button', { name: 'Enregistrer l’en-tête' }).click();
  await expect(page.getByText('En-tête enregistré.')).toBeVisible();
}

const pdfDe = async (page: Page, url: string) => texteDuPdf(await (await page.request.get(`${url}/pdf`)).body()).replace(/[  ]/g, ' ');

async function emettreFacture(page: Page) {
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await page.getByLabel(/J’émets avec ces textes/).check();
  await page.getByRole('button', { name: 'Émettre la facture' }).click();
  await expect(page.getByText(/Facture émise : numéro attribué/)).toBeVisible();
  return page.url().split('?')[0]!;
}

test('assujetti : taux réduit bloqué sans attestation ; 5 000 € HT à 20 %, acompte 30 %, finale avec déduction', async ({ page }) => {
  const chantier = await chantierAvecClient(page, `TVA-${unique()}`);
  await page.goto(`/chantiers/${chantier}`);
  await page.getByRole('link', { name: '+ Devis' }).click();
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();

  // Taux réduit : émission bloquée, message clair.
  await ligne(page, 'Peinture intérieure (taux réduit)', '100', '1000');
  await entete(page);
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await expect(page.getByText(/Taux réduit 10 % : une attestation du client est requise et l’application ne la produit pas encore/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Émettre le devis' })).toBeDisabled();
  await page.getByRole('link', { name: '← Retour au brouillon' }).click();
  const reduite = page.getByRole('listitem').filter({ hasText: 'Peinture intérieure (taux réduit)' });
  await reduite.locator('summary', { hasText: 'Modifier' }).click();
  await reduite.getByText('Supprimer la ligne…').click();
  await reduite.getByLabel('Je supprime cette ligne').check();
  await reduite.getByRole('button', { name: 'Supprimer la ligne' }).click();
  await expect(page.getByText('Peinture intérieure (taux réduit)')).toHaveCount(0);

  // 5 000 € HT à 20 % : TVA 1 000 €, TTC 6 000 €.
  await ligne(page, 'Ravalement de façade', '5000', '2000');
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await page.getByLabel(/J’émets ce devis avec ces textes/).check();
  await page.getByRole('button', { name: 'Émettre le devis' }).click();
  await expect(page.getByText(/Devis émis : numéro attribué/)).toBeVisible();
  const devisUrl = page.url().split('?')[0]!;
  const devis = await pdfDe(page, devisUrl);
  expect(devis).toMatch(/Total HT\s+5 000,00 €/);
  expect(devis).toMatch(/TVA 20 % sur 5 000,00 €\s+1 000,00 €/);
  expect(devis).toMatch(/Total TTC\s+6 000,00 €/);
  expect(devis).not.toContain('293 B');
  await page.getByRole('link', { name: 'Faire signer sur place' }).click();
  await page.getByLabel('Nom et prénom du signataire').fill('Alice Martin');
  await page.getByLabel('Écrivez « Bon pour accord »').fill('Bon pour accord');
  await signerDansLeCadre(page);
  await page.getByLabel('J’ai lu le devis et je l’accepte').check();
  await page.getByRole('button', { name: 'Signer le devis' }).click();
  await expect(page.getByText('Devis signé.')).toBeVisible();

  // Acompte 30 % : 1 500 € HT + 300 € TVA = 1 800 € TTC.
  await page.getByRole('link', { name: /Facturer/ }).click();
  await page.getByLabel('Acompte (% du devis signé)').fill('30');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  const acompte = await pdfDe(page, await emettreFacture(page));
  expect(acompte).toMatch(/Total HT\s+1 500,00 €/);
  expect(acompte).toMatch(/TVA 20 % sur 1 500,00 €\s+300,00 €/);
  expect(acompte).toMatch(/Total TTC\s+1 800,00 €/);
  expect(acompte).toMatch(/À régler au plus tard le \d\d\/\d\d\/\d{4} : 1 800,00 €\./);
  expect(acompte).toContain('FR00123456789');

  // Finale : 6 000 € TTC, acompte déduit (1 800 €), net 4 200 €.
  await page.goto(devisUrl);
  await page.getByRole('link', { name: /Facturer/ }).click();
  await page.getByLabel('Type de facture').selectOption('finale');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  const finale = await pdfDe(page, await emettreFacture(page));
  expect(finale).toMatch(/Total TTC\s+6 000,00 €/);
  expect(finale).toMatch(/Acompte FAC-\d{4}-\d{4} déduit -1 800,00 €/);
  expect(finale).toContain('Net à payer 4 200,00 €');
});

test('assujetti : une facture libre à taux réduit est bloquée elle aussi (attestation non produite)', async ({ page }) => {
  const nom = `Libre-TVA-${unique()}`;
  await chantierAvecClient(page, nom);
  await page.goto('/factures/nouvelle');
  await page.getByLabel('Type de facture').selectOption('libre');
  await page.getByLabel('Client').selectOption({ label: `Client-${nom}` });
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
  await ligne(page, 'Peinture intérieure (taux réduit)', '100', '1000');
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await expect(page.getByText(/Taux réduit 10 % : une attestation du client est requise/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Émettre la facture' })).toBeDisabled();
});
