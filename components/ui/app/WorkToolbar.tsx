'use client';

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './WorkToolbar.module.css';

// Authenticated-app filter / action bar (Phase C). A flat, wrapping row —
// not a floating card — for the search box, filters, result count and
// page actions that sit above a table or list. It owns no state: search
// and filter values, and what they do, stay with the caller.
//
//   <WorkToolbar
//     count="12 of 40"
//     actions={<Button variant="primary">Add company</Button>}
//   >
//     <ToolbarSearch label="Search companies" value={q} onChange={e => setQ(e.target.value)} />
//     <select className={toolbarControlClassName} aria-label="Status" …/>
//   </WorkToolbar>
//
// Controls come first, the count sits after them, actions are pushed to
// the end so the primary action stays in a predictable place and wraps
// onto its own line on narrow screens.

export type WorkToolbarProps = {
  /** Search box, filter selects, toggles. */
  children?: ReactNode;
  /** Result metadata, e.g. "12 results". Announced politely when it changes. */
  count?: ReactNode;
  /** Page / bulk actions, right-aligned. */
  actions?: ReactNode;
  className?: string;
};

export function WorkToolbar({ children, count, actions, className }: WorkToolbarProps) {
  return (
    <div className={[styles.toolbar, className ?? ''].join(' ').trim()}>
      {children && <div className={styles.controls}>{children}</div>}
      {count !== undefined && count !== null && (
        <p className={styles.count} role="status" aria-live="polite">
          {count}
        </p>
      )}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

export type ToolbarSearchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Accessible name. Rendered visually hidden; the placeholder is not a label. */
  label: string;
};

/** Search input with a real (visually hidden) label. Value and handlers pass straight through. */
export function ToolbarSearch({ label, id, className, placeholder = 'Search…', ...rest }: ToolbarSearchProps) {
  const generated = useId();
  const inputId = id ?? `${generated}-search`;
  return (
    <div className={styles.search}>
      <label htmlFor={inputId} className={styles.visuallyHidden}>
        {label}
      </label>
      <input
        id={inputId}
        type="search"
        placeholder={placeholder}
        className={[styles.control, styles.searchInput, className ?? ''].join(' ').trim()}
        {...rest}
      />
    </div>
  );
}

/** Compact control look for filter selects and inputs placed in a WorkToolbar. */
export const toolbarControlClassName = styles.control;
