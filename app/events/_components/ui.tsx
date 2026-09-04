'use client';

// Shared, Events-only presentation primitives — visual polish layer for
// the authenticated Events control centre (app/events/**). Not a new
// design system: these are thin wrappers around the same dark/violet
// palette already used by the polished public booking page
// (app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx), kept
// local to app/events/ rather than promoted into a shared components/ui
// primitive, since nothing outside Events currently needs them.

import { useState } from 'react';

export const FONT = 'var(--font-inter),-apple-system,sans-serif';

export const BORDER = 'rgba(255,255,255,.08)';
export const BORDER_SOFT = 'rgba(255,255,255,.06)';
export const PANEL_BG = 'rgba(255,255,255,.025)';
export const ROW_BG = 'rgba(255,255,255,.02)';
export const VIOLET = '#8A4DFF';
export const VIOLET_SOFT = '#A78BFA';
export const VIOLET_GRADIENT = 'linear-gradient(100deg,#6A3DFF 0%,#8A4DFF 55%,#5677FF 100%)';
export const TEXT_PRIMARY = '#F5F7FA';
export const TEXT_SECONDARY = 'rgba(226,232,240,.66)';
export const TEXT_MUTED = 'rgba(226,232,240,.42)';
export const GREEN = '#4ADE80';
export const RED = '#F87171';
export const YELLOW = '#FBBF24';

// ─── Layout primitives ──────────────────────────────────────────────

export function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: PANEL_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 22, ...style }}>
      {children}
    </div>
  );
}

export function SectionHeader({ title, sub, action }: { title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: TEXT_PRIMARY }}>{title}</h2>
        {sub && <div style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 3 }}>{sub}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '30px 16px' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY, marginBottom: body ? 5 : 0 }}>{title}</div>
      {body && <div style={{ fontSize: 12.5, lineHeight: 1.6, color: TEXT_MUTED, maxWidth: 360, margin: '0 auto' }}>{body}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

// ─── Status badges ──────────────────────────────────────────────────
// Colour is a supplement, never the only signal — the text label is
// always rendered alongside the coloured dot.

export type Tone = 'success' | 'danger' | 'warning' | 'neutral';

export function capacityTone(remaining: number, capacity: number): Tone {
  if (capacity <= 0) return 'neutral';
  if (remaining <= 0) return 'danger';
  if (remaining <= Math.max(1, Math.round(capacity * 0.15))) return 'warning';
  return 'success';
}

const TONE_STYLES: Record<Tone, { fg: string; bg: string; bd: string }> = {
  success: { fg: GREEN, bg: 'rgba(74,222,128,.10)', bd: 'rgba(74,222,128,.30)' },
  danger: { fg: RED, bg: 'rgba(248,113,113,.10)', bd: 'rgba(248,113,113,.30)' },
  warning: { fg: YELLOW, bg: 'rgba(251,191,36,.10)', bd: 'rgba(251,191,36,.30)' },
  neutral: { fg: TEXT_SECONDARY, bg: 'rgba(255,255,255,.05)', bd: BORDER },
};

export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  const t = TONE_STYLES[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700,
      letterSpacing: '.05em', textTransform: 'uppercase', padding: '3px 9px', borderRadius: 999,
      color: t.fg, background: t.bg, border: `1px solid ${t.bd}`, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.fg, flex: 'none' }} aria-hidden="true" />
      {label}
    </span>
  );
}

export function eventStatusTone(status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED'): Tone {
  if (status === 'PUBLISHED') return 'success';
  if (status === 'CANCELLED') return 'danger';
  return 'neutral';
}

export function orderStatusTone(status: string): Tone {
  if (status === 'CONFIRMED') return 'success';
  if (status === 'PENDING') return 'warning';
  if (status === 'CANCELLED') return 'danger';
  return 'neutral';
}

// Phase 4 — payment_status is a distinct dimension from status above
// (see scripts/add-events-payments.sql); NOT_REQUIRED (every free
// order) deliberately renders no badge at all rather than a "Free"
// badge competing for attention next to the order status badge — see
// RegistrationsPanel's own usage.
export function paymentStatusTone(paymentStatus: string): Tone {
  if (paymentStatus === 'PAID') return 'success';
  if (paymentStatus === 'PENDING') return 'warning';
  if (paymentStatus === 'REFUNDED') return 'neutral';
  if (paymentStatus === 'FAILED' || paymentStatus === 'EXPIRED') return 'danger';
  return 'neutral';
}

// ─── Buttons ─────────────────────────────────────────────────────────

export const primaryBtnStyle: React.CSSProperties = {
  background: VIOLET_GRADIENT, color: '#fff', border: 'none', borderRadius: 9,
  padding: '8px 16px', fontSize: 12.5, fontWeight: 650, cursor: 'pointer',
  boxShadow: '0 4px 14px rgba(106,61,255,.24)', fontFamily: FONT,
};

export const secondaryBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,.04)', color: TEXT_SECONDARY, border: `1px solid ${BORDER}`,
  borderRadius: 9, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
};

// Delete stays visually restrained until hover/focus — never draws the
// eye the way the primary action does.
export function DangerButton({ children, onClick, disabled, ariaLabel }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; ariaLabel?: string;
}) {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}
      onMouseEnter={() => setActive(true)} onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)} onBlur={() => setActive(false)}
      style={{
        background: active ? 'rgba(248,113,113,.12)' : 'transparent',
        color: active ? '#FCA5A5' : 'rgba(248,113,113,.55)',
        border: `1px solid ${active ? 'rgba(248,113,113,.4)' : 'rgba(248,113,113,.18)'}`,
        borderRadius: 9, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        transition: 'background .15s ease, border-color .15s ease, color .15s ease',
      }}
    >
      {children}
    </button>
  );
}

// ─── Form fields ─────────────────────────────────────────────────────

export const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: TEXT_MUTED, fontWeight: 500 };
// colorScheme: 'dark' — every <select> that reuses this style (e.g.
// RegistrationsPanel's filter dropdowns, EventDetailClient's status
// select, QuestionsPanel's field-type/scope selects) renders correctly
// while closed from the explicit background/color above, but without
// this the browser still paints the OPEN native option popup using its
// default LIGHT UA theme — background/color on the element itself does
// not reach that popup, only color-scheme does. Matches the same fix
// already applied per-element elsewhere in this codebase (e.g.
// components/ops/maintenance/CreateJobModal.tsx's selects) — set once
// here instead, so every current and future consumer of this shared
// style gets it for free. Harmless on plain <input>s that also use this
// style (color-scheme only affects native widget chrome — caret,
// autofill, spell-check UI — never layout or content).
export const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,.03)', border: `1px solid ${BORDER}`, borderRadius: 8,
  padding: '8px 11px', color: TEXT_PRIMARY, fontSize: 13, fontFamily: FONT, colorScheme: 'dark',
};

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={fieldStyle}>
      {label}
      {children}
    </label>
  );
}

// ─── Row card (sessions / ticket types / registrations list rows) ────

export const rowCardStyle: React.CSSProperties = {
  padding: '13px 15px', background: ROW_BG, border: `1px solid ${BORDER_SOFT}`, borderRadius: 10,
};

// ─── Shared scoped CSS ──────────────────────────────────────────────
// Only exists for the two pseudo-classes inline style objects can't
// express (:hover on link-rows, :focus on inputs) — same pattern the
// public booking page already uses for its own scoped <style> block.
// Render <EventsSharedStyles /> once per page.

const EVENTS_UI_CSS = `
.bb-evt-row { transition: border-color .15s ease, background .15s ease; }
.bb-evt-row:hover, .bb-evt-row:focus-within { border-color: rgba(138,77,255,.35); background: rgba(138,77,255,.05); }
.bb-evt-input { transition: border-color .15s ease, background .15s ease, box-shadow .15s ease; }
.bb-evt-input:focus {
  outline: none; border-color: rgba(138,77,255,.55); background: rgba(138,77,255,.05);
  box-shadow: 0 0 0 3px rgba(124,58,237,.14);
}
`;

export function EventsSharedStyles() {
  return <style>{EVENTS_UI_CSS}</style>;
}
