import type { ReactNode } from 'react';
import { EveWordmark } from '@/components/brand/EveWordmark';
import { Container } from '@/components/ui/primitives';
import { product } from '@/config/product';

// Buyer-facing chrome is intentionally minimal: a small wordmark and a
// support line. Organiser branding will sit above this once public event
// pages are connected (Phase 2).
export default function BuyerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="border-b border-eve-line bg-eve-surface">
        <Container className="flex min-h-14 items-center justify-between">
          <EveWordmark size="sm" />
          <span className="text-xs text-eve-muted">Tickets by {product.name}</span>
        </Container>
      </header>
      <main id="main">{children}</main>
      <footer className="mt-16 border-t border-eve-line py-6 text-center text-xs text-eve-muted">
        Need help with a booking? {product.supportEmail}
      </footer>
    </>
  );
}
