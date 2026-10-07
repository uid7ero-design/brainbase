'use client';

import { createContext, useContext, type ReactNode } from 'react';
import Link from 'next/link';

const FinanceSetupAccess = createContext(false);

export function FinanceSetupAccessProvider({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return <FinanceSetupAccess.Provider value={allowed}>{children}</FinanceSetupAccess.Provider>;
}

const destinations = [
  { key: 'setup', label: 'Finance setup', href: '/commercial/budgeting/setup' },
  { key: 'mappings', label: 'External GL mappings', href: '/commercial/budgeting/external-gl' },
  { key: 'reporting', label: 'Budget reporting', href: '/commercial/budgeting/commitments' },
  { key: 'controls', label: 'Finance controls', href: '/commercial/budgeting/finance-controls' },
] as const;

export function FinanceWorkflow({ current, setupHint }: { current: typeof destinations[number]['key']; setupHint?: string }) {
  const allowed = useContext(FinanceSetupAccess);
  if (!allowed) return null;
  return <div style={{ marginBottom: 20 }}>
    {setupHint && <p style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>{setupHint}</p>}
    <nav aria-label="Finance workflow" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', fontSize: 13 }}>
      {destinations.filter(destination => destination.key !== current).map(destination => <Link key={destination.key} href={destination.href} style={{ color: 'var(--brand-brainbase-accent)' }}>{destination.label}</Link>)}
    </nav>
  </div>;
}
