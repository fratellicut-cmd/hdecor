// Mini passerelle locale : reproduit les chemins de l'API Supabase
// (/auth/v1, /rest/v1) devant GoTrue et PostgREST. Développement seulement.
import http from 'node:http';
const routes = [
  ['/auth/v1', Number(process.env.PORT_AUTH)],
  ['/rest/v1', Number(process.env.PORT_REST)],
];
http.createServer((req, res) => {
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
