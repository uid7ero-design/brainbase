import type { SemanticState } from './types';
import { SEMANTIC_STATE_LABELS } from './types';
import styles from './semantic.module.css';

export type StatusDotProps = {
  state: SemanticState;
  /** Visible text naming the state. Defaults to the state's standard label. */
  label?: string;
  /**
   * Announce changes politely. Off by default: a static status is metadata,
   * not a live region. Turn on only where the status changes while the
   * page is open (e.g. a connection indicator).
   */
  announce?: boolean;
  className?: string;
};

/**
 * Lowest-emphasis state indicator: a small shaped dot plus visible text.
 * The dot is decorative (its shape and colour repeat what the text says),
 * so it is hidden from assistive technology.
 */
export function StatusDot({ state, label, announce = false, className }: StatusDotProps) {
  const text = label ?? SEMANTIC_STATE_LABELS[state];
  return (
    <span
      className={[styles.statusDot, styles.stateful, 'bb-semantic', className ?? ''].join(' ').trim()}
      data-state={state}
      {...(announce ? { role: 'status', 'aria-live': 'polite' as const, 'aria-atomic': true } : {})}
    >
      <span className={styles.dot} data-shape={state} aria-hidden="true" data-decorative="true" />
      <span className={styles.statusDotLabel}>{text}</span>
    </span>
  );
}
