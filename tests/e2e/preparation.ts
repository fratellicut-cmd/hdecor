import { adminTests, COMPTE } from './outils';
import { loadEnvFile } from 'node:process';

/** Crée (une fois) le compte et l'organisation des parcours de test. */
export default async function preparation() {
  try { loadEnvFile('.env.local'); } catch { /* variables déjà présentes (CI) */ }
  const admin = adminTests();
  const { data: liste } = await admin.auth.admin.listUsers();
  const existant = liste?.users.find((u) => u.email === COMPTE.email);
  if (existant) return;
  const { data, error } = await admin.auth.admin.createUser({ email: COMPTE.email, password: COMPTE.motDePasse, email_confirm: true });
  if (error || !data.user) throw new Error(`Préparation e2e : ${error?.message}`);
  const { error: e2 } = await admin.rpc('initialiser_organisation', {
    p_user_id: data.user.id, p_raison_sociale: 'Entreprise de test E2E', p_nom_dirigeant: 'Testeur', p_email: COMPTE.email,
  });
  if (e2) throw new Error(`Préparation e2e : ${e2.message}`);
}
