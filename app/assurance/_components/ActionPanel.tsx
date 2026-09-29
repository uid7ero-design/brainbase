'use client';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import AssuranceForm, { type FormField } from './AssuranceForm';

// A disclosure button that reveals either an inline form (when fields are
// supplied) or performs a one-click POST. Used for lifecycle steps on
// detail pages. Server enforcement is authoritative; the page only
// renders the actions the server says are currently valid.

type Props = {
  label: string;
  endpoint: string;
  fields?: FormField[];
  extraBody?: Record<string, unknown>;
  submitLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  description?: ReactNode;
  redirectTo?: string;
};

export default function ActionPanel({ label, endpoint, fields, extraBody, submitLabel, variant = 'secondary', description, redirectTo }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const style = {
    padding: '7px 13px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    background: variant === 'primary' ? 'var(--purple-600)' : 'transparent',
    color: variant === 'primary' ? '#fff' : variant === 'danger' ? 'var(--bb-danger)' : 'var(--text-primary)',
    border: variant === 'primary' ? '1px solid transparent' : variant === 'danger'
      ? '1px solid color-mix(in srgb, var(--bb-danger) 45%, transparent)' : '1px solid var(--border)',
  } as const;

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

  if (!fields || fields.length === 0) {
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
        <button type="button" onClick={oneClick} disabled={busy} style={{ ...style, opacity: busy ? 0.7 : 1 }}>{busy ? 'Working…' : label}</button>
        {error && <span role="alert" style={{ fontSize: 12, color: 'var(--bb-danger)', maxWidth: 320 }}>{error}</span>}
      </span>
    );
  }

  return (
    <div style={{ width: open ? '100%' : undefined }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} style={style}>{open ? 'Cancel' : label}</button>
      {open && (
        <div style={{ marginTop: 10, padding: 16, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-surface)', maxWidth: 640 }}>
          {description && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.55 }}>{description}</div>}
          <AssuranceForm endpoint={endpoint} fields={fields} extraBody={extraBody} submitLabel={submitLabel ?? label} compact
            danger={variant === 'danger'} redirectTo={redirectTo} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
