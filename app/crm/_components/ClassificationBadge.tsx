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

// Domain category encoding (kept) — six distinct contact categories, always
// rendered beside their text label. Categories whose meaning matches a
// semantic state use the status tokens (client→success, lead→warning,
// supplier→info, other→inactive); Event Contact and Partner have no
// semantic equivalent, so they get their own category hue (chosen apart from
// the brand accent and the status hues), mixed toward the theme's
// text colour for legible contrast in both light and dark themes.
const categoryTone = (hue: string) => ({
  fg: `color-mix(in srgb, ${hue} 65%, var(--text-primary))`,
  bg: `color-mix(in srgb, ${hue} 12%, transparent)`,
  bd: `color-mix(in srgb, ${hue} 35%, transparent)`,
  dot: hue,
});

const TONE: Record<CrmContactClassification, { fg: string; bg: string; bd: string; dot: string }> = {
  CLIENT: { fg: 'var(--status-success)', bg: 'var(--status-success-muted)', bd: 'var(--status-success-border)', dot: 'var(--status-success)' },
  LEAD: { fg: 'var(--status-warning)', bg: 'var(--status-warning-muted)', bd: 'var(--status-warning-border)', dot: 'var(--status-warning)' },
  EVENT_CONTACT: categoryTone('#3B82F6'),
  SUPPLIER: { fg: 'var(--status-info)', bg: 'var(--status-info-muted)', bd: 'var(--status-info-border)', dot: 'var(--status-info)' },
  PARTNER: categoryTone('#F472B6'),
  OTHER: { fg: 'var(--status-inactive)', bg: 'var(--status-inactive-muted)', bd: 'var(--border)', dot: 'var(--status-inactive)' },
};

// `null`/`undefined` (unclassified) renders a plain muted "—" rather
// than a coloured badge — most existing contacts are unclassified, and
// that is a normal state, not a warning/error state that deserves a
// tone of its own.
export default function ClassificationBadge({ classification }: { classification: CrmContactClassification | null | undefined }) {
  if (!classification) {
    return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>;
  }
  const tone = TONE[classification];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
        padding: '2px 8px', borderRadius: 'var(--radius-sm)',
        color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}`, whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: tone.dot, flex: 'none' }} aria-hidden="true" />
      {CRM_CONTACT_CLASSIFICATION_LABELS[classification]}
    </span>
  );
}
