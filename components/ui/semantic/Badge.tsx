import type { ReactNode } from 'react';
import type { SemanticState } from './types';
import { SEMANTIC_STATE_LABELS } from './types';
import styles from './semantic.module.css';

export type BadgeProps = {
  state: SemanticState;
  /** Visible badge text, e.g. "Connected", "In development", "Read-only". */
  children?: ReactNode;
  /** Show the decorative state dot (default true). */
  dot?: boolean;
  /**
   * Announce changes politely — only for a badge whose state changes while
   * the page is open (e.g. a syncing badge). Static badges are never live.
   */
  announce?: boolean;
  className?: string;
};

/** Compact semantic metadata. */
export function Badge({ state, children, dot = true, announce = false, className }: BadgeProps) {
  return (
    <span
      className={[styles.badge, styles.stateful, 'bb-semantic', className ?? ''].join(' ').trim()}
      data-state={state}
      {...(announce ? { role: 'status', 'aria-live': 'polite' as const, 'aria-atomic': true } : {})}
    >
      {dot && <span className={styles.dot} data-shape={state} aria-hidden="true" data-decorative="true" />}
      <span>{children ?? SEMANTIC_STATE_LABELS[state]}</span>
    </span>
  );
}
