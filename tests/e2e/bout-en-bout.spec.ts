import { expect, test, type Page } from '@playwright/test';
import { seConnecter, surveillerConsole } from './outils';
import { ajouterLigne, chantierAvecClient, preparerEntreprise, signerDansLeCadre, texteDuPdf, unique } from './parcours';

test.beforeAll(preparerEntreprise);
test.beforeEach(async ({ page }) => { await seConnecter(page); });

const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const FRANCHISE = 'TVA non applicable, art. 293 B du CGI';
/** « 1 234,56 € » -> « 1 234,56 € » avec espaces ordinaires (comparaison écran / PDF / export). */
const montant = (t: string) => t.replace(/[\s  ]+/g, ' ').trim();

async function valeur(page: Page, terme: string): Promise<string> {
  return montant((await page.locator('dt', { hasText: new RegExp(`^${terme}$`) }).first().locator('xpath=following-sibling::dd[1]').textContent())!);
}

async function emettre(page: Page, avoir = false) {
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await page.getByLabel(/J’émets avec ces textes/).check();
  await page.getByRole('button', { name: avoir ? 'Émettre l’avoir' : 'Émettre la facture' }).click();
  await expect(page.getByText(avoir ? /Avoir émis : numéro attribué/ : /Facture émise : numéro attribué/)).toBeVisible();
  const url = page.url().split('?')[0]!;
  return { url, pdf: texteDuPdf(await (await page.request.get(`${url}/pdf`)).body()).replace(/[  ]/g, ' ') };
}

async function payer(page: Page, mode: 'virement' | 'especes') {
  const reste = await valeur(page, 'Reste à payer');
  await page.getByText('Enregistrer un paiement', { exact: true }).click();
  await page.getByLabel('Montant reçu (€)').fill(reste.replace(/[^\d,]/g, ''));
  await page.getByLabel('Mode').selectOption(mode);
  await page.getByRole('button', { name: 'Enregistrer le paiement' }).click();
  await expect(page.getByText(/Paiement enregistré\. Reste à payer : 0,00\s€\./)).toBeVisible();
  return reste;
}

test('de bout en bout, en franchise : métré, devis repris du métré, signature, acompte, finale, avoir, PV, livre des recettes', async ({ page }) => {
  test.setTimeout(180_000);
  const debut = Date.now();
  const erreurs = surveillerConsole(page);
  const nom = `Complet-${unique()}`;
  const chantier = await chantierAvecClient(page, nom);

  // Métré : pièce de référence (31,93 m² de murs) et calcul peinture.
  await page.goto(`/chantiers/${chantier}/pieces/nouvelle`);
  await page.getByLabel('Nom de la pièce').fill('Chambre');
  await page.getByLabel('Longueur (m)').fill('4');
  await page.getByLabel('Largeur (m)').fill('3');
  await page.getByLabel('Hauteur sous plafond (m)').fill('2,50');
  await page.getByRole('button', { name: 'Enregistrer la pièce' }).click();
  await page.getByText('+ Ajouter une ouverture').click();
  await page.getByRole('button', { name: 'Ajouter l’ouverture' }).click();
  await expect(page.getByText('Porte : 83 × 204 cm')).toBeVisible();
  await page.getByLabel('Type').selectOption('fenetre');
  await page.getByLabel('Largeur (cm)').fill('120');
  await page.getByLabel('Hauteur (cm)').fill('115');
  await page.getByRole('button', { name: 'Ajouter l’ouverture' }).click();
  await expect(page.getByRole('definition').filter({ hasText: /^31,93\s*m²$/ })).toBeVisible();
  await page.getByRole('link', { name: /Peinture de cette pièce/ }).click();
  await page.getByRole('button', { name: 'Enregistrer et calculer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Calcul peinture' })).toBeVisible();

  // Devis : le poste de peinture est repris du métré (31,93 m²), prix à compléter.
  await page.goto(`/chantiers/${chantier}`);
  await page.getByRole('link', { name: '+ Devis' }).click();
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  const poste = page.getByRole('listitem').filter({ hasText: 'PRIX À COMPLÉTER' }).first();
  await expect(poste).toContainText(/31,93\s*m²/);
  await poste.locator('summary', { hasText: 'Modifier' }).click();
  await poste.getByLabel('Prix unitaire HT (€)').fill('20');
  await poste.getByRole('button', { name: 'Enregistrer la ligne' }).click();
  await expect(page.getByText('PRIX À COMPLÉTER')).toHaveCount(0);
  await ajouterLigne(page, { designation: 'Protection du chantier', quantite: '1', prix: '61,40', unite: 'forfait' });
  // 31,93 × 20 = 638,60 ; + 61,40 = 700,00 € (franchise : HT = TTC).
  await page.getByLabel('Durée (jours)').fill('2');
  await page.getByLabel(/Signé chez le client \(hors établissement\)/).setChecked(false);
  await page.getByLabel('Ou délai de début (texte)').fill('Sous 3 semaines');
  await page.getByRole('button', { name: 'Enregistrer l’en-tête' }).click();
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await page.getByLabel(/J’émets ce devis avec ces textes/).check();
  await page.getByRole('button', { name: 'Émettre le devis' }).click();
  await expect(page.getByText(/Devis émis : numéro attribué/)).toBeVisible();
  const devisUrl = page.url().split('?')[0]!;
  const pdfDevis = texteDuPdf(await (await page.request.get(`${devisUrl}/pdf`)).body()).replace(/[  ]/g, ' ');
  expect(pdfDevis).toContain(FRANCHISE);
  expect(pdfDevis).toContain('700,00 €');
  await page.getByRole('link', { name: 'Faire signer sur place' }).click();
  await page.getByLabel('Nom et prénom du signataire').fill('Alice Martin');
  await page.getByLabel('Écrivez « Bon pour accord »').fill('Bon pour accord');
  await signerDansLeCadre(page);
  await page.getByLabel('J’ai lu le devis et je l’accepte').check();
  await page.getByRole('button', { name: 'Signer le devis' }).click();
  await expect(page.getByText('Devis signé.')).toBeVisible();

  // Acompte 30 % (210,00 €) payé par virement : écran = PDF.
  await page.getByRole('link', { name: /Facturer/ }).click();
  await page.getByLabel('Acompte (% du devis signé)').fill('30');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  const acompte = await emettre(page);
  expect(acompte.pdf).toContain(FRANCHISE);
  expect(acompte.pdf).toContain('Net à payer 210,00 €');
  expect(await payer(page, 'virement')).toBe('210,00 €');

  // Finale (700,00 € − 210,00 € = 490,00 €), payée en espèces.
  await page.goto(devisUrl);
  await page.getByRole('link', { name: /Facturer/ }).click();
  await page.getByLabel('Type de facture').selectOption('finale');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  const finale = await emettre(page);
  expect(finale.pdf).toContain(FRANCHISE);
  expect(finale.pdf).toContain('Net à payer 490,00 €');
  expect(await payer(page, 'especes')).toBe('490,00 €');

  // Avoir de 15,00 € remboursé : mention de franchise aussi.
  await page.getByRole('link', { name: 'Corriger ou annuler : établir un avoir' }).click();
  await page.getByLabel('Montant', { exact: true }).selectOption('montant');
  await page.getByLabel('Montant de l’avoir, TTC (€)').fill('15');
  await page.getByLabel('Motif (imprimé sur l’avoir)').fill('Geste commercial');
  await page.getByRole('button', { name: 'Créer l’avoir (brouillon)' }).click();
  const avoir = await emettre(page, true);
  expect(avoir.pdf).toContain(FRANCHISE);
  await page.getByText('Enregistrer un remboursement', { exact: true }).click();
  await page.getByLabel(/Montant remboursé/).fill('15');
  await page.getByLabel('Mode').selectOption('especes');
  await page.getByRole('button', { name: /Enregistrer le remboursement/ }).click();
  await expect(page.getByText(/Remboursement enregistré/)).toBeVisible();

  // PV sans réserve, signé à deux.
  await page.goto(`/chantiers/${chantier}`);
  await page.getByRole('link', { name: 'PV de réception' }).click();
  await page.getByRole('button', { name: 'Créer le PV' }).click();
  await page.getByRole('button', { name: 'Présenter au client pour signature' }).click();
  await page.getByLabel('Nom et prénom du client').fill('Alice Martin');
  await page.getByLabel(/Écrivez « Lu et approuvé »/).fill('Lu et approuvé');
  await page.getByLabel(/J’ai relu le procès-verbal/).check();
  await signerDansLeCadre(page, 'Signature du client');
  await page.getByRole('button', { name: 'Valider la signature du client' }).click();
  await signerDansLeCadre(page, 'Signature de l’entreprise');
  await page.getByRole('button', { name: 'Signer le procès-verbal' }).click();
  await expect(page.getByText('Procès-verbal signé.')).toBeVisible();

  // Livre des recettes du mois : les 3 mouvements, montants identiques à l'écran et aux PDF.
  const csv = await (await page.request.get(`/comptabilite/export?periode=${aujourdhui().slice(0, 7)}&format=recettes.csv`)).text();
  const lignes = csv.split('\r\n').filter((l) => l.includes(`Client-${nom}`));
  expect(lignes).toHaveLength(3);
  expect(lignes.some((l) => /;210,00(;|$)/.test(l))).toBe(true);
  expect(lignes.some((l) => /;490,00(;|$)/.test(l))).toBe(true);
  expect(lignes.some((l) => /;-15,00(;|$)/.test(l))).toBe(true);
  expect(erreurs).toEqual([]);
  test.info().annotations.push({ type: 'durée', description: `${Math.round((Date.now() - debut) / 1000)} s (automate, pas un temps humain)` });
});
