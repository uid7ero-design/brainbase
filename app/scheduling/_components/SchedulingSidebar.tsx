'use client';
import { usePathname } from 'next/navigation';
import { APP_HEADER_OFFSET_VAR, APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';
import { ModuleNavItem, ModuleSidebar } from '@/components/ui/app';

// The shared BrainBase module sidebar (sticky under the app header; a horizontal strip below 768px). Hiding or showing a link here
// is UX only: every page and API route enforces its own access.
const NAV_ITEMS: { href: string; label: string; exact?: boolean; also?: string[] }[] = [
  { href: '/scheduling', label: 'Overview', exact: true },
  { href: '/scheduling/schedules', label: 'Schedules', also: ['/scheduling/offerings'] },
  { href: '/scheduling/resources', label: 'Resources' },
];

export default function SchedulingSidebar() {
  const pathname = usePathname() ?? '';
  return (
    <ModuleSidebar title="Scheduling" label="Scheduling" style={{ position: 'sticky', top: APP_HEADER_OFFSET_VAR, height: APP_HEADER_OFFSET_VH_CALC }}>
      {NAV_ITEMS.map(item => {
        const active = item.exact ? pathname === item.href : [item.href, ...(item.also ?? [])].some(prefix => pathname.startsWith(prefix));
        return (
          <ModuleNavItem key={item.href} href={item.href} active={active}>
            {item.label}
          </ModuleNavItem>
        );
      })}
    </ModuleSidebar>
  );
}
