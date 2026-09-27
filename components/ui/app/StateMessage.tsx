import type { ReactNode } from 'react';
import styles from './StateMessage.module.css';

// Authenticated-app empty / loading / error message (Phase C), for states
// that replace a whole region or page (a detail page loading, a record not
// found, a section with nothing in it). For states inside a table body use
// TableStateRow instead so the header stays put.
//
// Deliberately small: a short title, optional one-line body, optional
// action. No illustration, no card. Error is semantic (danger colour and
// role="alert"); loading is a polite status; empty is plain content.

export type StateMessageProps = {
  kind: 'empty' | 'loading' | 'error';
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** 'page' centres the message in a taller block; 'inline' is compact. */
  size?: 'page' | 'inline';
  className?: string;
};

export function StateMessage({ kind, title, children, action, size = 'inline', className }: StateMessageProps) {
  const liveProps =
    kind === 'loading'
      ? ({ role: 'status', 'aria-live': 'polite' } as const)
      : kind === 'error'
        ? ({ role: 'alert' } as const)
        : {};
  return (
    <div
      className={[styles.message, className ?? ''].join(' ').trim()}
      data-kind={kind}
      data-size={size}
      {...liveProps}
    >
      <p className={styles.title}>{title}</p>
      {children && <p className={styles.body}>{children}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
