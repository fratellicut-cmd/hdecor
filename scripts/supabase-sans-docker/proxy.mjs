// Mini passerelle locale : reproduit les chemins de l'API Supabase
// (/auth/v1, /rest/v1) devant GoTrue et PostgREST, et émule le STOCKAGE de
// fichiers (/storage/v1/object) sur le disque. Développement seulement.
//
// Émulation du stockage : seule la clé « service » est acceptée. L'application
// n'accède aux fichiers que depuis le serveur (src/lib/stockage.ts), après ses
// propres contrôles. Opérations : dépôt (POST/PUT), lecture (GET/HEAD),
// suppression (DELETE avec { prefixes }). En production, c'est Supabase Storage.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const routes = [
  ['/auth/v1', Number(process.env.PORT_AUTH)],
  ['/rest/v1', Number(process.env.PORT_REST)],
];
const DOSSIER = process.env.DOSSIER_STOCKAGE;
const CLE_SERVICE = process.env.CLE_SERVICE;

const json = (res, code, corps) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(corps));
const lireCorps = (req) => new Promise((ok, ko) => {
  const morceaux = [];
  req.on('data', (m) => morceaux.push(m));
  req.on('end', () => ok(Buffer.concat(morceaux)));
  req.on('error', ko);
});

/** « bucket/a/b.pdf » -> chemin disque, sans remontée possible hors du dossier. */
function cheminDisque(cle) {
  const segments = decodeURIComponent(cle).split('/').filter(Boolean);
  if (!segments.length || segments.some((s) => s === '.' || s === '..')) return null;
  const p = path.join(DOSSIER, ...segments);
  return p.startsWith(path.resolve(DOSSIER) + path.sep) ? p : null;
}

async function stockage(req, res, suite) {
  if (!DOSSIER || !CLE_SERVICE) return json(res, 503, { statusCode: '503', error: 'indisponible', message: 'stockage local non configuré' });
  if (req.headers.authorization !== `Bearer ${CLE_SERVICE}`) {
    return json(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'émulation locale : clé service uniquement' });
  }
  const cle = suite.split('?')[0];
  if (req.method === 'DELETE') {
    const { prefixes = [] } = JSON.parse((await lireCorps(req)).toString() || '{}');
    const supprimes = [];
    for (const p of prefixes) {
      const f = cheminDisque(`${cle}/${p}`);
      if (!f) continue;
      try { await stat(f); await rm(f); await rm(`${f}.meta`, { force: true }); supprimes.push({ name: p }); } catch { /* absent */ }
    }
    return json(res, 200, supprimes);
  }
  const fichier = cheminDisque(cle);
  if (!fichier) return json(res, 400, { statusCode: '400', error: 'InvalidKey', message: 'chemin invalide' });
  if (req.method === 'POST' || req.method === 'PUT') {
    const ecraser = req.method === 'PUT' || req.headers['x-upsert'] === 'true';
    const existe = await stat(fichier).then(() => true, () => false);
    if (existe && !ecraser) return json(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    await mkdir(path.dirname(fichier), { recursive: true });
    await writeFile(fichier, await lireCorps(req));
    await writeFile(`${fichier}.meta`, JSON.stringify({ type: req.headers['content-type'] ?? 'application/octet-stream' }));
    return json(res, 200, { Key: decodeURIComponent(cle), Id: randomUUID() });
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    try {
      const octets = await readFile(fichier);
      const meta = JSON.parse(await readFile(`${fichier}.meta`, 'utf8').catch(() => '{}'));
      res.writeHead(200, { 'content-type': meta.type ?? 'application/octet-stream', 'content-length': octets.length });
      return res.end(req.method === 'HEAD' ? undefined : octets);
    } catch {
      return json(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    }
  }
  return json(res, 405, { statusCode: '405', error: 'method', message: 'méthode non émulée' });
}

http.createServer((req, res) => {
  if (req.url.startsWith('/storage/v1/object/')) {
    stockage(req, res, req.url.slice('/storage/v1/object/'.length)).catch(() => json(res, 500, { statusCode: '500', error: 'interne', message: 'erreur du stockage local' }));
    return;
  }
  const route = routes.find(([p]) => req.url === p || req.url.startsWith(p + '/') || req.url.startsWith(p + '?'));
  if (!route) { res.writeHead(404).end('{"message":"route inconnue"}'); return; }
  const [prefixe, port] = route;
  const amont = http.request(
    { host: '127.0.0.1', port, path: req.url.slice(prefixe.length) || '/', method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } },
    (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); },
  );
  amont.on('error', () => res.writeHead(502).end('{"message":"service indisponible"}'));
  req.pipe(amont);
}).listen(Number(process.env.PORT_API), '127.0.0.1');
