import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { adminTests, COMPTE, seConnecter, surveillerConsole } from './outils';

const unique = () => Date.now().toString(36).slice(-5);
const telephone = () => `07 ${String(Math.floor(Math.random() * 1e8)).padStart(8, '0').replace(/(\d\d)(?=\d)/g, '$1 ')}`;

function texteDuPdf(octets: Buffer): string {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'hdecor-e2e-')), 'd.pdf');
  writeFileSync(f, octets);
  return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).replace(/[   ]+/g, ' ');
}

/** Mentions obligatoires de l'entreprise de test (données FICTIVES), franchise de TVA. */
test.beforeAll(async () => {
  const admin = adminTests();
  const { data: liste } = await admin.auth.admin.listUsers();
  const user = liste!.users.find((u) => u.email === COMPTE.email)!;
  const { data: m } = await admin.from('membres').select('organisation_id').eq('user_id', user.id).single();
  const org = m!.organisation_id;
  const { error: eP } = await admin.from('parametres_entreprise').update({
    siret: '12345678900011', adresse_ligne1: '1 rue de l’Exemple', code_postal: '57100', ville: 'Thionville',
    mediateur_nom: 'Médiateur fictif (test)', taux_horaire_cents: 4500, regime_tva: 'franchise', relance_devis_active: false,
  }).eq('organisation_id', org);
  if (eP) throw new Error(`Préparation : ${eP.message}`);
  const { count } = await admin.from('assurances').select('id', { count: 'exact', head: true }).eq('organisation_id', org).eq('type', 'decennale');
  if (!count) {
    const { error } = await admin.from('assurances').insert({
      organisation_id: org, type: 'decennale', assureur: 'Assureur fictif', numero_contrat: 'TEST-1', debut: '2020-01-01', fin: null, zone_couverte: 'France (test)',
    });
    if (error) throw new Error(`Préparation : ${error.message}`);
  }
});

test.beforeEach(async ({ page }) => { await seConnecter(page); });

/** Client particulier avec adresse + chantier à la même adresse ; renvoie l'id du chantier. */
async function chantierAvecClient(page: Page, nom: string, adresse = true): Promise<string> {
  await page.goto('/clients/nouveau');
  await page.getByLabel('Nom', { exact: true }).fill(`Client-${nom}`);
  await page.getByLabel('Téléphone').fill(telephone());
  if (adresse) {
    await page.getByLabel('Adresse de facturation').fill('3 avenue des Lilas');
    await page.getByLabel('Code postal').fill('57100');
  }
  await page.getByLabel('Ville').fill('Thionville');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('link', { name: '+ Chantier' }).click();
  await page.getByLabel('Nom du chantier').fill(nom);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: nom })).toBeVisible();
  return page.url().split('?')[0]!.split('/').pop()!;
}

async function nouveauBrouillon(page: Page, chantierId: string) {
  await page.goto(`/chantiers/${chantierId}`);
  await page.getByRole('link', { name: '+ Devis' }).click();
  await page.getByLabel('Objet (facultatif)').fill('Peinture de la chambre');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
}

async function ajouterLigne(page: Page, l: { designation: string; quantite: string; prix: string; unite?: string; option?: boolean }) {
  const bloc = page.locator('details').filter({ hasText: '+ Ajouter une ligne' });
  if (!(await bloc.evaluate((d) => (d as HTMLDetailsElement).open))) await bloc.locator('summary').click();
  await bloc.getByLabel('Désignation').fill(l.designation);
  await bloc.getByLabel('Quantité').fill(l.quantite);
  if (l.unite) await bloc.getByLabel('Unité').selectOption(l.unite);
  await bloc.getByLabel('Prix unitaire HT (€)').fill(l.prix);
  if (l.option) await bloc.getByLabel('Option (proposée au client, hors total)').check();
  await bloc.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByText('Ligne ajoutée.')).toBeVisible();
  await expect(page.locator('li').filter({ hasText: l.designation }).first()).toBeVisible();
}

async function completerEtEmettre(page: Page): Promise<string> {
  await page.getByLabel('Durée (jours)').fill('2');
  await page.getByLabel('Ou délai de début (texte)').fill('Sous 3 semaines après signature');
  await page.getByRole('button', { name: 'Enregistrer l’en-tête' }).click();
  await expect(page.getByText('En-tête enregistré.')).toBeVisible();
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await expect(page.getByText('Toutes les mentions obligatoires sont renseignées.')).toBeVisible();
  await page.getByLabel(/J’émets ce devis avec ces textes/).check();
  await page.getByRole('button', { name: 'Émettre le devis' }).click();
  await expect(page.getByText(/Devis émis : numéro attribué/)).toBeVisible();
  const titre = await page.getByRole('heading', { level: 1 }).textContent();
  expect(titre).toMatch(/^DEV-\d{4}-\d{4}/);
  return titre!.slice(0, 13);
}

async function signerDansLeCadre(page: Page) {
  const cadre = page.getByRole('img', { name: 'Signature' });
  await cadre.scrollIntoViewIfNeeded();
  const b = (await cadre.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + 20 + i * 15, b.y + 40 + (i % 2 ? 30 : -10));
  await page.mouse.up();
  await expect(page.getByText('Signature tracée.')).toBeVisible();
}

test('devis : brouillon, totaux R4, émission numérotée, PDF figé, lien, signature à distance, PDF signé', async ({ page, browser }) => {
  const erreurs = surveillerConsole(page);
  const chantier = await chantierAvecClient(page, `Devis-${unique()}`);
  await nouveauBrouillon(page, chantier);
  await ajouterLigne(page, { designation: 'Murs acrylique 2 couches', quantite: '31,93', prix: '12,50' });
  await ajouterLigne(page, { designation: 'Boiseries laquées', quantite: '5', prix: '20', unite: 'ml', option: true });
  // R4 : 31,93 × 12,50 = 399,125 -> 399,13 ; l'option est hors total.
  await expect(page.getByText(/= 399,13\s*€ HT/)).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^399,13\s*€$/ }).first()).toBeVisible();
  await expect(page.getByText(/Options proposées \(hors total\) : 100,00\s*€ HT/)).toBeVisible();

  // Aperçu : PDF avec filigrane, sans numéro.
  const devisUrl = page.url().split('?')[0]!;
  const apercu = await page.request.get(`${devisUrl}/pdf`);
  expect(apercu.headers()['content-type']).toBe('application/pdf');
  expect(texteDuPdf(await apercu.body())).toContain('APERÇU : BROUILLON SANS VALEUR CONTRACTUELLE');

  const numero = await completerEtEmettre(page);
  const pdf = texteDuPdf(await (await page.request.get(`${devisUrl}/pdf`)).body());
  expect(pdf).toContain(`Devis n° ${numero}`);
  expect(pdf).toContain('399,13 €');
  expect(pdf).toContain('TVA non applicable');
  expect(pdf).toContain('Formulaire de rétractation');
  expect(pdf).not.toContain('APERÇU');

  // Lien à partager (pas d'email configuré en local).
  await page.getByRole('button', { name: 'Créer un lien à partager' }).click();
  const lien = await page.getByLabel('Lien de signature').inputValue();
  expect(lien).toMatch(/\/d\/[A-Za-z0-9_-]{43}$/);

  // Le client ouvre le lien SANS session.
  const contexte = await browser.newContext({ ...test.info().project.use, baseURL: undefined });
  const client = await contexte.newPage();
  const erreursClient = surveillerConsole(client);
  await client.goto(lien.replace(/^https?:\/\/[^/]+/, new URL(devisUrl).origin));
  await expect(client.getByRole('heading', { level: 1, name: new RegExp(numero) })).toBeVisible();
  await client.getByLabel(/Boiseries laquées/).check();
  await client.getByLabel('Nom et prénom du signataire').fill('Alice Martin');
  await client.getByLabel('Écrivez « Bon pour accord »').fill('bon pour accord');
  await signerDansLeCadre(client);
  await client.getByLabel('J’ai lu le devis et je l’accepte').check();
  await client.getByRole('button', { name: 'Signer le devis' }).click();
  await expect(client.getByText('Devis signé. Merci !')).toBeVisible();
  const signeClient = await client.request.get(`${client.url().split('?')[0]}/pdf?signe=1`);
  expect(texteDuPdf(await signeClient.body())).toContain('Certificat de signature électronique');
  // Lien de signature consommé.
  await client.goto(lien.replace(/^https?:\/\/[^/]+/, new URL(devisUrl).origin));
  await expect(client.getByRole('heading', { name: 'Lien invalide ou expiré' })).toBeVisible();
  expect(erreursClient).toEqual([]);
  await contexte.close();

  // Côté entreprise : accepté, montant avec l'option, PDF signé archivé.
  await page.goto(devisUrl);
  await expect(page.getByText('Signé par Alice Martin')).toBeVisible();
  await expect(page.getByText(/Montant accepté : 499,13\s*€/)).toBeVisible();
  const signe = texteDuPdf(await (await page.request.get(`${devisUrl}/pdf?signe=1`)).body());
  expect(signe).toContain('Alice Martin');
  expect(signe).toContain('Boiseries laquées');
  expect(erreurs).toEqual([]);
});

test('devis : émission bloquée sans adresse client, signature sur place, nouvelle version et comparaison', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  const chantier = await chantierAvecClient(page, `Devis2-${unique()}`, false);
  await nouveauBrouillon(page, chantier);
  await ajouterLigne(page, { designation: 'Plafond', quantite: '12', prix: '15' });
  await page.getByLabel('Durée (jours)').fill('1');
  await page.getByRole('button', { name: 'Enregistrer l’en-tête' }).click();
  await expect(page.getByText('En-tête enregistré.')).toBeVisible();
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await expect(page.getByText('Adresse du client incomplète.')).toBeVisible();
  await expect(page.getByText('Adresse du chantier incomplète.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Émettre le devis' })).toBeDisabled();

  // Adresses complétées (fiche client, chantier) -> émission possible.
  const emettre = page.url();
  await page.getByRole('link', { name: 'Fiche client' }).first().click();
  await page.getByLabel('Adresse de facturation').fill('5 rue du Test');
  await page.getByLabel('Code postal').fill('57100');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/enregistré/i).first()).toBeVisible();
  await page.goto(emettre);
  await page.getByRole('link', { name: 'Chantier' }).first().click();
  await page.getByLabel('Adresse du chantier').fill('5 rue du Test');
  await page.getByLabel('Code postal').fill('57100');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Chantier enregistré.')).toBeVisible();
  await page.goto('/devis?filtre=brouillon');
  await page.getByRole('link', { name: /Brouillon · Client-Devis2/ }).first().click();
  const numero = await completerEtEmettre(page);
  const devisUrl = page.url().split('?')[0]!;

  // Nouvelle version : même numéro, v2, comparaison.
  await page.getByText('Modifier : créer une nouvelle version…').click();
  await page.getByLabel(/Je crée une version suivante/).check();
  await page.getByRole('button', { name: 'Modifier : créer une nouvelle version' }).click();
  await expect(page.getByText(/Nouvelle version en brouillon/)).toBeVisible();
  await ajouterLigne(page, { designation: 'Porte', quantite: '1', prix: '80', unite: 'u' });
  await completerEtEmettre(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${numero} (version 2)`);
  await page.getByRole('link', { name: 'Comparer avec la version précédente' }).click();
  await expect(page.getByText('Ajoutée : Porte')).toBeVisible();
  await page.goto(devisUrl);
  await expect(page.getByText(/Remplacé/).first()).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: '← Retour' }).click();

  // Signature sur place.
  await page.getByRole('link', { name: 'Faire signer sur place' }).click();
  await page.getByLabel('Nom et prénom du signataire').fill('Client Sur Place');
  await page.getByLabel('Écrivez « Bon pour accord »').fill('Bon pour accord.');   // point final du clavier : accepté
  // Un simple tapotement n'est pas une signature.
  const cadre = page.getByRole('img', { name: 'Signature' });
  await cadre.scrollIntoViewIfNeeded();
  const b = (await cadre.boundingBox())!;
  await page.mouse.click(b.x + 50, b.y + 50);
  await expect(page.getByText('Signature trop courte : signez en entier dans le cadre.')).toBeVisible();
  await page.getByLabel('J’ai lu le devis et je l’accepte').check();
  await page.getByRole('button', { name: 'Signer le devis' }).click();
  await expect(page.getByText('Signez dans le cadre.').first()).toBeVisible();
  // Téléphone tourné après avoir signé : cadre vidé, nouvelle signature demandée.
  await signerDansLeCadre(page);
  const taille = page.viewportSize()!;
  await page.setViewportSize({ width: taille.height, height: taille.width });
  await expect(page.getByText('Le téléphone a tourné : le cadre a été vidé, signez à nouveau.')).toBeVisible();
  await page.setViewportSize(taille);
  await signerDansLeCadre(page);
  await page.getByRole('button', { name: 'Signer le devis' }).click();
  await expect(page.getByText('Devis signé.')).toBeVisible();
  await expect(page.getByText(/Signé par Client Sur Place .*sur place/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'PDF signé' })).toBeVisible();
  expect(erreurs).toEqual([]);
});

test('devis : reprise des postes de peinture (surface affichée), sans doublon à la seconde reprise', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  const chantier = await chantierAvecClient(page, `Reprise-${unique()}`);
  await page.goto(`/chantiers/${chantier}/pieces/nouvelle`);
  await page.getByLabel('Nom de la pièce').fill('Chambre');
  await page.getByLabel('Longueur (m)').fill('4');
  await page.getByLabel('Largeur (m)').fill('3');
  await page.getByLabel('Hauteur sous plafond (m)').fill('2,50');
  await page.getByRole('button', { name: 'Enregistrer la pièce' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Chambre' })).toBeVisible();
  await page.goto(`/chantiers/${chantier}/peinture/nouveau`);
  await page.getByLabel('Pièce', { exact: true }).selectOption({ label: 'Chambre' });
  await page.getByLabel('Finition').selectOption('velours');
  await page.getByRole('button', { name: 'Enregistrer et calculer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Calcul peinture' })).toBeVisible();

  await nouveauBrouillon(page, chantier);
  // Murs 2 × (4 + 3) × 2,50 = 35,00 m², repris tels qu'affichés.
  const ligne = page.locator('li').filter({ hasText: 'Chambre : murs' }).first();
  await expect(ligne).toBeVisible();
  await expect(ligne.getByText(/^35 m² ×/)).toBeVisible();
  await page.getByRole('button', { name: 'Reprendre les postes de peinture du chantier' }).click();
  await expect(page.getByText('Tous les postes du chantier sont déjà repris dans ce devis.')).toBeVisible();
  await expect(page.locator('li').filter({ hasText: 'Chambre : murs' })).toHaveCount(1);
  expect(erreurs).toEqual([]);
});
