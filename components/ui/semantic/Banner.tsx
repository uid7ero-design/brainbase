'use client';

import { useId, type ReactNode } from 'react';
import type { Politeness, SemanticState } from './types';
import { StateIcon } from './StateIcon';
import { DismissButton, SemanticActions, resolveUrgentRole, type SemanticAction } from './actions';
import styles from './semantic.module.css';

export type BannerProps = {
  state: SemanticState;
  /** Short visible heading, e.g. "Import complete", "Sources need attention". */
  title: string;
  /** Optional supporting text. */
  children?: ReactNode;
  actions?: SemanticAction[];
  onDismiss?: () => void;
  /** Accessible name for the dismiss button. Defaults to "Dismiss: {title}". */
  dismissLabel?: string;
  /**
   * How the banner is announced when it appears dynamically.
   *  - false (default): static page information, not a live region.
   *  - 'polite': routine update, role="status".
   *  - 'assertive': critical failure only — honoured for state "error".
   */
  announce?: Politeness | false;
  className?: string;
};

/** Page- or context-level information. */
export function Banner({
  state,
  title,
  children,
  actions,
  onDismiss,
  dismissLabel,
  announce = false,
  className,
}: BannerProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;

  const role = announce ? resolveUrgentRole(state, announce === 'assertive') : undefined;
  const Tag = role ? 'div' : 'section';

  return (
    <Tag
      className={[styles.banner, styles.stateful, 'bb-semantic', className ?? ''].join(' ').trim()}
      data-state={state}
      role={role}
      aria-live={role ? (role === 'alert' ? 'assertive' : 'polite') : undefined}
      aria-labelledby={titleId}
      aria-describedby={children ? descId : undefined}
    >
      <StateIcon state={state} className={styles.bannerIcon} />
      <div className={styles.body}>
        <p id={titleId} className={styles.title}>
          {title}
        </p>
        {children && (
          <div id={descId} className={styles.description}>
            {children}
          </div>
        )}
        <SemanticActions actions={actions} />
      </div>
      {onDismiss && <DismissButton label={dismissLabel ?? `Dismiss: ${title}`} onDismiss={onDismiss} />}
    </Tag>
  );
}
