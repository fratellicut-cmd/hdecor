import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { adminTests, COMPTE } from './outils';

/** Parcours communs aux tests des devis et des factures. */

export const unique = () => Date.now().toString(36).slice(-5);
export const telephone = () => `07 ${String(Math.floor(Math.random() * 1e8)).padStart(8, '0').replace(/(\d\d)(?=\d)/g, '$1 ')}`;

export function texteDuPdf(octets: Buffer): string {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'hdecor-e2e-')), 'd.pdf');
  writeFileSync(f, octets);
  return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).replace(/[   ]+/g, ' ');
}

/** Mentions obligatoires de l'entreprise de test (données FICTIVES), franchise de TVA. */
export async function preparerEntreprise() {
  const admin = adminTests();
  const { data: liste } = await admin.auth.admin.listUsers();
  const user = liste!.users.find((u) => u.email === COMPTE.email)!;
  const { data: m } = await admin.from('membres').select('organisation_id').eq('user_id', user.id).single();
  const org = m!.organisation_id;
  const { error: eP } = await admin.from('parametres_entreprise').update({
    siret: '12345678900011', adresse_ligne1: '1 rue de l’Exemple', code_postal: '57100', ville: 'Thionville',
    mediateur_nom: 'Médiateur fictif (test)', taux_horaire_cents: 4500, regime_tva: 'franchise', relance_devis_active: false,
    iban: 'FR1420041010050500013M02606', bic: 'PSSTFRPPPAR', taux_penalites_bp: 1000,
  }).eq('organisation_id', org);
  if (eP) throw new Error(`Préparation : ${eP.message}`);
  const { count } = await admin.from('assurances').select('id', { count: 'exact', head: true }).eq('organisation_id', org).eq('type', 'decennale');
  if (!count) {
    const { error } = await admin.from('assurances').insert({
      organisation_id: org, type: 'decennale', assureur: 'Assureur fictif', numero_contrat: 'TEST-1', debut: '2020-01-01', fin: null, zone_couverte: 'France (test)',
    });
    if (error) throw new Error(`Préparation : ${error.message}`);
  }
}

/** Client particulier avec adresse + chantier à la même adresse ; renvoie l'id du chantier. */
export async function chantierAvecClient(page: Page, nom: string, adresse = true): Promise<string> {
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

export async function nouveauBrouillon(page: Page, chantierId: string) {
  await page.goto(`/chantiers/${chantierId}`);
  await page.getByRole('link', { name: '+ Devis' }).click();
  await page.getByLabel('Objet (facultatif)').fill('Peinture de la chambre');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
}

export async function ajouterLigne(page: Page, l: { designation: string; quantite: string; prix: string; unite?: string; option?: boolean }) {
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

export async function completerEtEmettre(page: Page): Promise<string> {
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

export async function signerDansLeCadre(page: Page) {
  const cadre = page.getByRole('img', { name: 'Signature' });
  await cadre.scrollIntoViewIfNeeded();
  const b = (await cadre.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + 20 + i * 15, b.y + 40 + (i % 2 ? 30 : -10));
  await page.mouse.up();
  await expect(page.getByText('Signature tracée.')).toBeVisible();
}

