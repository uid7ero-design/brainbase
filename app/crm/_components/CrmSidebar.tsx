'use client';
import { usePathname } from 'next/navigation';
import { APP_HEADER_OFFSET_VAR, APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';
import { ModuleNavItem, ModuleSidebar } from '@/components/ui/app';


const NAV_ITEMS = [
  { href: '/crm', label: 'Overview', exact: true },
  { href: '/crm/companies', label: 'Companies' },
  { href: '/crm/contacts', label: 'Contacts' },
  // Contact classification phase — a shortcut, not a second contacts
  // store: same crm_contacts rows, same list page, same API, just a
  // pre-applied ?classification=EVENT_CONTACT filter (see
  // app/crm/contacts/page.tsx). Note: this sidebar's `active` check
  // compares against usePathname() only (query strings are stripped),
  // so this item never highlights as active even while viewing it —
  // a pre-existing limitation of every item's shared active-detection
  // logic here, not something specific to this one link; the link
  // itself still navigates and filters correctly.
  { href: '/crm/contacts?classification=EVENT_CONTACT', label: 'Event Contacts' },
  { href: '/crm/deals', label: 'Deals' },
  { href: '/crm/activities', label: 'Activities' },
  // Phase 6.2 — shown unconditionally here, matching every other entry
  // in this sidebar (none of them do their own role/capability check —
  // CrmLayout's own capability gate is what stands between an
  // unentitled organisation and this whole sidebar). The page itself
  // enforces admin+ role and the 'events' capability server-side; a
  // non-admin who follows this link sees a clear "admins only" message
  // rather than a raw 403.
  { href: '/crm/events-backfill', label: 'Backfill Event Contacts' },
];

export default function CrmSidebar() {
  const pathname = usePathname() ?? '';

  return (
    <ModuleSidebar
      title="CRM"
      label="CRM sections"
      style={{ position: 'sticky', top: APP_HEADER_OFFSET_VAR, height: APP_HEADER_OFFSET_VH_CALC }}
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
