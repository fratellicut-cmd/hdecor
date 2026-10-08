// Génère les clés « anon » et « service_role » (JWT HS256) de la pile locale.
// Le secret de développement n'est PAS un secret de production.
import { createHmac } from 'node:crypto';
const secret = process.argv[2];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const signe = (role) => {
  const corps = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase-local', role, iat: 1760000000, exp: 2075000000 })}`;
  return `${corps}.${createHmac('sha256', secret).update(corps).digest('base64url')}`;
};
console.log(`ANON=${signe('anon')}`);
console.log(`SERVICE=${signe('service_role')}`);
