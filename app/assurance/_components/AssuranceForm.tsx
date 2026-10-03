'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, FormError, fieldControlClassName } from '@/components/ui/app';
import styles from './assurance.module.css';

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
  /** A calendar date sent as YYYY-MM-DD (certificate/licence dates), not a timestamp. */
  | { kind: 'calendarDate'; name: string; label: string; required?: boolean; help?: string; defaultValue?: string }
  | { kind: 'number'; name: string; label: string; required?: boolean; help?: string; min?: number; max?: number; defaultValue?: string }
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
    <form onSubmit={onSubmit} className={styles.form} data-compact={compact || undefined} noValidate={false}>
      {fields.map(f => {
        if (f.kind === 'hidden') return <input key={f.name} type="hidden" name={f.name} value={f.value} />;
        const id = `af-${f.name}`;
        if (f.kind === 'checkbox') {
          return (
            <div key={f.name}>
              <label htmlFor={id} className={styles.check}>
                <input id={id} type="checkbox" name={f.name} defaultChecked={f.defaultChecked} aria-describedby={f.help ? `${id}-helper` : undefined} />
                <span>{f.label}</span>
              </label>
              {f.help && <p id={`${id}-helper`} className={styles.dim} style={{ margin: '4px 0 0 22px', fontSize: '0.75rem', lineHeight: 1.5 }}>{f.help}</p>}
            </div>
          );
        }
        const required = 'required' in f && !!f.required;
        return (
          <Field key={f.name} id={id} label={f.label} required={required} helper={'help' in f ? f.help : undefined}>
            {control => (
              <>
                {f.kind === 'text' && (
                  <input {...control} name={f.name} type="text" required={f.required} placeholder={f.placeholder} maxLength={f.maxLength ?? 200} defaultValue={f.defaultValue} className={fieldControlClassName} />
                )}
                {f.kind === 'textarea' && (
                  <textarea {...control} name={f.name} required={f.required} placeholder={f.placeholder} rows={f.rows ?? 4} defaultValue={f.defaultValue} className={fieldControlClassName} />
                )}
                {f.kind === 'select' && (
                  <select {...control} name={f.name} required={f.required} defaultValue={f.defaultValue ?? ''} className={fieldControlClassName}>
                    <option value="">{f.emptyLabel ?? (f.required ? 'Choose…' : 'None')}</option>
                    {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {f.kind === 'multiselect' && (
                  <select {...control} name={f.name} multiple required={f.required} defaultValue={f.defaultValues ?? []} size={Math.min(6, Math.max(3, f.options.length))} className={fieldControlClassName}>
                    {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {f.kind === 'datetime' && (
                  <input {...control} name={f.name} type="datetime-local" required={f.required} defaultValue={f.defaultNow ? nowDefault : undefined} className={fieldControlClassName} />
                )}
                {f.kind === 'date' && <input {...control} name={f.name} type="date" required={f.required} className={fieldControlClassName} />}
                {f.kind === 'calendarDate' && <input {...control} name={f.name} type="date" required={f.required} defaultValue={f.defaultValue} className={fieldControlClassName} />}
                {f.kind === 'number' && (
                  <input {...control} name={f.name} type="number" inputMode="numeric" required={f.required} min={f.min} max={f.max} defaultValue={f.defaultValue} className={fieldControlClassName} />
                )}
              </>
            )}
          </Field>
        );
      })}
      {error && <FormError>{error}</FormError>}
      <div>
        <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
