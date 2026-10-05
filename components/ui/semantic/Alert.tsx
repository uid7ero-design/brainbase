'use client';

import { useId, type ReactNode } from 'react';
import type { SemanticState } from './types';
import { StateIcon } from './StateIcon';
import { DismissButton, SemanticActions, resolveUrgentRole, type SemanticAction } from './actions';
import styles from './semantic.module.css';

export type AlertUrgency = 'static' | 'polite' | 'critical';

export type AlertProps = {
  state?: SemanticState;
  /** Names the condition. Wired to the alert via aria-labelledby. */
  title: string;
  /** Explains the condition and what to do. Wired via aria-describedby. */
  children: ReactNode;
  actions?: SemanticAction[];
  onDismiss?: () => void;
  /** Accessible name for the dismiss button. Defaults to "Dismiss: {title}". */
  dismissLabel?: string;
  /**
   *  - 'static' (default): rendered with the page; role="group", no announcement.
   *  - 'polite': appeared in response to something; role="status".
   *  - 'critical': a real critical error; role="alert". Only honoured for
   *    state "error" — anything else is downgraded to polite.
   */
  urgency?: AlertUrgency;
  className?: string;
};

/** A stronger condition that needs explanation or action. */
export function Alert({
  state = 'error',
  title,
  children,
  actions,
  onDismiss,
  dismissLabel,
  urgency = 'static',
  className,
}: AlertProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;

  const role = urgency === 'static' ? 'group' : resolveUrgentRole(state, urgency === 'critical');

  return (
    <div
      className={[styles.alert, styles.stateful, 'bb-semantic', className ?? ''].join(' ').trim()}
      data-state={state}
      role={role}
      aria-live={role === 'alert' ? 'assertive' : role === 'status' ? 'polite' : undefined}
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div className={styles.alertHead}>
        <StateIcon state={state} className={styles.bannerIcon} />
        <p id={titleId} className={styles.title}>
          {title}
        </p>
        {onDismiss && <DismissButton label={dismissLabel ?? `Dismiss: ${title}`} onDismiss={onDismiss} />}
      </div>
      <div id={descId} className={styles.description}>
        {children}
      </div>
      <SemanticActions actions={actions} />
    </div>
  );
}
