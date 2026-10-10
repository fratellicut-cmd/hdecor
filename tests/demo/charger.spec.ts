/**
 * Jeu de DÉMONSTRATION (données fictives) chargé PAR L'APPLICATION elle-même :
 * numéros, PDF, signatures, paiements et PV suivent exactement les vraies
 * règles. Base locale « hdecor_demo » uniquement (voir garde.ts).
 *
 *   npm run demo:pile                    # recrée hdecor_demo (pile locale)
 *   npm run build && npx next start      # serveur sur la démo
 *   npm run demo:charger                 # ce chargement (2 à 3 minutes)
 *
 * Accès : écrit dans .supabase-local/demo-acces.txt (jamais dans git).
 * Effacement : relancer npm run demo:pile (base et fichiers recréés vides).
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { expect, test, type Page } from '@playwright/test';
import { adminTests, seConnecter } from '../e2e/outils';
import { ajouterLigne, signerDansLeCadre } from '../e2e/parcours';
import { refusDemo } from './garde';

// Lancé depuis la racine du projet (npm run demo:charger).
const RACINE = process.cwd();
const DEMO = { email: 'demo@hdecor.invalid', motDePasse: '' };
export const URL_DEMO = process.env.DEMO_URL ?? 'http://localhost:3000';
const MENTION_DEMO = 'DOCUMENT DE DÉMONSTRATION : entreprise, clients et montants fictifs, sans valeur.';

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async () => {
  try { loadEnvFile(path.join(RACINE, '.env.local')); } catch { /* variables déjà présentes */ }
  let base: string | null = null;
  try { base = readFileSync(path.join(RACINE, '.supabase-local/base-active'), 'utf8').trim(); } catch { /* pile absente */ }
  const refus = refusDemo({ baseActive: base, urlSupabase: process.env.NEXT_PUBLIC_SUPABASE_URL, urlSite: URL_DEMO, env: process.env });
  if (refus.length) throw new Error(`Démo refusée :\n- ${refus.join('\n- ')}`);

  const admin = adminTests();
  const { data: liste } = await admin.auth.admin.listUsers();
  if (liste?.users.some((u) => u.email === DEMO.email)) throw new Error('Démo déjà chargée : relancez npm run demo:pile pour repartir de zéro.');
  DEMO.motDePasse = randomBytes(12).toString('base64url');
  const { data: u, error } = await admin.auth.admin.createUser({ email: DEMO.email, password: DEMO.motDePasse, email_confirm: true });
  if (error || !u.user) throw new Error(`Compte de démo : ${error?.message}`);
  const { data: org, error: eO } = await admin.rpc('initialiser_organisation', {
    p_user_id: u.user.id, p_raison_sociale: 'DÉMO Peinture (entreprise fictive)', p_nom_dirigeant: 'Dominique Exemple (fictif)', p_email: DEMO.email,
  });
  if (eO) throw new Error(`Organisation de démo : ${eO.message}`);
  const orgId = org as unknown as string;
  // Valeurs FICTIVES : SIRET et IBAN d'exemple, médiateur et assureur inventés et désignés comme tels.
  const { error: eP } = await admin.from('parametres_entreprise').update({
    siret: '12345678900011', adresse_ligne1: '1 rue de la Démonstration', code_postal: '57100', ville: 'Thionville',
    telephone: '03 00 00 00 00', iban: 'FR1420041010050500013M02606', bic: 'PSSTFRPPPAR', taux_penalites_bp: 1000,
    mediateur_nom: 'Médiateur fictif (démo)', mediateur_site: 'https://example.invalid/mediateur', mentions_pied: MENTION_DEMO,
    taux_horaire_cents: 4500, regime_tva: 'franchise', relance_devis_active: false, avis_google_url: 'https://example.invalid/avis-demo',
  }).eq('organisation_id', orgId);
  if (eP) throw new Error(`Paramètres de démo : ${eP.message}`);
  const { error: eA } = await admin.from('assurances').insert({
    organisation_id: orgId, type: 'decennale', assureur: 'Assureur fictif (démo)', numero_contrat: 'DEMO-0001', debut: '2026-01-01', fin: null, zone_couverte: 'France (démo)',
  });
  if (eA) throw new Error(`Assurance de démo : ${eA.message}`);
  const acces = path.join(RACINE, '.supabase-local/demo-acces.txt');
  writeFileSync(acces, `Démonstration H'DECOR (données fictives)\nEmail : ${DEMO.email}\nMot de passe : ${DEMO.motDePasse}\n`, { mode: 0o600 });
  chmodSync(acces, 0o600);
  console.log(`Accès de démonstration écrit dans ${acces}`);
});

test.beforeEach(async ({ page }) => { await seConnecter(page, DEMO); });

/** Client saisi par le formulaire ; renvoie l'URL de sa fiche. */
async function client(page: Page, c: { pro?: boolean; raison?: string; civilite?: string; nom: string; prenom?: string; email: string; adresse: string; cp: string; ville: string }) {
  await page.goto('/clients/nouveau');
  if (c.pro) {
    await page.getByText('Professionnel', { exact: true }).click();
    await page.getByLabel('Raison sociale').fill(c.raison!);
  }
  if (c.civilite) await page.getByLabel('Civilité').selectOption(c.civilite);
  await page.getByLabel(c.pro ? 'Nom du contact' : 'Nom', { exact: true }).fill(c.nom);
  if (c.prenom) await page.getByLabel('Prénom').fill(c.prenom);
  await page.getByLabel('Email').fill(c.email);
  await page.getByLabel('Adresse de facturation').fill(c.adresse);
  await page.getByLabel('Code postal').fill(c.cp);
  await page.getByLabel('Ville').fill(c.ville);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('link', { name: '+ Chantier' })).toBeVisible();
  return page.url().split('?')[0]!;
}

async function chantier(page: Page, ficheClient: string, nom: string): Promise<string> {
  await page.goto(ficheClient);
  await page.getByRole('link', { name: '+ Chantier' }).click();
  await page.getByLabel('Nom du chantier').fill(nom);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: nom })).toBeVisible();
  return page.url().split('?')[0]!;
}

async function piece(page: Page, urlChantier: string, p: { nom: string; l: string; la: string; h: string; ouvertures: { type: 'porte' | 'fenetre'; l: string; h: string }[] }) {
  await page.goto(`${urlChantier}/pieces/nouvelle`);
  await page.getByLabel('Nom de la pièce').fill(p.nom);
  await page.getByLabel('Longueur (m)').fill(p.l);
  await page.getByLabel('Largeur (m)').fill(p.la);
  await page.getByLabel('Hauteur sous plafond (m)').fill(p.h);
  await page.getByRole('button', { name: 'Enregistrer la pièce' }).click();
  await expect(page.getByRole('heading', { level: 1, name: p.nom })).toBeVisible();
  for (const o of p.ouvertures) {
    const bloc = page.locator('details').filter({ hasText: '+ Ajouter une ouverture' });
    if (!(await bloc.evaluate((d) => (d as HTMLDetailsElement).open))) await bloc.locator('summary').click();
    await page.getByLabel('Type').selectOption(o.type);
    await page.getByLabel('Largeur (cm)').fill(o.l);
    await page.getByLabel('Hauteur (cm)').fill(o.h);
    await page.getByRole('button', { name: 'Ajouter l’ouverture' }).click();
    await expect(page.getByText(`${o.type === 'porte' ? 'Porte' : 'Fenêtre'} : ${o.l} × ${o.h} cm`).first()).toBeVisible();
  }
  return page.url().split('?')[0]!;
}

/** Devis brouillon depuis un chantier ; reste sur le devis. */
async function devis(page: Page, urlChantier: string, objet: string) {
  await page.goto(urlChantier);
  await page.getByRole('link', { name: '+ Devis' }).click();
  await page.getByLabel('Objet (facultatif)').fill(objet);
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
  return page.url().split('?')[0]!;
}

async function emettreDevis(page: Page, horsEtablissement: boolean, duree: string) {
  await page.getByLabel('Durée (jours)').fill(duree);
  await page.getByLabel(/Signé chez le client \(hors établissement\)/).setChecked(horsEtablissement);
  await page.getByLabel('Ou délai de début (texte)').fill('Sous 3 semaines après signature');
  await page.getByRole('button', { name: 'Enregistrer l’en-tête' }).click();
  await expect(page.getByText('En-tête enregistré.')).toBeVisible();
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await page.getByLabel(/J’émets ce devis avec ces textes/).check();
  await page.getByRole('button', { name: 'Émettre le devis' }).click();
  await expect(page.getByText(/Devis émis : numéro attribué/)).toBeVisible();
}

async function emettreFacture(page: Page, avoir = false) {
  await page.getByRole('link', { name: 'Émettre…' }).click();
  await page.getByLabel(/J’émets avec ces textes/).check();
  await page.getByRole('button', { name: avoir ? 'Émettre l’avoir' : 'Émettre la facture' }).click();
  await expect(page.getByText(avoir ? /Avoir émis : numéro attribué/ : /Facture émise : numéro attribué/)).toBeVisible();
  return page.url().split('?')[0]!;
}

async function paiement(page: Page, montant: string, mode: 'virement' | 'especes' | 'cheque') {
  await page.getByText('Enregistrer un paiement', { exact: true }).click();
  await page.getByLabel('Montant reçu (€)').fill(montant);
  await page.getByLabel('Mode').selectOption(mode);
  await page.getByRole('button', { name: 'Enregistrer le paiement' }).click();
  await expect(page.getByText(/Paiement enregistré/)).toBeVisible();
}

/** Lignes reprises du métré sans prix : prix au m² saisi, ligne par ligne. */
async function completerPrix(page: Page, prix: (designation: string) => string) {
  const aCompleter = page.getByRole('listitem').filter({ hasText: 'PRIX À COMPLÉTER' });
  for (let n = await aCompleter.count(); n > 0; n--) {
    const ligne = aCompleter.first();
    const texte = (await ligne.locator('p').first().textContent()) ?? '';
    await ligne.locator('summary', { hasText: 'Modifier' }).click();
    await ligne.getByLabel('Prix unitaire HT (€)').fill(prix(texte));
    await ligne.getByRole('button', { name: 'Enregistrer la ligne' }).click();
    await expect(aCompleter).toHaveCount(n - 1);
  }
}

/** Reste à payer affiché sur la facture (« 1234,56 »), pour un paiement exact. */
async function resteAPayer(page: Page): Promise<string> {
  const t = (await page.locator('dt', { hasText: /^Reste à payer$/ }).locator('xpath=following-sibling::dd[1]').textContent())!;
  return t.replace(/[^\d,]/g, '');
}

const urls: Record<string, string> = {};

test('clients fictifs', async ({ page }) => {
  urls.martin = await client(page, { civilite: 'Mme', nom: 'Martin (démo)', prenom: 'Camille', email: 'camille.martin@example.invalid',
    adresse: '12 rue des Exemples', cp: '57100', ville: 'Thionville' });
  urls.durand = await client(page, { civilite: 'M.', nom: 'Durand (démo)', prenom: 'Paul', email: 'paul.durand@example.invalid',
    adresse: '5 allée Imaginaire', cp: '57700', ville: 'Hayange' });
  urls.sci = await client(page, { pro: true, raison: 'SCI Exemple (démo)', civilite: 'Mme', nom: 'Gérante fictive', email: 'contact@sci-exemple.invalid',
    adresse: '8 place Fictive', cp: '57000', ville: 'Metz' });
});

test('chantier de 4 pièces : métré, duplication, peinture et liste d’achat', async ({ page }) => {
  urls.chMartin = await chantier(page, urls.martin!, 'Appartement Martin (démo)');
  // Pièce de référence du cahier des charges : 4 × 3 × 2,50, une porte, une fenêtre.
  const chambre = await piece(page, urls.chMartin, { nom: 'Chambre', l: '4', la: '3', h: '2,50', ouvertures: [{ type: 'porte', l: '83', h: '204' }, { type: 'fenetre', l: '120', h: '115' }] });
  await piece(page, urls.chMartin, { nom: 'Séjour', l: '5,20', la: '4', h: '2,50', ouvertures: [{ type: 'porte', l: '83', h: '204' }, { type: 'fenetre', l: '180', h: '135' }] });
  await piece(page, urls.chMartin, { nom: 'Couloir', l: '4,50', la: '1,10', h: '2,50', ouvertures: [{ type: 'porte', l: '83', h: '204' }] });
  // Duplication : la deuxième chambre, identique.
  await page.goto(chambre);
  await page.getByText('Dupliquer la pièce…').click();
  await page.getByLabel('Nom de la copie').fill('Chambre 2');
  await page.getByRole('button', { name: 'Dupliquer la pièce' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Chambre 2' })).toBeVisible();
  // Peinture de TOUT le chantier (murs puis plafonds des 4 pièces, ancienne peinture : lessivage et
  // ponçage) : la liste d'achat et les postes repris dans le devis couvrent ainsi tout le devis.
  // Type de produit « acrylique » du référentiel (rendements indicatifs, À VÉRIFIER).
  for (const cible of ['Murs', 'Plafond'] as const) {
    await page.goto(`${urls.chMartin}/peinture/nouveau`);
    await page.getByLabel('Pièce', { exact: true }).selectOption({ label: 'Chambre' });
    await page.locator('label', { hasText: new RegExp(`^${cible}$`) }).click();
    await page.locator('summary', { hasText: /^Préparation/ }).click();
    await page.getByLabel(/^Lessivage/).check();
    await page.getByLabel(/^Ponçage/).check();
    for (const autre of ['Séjour', 'Couloir', 'Chambre 2']) await page.getByLabel(autre, { exact: true }).check();
    await page.getByRole('button', { name: 'Enregistrer et calculer' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Calcul peinture' })).toBeVisible();
  }
  await page.goto(`${urls.chMartin}/liste-achat`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('devis signé sur place, acompte payé par virement, finale payée en espèces', async ({ page }) => {
  urls.devisMartin = await devis(page, urls.chMartin!, 'Peinture des chambres, du séjour et du couloir');
  // Les 8 postes du métré sont repris à la création : prix de vente à compléter (temps de pose et prix d'achat non saisis).
  await completerPrix(page, (texte) => (/plafond/i.test(texte) ? '20' : '18'));
  await ajouterLigne(page, { designation: 'Protection et nettoyage du chantier', quantite: '1', prix: '150', unite: 'forfait' });
  await emettreDevis(page, false, '6');
  await page.getByRole('link', { name: 'Faire signer sur place' }).click();
  await page.getByLabel('Nom et prénom du signataire').fill('Camille Martin');
  await page.getByLabel('Écrivez « Bon pour accord »').fill('Bon pour accord');
  await signerDansLeCadre(page);
  await page.getByLabel('J’ai lu le devis et je l’accepte').check();
  await page.getByRole('button', { name: 'Signer le devis' }).click();
  await expect(page.getByText('Devis signé.')).toBeVisible();

  // Acompte de 30 %, payé par virement.
  await page.getByRole('link', { name: /Facturer/ }).click();
  await page.getByLabel('Acompte (% du devis signé)').fill('30');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
  await emettreFacture(page);
  await paiement(page, await resteAPayer(page), 'virement');

  // Finale : l'acompte est déduit, solde payé en espèces.
  await page.goto(urls.devisMartin);
  await page.getByRole('link', { name: /Facturer/ }).click();
  await page.getByLabel('Type de facture').selectOption('finale');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
  urls.finaleMartin = await emettreFacture(page);
  await paiement(page, await resteAPayer(page), 'especes');
});

test('PV de réception avec une réserve, signé à deux sur le téléphone', async ({ page }) => {
  await page.goto(urls.chMartin!);
  await page.getByRole('link', { name: 'PV de réception' }).click();
  await page.getByLabel('Travaux réceptionnés').fill('Peinture des chambres, du séjour et du couloir');
  await page.getByLabel(/Réserves/).fill('Reprendre l’angle du plafond de la chambre 2');
  await page.getByLabel(/Délai pour lever les réserves/).fill('15');
  await page.getByRole('button', { name: 'Créer le PV' }).click();
  await expect(page.getByText(/Brouillon · 1 réserve à lever sur 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Présenter au client pour signature' }).click();
  await page.getByLabel('Nom et prénom du client').fill('Camille Martin');
  await page.getByLabel(/Écrivez « Lu et approuvé »/).fill('Lu et approuvé');
  await page.getByLabel(/J’ai relu le procès-verbal/).check();
  await signerDansLeCadre(page, 'Signature du client');
  await page.getByRole('button', { name: 'Valider la signature du client' }).click();
  await signerDansLeCadre(page, 'Signature de l’entreprise');
  await page.getByRole('button', { name: 'Signer le procès-verbal' }).click();
  await expect(page.getByText('Procès-verbal signé.')).toBeVisible();
});

test('autres devis : émis hors établissement en attente, brouillon repris du métré', async ({ page }) => {
  // Maison Durand : devis émis chez le client (formulaire de rétractation joint), pas encore signé.
  urls.chDurand = await chantier(page, urls.durand!, 'Maison Durand (démo)');
  await devis(page, urls.chDurand, 'Façade du garage et portail');
  await ajouterLigne(page, { designation: 'Façade du garage : lavage, fixateur, 2 couches', quantite: '28', prix: '24', unite: 'm2' });
  await ajouterLigne(page, { designation: 'Portail métallique : brossage et ponçage, primaire antirouille, 2 couches de laque extérieure', quantite: '1', prix: '380', unite: 'forfait' });
  await ajouterLigne(page, { designation: 'Peinture de la porte de garage', quantite: '1', prix: '180', unite: 'forfait', option: true });
  await emettreDevis(page, true, '3');

  // SCI : chantier mesuré, devis brouillon avec les postes repris du métré (prix à compléter).
  urls.chSci = await chantier(page, urls.sci!, 'Bureaux SCI Exemple (démo)');
  await piece(page, urls.chSci, { nom: 'Bureau 1', l: '4,20', la: '3,50', h: '2,70', ouvertures: [{ type: 'porte', l: '83', h: '204' }, { type: 'fenetre', l: '140', h: '120' }] });
  await page.getByRole('link', { name: /Peinture de cette pièce/ }).click();
  await page.getByRole('button', { name: 'Enregistrer et calculer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Calcul peinture' })).toBeVisible();
  await devis(page, urls.chSci, 'Rafraîchissement des bureaux');
  await page.getByRole('button', { name: 'Reprendre les postes de peinture du chantier' }).click();
  await expect(page.locator('li').filter({ hasText: /Bureau 1/ }).first()).toBeVisible();
});

test('facture libre à encaisser et avoir partiel', async ({ page }) => {
  await page.goto('/factures/nouvelle');
  await page.getByLabel('Type de facture').selectOption('libre');
  await page.getByLabel('Client').selectOption({ label: 'SCI Exemple (démo)' });
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
  await ajouterLigne(page, { designation: 'Retouches cage d’escalier', quantite: '1', prix: '640', unite: 'forfait' });
  await emettreFacture(page);
  await page.getByRole('link', { name: 'Corriger ou annuler : établir un avoir' }).click();
  await page.getByLabel('Montant', { exact: true }).selectOption('montant');
  await page.getByLabel('Montant de l’avoir, TTC (€)').fill('40');
  await page.getByLabel('Motif (imprimé sur l’avoir)').fill('Geste commercial (démo)');
  await page.getByRole('button', { name: 'Créer l’avoir (brouillon)' }).click();
  await expect(page.getByText('Brouillon créé.')).toBeVisible();
  await emettreFacture(page, true);
});

test('pilotage : planning, temps passé, achats, matériel', async ({ page }) => {
  await page.goto(urls.chDurand!);
  await page.getByLabel('Durée (jours ouvrés)').fill('3');
  const lundi = new Date();
  lundi.setDate(lundi.getDate() + ((8 - lundi.getDay()) % 7 || 7));
  await page.getByLabel('Début', { exact: true }).fill(lundi.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }));
  await page.getByRole('button', { name: 'Planifier', exact: true }).click();
  await expect(page.getByText(/Chantier planifié du/)).toBeVisible();

  await page.goto(urls.chMartin!);
  await page.getByLabel('Durée', { exact: true }).fill('7h30');
  await page.getByLabel('Tâche (facultatif)').fill('Préparation des murs');
  await page.getByRole('button', { name: 'Noter le temps' }).click();
  await expect(page.getByText(/7 h 30 notées le/)).toBeVisible();
  await page.getByRole('link', { name: '+ Noter un achat pour ce chantier' }).click();
  await page.getByLabel('Montant TTC').fill('186,40');
  await page.getByLabel('Fournisseur').fill('Négoce fictif (démo)');
  await page.getByRole('button', { name: 'Enregistrer l’achat' }).click();
  await expect(page.getByText('Achat enregistré pour ce chantier.')).toBeVisible();

  await page.goto('/comptabilite/materiel');
  const ajout = page.locator('section', { has: page.getByRole('heading', { name: 'Ajouter' }) });
  await ajout.getByLabel('Désignation').fill('Ponceuse girafe (démo)');
  await ajout.getByLabel('Valeur (facultatif)').fill('489');
  await ajout.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('« Ponceuse girafe (démo) » ajouté au matériel.')).toBeVisible();
});
