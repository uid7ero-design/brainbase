'use client';

import { useId } from 'react';
import { CapabilityIcon } from '@/components/brand/CapabilityIcon';
import styles from './ModuleAccessCard.module.css';

// The client dashboard's own capability-driven "Your tools" section — the
// single place a staff user with a capability-gated module enabled sees an
// obvious entry point for it on the page they actually land on after login
// (app/dashboard/page.tsx -> <BrainBase>/<TennisDashboard>), not only in
// TopNav's thin, easily-missed pill row. Deliberately data-driven, not "if
// org has Events render a hardcoded Events card": add a new entry here when
// a second module needs the same treatment, rather than special-casing
// each one at the call site. Never references an organisation id or slug —
// entirely driven by the enabledCapabilities prop, which callers compute
// server-side (app/dashboard/page.tsx) via the SAME query
// app/api/me/route.ts's own enabledCapabilities projection already runs —
// this is the same capability system, not a second one, and rendering it
// server-side (rather than this component doing its own client fetch)
// means the entry is present in the initial page render, not only after a
// client-side round trip resolves.
type ModuleEntry = {
  key: string;
  title: string;
  description: string;
  href: string;
  cta: string;
};

// Phase C.2C — added the crm/organiser entries alongside the existing
// events one so this card covers every capability key that genuinely
// exists in `modules` today (confirmed via a read-only audit: crm, events,
// organiser are the only three rows). Same pattern, same verified real
// routes (/crm, /organiser) — not a guess.
const MODULE_ENTRIES: ModuleEntry[] = [
  {
    key: 'events',
    title: 'Events & Ticketing',
    description: 'Create and manage events, registrations and tickets',
    href: '/events',
    cta: 'Open Events',
  },
  {
    key: 'crm',
    title: 'CRM',
    description: 'Companies, contacts, deals and activities',
    href: '/crm',
    cta: 'Open CRM',
  },
  {
    key: 'organiser',
    title: 'Organiser',
    description: 'Boards and tasks for your organisation',
    href: '/organiser',
    cta: 'Open Organiser',
  },
];

// Phase D2 — compact module access: one bordered list, one row per
// enabled module (icon, name, purpose, direct action), instead of large
// hover-lit tiles. Destinations, copy and capability gating are unchanged.
// Shared by OrganisationDashboard, TennisDashboard and BrainBase.jsx; the
// props contract is unchanged, so every consumer gets the same rows.
function ModuleCard({ entry }: { entry: ModuleEntry }) {
  return (
    <li>
      <a href={entry.href} className={styles.row}>
        {/* Decorative — the title text beside it already gives every row an
            accessible name, so the icon carries no separate aria-label. */}
        <CapabilityIcon capability={entry.key} size="sm" />
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

export function ModuleAccessCard({ enabledCapabilities }: { enabledCapabilities: string[] }) {
  const entries = MODULE_ENTRIES.filter(e => enabledCapabilities.includes(e.key));
  const headingId = useId();
  if (entries.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>Your Tools</h2>
      <ul className={styles.list}>
        {entries.map(entry => (
          <ModuleCard key={entry.key} entry={entry} />
        ))}
      </ul>
    </section>
  );
}
