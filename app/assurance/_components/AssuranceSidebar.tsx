'use client';
import { usePathname } from 'next/navigation';
import { APP_HEADER_OFFSET_VAR, APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';
import Link from 'next/link';
import { ModuleNavItem, ModuleSidebar, moduleNavFooterItemClassName } from '@/components/ui/app';

// The shared BrainBase module sidebar, exactly as CommercialSidebar uses
// it (sticky under the app header; a horizontal strip below 768px).
// Hiding or showing a link here is UX only — every page and route
// enforces its own access server-side.
const NAV_ITEMS: { href: string; label: string; exact?: boolean }[] = [
  { href: '/assurance', label: 'Dashboard', exact: true },
  { href: '/assurance/incidents', label: 'Incidents' },
  { href: '/assurance/investigations', label: 'Investigations' },
  { href: '/assurance/inspections', label: 'Inspections' },
  { href: '/assurance/audits', label: 'Audits' },
  { href: '/assurance/findings', label: 'Findings' },
  { href: '/assurance/actions', label: 'Actions' },
  { href: '/assurance/evidence', label: 'Evidence' },
  { href: '/assurance/verification', label: 'Verification' },
];

export default function AssuranceSidebar() {
  const pathname = usePathname() ?? '';
  return (
    <ModuleSidebar
      title="Assurance"
      label="Assurance"
      style={{ position: 'sticky', top: APP_HEADER_OFFSET_VAR, height: APP_HEADER_OFFSET_VH_CALC }}
      footer={
        // In-app Help (guides and work instructions). Outside the nine-section
        // navigation on purpose: it is a reference, not a workflow section.
        <Link href="/assurance/help" className={moduleNavFooterItemClassName}
          aria-current={pathname.startsWith('/assurance/help') ? 'page' : undefined}>
          Help &amp; work instructions
        </Link>
      }
    >
      {NAV_ITEMS.map(item => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <ModuleNavItem key={item.href} href={item.href} active={active}>
            {item.label}
          </ModuleNavItem>
        );
      })}
    </ModuleSidebar>
  );
}
