'use client';

import { useState } from 'react';
import { CapabilityIcon } from '@/components/brand/CapabilityIcon';

const FONT = "var(--font-inter), -apple-system, sans-serif";

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

function ModuleCard({ entry }: { entry: ModuleEntry }) {
  const [hover, setHover] = useState(false);

  return (
    <a
      href={entry.href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 16px 14px',
        borderRadius: 11,
        textDecoration: 'none',
        fontFamily: FONT,
        background: hover ? 'rgba(124,58,237,.10)' : 'rgba(255,255,255,.025)',
        border: `1px solid ${hover ? 'rgba(124,58,237,.38)' : 'rgba(255,255,255,.07)'}`,
        boxShadow: hover ? '0 0 20px rgba(124,58,237,.12)' : 'none',
        transition: 'all .18s',
      }}
    >
      {/* Decorative — the title text right below already gives every card an
          accessible name, so the icon carries no separate aria-label.
          marginBottom trims the flex gap below just this element (8px -
          2px = 6px) so the icon reads as grouped with the title, without
          touching the title/description/CTA rhythm below, which keeps the
          container's own 8px gap unchanged. */}
      <CapabilityIcon capability={entry.key} size="md" state={hover ? 'hover' : 'default'} style={{ marginBottom: -2 }} />

      <span style={{ fontSize: 13, fontWeight: 700, color: hover ? '#E2D9F3' : '#D4D4D8', lineHeight: 1.35 }}>
        {entry.title}
      </span>
      <p style={{ margin: 0, fontSize: 11, color: 'rgba(161,161,170,.75)', lineHeight: 1.5 }}>
        {entry.description}
      </p>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
        color: hover ? '#C4B5FD' : 'rgba(167,139,250,.55)',
        transition: 'color .18s',
      }}>
        {entry.cta} →
      </span>
    </a>
  );
}

export function ModuleAccessCard({ enabledCapabilities }: { enabledCapabilities: string[] }) {
  const entries = MODULE_ENTRIES.filter(e => enabledCapabilities.includes(e.key));
  if (entries.length === 0) return null;

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,.06)' }} />
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.14em', color: 'rgba(255,255,255,.30)', textTransform: 'uppercase' }}>
          Your Tools
        </span>
        <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,.06)' }} />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 8,
      }}>
        {entries.map(entry => (
          <ModuleCard key={entry.key} entry={entry} />
        ))}
      </div>
    </div>
  );
}
