import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { seConnecter, surveillerConsole } from './outils';
import { chantierAvecClient, preparerEntreprise, texteDuPdf, unique } from './parcours';

test.beforeAll(preparerEntreprise);
test.beforeEach(async ({ page }) => { await seConnecter(page); });

/** Vraie photo JPEG (Pillow) portant une position GPS et un commentaire avec une adresse. */
function photoAvecGps(couleur: [number, number, number]): Buffer {
  const script = [
    'import io, sys',
    'from PIL import Image',
    `im = Image.new("RGB", (1200, 900), (${couleur.join(',')}))`,
    'exif = Image.Exif()',
    'exif[0x8825] = {1: "N", 2: (49.0, 21.0, 30.0), 3: "E", 4: (6.0, 10.0, 5.0)}',
    'b = io.BytesIO()',
    'im.save(b, "JPEG", exif=exif.tobytes(), comment=b"3 rue des Lilas")',
    'sys.stdout.buffer.write(b.getvalue())',
  ].join('\n');
  return execFileSync('python3', ['-I', '-c', script]);
}

/** Métadonnées encore présentes dans une photo servie (relue par Pillow). */
function metadonnees(octets: Buffer): { exif: number; commentaire: boolean; taille: [number, number] } {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'hdecor-photo-')), 'p.jpg');
  writeFileSync(f, octets);
  const script = 'import json,sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]); im.load()\nprint(json.dumps({"exif": len(im.getexif()), "commentaire": "comment" in im.info, "taille": im.size}))';
  return JSON.parse(execFileSync('python3', ['-I', '-c', script, f], { encoding: 'utf8' }));
}

test('photos : ajout, métadonnées retirées, galerie avant / après soumise à l’accord du client, exports', async ({ page, browser }) => {
  const erreurs = surveillerConsole(page);
  const chantier = await chantierAvecClient(page, `Photos-${unique()}`);
  await page.getByRole('link', { name: /^Photos \(0\)$/ }).click();
  await expect(page.getByRole('heading', { name: 'Photos', level: 1 })).toBeVisible();

  // Deux photos « avant », puis une « après ».
  const ajout = page.locator('section', { has: page.getByRole('heading', { name: 'Ajouter des photos' }) });
  await page.locator('input[name="photos"]').setInputFiles([
    { name: 'avant1.jpg', mimeType: 'image/jpeg', buffer: photoAvecGps([180, 60, 40]) },
    { name: 'avant2.jpg', mimeType: 'image/jpeg', buffer: photoAvecGps([40, 60, 180]) },
  ]);
  await expect(page.getByText(/2 photos prêtes/)).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter les photos' }).click();
  await expect(page.getByText('2 photos ajoutées.')).toBeVisible();
  await page.reload();
  await expect(ajout.getByLabel('Moment')).toHaveValue('apres');
  await page.locator('input[name="photos"]').setInputFiles([{ name: 'apres.jpg', mimeType: 'image/jpeg', buffer: photoAvecGps([60, 180, 60]) }]);
  await expect(page.getByText(/1 photo prête/)).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter les photos' }).click();
  await expect(page.getByText('1 photo ajoutée.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Avant (2)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Après (1)' })).toBeVisible();

  // Photo servie : lisible, réduite à 1600 px au plus, sans position GPS ni commentaire.
  const src = await page.locator('section[aria-label="Photos Avant"] img').first().getAttribute('src');
  const r = await page.request.get(src!);
  expect(r.headers()['content-type']).toBe('image/jpeg');
  const m = metadonnees(await r.body());
  expect(m).toEqual({ exif: 0, commentaire: false, taille: [1200, 900] });
  expect((await r.body()).toString('latin1')).not.toContain('rue des Lilas');
  const anonyme = await browser.newContext();
  expect((await anonyme.request.get(new URL(src!, page.url()).toString(), { maxRedirects: 0 })).status()).not.toBe(200);
  await anonyme.close();

  // Galerie : une photo avant et la photo après retenues.
  for (const section of ['Photos Avant', 'Photos Après']) {
    const carte = page.locator(`section[aria-label="${section}"] li`).first();
    await carte.getByText('Modifier', { exact: true }).click();
    await carte.getByLabel('Dans la galerie avant / après').check();
    await carte.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(carte.getByText('Photo mise à jour.')).toBeVisible();
  }
  const exportPdf = `/chantiers/${chantier}/photos/export?quoi=galerie&format=pdf`;
  expect((await page.request.get(exportPdf)).status()).toBe(403);

  await page.reload();
  await page.getByText('Noter l’accord du client…').click();
  await page.getByLabel(/Le client accepte que les photos/).check();
  await page.getByRole('button', { name: 'Noter l’accord du client' }).click();
  await expect(page.getByText(/Accord du client pour la diffusion noté le/)).toBeVisible();
  const pdf = await page.request.get(exportPdf);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  const texte = texteDuPdf(await pdf.body());
  expect(texte).toContain('Réalisation : avant / après');
  expect(texte).toContain('Avant');
  expect(texte).toContain('Après');
  expect(texte).not.toContain('Client-Photos');
  const zip = await page.request.get(`/chantiers/${chantier}/photos/export?quoi=galerie&format=zip`);
  expect((await zip.body()).subarray(0, 2).toString()).toBe('PK');
  expect((await zip.body()).toString('latin1')).toContain('Chantier-1-avant.jpg');
  const tout = await page.request.get(`/chantiers/${chantier}/photos/export?quoi=tout&format=zip`);
  expect((await tout.body()).toString('latin1')).toContain('Avant/chantier-2.jpg');
  expect(erreurs).toEqual([]);
});

test('documents de chantier : PDF vérifié sur son contenu, ouverture, suppression', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  const chantier = await chantierAvecClient(page, `Docs-${unique()}`);
  await page.goto(`/chantiers/${chantier}/documents`);
  await page.locator('input[name="fichier"]').setInputFiles({ name: 'faux.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>pas un pdf</html>') });
  await page.getByLabel('Nom').fill('Faux');
  await page.getByRole('button', { name: 'Ajouter le document' }).click();
  await expect(page.getByText('Format refusé : PDF ou photo (JPEG, PNG, WebP).')).toBeVisible();

  await page.locator('input[name="fichier"]').setInputFiles({ name: 'fiche.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') });
  await page.getByLabel('Nom').fill('Fiche technique peinture mate');
  await page.getByRole('button', { name: 'Ajouter le document' }).click();
  await expect(page.getByText('« Fiche technique peinture mate » ajouté.')).toBeVisible();
  await page.reload();
  const lien = page.getByRole('link', { name: 'Fiche technique peinture mate' });
  const r = await page.request.get((await lien.getAttribute('href'))!);
  expect(r.headers()['content-type']).toBe('application/pdf');
  await page.getByText('Supprimer…').click();
  await page.getByLabel('Je supprime ce document').check();
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByText('Aucun document.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Aucun document.')).toBeVisible();
  expect(erreurs).toEqual([]);
});
