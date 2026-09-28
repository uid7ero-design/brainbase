'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_HEADER_OFFSET_VAR, APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';

const BORDER = 'var(--border)';

// Mirrors app/commercial/_components/CommercialSidebar.tsx. Hiding or
// showing a link here is UX only — every page and route enforces its own
// access server-side.
const NAV_ITEMS: { href: string; label: string; exact?: boolean }[] = [
  { href: '/assurance', label: 'Dashboard', exact: true },
  { href: '/assurance/incidents', label: 'Incidents' },
  { href: '/assurance/investigations', label: 'Investigations' },
  { href: '/assurance/inspections', label: 'Inspections' },
  { href: '/assurance/findings', label: 'Findings' },
  { href: '/assurance/actions', label: 'Actions' },
  { href: '/assurance/evidence', label: 'Evidence' },
  { href: '/assurance/verification', label: 'Verification' },
];

export default function AssuranceSidebar() {
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
      <div style={{ padding: '0 20px 14px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Assurance
      </div>
      <nav aria-label="Assurance" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
        {NAV_ITEMS.map(item => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'block',
                padding: '8px 12px',
                fontSize: 14,
                textDecoration: 'none',
                borderRadius: 7,
                color: active ? 'var(--brand-brainbase-accent)' : 'var(--text-secondary)',
                background: active ? 'color-mix(in srgb, var(--brand-brainbase-accent) 10%, transparent)' : 'transparent',
                transition: 'background .12s, color .12s',
              }}
            >
              {item.label}
            </Link>
          );
        })}
        {/* A0.1E-1 Audit is still in deployment gating — shown disabled, never linked. */}
        <span
          aria-disabled="true"
          title="Audits are coming soon"
          style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', fontSize: 14, color: 'var(--text-muted)', cursor: 'not-allowed' }}
        >
          Audits
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', alignSelf: 'center' }}>Soon</span>
        </span>
      </nav>
    </aside>
  );
}
