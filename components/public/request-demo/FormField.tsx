import { useId, type ReactNode } from 'react';
import styles from './requestDemo.module.css';

export type ControlProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-required'?: true;
  'aria-invalid'?: true;
};

/**
 * Label + control + helper, wired together: the <label> is associated via
 * htmlFor/id, the helper (and the form-level error while this field is
 * invalid) via aria-describedby. "Required" is visible text, not only an
 * asterisk or colour. Uses aria-required rather than the `required`
 * attribute so the page's existing JS validation and messages are
 * unchanged.
 */
export function FormField({
  label,
  required,
  helper,
  invalid,
  errorId,
  children,
}: {
  label: string;
  required?: boolean;
  helper?: string;
  /** Field is currently failing the form's validation. */
  invalid?: boolean;
  /** id of the form-level error message to associate while invalid. */
  errorId?: string;
  /** Receives the props to spread onto the actual form control. */
  children: (control: ControlProps) => ReactNode;
}) {
  const id = useId();
  const controlId = `${id}-control`;
  const helperId = helper ? `${id}-helper` : undefined;
  const describedBy = [helperId, invalid ? errorId : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={controlId} className={styles.label}>
        <span>{label}</span>
        {required && <span className={styles.requiredTag}>Required</span>}
      </label>
      {children({
        id: controlId,
        'aria-describedby': describedBy,
        ...(required ? { 'aria-required': true as const } : {}),
        ...(invalid ? { 'aria-invalid': true as const } : {}),
      })}
      {helper && (
        <p id={helperId} className={styles.helper}>
          {helper}
        </p>
      )}
    </div>
  );
}

/** Wraps a native <select> with a token-coloured decorative chevron. */
export function SelectShell({ children }: { children: ReactNode }) {
  return (
    <span className={styles.selectShell}>
      {children}
      <svg
        className={styles.chevron}
        viewBox="0 0 12 8"
        width="12"
        height="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M1 1l5 5 5-5" />
      </svg>
    </span>
  );
}
