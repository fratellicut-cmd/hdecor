import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

export const COMPTE = { email: 'e2e-yorick@hdecor.test', motDePasse: 'mot-de-passe-e2e-tres-long' };

/** Client « service » des tests (préparation des données uniquement). */
export function adminTests() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function seConnecter(page: Page, compte = COMPTE) {
  await page.goto('/connexion');
  await page.getByLabel('Adresse email').fill(compte.email);
  await page.getByLabel('Mot de passe').fill(compte.motDePasse);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
}

/** Échoue si la page a produit une erreur console (dont violations de CSP). */
export function surveillerConsole(page: Page) {
  const erreurs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  page.on('pageerror', (e) => erreurs.push(e.message));
  return erreurs;
}
