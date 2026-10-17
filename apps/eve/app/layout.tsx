import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { product } from '@/config/product';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: `${product.name} — ${product.tagline}`, template: `%s · ${product.name}` },
  description: 'Ticketing built for every kind of event. Create, sell, scan and manage — without the complexity.',
  metadataBase: new URL(product.publicBaseUrl),
};

export const viewport: Viewport = {
  themeColor: '#faf9f6',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
