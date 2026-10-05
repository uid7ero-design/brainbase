'use client';

// Shared, Events-only presentation primitives for the authenticated
// Events control centre (app/events/**). Phase D1: these are now thin
// adapters onto the authenticated app system — semantic tokens for every
// colour (light and dark), the canonical semantic Badge for status, and
// the shared button contract's colours — kept as Events-local exports so
// every existing call site and its behaviour stays unchanged.

import { useEffect, useRef, useState } from 'react';
import { Badge, type SemanticState } from '@/components/ui/app';

export const FONT = 'var(--font-inter),-apple-system,sans-serif';

export const BORDER = 'var(--border)';
export const BORDER_SOFT = 'var(--border-light)';
export const PANEL_BG = 'var(--bg-surface)';
export const ROW_BG = 'var(--bg-raised)';
// Product accent (was the retired --purple-* ramp). Names kept for callers.
export const VIOLET = 'var(--brand-brainbase-accent)';
export const VIOLET_SOFT = 'var(--brand-brainbase-accent)';
export const VIOLET_GRADIENT = 'var(--brand-brainbase-accent)';
export const TEXT_PRIMARY = 'var(--text-primary)';
export const TEXT_SECONDARY = 'var(--text-secondary)';
export const TEXT_MUTED = 'var(--text-muted)';
// Semantic status colours (theme-aware). Names kept for callers.
export const GREEN = 'var(--status-success)';
export const RED = 'var(--status-danger)';
export const YELLOW = 'var(--status-warning)';

// ─── Layout primitives ──────────────────────────────────────────────

export function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: PANEL_BG, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 20, ...style }}>
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

// Events tones → the canonical semantic states (components/ui/semantic):
// same text label, a state-specific dot shape, theme-aware colours.
const TONE_STATE: Record<Tone, SemanticState> = {
  success: 'success',
  danger: 'error',
  warning: 'warning',
  neutral: 'inactive',
};

export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return <Badge state={TONE_STATE[tone]}>{label}</Badge>;
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

// Same colours as the shared app Button (components/ui/app/Button):
// primary = product accent, secondary = neutral surface + strong border.
export const primaryBtnStyle: React.CSSProperties = {
  background: 'var(--brand-brainbase-accent)', color: 'var(--brand-brainbase-on-accent)',
  border: '1px solid var(--brand-brainbase-accent)', borderRadius: 'var(--radius-md)',
  padding: '8px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  fontFamily: FONT,
};

export const secondaryBtnStyle: React.CSSProperties = {
  background: 'var(--bg-surface)', color: TEXT_PRIMARY, border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)', padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
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
        background: active ? 'var(--status-danger-muted)' : 'transparent',
        color: 'var(--status-danger)',
        border: `1px solid ${active ? 'var(--status-danger)' : 'var(--status-danger-border)'}`,
        borderRadius: 'var(--radius-md)', padding: '7px 14px', fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
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
// colorScheme: 'dark' — originally added because every native <select>
// that reused this style rendered correctly while closed (from the
// explicit background/color below) but painted its OPEN option popup
// with the browser's default LIGHT UA theme — background/color on the
// element itself never reaches that popup, only color-scheme does.
// Every Events form <select> has since been migrated to FilterDropdown
// (dropdown-consistency phase — see that component's own header
// comment), whose trigger button still spreads ...inputStyle as its
// base, so this fix keeps mattering there; it's also harmless on the
// plain <input>s that use this style directly (color-scheme only
// affects native widget chrome — caret, autofill, spell-check UI —
// never layout or content), and on any native <select> a future Events
// surface might still introduce (matching the same per-element fix
// already applied elsewhere in this codebase, e.g.
// components/ops/maintenance/CreateJobModal.tsx's selects).
export const inputStyle: React.CSSProperties = {
  background: 'var(--bg-raised)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)',
  padding: '8px 11px', color: TEXT_PRIMARY, fontSize: 13, fontFamily: FONT,
};

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={fieldStyle}>
      {label}
      {children}
    </label>
  );
}

// ─── Filter dropdown (BrainBase menu surface, replaces a native <select>) ─
//
// Phase D1: the open panel now uses the app's overlay tokens
// (--bg-overlay / --border / --shadow-menu), so it follows light and dark
// like the TopNav menus it was modelled on; behaviour is unchanged.
//
// Registration operations phase — a single-select dropdown that looks
// and behaves like the top-nav dropdown family (components/nav/
// TopNav.tsx's OpsDropdown/AdminDropdown: dark panel, subtle border,
// shadow, rotating chevron, hover highlight) but is triggered by CLICK
// and emits a VALUE via onChange, matching components/admin/
// OrgSwitcher.tsx's interaction model instead of TopNav's hover-to-open,
// navigate-to-a-page one — TopNav's dropdowns are link menus, not value
// selectors, so they aren't reusable as-is for a filter control.
// Synthesizes the better fit of the two existing dark-dropdown
// precedents rather than inventing a third pattern: OrgSwitcher's own
// click/click-outside/selected-highlight mechanics, TopNav's own dark
// popup surface styling.
//
// The closed trigger reuses inputStyle (so it stays visually consistent
// with the still-native search box sitting right next to it in the same
// toolbar); the open panel uses the TopNav-family's own dark popup
// styling (rgba(7,5,16,.98) background, matching border/shadow), not a
// browser-native popup — this is what actually needed to change from
// the plain <select> this replaces (see the PR #125 report on why a
// native option popup couldn't be made to match this palette).
//
// Neither existing dark-dropdown precedent implements Escape-to-close
// or explicit focus handling — both are added here because they were
// missing everywhere, not because either precedent already provides
// them (i.e. not "custom ARIA", just closing two real gaps): Escape is
// caught at the wrapper (bubbles from the trigger or any open option),
// and selecting an option (or Escape) returns focus to the trigger so
// keyboard Tab order continues sensibly. The trigger and each option
// are plain native <button> elements — Enter/Space activation and the
// browser's own visible focus outline come for free, not reimplemented.
export type DropdownOption = { value: string; label: string };

export function FilterDropdown({
  ariaLabel, value, onChange, options, style, triggerStyle,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  // Merged onto the outer (position: relative) wrapper — e.g. a flex
  // sizing override in a toolbar row.
  style?: React.CSSProperties;
  // Merged onto the trigger <button> itself, AFTER its own defaults —
  // needed once this component started serving contexts beyond the
  // registration toolbar (dropdown-consistency phase): a compact inline
  // answer editor needs smaller padding/font-size and a much narrower
  // minWidth than the toolbar's own filters use, and a form-grid cell
  // needs the trigger to stretch to the cell's full width the way its
  // sibling <input>s already do. Both are real, current call sites, not
  // speculative — see EventDetailClient.tsx's status field and
  // RegistrationDetail.tsx's Yes/No answer editor.
  triggerStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function select(next: string) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const selected = options.find(o => o.value === value) ?? options[0];

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', flex: '0 1 auto', ...style }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        style={{
          ...inputStyle,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          cursor: 'pointer', minWidth: 150, background: open ? 'var(--bg-sunken)' : inputStyle.background,
          ...triggerStyle,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected?.label ?? ariaLabel}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ flexShrink: 0, opacity: 0.6, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .12s' }} aria-hidden="true">
          <path d="M1 2l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          style={{
            // maxWidth is viewport-aware (not a bare 260px) so a trigger
            // sitting near the right edge on a narrow/mobile screen can
            // never make this panel wider than the viewport itself —
            // the toolbar's own flex-wrap already handles vertical
            // stacking; this only guards the one axis wrapping can't.
            position: 'absolute', top: '100%', left: 0, marginTop: 4, minWidth: '100%', width: 'max-content', maxWidth: 'min(260px, calc(100vw - 32px))',
            background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-menu)', padding: 4, zIndex: 60,
            maxHeight: 280, overflowY: 'auto',
          }}
        >
          {options.map(opt => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value || '__any__'}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => select(opt.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                  padding: '7px 10px', background: 'none', border: 'none', borderRadius: 7, cursor: 'pointer',
                  color: isSelected ? VIOLET_SOFT : TEXT_PRIMARY, fontSize: 12.5, fontWeight: isSelected ? 600 : 400,
                  fontFamily: FONT, whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-sunken)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: isSelected ? VIOLET_SOFT : 'transparent', flexShrink: 0 }} />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Row card (sessions / ticket types / registrations list rows) ────

export const rowCardStyle: React.CSSProperties = {
  padding: '12px 14px', background: ROW_BG, border: `1px solid ${BORDER_SOFT}`, borderRadius: 'var(--radius-lg)',
};

// ─── Shared scoped CSS ──────────────────────────────────────────────
// Only exists for the two pseudo-classes inline style objects can't
// express (:hover on link-rows, :focus on inputs) — same pattern the
// public booking page already uses for its own scoped <style> block.
// Render <EventsSharedStyles /> once per page.

// Phase D1: tokens only; no outline suppression — inputs keep the global
// :focus-visible ring and gain an accent border while focused.
const EVENTS_UI_CSS = `
.bb-evt-row { transition: border-color .15s ease, background .15s ease; }
.bb-evt-row:hover, .bb-evt-row:focus-within { border-color: var(--brand-brainbase-accent-border); background: var(--bg-sunken); }
.bb-evt-input { transition: border-color .15s ease; }
.bb-evt-input:focus { border-color: var(--border-focus); }
`;

export function EventsSharedStyles() {
  return <style>{EVENTS_UI_CSS}</style>;
}
