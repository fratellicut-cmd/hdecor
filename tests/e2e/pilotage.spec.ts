import { crc32, deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { seConnecter, surveillerConsole } from './outils';
import { chantierAvecClient, preparerEntreprise, texteDuPdf, unique } from './parcours';

test.beforeAll(preparerEntreprise);
test.beforeEach(async ({ page }) => { await seConnecter(page); });

const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

/** Image PNG unie (photo de ticket simulée), construite octet par octet. */
function png(largeur: number, hauteur: number): Buffer {
  const bloc = (type: string, donnees: Buffer) => {
    const t = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
    const l = Buffer.alloc(4); l.writeUInt32BE(donnees.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(t));
    return Buffer.concat([l, t, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4); ihdr[8] = 8; ihdr[9] = 2;
  const ligne = Buffer.concat([Buffer.from([0]), Buffer.alloc(largeur * 3, 0xc8)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', ihdr),
    bloc('IDAT', deflateSync(Buffer.concat(Array.from({ length: hauteur }, () => ligne)))), bloc('IEND', Buffer.alloc(0))]);
}

test('tableau de bord et planning : événement, rappel, export ICS', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Chiffre d’affaires encaissé' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Seuils de la micro-entreprise' })).toBeVisible();

  await page.getByRole('link', { name: 'Planning' }).first().click();
  await expect(page).toHaveURL(/\/planning/);
  const titre = `RDV métré ${unique()}`;
  await page.getByText('+ Un rendez-vous ou un événement').click();
  const ajout = page.locator('details', { hasText: '+ Un rendez-vous ou un événement' });
  await ajout.getByLabel('Titre').fill(titre);
  await ajout.getByLabel('Début', { exact: true }).fill(aujourdhui());
  await ajout.getByLabel('Heure de début').fill('09:00');
  await ajout.getByLabel('Heure de fin').fill('08:00');
  await ajout.getByRole('button', { name: 'Ajouter au planning' }).click();
  await expect(page.getByText('La fin précède le début.')).toBeVisible();
  await ajout.getByLabel('Heure de fin').fill('10:30');
  await ajout.getByRole('button', { name: 'Ajouter au planning' }).click();
  await expect(page.getByText(/Ajouté au planning le/)).toBeVisible();
  await page.goto(`/planning?vue=jour&date=${aujourdhui()}`);
  await expect(page.getByText(titre)).toBeVisible();

  const rappel = `Commander l’enduit ${unique()}`;
  await page.getByText('+ Un rappel').click();
  await page.getByLabel('Me rappeler de').fill(rappel);
  await page.getByRole('button', { name: 'Ajouter le rappel' }).click();
  await expect(page.getByText(/Rappel noté pour le/)).toBeVisible();
  await page.reload();
  const leRappel = page.getByRole('listitem').filter({ hasText: rappel });
  await expect(leRappel).toBeVisible();
  // « C’est fait » : le rappel quitte le planning (et « À faire »).
  await leRappel.getByRole('button', { name: 'C’est fait' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: rappel })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: rappel })).toHaveCount(0);

  const ics = await page.request.get('/planning/agenda.ics');
  expect(ics.status()).toBe(200);
  expect(ics.headers()['content-type']).toContain('text/calendar');
  const texte = (await ics.text()).replace(/\r\n /g, '');
  expect(texte).toContain('BEGIN:VCALENDAR');
  expect(texte).toContain(`SUMMARY:${titre}`);
  expect(erreurs).toEqual([]);
});

test('chantier : planification en jours ouvrés, temps passé, rentabilité, achat rattaché avec photo', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  const nom = `Pilot-${unique()}`;
  const chantier = await chantierAvecClient(page, nom);

  // Vendredi 2 octobre 2026 + 2 jours ouvrés : fin le lundi 5.
  await page.getByLabel('Durée (jours ouvrés)').fill('2');
  await page.getByLabel('Début', { exact: true }).fill('2026-10-02');
  await page.getByRole('button', { name: 'Planifier', exact: true }).click();
  await expect(page.getByText('Chantier planifié du 02/10/2026 au 05/10/2026 (2 j ouvrés).')).toBeVisible();
  // Rien le week-end : le samedi 03/10 n'affiche pas le chantier, le lundi 05/10 si.
  await page.goto('/planning?vue=jour&date=2026-10-03');
  await expect(page.getByRole('region', { name: 'samedi 3 octobre' }).getByText(nom)).toHaveCount(0);
  await page.goto('/planning?vue=jour&date=2026-10-05');
  await expect(page.getByRole('region', { name: 'lundi 5 octobre' }).getByText(nom)).toBeVisible();
  await page.goto(`/chantiers/${chantier}`);

  await page.getByLabel('Durée', { exact: true }).fill('7h30');
  await page.getByLabel('Tâche (facultatif)').fill('Ponçage');
  await page.getByRole('button', { name: 'Noter le temps' }).click();
  await expect(page.getByText(/7 h 30 notées le/)).toBeVisible();
  await page.reload();
  await expect(page.getByText('Total : 7 h 30')).toBeVisible();
  // 7 h 30 au taux horaire de test (45 €/h) : 337,50 €.
  await expect(page.getByRole('definition').filter({ hasText: /^337,50\s€$/ })).toBeVisible();

  // Achat rattaché au chantier, avec photo du ticket.
  await page.getByRole('link', { name: '+ Noter un achat pour ce chantier' }).click();
  await expect(page.getByLabel('Chantier (facultatif)')).toHaveValue(chantier);
  await page.locator('input[name="justificatif"]').setInputFiles({ name: 'ticket.png', mimeType: 'image/png', buffer: png(64, 48) });
  await expect(page.getByText(/prêt à envoyer/)).toBeVisible();
  await page.getByLabel('Montant TTC').fill('120');
  await page.getByLabel('Dont TVA').fill('130');
  const fournisseur = `Négoce ${unique()}`;
  await page.getByLabel('Fournisseur').fill(fournisseur);
  await page.getByRole('button', { name: 'Enregistrer l’achat' }).click();
  await expect(page.getByText('La TVA dépasse le montant TTC.')).toBeVisible();
  await page.getByLabel('Dont TVA').fill('20');
  await page.getByRole('button', { name: 'Enregistrer l’achat' }).click();
  // Noté depuis le chantier : retour au chantier.
  await expect(page.getByText('Achat enregistré pour ce chantier.')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/chantiers/${chantier}`));
  await page.goto('/comptabilite/achats');
  await page.getByRole('link', { name: new RegExp(fournisseur) }).click();
  const img = page.getByRole('img', { name: /Justificatif/ });
  await expect(img).toBeVisible();
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);

  // Franchise de TVA : l'achat compte TTC dans la marge (120 €).
  await page.goto(`/chantiers/${chantier}`);
  await expect(page.getByText('Achats (TTC, TVA non récupérée)')).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^120,00\s€$/ }).first()).toBeVisible();
  expect(erreurs).toEqual([]);
});

test('justificatif : contenu vérifié, fichier inaccessible sans session', async ({ page, browser }) => {
  await page.goto('/comptabilite/achats/nouveau');
  await page.locator('input[name="justificatif"]').setInputFiles({ name: 'ticket.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>pas un pdf</html>') });
  await page.getByLabel('Montant TTC').fill('10');
  await page.getByLabel('Fournisseur').fill('Faux PDF');
  await page.getByRole('button', { name: 'Enregistrer l’achat' }).click();
  await expect(page.getByText('Format refusé : photo (JPEG, PNG, WebP) ou PDF.')).toBeVisible();

  const vrai = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  await page.locator('input[name="justificatif"]').setInputFiles({ name: 'facture.pdf', mimeType: 'application/pdf', buffer: vrai });
  await page.getByLabel('Fournisseur').fill(`Vrai PDF ${unique()}`);
  await page.getByRole('button', { name: 'Enregistrer l’achat' }).click();
  await expect(page.getByText('Achat enregistré.')).toBeVisible();
  await page.getByRole('link', { name: /Vrai PDF/ }).first().click();
  const lien = await page.getByRole('link', { name: 'Ouvrir le PDF' }).getAttribute('href');
  const r = await page.request.get(lien!);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toBe('application/pdf');

  const anonyme = await browser.newContext();
  const r2 = await anonyme.request.get(new URL(lien!, page.url()).toString(), { maxRedirects: 0 });
  expect(r2.status()).not.toBe(200);
  await anonyme.close();
});

test('comptabilité : registre, exports CSV, Excel et PDF, matériel', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  const fournisseur = `Droguerie ${unique()}`;
  await page.goto('/comptabilite/achats/nouveau');
  await page.getByLabel('Montant TTC').fill('45,99');
  await page.getByLabel('Fournisseur').fill(fournisseur);
  await page.getByLabel('Catégorie', { exact: true }).selectOption({ label: 'Outillage' });
  await page.getByRole('button', { name: 'Enregistrer l’achat' }).click();
  await expect(page.getByText('Achat enregistré.')).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(fournisseur) })).toContainText('Justificatif manquant');

  await page.goto('/comptabilite');
  await expect(page.getByText(/sans justificatif/)).toBeVisible();
  const mois = aujourdhui().slice(0, 7);
  const csv = await page.request.get(`/comptabilite/export?periode=${mois}&format=achats.csv`);
  expect(csv.status()).toBe(200);
  const texte = await csv.text();
  expect(texte.split('\r\n')[0]).toBe('﻿Date;Fournisseur;Libellé;Catégorie;Chantier;HT;TVA;TTC;Mode de paiement;Justificatif');
  expect(texte).toContain(`;${fournisseur};;Outillage;;45,99;0,00;45,99;;Non`);

  const xlsx = await page.request.get(`/comptabilite/export?periode=${mois.slice(0, 4)}&format=xlsx`);
  expect(xlsx.status()).toBe(200);
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe('PK');

  const pdf = await page.request.get(`/comptabilite/export?periode=${mois}&format=pdf`);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  const t = texteDuPdf(await pdf.body());
  expect(t).toContain('Livre des recettes');
  expect(t).toContain('Registre des achats');
  expect(t).toContain(fournisseur);

  expect((await page.request.get(`/comptabilite/export?periode=2026-13&format=pdf`)).status()).toBe(404);

  await page.goto('/comptabilite/materiel');
  const outil = `Ponceuse ${unique()}`;
  const ajout = page.locator('section', { has: page.getByRole('heading', { name: 'Ajouter' }) });
  await ajout.getByLabel('Désignation').fill(outil);
  await ajout.getByLabel('Valeur (facultatif)').fill('489');
  await ajout.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText(`« ${outil} » ajouté au matériel.`)).toBeVisible();
  await page.reload();
  await expect(page.getByText(outil)).toBeVisible();
  expect(erreurs).toEqual([]);
});
