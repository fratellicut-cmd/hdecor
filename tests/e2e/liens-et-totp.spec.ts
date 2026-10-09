import { expect, test } from '@playwright/test';
import { adminTests, COMPTE, seConnecter } from './outils';
import { codeTotp } from './totp';
import { createClient } from '@supabase/supabase-js';

test('lien de connexion reçu par email : connecte, puis inutilisable une 2e fois', async ({ page }) => {
  const { data, error } = await adminTests().auth.admin.generateLink({ type: 'magiclink', email: COMPTE.email });
  expect(error).toBeNull();
  const lien = `/auth/confirmer?token_hash=${data.properties!.hashed_token}&type=magiclink&suite=%2Fcompte`;
  await page.goto(lien);
  await expect(page).toHaveURL(/\/compte$/);
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.goto(lien);
  await expect(page).toHaveURL(/\/connexion\?erreur=lien/);
  await expect(page.getByText('Ce lien n’est plus valable')).toBeVisible();
});

test('lien falsifié refusé', async ({ page }) => {
  await page.goto('/auth/confirmer?token_hash=faux&type=magiclink');
  await expect(page).toHaveURL(/\/connexion\?erreur=lien/);
});

test('mot de passe oublié : le lien mène au choix d’un nouveau mot de passe', async ({ page }) => {
  const admin = adminTests();
  const email = `oubli-${Date.now()}@hdecor.test`;
  const { data: u } = await admin.auth.admin.createUser({ email, password: 'ancien-mot-de-passe-long', email_confirm: true });
  await admin.rpc('initialiser_organisation', { p_user_id: u.user!.id, p_raison_sociale: 'Oubli', p_nom_dirigeant: '', p_email: email });
  const { data } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  await page.goto(`/auth/confirmer?token_hash=${data.properties!.hashed_token}&type=recovery`);
  await expect(page).toHaveURL(/\/compte\/nouveau-mot-de-passe$/);
  await page.getByLabel('Nouveau mot de passe').fill('court');
  await page.getByLabel('Confirmez le mot de passe').fill('court');
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(page.getByText('Au moins 12 caractères.')).toBeVisible();
  await page.getByLabel('Nouveau mot de passe').fill('nouveau-mot-de-passe-long');
  await page.getByLabel('Confirmez le mot de passe').fill('nouveau-mot-de-passe-long');
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(page.getByRole('heading', { name: 'Bonjour' })).toBeVisible();
  // Le nouveau mot de passe fonctionne.
  // Le compte s'ouvre depuis l'onglet Réglages.
  await page.getByRole('link', { name: /Réglages/ }).click();
  await page.getByRole('link', { name: /Mon compte/ }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await seConnecter(page, { email, motDePasse: 'nouveau-mot-de-passe-long' });
});

test('double authentification : activation, code exigé à la connexion, désactivation', async ({ page }) => {
  const admin = adminTests();
  const compte = { email: `totp-${Date.now()}@hdecor.test`, motDePasse: 'mot-de-passe-totp-long' };
  const { data: u } = await admin.auth.admin.createUser({ email: compte.email, password: compte.motDePasse, email_confirm: true });
  const { data: orgId } = await admin.rpc('initialiser_organisation', { p_user_id: u.user!.id, p_raison_sociale: 'TOTP', p_nom_dirigeant: '', p_email: compte.email });

  await seConnecter(page, compte);
  await page.goto('/compte');
  await page.getByRole('button', { name: 'Activer la double authentification' }).click();
  await expect(page.getByAltText(/QR code/)).toBeVisible();
  const secret = (await page.locator('code').textContent())!.trim();
  await page.getByLabel('Code à 6 chiffres').fill('000000');
  await page.getByRole('button', { name: 'Confirmer' }).click();
  await expect(page.getByText('Code incorrect')).toBeVisible();
  await page.getByLabel('Code à 6 chiffres').fill(codeTotp(secret));
  await page.getByRole('button', { name: 'Confirmer' }).click();
  await expect(page.getByText('Double authentification activée')).toBeVisible();

  // Nouvelle connexion : le code est exigé avant tout accès aux données.
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.getByLabel('Adresse email').fill(compte.email);
  await page.getByLabel('Mot de passe').fill(compte.motDePasse);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/connexion\/double-authentification/);
  await page.goto('/compte');
  await expect(page).toHaveURL(/\/connexion\/double-authentification/);

  // Même en appelant l'API directement avec la session « mot de passe seul »
  // (aal1), la base ne renvoie aucune donnée : la règle est dans la RLS.
  const direct = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  await direct.auth.signInWithPassword({ email: compte.email, password: compte.motDePasse });
  await admin.from('clients').insert({ organisation_id: orgId as string, nom: 'Client secret' });
  const { data: vus } = await direct.from('clients').select('nom');
  expect(vus).toEqual([]);
  const { data: param } = await direct.from('parametres_entreprise').select('raison_sociale');
  expect(param).toEqual([]);
  await page.getByLabel('Code à 6 chiffres').fill(codeTotp(secret));
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByRole('heading', { name: 'Bonjour' })).toBeVisible();

  await page.goto('/compte');
  await page.getByRole('button', { name: 'Désactiver' }).click();
  await expect(page.getByText('Double authentification désactivée.')).toBeVisible();
});
