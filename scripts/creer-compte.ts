/**
 * Création du compte de l'artisan et de son entreprise (organisation).
 * L'inscription publique est FERMÉE : c'est la seule façon de créer un compte.
 *
 *   npx tsx --env-file=.env.local scripts/creer-compte.ts \
 *     --email yorick@exemple.fr --raison-sociale "H'DECOR" --dirigeant "Yorick Heussler"
 *
 * Le mot de passe est demandé au clavier (ou lu dans MOT_DE_PASSE_INITIAL),
 * jamais passé en argument (il resterait dans l'historique du terminal).
 * Variables requises : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    'raison-sociale': { type: 'string' },
    dirigeant: { type: 'string' },
  },
});

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cle) throw new Error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requises.');
  if (!values.email || !values['raison-sociale']) throw new Error('--email et --raison-sociale sont requis.');

  let motDePasse = process.env.MOT_DE_PASSE_INITIAL ?? '';
  if (!motDePasse) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    motDePasse = await rl.question('Mot de passe (12 caractères minimum) : ');
    rl.close();
  }
  if (motDePasse.length < 12) throw new Error('Mot de passe trop court (12 caractères minimum).');

  const admin = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: eU } = await admin.auth.admin.createUser({
    email: values.email, password: motDePasse, email_confirm: true,
  });
  if (eU || !u.user) throw new Error(`Création du compte impossible : ${eU?.message}`);

  // Organisation, membre, paramètres et taux : en UNE transaction côté base.
  const { data: orgId, error: eO } = await admin.rpc('initialiser_organisation', {
    p_user_id: u.user.id,
    p_raison_sociale: values['raison-sociale'],
    p_nom_dirigeant: values.dirigeant ?? '',
    p_email: values.email,
  });
  if (eO) {
    await admin.auth.admin.deleteUser(u.user.id);
    throw new Error(`Initialisation impossible (compte supprimé) : ${eO.message}`);
  }
  console.log(`Compte créé : ${values.email} (organisation ${orgId}).`);
}
main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
