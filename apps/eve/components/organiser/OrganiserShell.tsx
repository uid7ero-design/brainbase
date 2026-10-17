import Link from 'next/link';
import type { ReactNode } from 'react';
import { CalendarDays, LayoutDashboard, ReceiptText, Users, ScanLine, CreditCard, Settings } from 'lucide-react';
import { EveWordmark } from '@/components/brand/EveWordmark';

export const ORGANISER_NAV = [
  { href: '/organiser', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/organiser/events', label: 'Events', icon: CalendarDays },
  { href: '/organiser/orders', label: 'Orders', icon: ReceiptText },
  { href: '/organiser/attendees', label: 'Attendees', icon: Users },
  { href: '/organiser/check-in', label: 'Check-in', icon: ScanLine },
  { href: '/organiser/payments', label: 'Payments', icon: CreditCard },
  { href: '/organiser/settings', label: 'Settings', icon: Settings },
] as const;

// The organiser console chrome. Its own sidebar and header — nothing is
// borrowed from any other product's navigation. There is no signed-in
// identity yet (see /signin), so the header says so instead of showing a
// placeholder user.
export function OrganiserShell({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="min-h-screen bg-eve-canvas md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-eve-line bg-eve-surface md:border-b-0 md:border-r">
        <div className="flex min-h-16 items-center px-5">
          <EveWordmark href="/" size="sm" />
          <span className="ml-2 rounded-full bg-eve-surface-alt px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-eve-muted">Organiser</span>
        </div>
        <nav aria-label="Organiser" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-6">
          {ORGANISER_NAV.map(item => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-11 items-center gap-3 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-eve-ink-soft hover:bg-eve-surface-alt hover:text-eve-ink"
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-16 items-center justify-between border-b border-eve-line bg-eve-surface px-4 sm:px-8">
          <h1 className="text-lg font-semibold">{title}</h1>
          <Link href="/signin" className="text-sm font-medium text-eve-accent">Not signed in</Link>
        </header>
        <main className="px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
