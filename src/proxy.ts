import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/**
 * Proxy (ex-« middleware » dans Next 16) : exécuté avant chaque page.
 *  1. Politique de sécurité du contenu (CSP) avec nonce unique par requête,
 *     et en-têtes de sécurité.
 *  2. Rafraîchissement de la session Supabase (cookies HttpOnly).
 *  3. Redirection OPTIMISTE vers /connexion si aucune session : ce n'est pas
 *     une autorisation. L'autorisation réelle est faite par la couche d'accès
 *     aux données (src/lib/dal.ts) et par la RLS de la base.
 */

const PAGES_PUBLIQUES = [
  '/connexion',
  '/mot-de-passe-oublie',
  '/auth/confirmer',
  '/confidentialite',
  '/manifest.webmanifest',
  // Devis partagé au client : l'accès est donné par le JETON du lien, vérifié par la base.
  '/d',
  // Facture partagée au client : même principe (jeton vérifié par la base).
  '/f',
];

function estPublique(chemin: string) {
  return PAGES_PUBLIQUES.some((p) => chemin === p || chemin.startsWith(p + '/'))
    || chemin.startsWith('/icones/')
    // Tâche planifiée : protégée par son propre secret (CRON_SECRET). Chemin
    // exact : une future route sous /api/cron/ ne sera pas publique par défaut.
    || chemin === '/api/cron/conservation' || chemin === '/api/cron/relances'
    // Webhook Stripe : protégé par la signature de Stripe (STRIPE_WEBHOOK_SECRET).
    || chemin === '/api/stripe/webhook';
}

function politiqueContenu(nonce: string) {
  const dev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    // Paiement en ligne facultatif : la redirection vers la page de paiement Stripe suit l'envoi du formulaire.
    `form-action 'self'${process.env.STRIPE_SECRET_KEY ? ' https://checkout.stripe.com' : ''}`,
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = politiqueContenu(nonce);

  // Session Supabase : les cookies rafraîchis sont posés sur la requête
  // (pour le rendu) et sur la réponse (pour le navigateur).
  const aPoser: { name: string; value: string; options: CookieOptions }[] = [];
  const entetesCache: Record<string, string> = {};
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies, entetes) => {
          for (const c of cookies) {
            request.cookies.set(c.name, c.value);
            aPoser.push(c);
          }
          Object.assign(entetesCache, entetes ?? {});
        },
      },
    },
  );
  const { data } = await supabase.auth.getClaims();
  const connecte = Boolean(data?.claims?.sub);

  const chemin = request.nextUrl.pathname;
  let reponse: NextResponse;
  // Envoi d'un formulaire (Server Action) sans session : on ne le redirige PAS
  // ici (le navigateur verrait un échec réseau). L'action passe par la DAL
  // (verifierSession), qui refuse et renvoie proprement vers la connexion.
  const actionServeur = request.method === 'POST' && request.headers.has('next-action');
  if (!connecte && !estPublique(chemin) && !actionServeur) {
    const url = request.nextUrl.clone();
    url.pathname = '/connexion';
    url.search = chemin === '/' ? '' : `?suite=${encodeURIComponent(chemin + request.nextUrl.search)}`;
    reponse = NextResponse.redirect(url);
  } else {
    const entetesRequete = new Headers(request.headers);
    entetesRequete.set('x-nonce', nonce);
    entetesRequete.set('Content-Security-Policy', csp);
    reponse = NextResponse.next({ request: { headers: entetesRequete } });
  }

  for (const { name, value, options } of aPoser) reponse.cookies.set(name, value, options);
  for (const [cle, valeur] of Object.entries(entetesCache)) reponse.headers.set(cle, valeur);
  reponse.headers.set('Content-Security-Policy', csp);
  reponse.headers.set('X-Frame-Options', 'DENY');
  reponse.headers.set('X-Content-Type-Options', 'nosniff');
  // Lien public : le jeton est dans l'adresse, il ne doit partir vers aucun site.
  reponse.headers.set('Referrer-Policy', chemin.startsWith('/d/') ? 'no-referrer' : 'strict-origin-when-cross-origin');
  reponse.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  if (process.env.NODE_ENV === 'production') {
    reponse.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  return reponse;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon|apple-icon).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
