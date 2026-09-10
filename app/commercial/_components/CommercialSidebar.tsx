'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_HEADER_OFFSET_VAR, APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';

const BORDER = '#1a1d24';

// Purchasing/Expenses/Budgeting/Finance Intelligence remain deliberately
// omitted entirely (not shown-disabled) per the C3 brief's original
// navigation instruction — no evidence any of those are being built yet.
//
// Phase C4.2 introduced per-item capability gating for Invoices, but
// left an inconsistency Phase C4.4A (Finding 3 remediation) now fixes:
// "Quotes" was still ALWAYS shown, on the (once-true, now-false)
// assumption that anyone who cleared the layout's own gate necessarily
// had Quotes — true back when that gate WAS 'quotes'-only, but no
// longer true since the layout widened to quotes OR invoicing (see
// app/commercial/layout.tsx's own comment). An invoicing-only
// organisation reaching this shell would have seen a "Quotes" link that
// always 403'd the moment it was clicked — exactly the
// looks-available-but-isn't trap this file's own Invoices precedent was
// designed to avoid. Quotes is now gated the identical way: omitted
// entirely (never shown-disabled) for an organisation that lacks it.
//
// Customers/Products/Settings remain always shown once the shell
// renders at all — they are genuinely available to BOTH quotes-only and
// invoicing-only organisations now (see lib/commercial/authorize.ts's
// own ['quotes', 'invoicing'] OR-gate, applied to every route backing
// these three nav items), so no per-item gate is needed for them.
const BASE_NAV_ITEMS = [
  { href: '/commercial', label: 'Overview', exact: true },
  { href: '/commercial/customers', label: 'Customers' },
  { href: '/commercial/products', label: 'Products & Services' },
  { href: '/commercial/settings', label: 'Settings' },
];

// Phase C6.3 — Purchasing follows the identical never-shown-disabled,
// per-capability-gated convention as Quotes/Invoicing above: omitted
// entirely (not shown-disabled) for an organisation not entitled to
// 'purchasing'. Hiding these links is UX only — every route backing them
// still enforces authorizeCommercialRequest('purchasing', ...)
// server-side regardless of what this sidebar renders.
export default function CommercialSidebar({ quotesEnabled = false, invoicingEnabled = false, purchasingEnabled = false }: { quotesEnabled?: boolean; invoicingEnabled?: boolean; purchasingEnabled?: boolean }) {
  const pathname = usePathname() ?? '';
  const navItems = [
    ...BASE_NAV_ITEMS.slice(0, 3),
    ...(quotesEnabled ? [{ href: '/commercial/quotes', label: 'Quotes' }] : []),
    ...(invoicingEnabled ? [{ href: '/commercial/invoices', label: 'Invoices' }] : []),
    ...(purchasingEnabled ? [
      { href: '/commercial/purchasing/purchase-orders', label: 'Purchase Orders' },
      { href: '/commercial/purchasing/suppliers', label: 'Suppliers' },
    ] : []),
    ...BASE_NAV_ITEMS.slice(3),
  ];

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
