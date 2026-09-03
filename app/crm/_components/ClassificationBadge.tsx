// Small, CRM-local badge for a contact's classification
// (lib/crm/classification.ts). Deliberately not imported from
// app/events/_components/ui.tsx's StatusBadge — that component is
// explicitly scoped to Events only (see its own file header); CRM gets
// its own tiny primitive instead of reaching across that boundary.
//
// Compact and subtle by design (per this phase's own "do not
// over-design this" instruction) — a coloured dot + label, no icons, no
// per-value imagery. Colour/tone lives entirely in this file, not in
// lib/crm/classification.ts, which stays a pure data-layer module with
// no UI concerns.

import { CRM_CONTACT_CLASSIFICATION_LABELS, type CrmContactClassification } from '@/lib/crm/classification';

const TONE: Record<CrmContactClassification, { fg: string; bg: string; bd: string }> = {
  CLIENT: { fg: '#4ADE80', bg: 'rgba(74,222,128,.10)', bd: 'rgba(74,222,128,.30)' },
  LEAD: { fg: '#FBBF24', bg: 'rgba(251,191,36,.10)', bd: 'rgba(251,191,36,.30)' },
  EVENT_CONTACT: { fg: '#A78BFA', bg: 'rgba(167,139,250,.10)', bd: 'rgba(167,139,250,.30)' },
  SUPPLIER: { fg: '#60A5FA', bg: 'rgba(96,165,250,.10)', bd: 'rgba(96,165,250,.30)' },
  PARTNER: { fg: '#F472B6', bg: 'rgba(244,114,182,.10)', bd: 'rgba(244,114,182,.30)' },
  OTHER: { fg: '#9CA3AF', bg: 'rgba(156,163,175,.10)', bd: 'rgba(156,163,175,.30)' },
};

// `null`/`undefined` (unclassified) renders a plain muted "—" rather
// than a coloured badge — most existing contacts are unclassified, and
// that is a normal state, not a warning/error state that deserves a
// tone of its own.
export default function ClassificationBadge({ classification }: { classification: CrmContactClassification | null | undefined }) {
  if (!classification) {
    return <span style={{ fontSize: 12, color: '#6b7280' }}>—</span>;
  }
  const tone = TONE[classification];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
        padding: '2px 8px', borderRadius: 999,
        color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}`, whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: tone.fg, flex: 'none' }} aria-hidden="true" />
      {CRM_CONTACT_CLASSIFICATION_LABELS[classification]}
    </span>
  );
}
