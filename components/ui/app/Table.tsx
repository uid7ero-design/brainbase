import type { ReactNode } from 'react';
import styles from './Table.module.css';

// Authenticated-app table contract (Phase C). A shared VISUAL contract, not
// a data-grid: callers keep their own <table> markup, rows, sorting,
// filtering and pagination. Apply `tableStyles.table` to the <table> and
// wrap it in <TableContainer> so wide tables scroll inside their own
// border instead of widening the page.
//
//   <TableContainer label="Companies">
//     <table className={tableStyles.table}>
//       <thead><tr><th scope="col">Company</th><th scope="col" className={tableStyles.num}>Deals</th></tr></thead>
//       <tbody>
//         <TableStateRow colSpan={2} kind="loading">Loading companies…</TableStateRow>
//         <tr><td className={tableStyles.primary}>Acme</td><td className={tableStyles.num}>3</td></tr>
//       </tbody>
//     </table>
//   </TableContainer>
//
// Density: 32px header, ~40px rows, 13px body text. Numbers right-aligned
// with tabular figures (`num`). Row hover and `aria-selected="true"` rows
// are styled by the contract; nothing about them is behavioural.

export const tableStyles = {
  /** Apply to <table>. */
  table: styles.table,
  /** Numeric / currency cell or header: right-aligned, tabular figures. */
  num: styles.num,
  /** The row's identifying cell (name, number). */
  primary: styles.primary,
  /** Secondary line inside a cell (e.g. a website under a company name). */
  meta: styles.meta,
  /** Trailing actions cell: right-aligned, no wrapping. */
  actions: styles.actions,
  /** A text link inside a cell (row "View" / "Open" actions). */
  link: styles.link,
  /** Muted placeholder value such as "—". */
  muted: styles.muted,
} as const;

export type TableContainerProps = {
  /** Accessible name for the scrollable region, e.g. "Companies". */
  label: string;
  children: ReactNode;
  /** Minimum table width before horizontal scrolling starts (default 640). */
  minWidth?: number;
  className?: string;
};

/**
 * Bordered surface + horizontal overflow. Focusable so keyboard users can
 * scroll a table that is wider than the viewport.
 */
export function TableContainer({ label, children, minWidth = 640, className }: TableContainerProps) {
  return (
    <div
      className={[styles.container, className ?? ''].join(' ').trim()}
      role="region"
      aria-label={label}
      tabIndex={0}
      style={{ ['--table-min-width' as string]: `${minWidth}px` }}
    >
      {children}
    </div>
  );
}

export type TableStateRowProps = {
  colSpan: number;
  kind: 'loading' | 'empty' | 'error';
  children: ReactNode;
  /** Optional action for empty / error rows (e.g. "Add company", "Retry"). */
  action?: ReactNode;
};

/**
 * Loading, empty and error states rendered inside the table body, so the
 * header stays in place and the layout does not jump. Loading is a polite
 * status, error an alert; empty is plain text.
 */
export function TableStateRow({ colSpan, kind, children, action }: TableStateRowProps) {
  const liveProps =
    kind === 'loading'
      ? ({ role: 'status', 'aria-live': 'polite' } as const)
      : kind === 'error'
        ? ({ role: 'alert' } as const)
        : {};
  return (
    <tr className={styles.stateRow} data-kind={kind}>
      <td colSpan={colSpan}>
        <div className={styles.state} {...liveProps}>
          <span>{children}</span>
          {action && <span className={styles.stateAction}>{action}</span>}
        </div>
      </td>
    </tr>
  );
}
