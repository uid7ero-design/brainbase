import type { SemanticState } from './types';
import { CloseIcon } from './StateIcon';
import styles from './semantic.module.css';

export type SemanticAction = {
  label: string;
  /** Optional fuller accessible name when the visible label is terse. */
  accessibleLabel?: string;
  onClick?: () => void;
  href?: string;
  primary?: boolean;
};

export function SemanticActions({ actions }: { actions?: SemanticAction[] }) {
  if (!actions || actions.length === 0) return null;
  return (
    <div className={styles.actions}>
      {actions.map(action =>
        action.href ? (
          <a
            key={action.label}
            href={action.href}
            className={action.primary ? styles.actionPrimary : styles.action}
            aria-label={action.accessibleLabel}
          >
            {action.label}
          </a>
        ) : (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className={action.primary ? styles.actionPrimary : styles.action}
            aria-label={action.accessibleLabel}
          >
            {action.label}
          </button>
        ),
      )}
    </div>
  );
}

export function DismissButton({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label={label}>
      <CloseIcon />
    </button>
  );
}

/**
 * role="alert" / assertive is reserved for real critical errors. Any other
 * state asking for it is downgraded to a polite status announcement.
 */
export function resolveUrgentRole(state: SemanticState, wantsAssertive: boolean): 'alert' | 'status' {
  if (wantsAssertive && state === 'error') return 'alert';
  if (wantsAssertive && process.env.NODE_ENV !== 'production') {
    console.warn(
      `[semantic] Assertive announcement requested for state "${state}" — only "error" may interrupt. Using polite status instead.`,
    );
  }
  return 'status';
}
