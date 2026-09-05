'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_HEADER_OFFSET_VAR, APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';

const BORDER = '#1a1d24';

// Only the three resources this phase actually builds — Invoices/
// Purchasing/Expenses/Budgeting/Finance Intelligence are deliberately
// omitted entirely (not shown-disabled) per the C3 brief's explicit
// navigation instruction, matching CrmSidebar.tsx's own precedent of one
// flat, always-shown list (this layout's own capability gate is what
// stands between an unentitled organisation and this whole sidebar, same
// as CRM).
const NAV_ITEMS = [
  { href: '/commercial', label: 'Overview', exact: true },
  { href: '/commercial/customers', label: 'Customers' },
  { href: '/commercial/products', label: 'Products & Services' },
  { href: '/commercial/quotes', label: 'Quotes' },
];

export default function CommercialSidebar() {
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
