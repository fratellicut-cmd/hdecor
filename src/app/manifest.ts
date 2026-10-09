import type { MetadataRoute } from 'next';

/**
 * Manifeste PWA : application installable sur l'écran d'accueil. Pas de
 * service worker ni de mode hors-ligne (décision du directeur) ; la garde de
 * saisie protège les formulaires pendant une coupure réseau.
 * Icônes PROVISOIRES (scripts/generer-icones.sh) : logo officiel à fournir.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: "H'DECOR",
    short_name: "H'DECOR",
    description: 'Métré, devis et factures de H’DECOR, peinture & décoration.',
    lang: 'fr',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#faf8f4',
    theme_color: '#1f1f1f',
    icons: [
      { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icones/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
