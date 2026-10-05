// Assurance presentational primitives, built on the shared BrainBase
// authenticated-app system (components/ui/app + components/ui/semantic).
// Server-safe (no hooks); only imports the zero-import domain module.
// Where BrainBase has an equivalent (PageHeader, Panel, table contract,
// WorkToolbar, StateMessage, Button, semantic Badge) this file delegates
// to it and only adapts Assurance's vocabulary (tones, record references).
// Assurance-only pieces (the chain, history, key/values) use tokens via
// assurance.module.css.
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Badge as SemanticBadge,
  Button,
  PageHeader as AppPageHeader,
  Panel,
  StateMessage,
  TableContainer,
  TableStateRow,
  ToolbarSearch,
  WorkToolbar,
  buttonProps,
  tableStyles,
  toolbarControlClassName,
  type SemanticState,
} from '@/components/ui/app';
import { assuranceLabel, assuranceTone, formatAssuranceDate, formatAssuranceDateTime, type AssuranceTone } from '@/lib/assurance/domain';
import { HELP_TOPICS, type HelpTopic } from '@/lib/assurance/help/topics';
import { helpHref } from '@/lib/assurance/help/registry';
import styles from './assurance.module.css';

export { styles as assuranceStyles, tableStyles };

// Assurance tone → shared semantic state. Colour is never the only
// carrier: the semantic Badge always pairs it with text and a dot shape.
const TONE_STATE: Record<AssuranceTone, SemanticState> = {
  neutral: 'inactive',
  info: 'info',
  warning: 'warning',
  danger: 'error',
  success: 'success',
  accent: 'active',
};

export function Badge({ value, tone, label }: { value: string | null | undefined; tone?: AssuranceTone; label?: string }) {
  if (!value) return <Dim>—</Dim>;
  return <SemanticBadge state={TONE_STATE[tone ?? assuranceTone(value)]}>{label ?? assuranceLabel(value)}</SemanticBadge>;
}

export function RestrictedTag() {
  return (
    <span title="Restricted record — visible only to its owner/lead, reporter, creator and organisation admins">
      <SemanticBadge state="warning">Restricted</SemanticBadge>
    </span>
  );
}

export function Dim({ children }: { children: ReactNode }) {
  return <span className={styles.dim}>{children}</span>;
}

export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} style={{ display: 'inline-flex', gap: 6 }}>
          {it.href ? <Link href={it.href}>{it.label}</Link> : <span>{it.label}</span>}
          {i < items.length - 1 && <span aria-hidden>/</span>}
        </span>
      ))}
    </nav>
  );
}

/**
 * The shared BrainBase page header; `subtitle` maps to its description line.
 * `help` adds a contextual link to the most relevant in-app Help page.
 */
export function PageHeader({ title, subtitle, actions, eyebrow, meta, help }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; meta?: ReactNode; help?: HelpTopic }) {
  const all = help ? <>{actions}<HelpLink topic={help} /></> : actions;
  return <AppPageHeader title={title} description={subtitle} actions={all} eyebrow={eyebrow} meta={meta} />;
}

/** Contextual Help link (allow-listed target from lib/assurance/help/topics.ts). */
export function HelpLink({ topic }: { topic: HelpTopic }) {
  const t = HELP_TOPICS[topic];
  return (
    <Link href={helpHref(t.slug, t.anchor)} {...buttonProps('ghost', 'sm')} aria-label={`Help: ${t.label}`} title={`Help: ${t.label}`}>
      <span aria-hidden="true">?</span> Help
    </Link>
  );
}

/** A shared BrainBase surface. `padded={false}` for edge-to-edge lists. */
export function Card({ children, padded = true, title, actions }: { children: ReactNode; padded?: boolean; title?: ReactNode; actions?: ReactNode }) {
  return <Panel title={title} actions={actions} padding={padded ? 'md' : 'none'}>{children}</Panel>;
}

/** A titled region: typography, not a box — its content supplies the surface. */
export function Section({ title, count, actions, children, id }: { title: string; count?: number; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={styles.section} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className={styles.sectionHeader}>
        <h2 id={id ? `${id}-title` : undefined} className={styles.sectionTitle}>
          {title}
          {typeof count === 'number' && <span className={styles.sectionCount}>{count}</span>}
        </h2>
        {actions && <div className={styles.sectionActions}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function KeyValues({ items, columns = 3 }: { items: { label: string; value: ReactNode }[]; columns?: number }) {
  return (
    <dl className={styles.kv} style={{ ['--kv-min' as string]: `${columns >= 3 ? 180 : 220}px` }}>
      {items.map(it => (
        <div key={it.label}>
          <dt>{it.label}</dt>
          <dd>{it.value ?? <Dim>—</Dim>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return <p className={styles.prose}>{children}</p>;
}

/** Whole-region empty state (the shared StateMessage). */
export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <Panel>
      <StateMessage kind="empty" title={title} action={action} size="page">{body}</StateMessage>
    </Panel>
  );
}

export function Notice({ tone = 'info', children }: { tone?: AssuranceTone; children: ReactNode }) {
  return <div role="note" className={styles.notice} data-tone={tone}>{children}</div>;
}

// ── Tables (shared BrainBase table contract) ──────────────────────────────

/** Cell style kept for call sites; the shared table contract owns padding and colour. */
export const td = { verticalAlign: 'top' } as const;

export function DataTable({ headers, children, minWidth = 760, empty, label }: { headers: string[]; children: ReactNode; minWidth?: number; empty?: ReactNode; label?: string }) {
  return (
    <TableContainer label={label ?? (headers.filter(Boolean).join(', ') || 'Records')} minWidth={minWidth}>
      <table className={tableStyles.table}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={`${h}-${i}`} scope="col" className={h ? undefined : tableStyles.actions}>
                {h || <span className="bb-visually-hidden">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
          {empty && <TableStateRow colSpan={headers.length} kind="empty">{empty}</TableStateRow>}
        </tbody>
      </table>
    </TableContainer>
  );
}

// `last` is accepted for call-site compatibility; the table contract draws row rules.
export function Row({ children }: { children: ReactNode; last?: boolean }) {
  return <tr>{children}</tr>;
}

export function RecordLink({ href, reference, title }: { href: string; reference: string; title?: string | null }) {
  return (
    <Link href={href} className={styles.recordLink}>
      <span className={styles.recordRef}>{reference}</span>
      {title && <span className={styles.recordTitle}>{title}</span>}
    </Link>
  );
}

export function RefChip({ href, reference, kind }: { href: string; reference: string; kind?: string }) {
  return (
    <Link href={href} title={kind ? assuranceLabel(kind.toUpperCase()) : undefined} className={styles.refChip}>
      {reference}
    </Link>
  );
}

export function DateCell({ value, withTime = false, overdue = false, timeZone }: { value: string | Date | null | undefined; withTime?: boolean; overdue?: boolean; timeZone?: string }) {
  if (!value) return <Dim>—</Dim>;
  return (
    <span className={styles.date} data-overdue={overdue || undefined}>
      {withTime ? formatAssuranceDateTime(value, timeZone) : formatAssuranceDate(value, timeZone)}
      {overdue && <span className={styles.overdueTag}>Overdue</span>}
    </span>
  );
}

// ── Filters (plain GET form: server-side filtering, works without JS) ────

export type FilterField =
  | { kind: 'search'; name: string; placeholder: string; value?: string }
  | { kind: 'select'; name: string; label: string; value?: string; options: { value: string; label: string }[] }
  | { kind: 'date'; name: string; label: string; value?: string }
  /** Carries a value (e.g. the selected view tab) through Apply; omitted when empty. */
  | { kind: 'hidden'; name: string; value?: string };

export function FilterBar({ fields, resetHref, count }: { fields: FilterField[]; resetHref: string; count?: ReactNode }) {
  return (
    <form method="get" role="search" className={styles.filterForm}>
      <WorkToolbar
        count={count}
        actions={
          <>
            <Button type="submit" size="sm">Apply</Button>
            <Link href={resetHref} {...buttonProps('ghost', 'sm')}>Reset</Link>
          </>
        }
      >
        {fields.map(f => {
          if (f.kind === 'search') {
            return <ToolbarSearch key={f.name} name={f.name} defaultValue={f.value ?? ''} placeholder={f.placeholder} label={f.placeholder} />;
          }
          if (f.kind === 'hidden') {
            return f.value ? <input key={f.name} type="hidden" name={f.name} value={f.value} /> : null;
          }
          if (f.kind === 'date') {
            return (
              <label key={f.name} className={styles.filterLabel}>
                {f.label}
                <input type="date" name={f.name} defaultValue={f.value ?? ''} className={toolbarControlClassName} />
              </label>
            );
          }
          return (
            <select key={f.name} name={f.name} defaultValue={f.value ?? ''} aria-label={f.label} className={toolbarControlClassName}>
              <option value="">{f.label}</option>
              {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          );
        })}
      </WorkToolbar>
    </form>
  );
}

export function enumOptions(values: readonly string[]): { value: string; label: string }[] {
  return values.map(v => ({ value: v, label: assuranceLabel(v) }));
}

// ── Buttons / links (shared BrainBase button contract) ───────────────────

export function LinkButton({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' }) {
  return <Link href={href} {...buttonProps(variant)}>{children}</Link>;
}

// ── The assurance chain ─────────────────────────────────────────────────

export type ChainStep = { label: string; state: 'done' | 'current' | 'pending' | 'blocked' | 'na'; detail?: string };

/** Source → Finding → Action → Evidence → Verification → Closure, with per-step state. */
export function ChainStrip({ steps }: { steps: ChainStep[] }) {
  return (
    <ol aria-label="Assurance chain" className={styles.chain}>
      {steps.map((s, i) => (
        <li key={s.label} className={styles.chainItem}>
          <div className={styles.chainStep} data-state={s.state}>
            <div className={styles.chainLabel}>
              {s.state === 'done' ? '✓ ' : s.state === 'blocked' ? '! ' : ''}{s.label}
            </div>
            {s.detail && <div className={styles.chainDetail}>{s.detail}</div>}
          </div>
          {i < steps.length - 1 && <span aria-hidden className={styles.chainArrow}>→</span>}
        </li>
      ))}
    </ol>
  );
}

// ── History ─────────────────────────────────────────────────────────────

/** `label` overrides the verb-only description (for histories spanning several record kinds); `timeZone` defaults to the server's. */
export function HistoryList({ entries, timeZone }: { entries: { id: string; action: string; created_at: string | Date; user_name: string | null; after_state?: unknown; label?: string }[]; timeZone?: string }) {
  if (entries.length === 0) return <Dim>No recorded history yet.</Dim>;
  return (
    <ol className={styles.history}>
      {entries.map(e => {
        const reason = historyReason(e.after_state);
        return (
          <li key={e.id}>
            <span className={styles.historyWhen}>{formatAssuranceDateTime(e.created_at, timeZone)}</span>
            <span className={styles.historyWhat}>{e.label ?? describeAuditAction(e.action)}</span>
            <span className={styles.historyWho}>{e.user_name ?? 'System'}</span>
            {reason && <span className={styles.historyReason}>Reason: {reason}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** A cancellation reason recorded in the audit row (actions, audits, inspections). */
function historyReason(afterState: unknown): string | null {
  if (!afterState || typeof afterState !== 'object') return null;
  const r = (afterState as Record<string, unknown>).reason;
  return typeof r === 'string' && r.trim() ? r : null;
}

function describeAuditAction(action: string): string {
  const verb = action.split('.')[1] ?? action;
  return assuranceLabel(verb.toUpperCase());
}

// ── Access states ───────────────────────────────────────────────────────

export function AccessMessage({ status }: { status: 'not_enabled' | 'unavailable' }) {
  return (
    <StateMessage
      kind={status === 'unavailable' ? 'error' : 'empty'}
      size="page"
      title={status === 'unavailable' ? 'Assurance is temporarily unavailable' : 'Assurance isn’t enabled for your organisation'}
    >
      {status === 'unavailable'
        ? 'We couldn’t confirm your organisation’s access right now. Please try again shortly.'
        : 'Ask a BrainBase admin to enable Assurance for your organisation.'}
    </StateMessage>
  );
}
