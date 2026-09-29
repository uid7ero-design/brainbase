'use client';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

// Generic Assurance form: renders server-supplied field definitions and
// POSTs JSON to an /api/assurance/** route. The server is the only
// authority — this component does no permission logic, and it only ever
// sends the fields it was configured with (the route/service allow-lists
// what it accepts regardless).

export type FormField =
  | { kind: 'text'; name: string; label: string; required?: boolean; placeholder?: string; maxLength?: number; defaultValue?: string }
  | { kind: 'textarea'; name: string; label: string; required?: boolean; placeholder?: string; rows?: number; defaultValue?: string; help?: string }
  | { kind: 'select'; name: string; label: string; required?: boolean; options: { value: string; label: string }[]; defaultValue?: string; emptyLabel?: string; help?: string }
  | { kind: 'datetime'; name: string; label: string; required?: boolean; defaultNow?: boolean; help?: string }
  | { kind: 'date'; name: string; label: string; required?: boolean; help?: string }
  | { kind: 'checkbox'; name: string; label: string; defaultChecked?: boolean; help?: string }
  | { kind: 'multiselect'; name: string; label: string; required?: boolean; options: { value: string; label: string }[]; defaultValues?: string[]; help?: string }
  | { kind: 'hidden'; name: string; value: string };

type Props = {
  endpoint: string;
  method?: 'POST' | 'PATCH';
  fields: FormField[];
  submitLabel: string;
  /** Where to go on success. `{id}` is replaced with the created record's id. Omit to refresh in place. */
  redirectTo?: string;
  /** Extra static JSON merged into the body (e.g. a fixed status for a transition). */
  extraBody?: Record<string, unknown>;
  onDone?: () => void;
  compact?: boolean;
  danger?: boolean;
};

const control: CSSProperties = {
  width: '100%', padding: '9px 11px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8,
  color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
};
const labelStyle: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 };
const helpStyle: CSSProperties = { fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 };

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function AssuranceForm({ endpoint, method = 'POST', fields, submitLabel, redirectTo, extraBody, onDone, compact, danger }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowDefault] = useState(localNow);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { ...(extraBody ?? {}) };
    for (const f of fields) {
      if (f.kind === 'checkbox') body[f.name] = form.get(f.name) === 'on';
      else if (f.kind === 'multiselect') body[f.name] = form.getAll(f.name).map(String);
      else if (f.kind === 'datetime') {
        const v = String(form.get(f.name) ?? '');
        body[f.name] = v ? new Date(v).toISOString() : null;
      } else if (f.kind === 'date') {
        const v = String(form.get(f.name) ?? '');
        // Due dates are end-of-day in the user's local time.
        body[f.name] = v ? new Date(`${v}T23:59:00`).toISOString() : null;
      } else {
        const v = form.get(f.name);
        body[f.name] = v === null || v === '' ? null : String(v);
      }
    }
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Something went wrong. Nothing was saved.');
        return;
      }
      onDone?.();
      if (redirectTo) router.push(redirectTo.replace('{id}', encodeURIComponent(String(data.id ?? ''))));
      else router.refresh();
    } catch {
      setError('Network error. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: compact ? 10 : 14 }} noValidate={false}>
      {fields.map(f => {
        if (f.kind === 'hidden') return <input key={f.name} type="hidden" name={f.name} value={f.value} />;
        const id = `af-${f.name}`;
        if (f.kind === 'checkbox') {
          return (
            <div key={f.name}>
              <label htmlFor={id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input id={id} type="checkbox" name={f.name} defaultChecked={f.defaultChecked} style={{ marginTop: 2 }} />
                <span>{f.label}</span>
              </label>
              {f.help && <div style={{ ...helpStyle, marginLeft: 22 }}>{f.help}</div>}
            </div>
          );
        }
        return (
          <div key={f.name}>
            <label htmlFor={id} style={labelStyle}>
              {f.label}{'required' in f && f.required ? <span aria-hidden style={{ color: 'var(--bb-danger)' }}> *</span> : null}
            </label>
            {f.kind === 'text' && (
              <input id={id} name={f.name} type="text" required={f.required} placeholder={f.placeholder} maxLength={f.maxLength ?? 200} defaultValue={f.defaultValue} style={control} />
            )}
            {f.kind === 'textarea' && (
              <textarea id={id} name={f.name} required={f.required} placeholder={f.placeholder} rows={f.rows ?? 4} defaultValue={f.defaultValue} style={{ ...control, resize: 'vertical' }} />
            )}
            {f.kind === 'select' && (
              <select id={id} name={f.name} required={f.required} defaultValue={f.defaultValue ?? ''} style={control}>
                <option value="">{f.emptyLabel ?? (f.required ? 'Choose…' : 'None')}</option>
                {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {f.kind === 'multiselect' && (
              <select id={id} name={f.name} multiple required={f.required} defaultValue={f.defaultValues ?? []} size={Math.min(6, Math.max(3, f.options.length))} style={control}>
                {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {f.kind === 'datetime' && (
              <input id={id} name={f.name} type="datetime-local" required={f.required} defaultValue={f.defaultNow ? nowDefault : undefined} style={control} />
            )}
            {f.kind === 'date' && <input id={id} name={f.name} type="date" required={f.required} style={control} />}
            {'help' in f && f.help && <div style={helpStyle}>{f.help}</div>}
          </div>
        );
      })}
      {error && <div role="alert" style={{ fontSize: 13, color: 'var(--bb-danger)', background: 'var(--bb-danger-soft)', padding: '8px 12px', borderRadius: 8 }}>{error}</div>}
      <div>
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
            background: danger ? 'transparent' : 'var(--purple-600)', color: danger ? 'var(--bb-danger)' : '#fff',
            border: danger ? '1px solid color-mix(in srgb, var(--bb-danger) 45%, transparent)' : '1px solid transparent',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
