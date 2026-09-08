'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_HEADER_OFFSET_VAR, APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';

const BORDER = '#1a1d24';

// Purchasing/Expenses/Budgeting/Finance Intelligence remain deliberately
// omitted entirely (not shown-disabled) per the C3 brief's original
// navigation instruction — no evidence any of those are being built yet.
// Invoices (Phase C4.2) is the first nav item in this list that IS
// per-item capability-gated rather than always shown once the shell
// itself renders: unlike Customers/Products/Quotes/Settings (which have
// always been reachable by anyone who cleared this layout's own 'quotes'
// gate), Invoices must stay invisible to an organisation entitled to
// Quotes but NOT Invoicing — the two are independently-entitlable
// capability keys (see app/commercial/layout.tsx's own comment), so
// showing this link unconditionally the way every other item here does
// would advertise a feature the organisation cannot actually use. No
// disabled/greyed-out placeholder either — per Phase C4.2's own
// instruction, an unentitled feature is omitted, never shown-disabled.
const BASE_NAV_ITEMS = [
  { href: '/commercial', label: 'Overview', exact: true },
  { href: '/commercial/customers', label: 'Customers' },
  { href: '/commercial/products', label: 'Products & Services' },
  { href: '/commercial/quotes', label: 'Quotes' },
  // Phase C3-POLISH-R — Business Profile + Tax Codes. The route itself
  // is administer-gated (app/api/commercial/settings/business-profile,
  // app/api/commercial/tax-codes) for writes; showing the link to every
  // Commercial user is consistent with every other nav item here (this
  // sidebar has no per-item role gating — the layout's own capability
  // check is what stands between an unentitled organisation and the
  // whole shell, same as CRM's sidebar).
  { href: '/commercial/settings', label: 'Settings' },
];

export default function CommercialSidebar({ invoicingEnabled = false }: { invoicingEnabled?: boolean }) {
  const pathname = usePathname() ?? '';
  const navItems = invoicingEnabled
    ? [...BASE_NAV_ITEMS.slice(0, 3), { href: '/commercial/invoices', label: 'Invoices' }, ...BASE_NAV_ITEMS.slice(3)]
    : BASE_NAV_ITEMS;

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
        top: APP_HEADER_OFFSET_VAR,
        height: APP_HEADER_OFFSET_VH_CALC,
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
        Commercial
      </div>
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
        {navItems.map(item => {
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
