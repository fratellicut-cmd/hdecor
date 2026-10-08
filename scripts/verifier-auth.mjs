// Vérifie les réglages d'authentification PUBLICS d'un projet Supabase
// (local ou production) : inscription fermée, pas de confirmation automatique,
// aucun fournisseur tiers ni connexion anonyme. Échoue (code 1) sinon.
//   node --env-file=.env.local scripts/verifier-auth.mjs
// Les réglages non exposés publiquement (12 caractères, TOTP, reconnexion
// pour changer de mot de passe, durée des liens) se vérifient dans le
// tableau de bord : voir LISEZ-MOI.md, « Mise en production ».
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requises.');
  process.exit(1);
}
const reponse = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon } });
if (!reponse.ok) {
  console.error(`Lecture des réglages impossible (HTTP ${reponse.status}).`);
  process.exit(1);
}
const r = await reponse.json();
const autres = Object.entries(r.external ?? {}).filter(([nom, actif]) => actif && nom !== 'email').map(([nom]) => nom);
const controles = [
  ['inscription publique fermée (disable_signup)', r.disable_signup === true],
  ['pas de confirmation automatique des emails (mailer_autoconfirm)', r.mailer_autoconfirm === false],
  ['connexion par email active', r.external?.email === true],
  [`aucun autre fournisseur ni connexion anonyme${autres.length ? ` (actifs : ${autres.join(', ')})` : ''}`, autres.length === 0],
];
for (const [libelle, ok] of controles) console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${libelle}`);
process.exit(controles.every(([, ok]) => ok) ? 0 : 1);
