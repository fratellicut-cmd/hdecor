import { defineConfig, devices } from '@playwright/test';

/**
 * Parcours de bout en bout sur téléphone (viewport Pixel 7, Chromium),
 * contre la pile locale (scripts/supabase-sans-docker ou `supabase start`)
 * et le serveur Next (`npm run dev` ou `npm run build && npm start`).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './tests/e2e/preparation.ts',
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:3000',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    // Environnement sans téléchargement de navigateur : Chromium préinstallé.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: 'telephone', use: { ...devices['Pixel 7'] } }],
});
