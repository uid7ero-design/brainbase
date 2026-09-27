'use client';

import { useId, type ReactNode } from 'react';
import styles from './Field.module.css';

// Authenticated-app field shell (Phase A foundation). It owns only the
// label / helper / error presentation and their accessibility wiring; the
// caller renders its own control and keeps full ownership of value,
// onChange, validation and submission. Usage:
//
//   <Field label="Company name" required error={errors.name}>
//     {control => <input {...control} className={fieldControlClassName} value={v} onChange={…} />}
//   </Field>
//
// `control` provides id, aria-describedby and aria-invalid. Required is
// shown as visible text, never colour alone.

export type FieldControlProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
};

export type FieldProps = {
  label: ReactNode;
  children: (control: FieldControlProps) => ReactNode;
  helper?: ReactNode;
  /** Validation message. When present the control is marked invalid. */
  error?: ReactNode;
  /** Shows a visible "Required" marker. The caller still sets `required` on its control if wanted. */
  required?: boolean;
  /** Supply to keep an existing id (e.g. one tests or labels already target). */
  id?: string;
  className?: string;
};

export function Field({ label, children, helper, error, required, id, className }: FieldProps) {
  const generated = useId();
  const controlId = id ?? `${generated}-control`;
  const helperId = helper ? `${controlId}-helper` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={[styles.field, className ?? ''].join(' ').trim()} data-invalid={error ? 'true' : undefined}>
      <label htmlFor={controlId} className={styles.label}>
        <span>{label}</span>
        {required && <span className={styles.required}>Required</span>}
      </label>
      {children({
        id: controlId,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {helper && (
        <p id={helperId} className={styles.helper}>
          {helper}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Shared look for input / select / textarea inside a Field. */
export const fieldControlClassName = styles.control;

/**
 * Form action row. Primary action last. `align="stretch"` makes a lone
 * submit button fill the row (the drawer-form convention).
 */
export function FormActions({ children, align = 'end' }: { children: ReactNode; align?: 'end' | 'stretch' }) {
  return (
    <div className={styles.actions} data-align={align}>
      {children}
    </div>
  );
}

/** Form-level error announced to assistive tech. Field-specific errors belong on the Field. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p className={styles.formError} role="alert">
      {children}
    </p>
  );
}
