import Link from 'next/link';
import { EveWordmark } from '@/components/brand/EveWordmark';
import { ButtonLink, Container } from '@/components/ui/primitives';

export const MARKETING_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/organisers', label: 'For organisers' },
  { href: '/venues', label: 'Venues & events' },
] as const;

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-eve-line/80 bg-eve-canvas/85 backdrop-blur">
      <Container className="flex min-h-16 items-center justify-between gap-4">
        <EveWordmark />
        <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
          {MARKETING_LINKS.map(l => (
            <Link key={l.href} href={l.href} className="text-sm font-medium text-eve-ink-soft hover:text-eve-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/signin" className="hidden min-h-11 items-center px-3 text-sm font-medium text-eve-ink-soft hover:text-eve-ink sm:inline-flex">
            Sign in
          </Link>
          <ButtonLink href="/get-started">Create an event</ButtonLink>
        </div>
      </Container>
      <nav aria-label="Primary, compact" className="md:hidden">
        <Container className="flex gap-4 overflow-x-auto pb-3 text-sm">
          {MARKETING_LINKS.map(l => (
            <Link key={l.href} href={l.href} className="whitespace-nowrap font-medium text-eve-ink-soft">
              {l.label}
            </Link>
          ))}
          <Link href="/signin" className="whitespace-nowrap font-medium text-eve-ink-soft sm:hidden">
            Sign in
          </Link>
        </Container>
      </nav>
    </header>
  );
}
