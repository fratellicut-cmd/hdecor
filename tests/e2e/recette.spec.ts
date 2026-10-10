import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { adminTests, seConnecter, surveillerConsole } from './outils';
import { ajouterLigne, chantierAvecClient, nouveauBrouillon, preparerEntreprise, texteDuPdf, unique } from './parcours';

test.beforeAll(preparerEntreprise);
test.beforeEach(async ({ page }) => { await seConnecter(page); });

/** Organisation de test remise à l'état par défaut (logo et textes), même si un test échoue. */
test.afterAll(async () => {
  const admin = adminTests();
  const { data: m } = await admin.from('membres').select('organisation_id').limit(1).single();
  await admin.from('parametres_entreprise').update({ logo_chemin: null, textes_legaux: {}, textes_legaux_valides_le: null }).eq('organisation_id', m!.organisation_id);
});

/** PNG RVB uni (w × h), encodé à la main : aucune image de fixture à maintenir. */
function png(l: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const bloc = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const lg = Buffer.alloc(4); lg.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(t));
    return Buffer.concat([lg, t, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const ligne = Buffer.concat([Buffer.from([0]), Buffer.alloc(l * 3, 0xb8)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', ihdr),
    bloc('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => ligne)))), bloc('IEND', Buffer.alloc(0))]);
}

test('réglages : logo et textes des documents imprimés sur le devis, retour aux valeurs par défaut', async ({ page }) => {
  const erreurs = surveillerConsole(page);
  await page.goto('/parametres');
  // Faux PNG refusé (contenu vérifié, pas l'extension).
  await page.locator('input[name="logo"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('pas une image') });
  await page.getByRole('button', { name: 'Enregistrer le logo' }).click();
  await expect(page.getByText('Format refusé : PNG ou JPEG seulement.')).toBeVisible();
  await page.locator('input[name="logo"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png(120, 60) });
  await page.getByRole('button', { name: 'Enregistrer le logo' }).click();
  await expect(page.getByRole('img', { name: 'Logo actuel' })).toBeVisible();

  await page.goto('/parametres/textes');
  const recu = page.getByLabel('Mention « devis reçu »');
  await expect(recu).toHaveValue('Devis reçu avant l’exécution des travaux.');
  await recu.fill('Devis reçu et lu avant les travaux (texte de recette).');
  const retractation = page.getByLabel('Droit de rétractation');
  const avant = await retractation.inputValue();
  await retractation.fill('Texte sans le repère obligatoire.');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Gardez {contact} : remplacé à l’impression.')).toBeVisible();
  await retractation.fill(avant);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Enregistré.')).toBeVisible();

  const chantier = await chantierAvecClient(page, `Recette-${unique()}`);
  await nouveauBrouillon(page, chantier);
  await ajouterLigne(page, { designation: 'Peinture des murs', quantite: '10', prix: '20', unite: 'm2' });
  const apercu = await (await page.request.get(`${page.url().split('?')[0]}/pdf`)).body();
  expect(apercu.includes('/Subtype /Image')).toBe(true);
  expect(texteDuPdf(apercu)).toContain('Devis reçu et lu avant les travaux (texte de recette).');

  // Retour aux valeurs par défaut : champ vidé, logo retiré.
  await page.goto('/parametres/textes');
  await page.getByLabel('Mention « devis reçu »').fill('');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Enregistré.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Mention « devis reçu »')).toHaveValue('Devis reçu avant l’exécution des travaux.');
  await page.goto('/parametres');
  await page.getByText('Retirer le logo…').click();
  await page.getByLabel(/Je retire le logo des prochains documents/).check();
  await page.getByRole('button', { name: 'Retirer le logo' }).click();
  await expect(page.getByRole('img', { name: 'Logo actuel' })).toHaveCount(0);
  expect(erreurs).toEqual([]);
});

test('listes : recherche d’un chantier et d’un devis par client, filtre conservé', async ({ page }) => {
  const nom = `Cherche-${unique()}`;
  const chantier = await chantierAvecClient(page, nom);
  await nouveauBrouillon(page, chantier);
  await page.goto('/chantiers?filtre=tous');
  await page.getByLabel('Chercher un chantier').fill(nom);
  await page.getByRole('button', { name: 'Chercher' }).click();
  await expect(page).toHaveURL(/filtre=tous/);
  await expect(page.getByRole('link', { name: new RegExp(nom) })).toHaveCount(1);
  await page.goto('/devis');
  await page.getByLabel('Chercher un devis').fill(`Client-${nom}`);
  await page.getByRole('button', { name: 'Chercher' }).click();
  await expect(page.getByRole('link', { name: new RegExp(`Brouillon · Client-${nom}`) })).toBeVisible();
  await page.getByLabel('Chercher un devis').fill('introuvable-zz9');
  await page.getByRole('button', { name: 'Chercher' }).click();
  await expect(page.getByText('Aucun devis pour « introuvable-zz9 » dans ce filtre. Essayez « Tous ».')).toBeVisible();
  // Caractères de syntaxe : nettoyés, jamais une erreur.
  await page.goto('/factures?q=%29%2Cnumero.eq.%28x');
  await expect(page.getByRole('heading', { name: 'Factures' })).toBeVisible();
});
