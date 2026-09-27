import type { CSSProperties, ReactNode } from 'react';
import styles from './Metric.module.css';

// Compact metric strip (Phase D1) — operational state at a glance without
// a gallery of cards: ONE bordered surface, cells divided by hairlines,
// label → value → optional sub-line. Values use tabular figures; colour is
// only applied when a value carries a semantic state (e.g. capacity full),
// never as decoration. Rendered as a description list so each value is
// paired with its label for assistive tech.
//
//   <MetricStrip>
//     <Metric label="Orders" value={12} />
//     <Metric label="Remaining" value={0} tone="danger" sub="100% booked" />
//   </MetricStrip>
//
// Phase D2 extensions (Dashboard / Command), still one component:
//   change — a compact change line (e.g. "▲ 3.2% vs last week"). Direction
//            is drawn as a glyph AND written in the label, and its tone is
//            set independently of direction (a rise can be bad), so the
//            meaning never depends on colour alone.
//   visual — an optional decorative trend graphic (e.g. a sparkline) laid
//            out beside the value; hidden from assistive tech because the
//            value and change line already carry the information.

export type MetricTone = 'success' | 'warning' | 'danger' | 'info';

export function MetricStrip({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <dl className={styles.strip} style={style}>
      {children}
    </dl>
  );
}

export type MetricChange = {
  label: ReactNode;
  direction?: 'up' | 'down' | 'flat';
  /** Semantic meaning of the change (independent of direction). */
  tone?: MetricTone;
};

const CHANGE_GLYPH = { up: '▲', down: '▼', flat: '–' } as const;

export type MetricProps = {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: MetricTone;
  /** Value not yet known: renders a neutral placeholder and marks the cell busy. */
  loading?: boolean;
  change?: MetricChange;
  visual?: ReactNode;
};

export function Metric({ label, value, sub, tone, loading = false, change, visual }: MetricProps) {
  return (
    <div className={styles.metric} aria-busy={loading || undefined}>
      <dt className={styles.label}>{label}</dt>
      {visual && !loading ? (
        // The row itself is the <dd> (a <dl> group may only hold dt/dd).
        <dd className={styles.valueRow}>
          <span className={styles.value} data-tone={tone}>{value}</span>
          <span className={styles.visual} aria-hidden="true">{visual}</span>
        </dd>
      ) : (
        <dd className={styles.value} data-tone={loading ? undefined : tone}>
          {loading ? <span className={styles.placeholder}>—</span> : value}
        </dd>
      )}
      {change && !loading && (
        <dd className={styles.change} data-tone={change.tone}>
          {change.direction && <span aria-hidden="true">{CHANGE_GLYPH[change.direction]} </span>}
          {change.label}
        </dd>
      )}
      {sub && !loading && <dd className={styles.sub}>{sub}</dd>}
    </div>
  );
}
