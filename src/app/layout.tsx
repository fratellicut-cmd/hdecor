import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import './globals.css';

export const metadata: Metadata = {
  title: { default: "H'DECOR", template: "%s · H'DECOR" },
  description: 'Métré, devis et factures de H’DECOR, peinture & décoration.',
  applicationName: "H'DECOR",
  robots: { index: false, follow: false },
  icons: { icon: '/icones/icone-192.png', apple: '/icones/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: "H'DECOR", statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#1f1f1f',
  width: 'device-width',
  initialScale: 1,
};

/**
 * CSP par nonce (proxy.ts) : le nonce est ajouté au rendu de CHAQUE requête.
 * Une page prérendue au build n'aurait aucun nonce et ses scripts seraient
 * bloqués en production. connection() impose le rendu dynamique partout.
 */
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  await connection();
  return (
    <html lang="fr">
      <body className="min-h-dvh overflow-x-hidden antialiased">{children}</body>
    </html>
  );
}
