import { defineConfig, devices } from '@playwright/test';

/**
 * Chargement du jeu de DÉMONSTRATION (données fictives) par l'application,
 * dans la base locale hdecor_demo uniquement (tests/demo/garde.ts).
 * Serveur : DEMO_URL (par défaut http://localhost:3000).
 */
export default defineConfig({
  testDir: 'tests/demo',
  testMatch: /charger\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.DEMO_URL ?? 'http://localhost:3000',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    actionTimeout: 20_000,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: 'telephone', use: { ...devices['Pixel 7'] } }],
});
