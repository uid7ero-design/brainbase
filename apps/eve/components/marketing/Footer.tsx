import Link from 'next/link';
import { EveWordmark } from '@/components/brand/EveWordmark';
import { Tagline } from '@/components/brand/Tagline';
import { Container } from '@/components/ui/primitives';
import { product } from '@/config/product';

export function Footer() {
  return (
    <footer className="mt-24 border-t border-eve-line bg-eve-surface">
      <Container className="grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <EveWordmark size="sm" />
          <Tagline className="mt-2 text-sm text-eve-muted" />
        </div>
        <nav aria-label="Product">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-eve-muted">Product</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/features" className="hover:text-eve-accent">Features</Link></li>
            <li><Link href="/pricing" className="hover:text-eve-accent">Pricing</Link></li>
            <li><Link href="/organisers" className="hover:text-eve-accent">For organisers</Link></li>
            <li><Link href="/venues" className="hover:text-eve-accent">Venues &amp; events</Link></li>
          </ul>
        </nav>
        <nav aria-label="Account">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-eve-muted">Account</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/signin" className="hover:text-eve-accent">Sign in</Link></li>
            <li><Link href="/get-started" className="hover:text-eve-accent">Create an event</Link></li>
            <li><Link href="/organiser" className="hover:text-eve-accent">Organiser console</Link></li>
          </ul>
        </nav>
      </Container>
      <Container className="flex flex-col gap-2 border-t border-eve-line py-6 text-xs text-eve-muted sm:flex-row sm:items-center sm:justify-between">
        <p>&copy; {new Date().getFullYear()} {product.name}. Early access.</p>
        <p>Support: {product.supportEmail}</p>
      </Container>
    </footer>
  );
}
