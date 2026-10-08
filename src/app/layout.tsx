import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: "H'DECOR", template: "%s · H'DECOR" },
  description: 'Métré, devis et factures de H’DECOR, peinture & décoration.',
  applicationName: "H'DECOR",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#1f1f1f',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="fr">
      <body className="min-h-dvh overflow-x-hidden antialiased">{children}</body>
    </html>
  );
}
