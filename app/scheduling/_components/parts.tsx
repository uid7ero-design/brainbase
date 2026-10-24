'use client';
import type { ReactNode } from 'react';
import { Button, FormError, StateMessage } from '@/components/ui/app';
import type { ApiProblem } from '@/lib/scheduling/dashboard/api';
import styles from './scheduling.module.css';

// Small shared pieces of the Scheduling dashboard: how a refusal is shown, how a failed load is shown, and the one list layout
// (a table on wide screens, cards on narrow) every screen uses.

/** A failed write inside a dialog. A stale write offers the way out (reload the latest); nothing was saved in any failure. */
export function ProblemNotice({ problem, onReload }: { problem: ApiProblem; onReload?: () => void }) {
  return (
    <FormError>
      <span className={problem.stale ? styles.staleBar : undefined}>
        <span>{problem.message}</span>
        {problem.stale && onReload && (
          <Button size="sm" variant="secondary" onClick={onReload}>
            Reload latest
          </Button>
        )}
      </span>
      {problem.problems.length > 0 && (
        <ul className={styles.problemList}>
          {problem.problems.map(p => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </FormError>
  );
}

/** Local validation problems from the form builders, shown the same way. */
export function ProblemsList({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <FormError>
      <span>Please fix the following.</span>
      <ul className={styles.problemList}>
        {problems.map(p => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </FormError>
  );
}

/** A screen-level load failure, with a retry. Access and set-up problems say what to do instead of offering a pointless retry. */
export function LoadError({ problem, onRetry }: { problem: ApiProblem; onRetry: () => void }) {
  if (problem.notConfigured) return <StateMessage kind="empty" size="page" title="Scheduling isn’t set up yet">{problem.message}</StateMessage>;
  if (problem.denied) return <StateMessage kind="error" size="page" title="You can’t view this">{problem.message}</StateMessage>;
  return (
    <StateMessage kind="error" size="page" title="We couldn’t load this" action={<Button onClick={onRetry}>Try again</Button>}>
      {problem.message}
    </StateMessage>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Shown as the label in the card layout (defaults to the header). */
  cardLabel?: string;
  /** The title cell: rendered as the card heading, not as a labelled field. */
  primary?: boolean;
}

/** The one list layout: a table from 640px up, a stack of cards below. Both carry the same cells and the same row actions. */
export function DataList<T extends { id: string }>({
  label,
  rows,
  columns,
  actions,
  archivedOf,
}: {
  label: string;
  rows: T[];
  columns: Column<T>[];
  actions?: (row: T) => ReactNode;
  archivedOf?: (row: T) => boolean;
}) {
  const primary = columns.find(c => c.primary) ?? columns[0];
  const rest = columns.filter(c => c !== primary);
  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label={label}>
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} scope="col">
                  {c.header}
                </th>
              ))}
              {actions && (
                <th scope="col">
                  <span className="bb-visually-hidden">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} data-archived={archivedOf?.(row) ? 'true' : undefined}>
                {columns.map(c => (
                  <td key={c.key} className={c === primary ? styles.name : undefined}>
                    {c.cell(row)}
                  </td>
                ))}
                {actions && <td className={styles.actions}>{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className={styles.cards} aria-label={label}>
        {rows.map(row => (
          <li key={row.id} className={styles.card} data-archived={archivedOf?.(row) ? 'true' : undefined}>
            <div className={styles.cardHead}>
              <span className={styles.name}>{primary.cell(row)}</span>
            </div>
            <dl className={styles.cardMeta}>
              {rest.map(c => (
                <div key={c.key}>
                  <dt>{c.cardLabel ?? c.header}</dt>
                  <dd>{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {actions && <div className={styles.actions}>{actions(row)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}

export function EmptyBlock({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty} role="status">
      <p className={styles.emptyTitle}>{title}</p>
      {children && <p className={styles.dim}>{children}</p>}
      {action}
    </div>
  );
}
