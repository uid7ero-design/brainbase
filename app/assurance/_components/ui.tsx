// Assurance presentational primitives. Server-safe (no hooks, no
// 'use client'); only imports the zero-import domain module. Visual
// language mirrors app/commercial: inline styles over the shared CSS
// tokens (--bg-surface, --border, --text-*, --bb-success/warning/danger/info).
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { assuranceLabel, assuranceTone, formatAssuranceDate, formatAssuranceDateTime, type AssuranceTone } from '@/lib/assurance/domain';

export const CARD = 'var(--bg-surface)';
export const BORDER = 'var(--border)';

const TONE_STYLE: Record<AssuranceTone, { color: string; bg: string }> = {
  neutral: { color: 'var(--text-secondary)', bg: 'color-mix(in srgb, var(--text-muted) 14%, transparent)' },
  info: { color: 'var(--bb-info)', bg: 'var(--bb-info-soft)' },
  warning: { color: 'var(--bb-warning)', bg: 'var(--bb-warning-soft)' },
  danger: { color: 'var(--bb-danger)', bg: 'var(--bb-danger-soft)' },
  success: { color: 'var(--bb-success)', bg: 'var(--bb-success-soft)' },
  accent: { color: 'var(--brand-brainbase-accent)', bg: 'color-mix(in srgb, var(--brand-brainbase-accent) 12%, transparent)' },
};

export function Badge({ value, tone, label }: { value: string | null | undefined; tone?: AssuranceTone; label?: string }) {
  if (!value) return <Dim>—</Dim>;
  const s = TONE_STYLE[tone ?? assuranceTone(value)];
  return (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', color: s.color, background: s.bg, whiteSpace: 'nowrap' }}>
      {label ?? assuranceLabel(value)}
    </span>
  );
}

export function RestrictedTag() {
  return (
    <span title="Restricted record — visible only to its owner/lead, reporter, creator and organisation admins"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4, color: 'var(--bb-danger)', border: '1px solid color-mix(in srgb, var(--bb-danger) 40%, transparent)' }}>
      <span aria-hidden>●</span> Restricted
    </span>
  );
}

export function Dim({ children }: { children: ReactNode }) {
  return <span style={{ color: 'var(--text-muted)' }}>{children}</span>;
}

export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} style={{ display: 'inline-flex', gap: 6 }}>
          {it.href ? <Link href={it.href} style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>{it.label}</Link> : <span>{it.label}</span>}
          {i < items.length - 1 && <span aria-hidden>/</span>}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div style={{ marginBottom: 6 }}>{eyebrow}</div>}
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{title}</h1>
        {subtitle && <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0', lineHeight: 1.5 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
    </div>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: CSSProperties; padded?: boolean }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: padded ? '18px 20px' : 0, overflow: padded ? undefined : 'hidden', ...style }}>
      {children}
    </div>
  );
}

export function Section({ title, count, actions, children, id }: { title: string; count?: number; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} style={{ marginBottom: 22 }} aria-labelledby={id ? `${id}-title` : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <h2 id={id ? `${id}-title` : undefined} style={{ fontSize: 14, fontWeight: 650, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {title}
          {typeof count === 'number' && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>{count}</span>}
        </h2>
        {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function KeyValues({ items, columns = 3 }: { items: { label: string; value: ReactNode }[]; columns?: number }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${columns >= 3 ? 180 : 220}px, 1fr))`, gap: '14px 20px', margin: 0 }}>
      {items.map(it => (
        <div key={it.label} style={{ minWidth: 0 }}>
          <dt style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>{it.label}</dt>
          <dd style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{it.value ?? <Dim>—</Dim>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--text-primary)', margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{children}</p>;
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ padding: '30px 20px', textAlign: 'center', border: `1px dashed ${BORDER}`, borderRadius: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
      {body && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.55, maxWidth: 520, marginInline: 'auto' }}>{body}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: AssuranceTone; children: ReactNode }) {
  const s = TONE_STYLE[tone];
  return (
    <div role="note" style={{ fontSize: 13, lineHeight: 1.55, padding: '10px 14px', borderRadius: 10, background: s.bg, color: 'var(--text-primary)', borderLeft: `3px solid ${s.color}` }}>
      {children}
    </div>
  );
}

// ── Tables ────────────────────────────────────────────────────────────────

export const th: CSSProperties = { padding: '11px 14px', textAlign: 'left', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' };
export const td: CSSProperties = { padding: '12px 14px', fontSize: 13, color: 'var(--text-secondary)', verticalAlign: 'top' };

export function DataTable({ headers, children, minWidth = 760, empty }: { headers: string[]; children: ReactNode; minWidth?: number; empty?: ReactNode }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
            {headers.map(h => <th key={h} scope="col" style={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {children}
          {empty && (
            <tr><td colSpan={headers.length} style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Row({ children, last }: { children: ReactNode; last?: boolean }) {
  return <tr style={{ borderBottom: last ? 'none' : `1px solid ${BORDER}` }}>{children}</tr>;
}

export function RecordLink({ href, reference, title }: { href: string; reference: string; title?: string | null }) {
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block', minWidth: 0 }}>
      <span style={{ fontFamily: 'var(--font-mono), ui-monospace, monospace', fontSize: 12, color: 'var(--brand-brainbase-accent)' }}>{reference}</span>
      {title && <span style={{ display: 'block', color: 'var(--text-primary)', fontSize: 13, fontWeight: 500, marginTop: 2 }}>{title}</span>}
    </Link>
  );
}

export function RefChip({ href, reference, kind }: { href: string; reference: string; kind?: string }) {
  return (
    <Link href={href} title={kind ? assuranceLabel(kind.toUpperCase()) : undefined}
      style={{ display: 'inline-block', fontFamily: 'var(--font-mono), ui-monospace, monospace', fontSize: 11, padding: '2px 6px', borderRadius: 4, border: `1px solid ${BORDER}`, color: 'var(--text-secondary)', textDecoration: 'none', marginRight: 4, marginBottom: 2, whiteSpace: 'nowrap' }}>
      {reference}
    </Link>
  );
}

export function DateCell({ value, withTime = false, overdue = false }: { value: string | Date | null | undefined; withTime?: boolean; overdue?: boolean }) {
  if (!value) return <Dim>—</Dim>;
  return (
    <span style={{ color: overdue ? 'var(--bb-danger)' : undefined, fontWeight: overdue ? 600 : undefined, whiteSpace: 'nowrap' }}>
      {withTime ? formatAssuranceDateTime(value) : formatAssuranceDate(value)}
      {overdue && <span style={{ fontSize: 11, marginLeft: 6 }}>Overdue</span>}
    </span>
  );
}

// ── Filters (plain GET form: server-side filtering, works without JS) ────

export type FilterField =
  | { kind: 'search'; name: string; placeholder: string; value?: string }
  | { kind: 'select'; name: string; label: string; value?: string; options: { value: string; label: string }[] }
  | { kind: 'date'; name: string; label: string; value?: string };

export function FilterBar({ fields, resetHref }: { fields: FilterField[]; resetHref: string }) {
  const control: CSSProperties = { padding: '8px 10px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, minHeight: 36 };
  return (
    <form method="get" role="search" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
      {fields.map(f => {
        if (f.kind === 'search') {
          return <input key={f.name} type="search" name={f.name} defaultValue={f.value ?? ''} placeholder={f.placeholder} aria-label={f.placeholder} style={{ ...control, minWidth: 220, flex: '1 1 220px' }} />;
        }
        if (f.kind === 'date') {
          return (
            <label key={f.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              {f.label}
              <input type="date" name={f.name} defaultValue={f.value ?? ''} style={control} />
            </label>
          );
        }
        return (
          <select key={f.name} name={f.name} defaultValue={f.value ?? ''} aria-label={f.label} style={control}>
            <option value="">{f.label}</option>
            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      })}
      <button type="submit" style={{ ...buttonStyle('secondary'), minHeight: 36 }}>Apply</button>
      <Link href={resetHref} style={{ fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'none', padding: '0 4px' }}>Reset</Link>
    </form>
  );
}

export function enumOptions(values: readonly string[]): { value: string; label: string }[] {
  return values.map(v => ({ value: v, label: assuranceLabel(v) }));
}

// ── Buttons / links ─────────────────────────────────────────────────────

export function buttonStyle(variant: 'primary' | 'secondary' | 'danger' = 'primary'): CSSProperties {
  const base: CSSProperties = { padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', lineHeight: 1.2 };
  if (variant === 'secondary') return { ...base, background: 'transparent', color: 'var(--text-primary)', border: `1px solid ${BORDER}` };
  if (variant === 'danger') return { ...base, background: 'transparent', color: 'var(--bb-danger)', border: '1px solid color-mix(in srgb, var(--bb-danger) 45%, transparent)' };
  return { ...base, background: 'var(--purple-600)', color: '#fff', border: '1px solid transparent' };
}

export function LinkButton({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' }) {
  return <Link href={href} style={buttonStyle(variant)}>{children}</Link>;
}

// ── Stat tile ───────────────────────────────────────────────────────────

export function StatTile({ label, value, href, tone = 'neutral', hint }: { label: string; value: number; href: string; tone?: AssuranceTone; hint?: string }) {
  const s = TONE_STYLE[tone];
  const emphasised = value > 0 && tone !== 'neutral';
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{ background: CARD, border: `1px solid ${emphasised ? `color-mix(in srgb, ${s.color} 45%, transparent)` : BORDER}`, borderRadius: 12, padding: '14px 16px', height: '100%' }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: emphasised ? s.color : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
      </div>
    </Link>
  );
}

// ── The assurance chain ─────────────────────────────────────────────────

export type ChainStep = { label: string; state: 'done' | 'current' | 'pending' | 'blocked' | 'na'; detail?: string };

/** Source → Finding → Action → Evidence → Verification → Closure, with per-step state. */
export function ChainStrip({ steps }: { steps: ChainStep[] }) {
  const color = (s: ChainStep['state']) =>
    s === 'done' ? 'var(--bb-success)' : s === 'current' ? 'var(--brand-brainbase-accent)' : s === 'blocked' ? 'var(--bb-warning)' : 'var(--text-muted)';
  return (
    <ol aria-label="Assurance chain" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'stretch' }}>
      {steps.map((s, i) => (
        <li key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ border: `1px solid color-mix(in srgb, ${color(s.state)} 50%, transparent)`, background: s.state === 'done' ? 'var(--bb-success-soft)' : 'transparent', borderRadius: 8, padding: '6px 10px', minWidth: 96 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: color(s.state), textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {s.state === 'done' ? '✓ ' : s.state === 'blocked' ? '! ' : ''}{s.label}
            </div>
            {s.detail && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{s.detail}</div>}
          </div>
          {i < steps.length - 1 && <span aria-hidden style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>}
        </li>
      ))}
    </ol>
  );
}

// ── History ─────────────────────────────────────────────────────────────

export function HistoryList({ entries }: { entries: { id: string; action: string; created_at: string | Date; user_name: string | null }[] }) {
  if (entries.length === 0) return <Dim>No recorded history yet.</Dim>;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {entries.map(e => (
        <li key={e.id} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: `1px solid ${BORDER}`, fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)', minWidth: 150, whiteSpace: 'nowrap' }}>{formatAssuranceDateTime(e.created_at)}</span>
          <span style={{ color: 'var(--text-primary)' }}>{describeAuditAction(e.action)}</span>
          <span style={{ color: 'var(--text-secondary)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{e.user_name ?? 'System'}</span>
        </li>
      ))}
    </ol>
  );
}

function describeAuditAction(action: string): string {
  const verb = action.split('.')[1] ?? action;
  return assuranceLabel(verb.toUpperCase());
}

// ── Access states ───────────────────────────────────────────────────────

export function AccessMessage({ status }: { status: 'not_enabled' | 'unavailable' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 10, textAlign: 'center', padding: 32 }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>
        {status === 'unavailable' ? 'Assurance is temporarily unavailable' : 'Assurance isn’t enabled for your organisation'}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 380 }}>
        {status === 'unavailable'
          ? 'We couldn’t confirm your organisation’s access right now. Please try again shortly.'
          : 'Ask a BrainBase admin to enable Assurance for your organisation.'}
      </div>
    </div>
  );
}
