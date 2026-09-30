'use client';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/app';
import AssuranceForm, { type FormField } from './AssuranceForm';
import styles from './assurance.module.css';

// A disclosure button that reveals either an inline form (when fields are
// supplied) or performs a one-click POST. With `confirm`, a one-click
// action first reveals the confirmation text and an explicit confirm
// button (for consequential switches such as deactivating a template).
// Used for lifecycle steps on detail pages. Server enforcement is
// authoritative; the page only renders the actions the server says are
// currently valid.

type Props = {
  label: string;
  endpoint: string;
  fields?: FormField[];
  extraBody?: Record<string, unknown>;
  submitLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  description?: ReactNode;
  redirectTo?: string;
  /** One-click actions only: require an explicit confirmation step showing this text. */
  confirm?: ReactNode;
};

export default function ActionPanel({ label, endpoint, fields, extraBody, submitLabel, variant = 'secondary', description, redirectTo, confirm }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function oneClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extraBody ?? {}) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Something went wrong.'); return; }
      if (redirectTo) router.push(redirectTo); else router.refresh();
    } catch {
      setError('Network error. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  if ((!fields || fields.length === 0) && confirm) {
    return (
      <div style={{ width: open ? '100%' : undefined }}>
        <Button variant={open ? 'ghost' : variant} aria-expanded={open} onClick={() => { setOpen(o => !o); setError(null); }}>{open ? 'Cancel' : label}</Button>
        {open && (
          <div className={styles.disclosure} role="group" aria-label={`Confirm: ${label}`}>
            <div className={styles.disclosureText}>{confirm}</div>
            <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={oneClick} disabled={busy} aria-busy={busy || undefined}>
              {busy ? 'Working…' : submitLabel ?? `Confirm — ${label.toLowerCase()}`}
            </Button>
            {error && <span role="alert" className={styles.actionError} style={{ display: 'block', marginTop: 8 }}>{error}</span>}
          </div>
        )}
      </div>
    );
  }

  if (!fields || fields.length === 0) {
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
        <Button variant={variant} onClick={oneClick} disabled={busy} aria-busy={busy || undefined}>{busy ? 'Working…' : label}</Button>
        {error && <span role="alert" className={styles.actionError}>{error}</span>}
      </span>
    );
  }

  return (
    <div style={{ width: open ? '100%' : undefined }}>
      <Button variant={open ? 'ghost' : variant} aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Cancel' : label}</Button>
      {open && (
        <div className={styles.disclosure}>
          {description && <div className={styles.disclosureText}>{description}</div>}
          <AssuranceForm endpoint={endpoint} fields={fields} extraBody={extraBody} submitLabel={submitLabel ?? label} compact
            danger={variant === 'danger'} redirectTo={redirectTo} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
