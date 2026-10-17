import type { ReactNode } from 'react';
import { MarketingNav } from '@/components/marketing/MarketingNav';
import { Footer } from '@/components/marketing/Footer';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-eve-ink focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <MarketingNav />
      <main id="main">{children}</main>
      <Footer />
    </>
  );
}
