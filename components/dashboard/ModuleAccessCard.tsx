'use client';

import { useId } from 'react';
import { CapabilityIcon } from '@/components/brand/CapabilityIcon';
import { workModuleCards, type DashboardVariant } from '@/components/nav/navModel';
import styles from './ModuleAccessCard.module.css';

// The client dashboard's own "Your tools" section — the obvious entry point
// to the organisation's first-class Work modules on the page staff land on
// after login (OrganisationDashboard, TennisDashboard, the BrainBase
// fallback). WHICH modules appear is no longer decided here: it comes from
// the same pure navigation model TopNav's Work menu uses
// (components/nav/navModel.ts → workModuleCards), so the dashboard and the
// chrome can never disagree about module access. Only first-class Work
// modules are cards — never Data Hub, the Tennis group, Manage, Brainbase or
// Account items. This component owns presentation only (copy + layout).
//
// Callers compute enabledCapabilities server-side (app/dashboard/page.tsx)
// via the same organisation_modules × modules projection /api/me uses, and
// pass the signed-in role so role-gated modules (Organiser: manager+) are
// offered only where their route admits the user. Without a role, role-gated
// modules fail closed.

type CardCopy = { description: string; cta: string };

const CARD_COPY: Record<string, CardCopy> = {
  events: { description: 'Create and manage events, registrations and tickets', cta: 'Open Events' },
  crm: { description: 'Companies, contacts, deals and activities', cta: 'Open CRM' },
  commercial: { description: 'Quotes, invoices and purchasing', cta: 'Open Commercial' },
  organiser: { description: 'Boards and tasks for your organisation', cta: 'Open Organiser' },
  people: { description: 'People, teams and HR records', cta: 'Open People' },
};

type ModuleEntry = {
  id: string;
  icon: string;
  title: string;
  description: string;
  href: string;
  cta: string;
};

// Phase D2 — compact module access: one bordered list, one row per
// enabled module (icon, name, purpose, direct action), instead of large
// hover-lit tiles.
function ModuleCard({ entry }: { entry: ModuleEntry }) {
  return (
    <li>
      <a href={entry.href} className={styles.row}>
        {/* Decorative — the title text beside it already gives every row an
            accessible name, so the icon carries no separate aria-label. */}
        <CapabilityIcon capability={entry.icon} size="sm" />
        <span className={styles.text}>
          <span className={styles.title}>{entry.title}</span>
          <span className={styles.description}>{entry.description}</span>
        </span>
        <span className={styles.cta}>
          {entry.cta} <span aria-hidden="true">→</span>
        </span>
      </a>
    </li>
  );
}

export function ModuleAccessCard({
  enabledCapabilities,
  role = '',
  dashboardVariant = null,
}: {
  enabledCapabilities: string[];
  /** Real signed-in role; omitted → role-gated modules fail closed. */
  role?: string;
  dashboardVariant?: DashboardVariant;
}) {
  const entries: ModuleEntry[] = workModuleCards({ role, enabledCapabilities, dashboardVariant }).map(link => ({
    id: link.id,
    icon: link.icon ?? link.id,
    title: link.label,
    description: CARD_COPY[link.id]?.description ?? link.description ?? '',
    href: link.href,
    cta: CARD_COPY[link.id]?.cta ?? `Open ${link.label}`,
  }));
  const headingId = useId();
  if (entries.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>Your Tools</h2>
      <ul className={styles.list}>
        {entries.map(entry => (
          <ModuleCard key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}
