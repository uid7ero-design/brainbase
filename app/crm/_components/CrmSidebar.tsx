'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const BORDER = '#1a1d24';

const NAV_ITEMS = [
  { href: '/crm', label: 'Overview', exact: true },
  { href: '/crm/companies', label: 'Companies' },
  { href: '/crm/contacts', label: 'Contacts' },
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
    <aside
      style={{
        width: 200,
        borderRight: `1px solid ${BORDER}`,
        padding: '28px 0',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'sticky',
        top: 52,
        height: 'calc(100vh - 52px)',
      }}
    >
      <div
        style={{
          padding: '0 20px 14px',
          fontSize: 11,
          fontWeight: 700,
          color: '#4b5563',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        CRM
      </div>
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
        {NAV_ITEMS.map(item => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'block',
                padding: '8px 12px',
                fontSize: 14,
                textDecoration: 'none',
                borderRadius: 7,
                color: active ? '#C4B5FD' : '#9ca3af',
                background: active ? 'rgba(139,92,246,.10)' : 'transparent',
                transition: 'background .12s, color .12s',
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
