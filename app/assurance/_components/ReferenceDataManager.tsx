'use client';
import { useMemo, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Dialog, Field, FormActions, FormError, fieldControlClassName } from '@/components/ui/app';
import {
  REACTIVATABLE_STATUS, REFERENCE_CONFIG, REFERENCE_MAX, REFERENCE_NAME_MAX, normaliseReference, referenceValueLabel,
  type ReferenceField, type ReferenceKind,
} from '@/lib/referenceData/rules';
import styles from './assurance.module.css';

// Settings → Reference data → Locations / Assets / External organisations.
// These are SHARED BrainBase records; Assurance does not keep copies. The
// list is server-rendered; every change is POSTed to
// /api/assurance/reference-data/<kind>/** where permission, organisation
// scope, uniqueness and stale-edit protection are enforced. Nothing is ever
// deleted — records are deactivated, which only removes them from the
// choices offered for NEW Assurance records.

export type ReferenceRowView = {
  id: string;
  reference: string;
  name: string;
  type: string | null;
  status: string;
  fields: Record<string, string | null | string[]>;
  revision: string;
  usage_count: number | null;
};

type Mode =
  | { kind: 'create' }
  | { kind: 'edit'; row: ReferenceRowView }
  | { kind: 'deactivate'; row: ReferenceRowView }
  | { kind: 'reactivate'; row: ReferenceRowView };

type StatusFilter = 'ACTIVE' | 'INACTIVE' | 'ALL';

function statusBadge(status: string): 'success' | 'inactive' {
  return status === 'ACTIVE' ? 'success' : 'inactive';
}

function summaryValue(f: ReferenceField, value: string | null | string[] | undefined): string {
  if (Array.isArray(value)) return value.length ? value.map(referenceValueLabel).join(', ') : '—';
  if (!value) return '—';
  return f.control === 'select' ? referenceValueLabel(value) : value;
}

export default function ReferenceDataManager({ kind, rows, canAdminister }: {
  kind: ReferenceKind; rows: ReferenceRowView[]; canAdminister: boolean;
}) {
  const cfg = REFERENCE_CONFIG[kind];
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const [query, setQuery] = useState('');
  // After a save the list re-renders from the server; until then rows carry
  // the old revision, so their actions stay disabled.
  const [refreshing, startRefresh] = useTransition();
  const base = `/api/assurance/reference-data/${cfg.segment}`;
  const summaryFields = cfg.fields.filter(f => f.summary);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r =>
      (status === 'ALL' || (status === 'ACTIVE' ? r.status === 'ACTIVE' : r.status !== 'ACTIVE'))
      && (!q || r.name.toLowerCase().includes(q) || r.reference.toLowerCase().includes(q)));
  }, [rows, status, query]);
  const inactiveCount = rows.filter(r => r.status !== 'ACTIVE').length;

  function close() { setMode(null); setError(null); setBusy(false); }

  async function submit(endpoint: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Something went wrong. Nothing was saved.'); return; }
      close();
      startRefresh(() => router.refresh());
    } catch {
      setError('Network error. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  const singularTitle = cfg.singular.charAt(0).toUpperCase() + cfg.singular.slice(1);
  const title = mode?.kind === 'create' ? `Create ${cfg.singular}`
    : mode?.kind === 'edit' ? `Edit ${mode.row.name}`
    : mode?.kind === 'deactivate' ? `Deactivate ${mode.row.name}`
    : mode?.kind === 'reactivate' ? `Reactivate ${mode.row.name}` : '';

  if (rows.length === 0) {
    return (
      <div>
        <div className={styles.riskEmpty} role="status">
          <p className={styles.riskEmptyTitle}>{cfg.emptyMessage}</p>
          {canAdminister
            ? <Button variant="primary" onClick={() => setMode({ kind: 'create' })}>Create {cfg.singular}</Button>
            : <p className={styles.dim}>Ask an organisation admin to add {cfg.plural.toLowerCase()}.</p>}
        </div>
        {mode && (
          <Dialog open onClose={close} title={title} width={560}>
            <RecordForm kind={kind} row={null} busy={busy} error={error} onCancel={close} onSubmit={body => submit(base, body)} />
          </Dialog>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.refToolbar}>
        <label className={styles.refSearch}>
          <span className="bb-visually-hidden">Search {cfg.plural.toLowerCase()}</span>
          <input type="search" className={fieldControlClassName} placeholder="Search by name or reference"
            value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        <label className={styles.refFilter}>
          <span className="bb-visually-hidden">Status</span>
          <select className={fieldControlClassName} value={status} onChange={e => setStatus(e.target.value as StatusFilter)}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive{inactiveCount ? ` (${inactiveCount})` : ''}</option>
            <option value="ALL">All</option>
          </select>
        </label>
        {canAdminister && (
          <Button variant="primary" disabled={refreshing} onClick={() => setMode({ kind: 'create' })}>Create {cfg.singular}</Button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className={styles.dim} role="status">No {cfg.plural.toLowerCase()} match this filter.</p>
      ) : (
        <>
          <div className={styles.riskTable}>
            <table className={styles.riskTableEl} aria-label={cfg.plural}>
              <thead>
                <tr>
                  <th scope="col">Name</th><th scope="col">Reference</th>
                  {summaryFields.map(f => <th key={f.key} scope="col">{f.label}</th>)}
                  <th scope="col">Status</th><th scope="col">Used by</th>
                  {canAdminister && <th scope="col"><span className="bb-visually-hidden">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {visible.map(r => (
                  <tr key={r.id} data-inactive={r.status === 'ACTIVE' ? undefined : 'true'}>
                    <td className={styles.riskName}>{r.name}</td>
                    <td><code className={styles.riskCode}>{r.reference}</code></td>
                    {summaryFields.map(f => <td key={f.key} className={styles.riskDescription}>{summaryValue(f, r.fields[f.key])}</td>)}
                    <td><Badge state={statusBadge(r.status)}>{referenceValueLabel(r.status)}</Badge></td>
                    <td>{r.usage_count === null ? '—' : `${r.usage_count} ${r.usage_count === 1 ? 'record' : 'records'}`}</td>
                    {canAdminister && <td className={styles.riskActions}><RowActions row={r} onPick={setMode} disabled={refreshing} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className={styles.riskCards} aria-label={cfg.plural}>
            {visible.map(r => (
              <li key={r.id} className={styles.riskCard} data-inactive={r.status === 'ACTIVE' ? undefined : 'true'}>
                <div className={styles.riskCardHead}>
                  <span className={styles.riskName}>{r.name}</span>
                  <Badge state={statusBadge(r.status)}>{referenceValueLabel(r.status)}</Badge>
                </div>
                <dl className={styles.riskCardMeta}>
                  <div><dt>Reference</dt><dd><code className={styles.riskCode}>{r.reference}</code></dd></div>
                  {summaryFields.map(f => <div key={f.key}><dt>{f.label}</dt><dd>{summaryValue(f, r.fields[f.key])}</dd></div>)}
                  <div><dt>Used by</dt><dd>{r.usage_count === null ? '—' : `${r.usage_count} ${r.usage_count === 1 ? 'record' : 'records'}`}</dd></div>
                </dl>
                {canAdminister && <div className={styles.riskActions}><RowActions row={r} onPick={setMode} disabled={refreshing} /></div>}
              </li>
            ))}
          </ul>
        </>
      )}

      {mode && (
        <Dialog open onClose={close} title={title} width={560}>
          {mode.kind === 'create' || mode.kind === 'edit' ? (
            <RecordForm kind={kind} row={mode.kind === 'edit' ? mode.row : null} busy={busy} error={error} onCancel={close}
              onSubmit={body => submit(mode.kind === 'edit' ? `${base}/${mode.row.id}` : base, body)} />
          ) : (
            <StatusConfirm singular={singularTitle} kind={kind} row={mode.row} activate={mode.kind === 'reactivate'} busy={busy} error={error} onCancel={close}
              onConfirm={() => submit(`${base}/${mode.row.id}/${mode.kind}`, { expectedRevision: mode.row.revision })} />
          )}
        </Dialog>
      )}
    </div>
  );
}

function RowActions({ row, onPick, disabled }: { row: ReferenceRowView; onPick: (m: Mode) => void; disabled: boolean }) {
  return (
    <span className={styles.riskActionButtons}>
      <Button size="sm" disabled={disabled} onClick={() => onPick({ kind: 'edit', row })} aria-label={`Edit ${row.name}`}>Edit</Button>
      {row.status === 'ACTIVE' && (
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onPick({ kind: 'deactivate', row })} aria-label={`Deactivate ${row.name}`}>Deactivate</Button>
      )}
      {row.status === REACTIVATABLE_STATUS && (
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onPick({ kind: 'reactivate', row })} aria-label={`Reactivate ${row.name}`}>Reactivate</Button>
      )}
    </span>
  );
}

function RecordForm({ kind, row, busy, error, onCancel, onSubmit }: {
  kind: ReferenceKind; row: ReferenceRowView | null; busy: boolean; error: string | null;
  onCancel: () => void; onSubmit: (body: Record<string, unknown>) => void;
}) {
  const cfg = REFERENCE_CONFIG[kind];
  const [reference, setReference] = useState('');
  function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { name: String(f.get('name') ?? '') };
    for (const field of cfg.fields) {
      body[field.key] = field.control === 'multiselect' ? f.getAll(field.key).map(String) : String(f.get(field.key) ?? '');
    }
    if (row) body.expectedRevision = row.revision;
    else body.reference = String(f.get('reference') ?? '');
    onSubmit(body);
  }
  return (
    <form onSubmit={handle} className={styles.riskForm}>
      {row ? (
        <Field label="Reference" helper="The reference is a stable identifier and cannot be changed after the record is created.">
          {p => <input {...p} className={fieldControlClassName} value={row.reference} readOnly aria-readonly="true" />}
        </Field>
      ) : (
        <Field label="Reference" required helper={`A short, unique identifier. It cannot be changed later.${reference ? ` Saved as ${normaliseReference(reference)}.` : ''}`}>
          {p => <input {...p} name="reference" className={fieldControlClassName} required maxLength={REFERENCE_MAX} autoComplete="off"
            value={reference} onChange={e => setReference(e.target.value)} placeholder={kind === 'location' ? 'e.g. DEPOT-01' : kind === 'asset' ? 'e.g. TRUCK-001' : 'e.g. ACME'} />}
        </Field>
      )}
      <Field label="Name" required>
        {p => <input {...p} name="name" className={fieldControlClassName} required maxLength={REFERENCE_NAME_MAX} defaultValue={row?.name ?? ''} />}
      </Field>
      {cfg.fields.map(field => <FieldControl key={field.key} field={field} value={row?.fields[field.key]} />)}
      {error && <FormError>{error}</FormError>}
      <FormActions>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Saving…' : row ? 'Save changes' : `Create ${cfg.singular}`}</Button>
      </FormActions>
    </form>
  );
}

function FieldControl({ field, value }: { field: ReferenceField; value: string | null | string[] | undefined }) {
  if (field.control === 'multiselect') {
    const selected = new Set(Array.isArray(value) ? value : []);
    return (
      <fieldset className={styles.refChecks}>
        <legend className={styles.refLegend}>{field.label}</legend>
        {field.helper && <p className={styles.riskHelp} style={{ margin: 0 }}>{field.helper}</p>}
        <div className={styles.refCheckGrid}>
          {(field.options ?? []).map(opt => (
            <label key={opt} className={styles.riskCheck}>
              <input type="checkbox" name={field.key} value={opt} defaultChecked={selected.has(opt)} />
              <span>{referenceValueLabel(opt)}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  const current = typeof value === 'string' ? value : '';
  return (
    <Field label={field.label} required={field.required} helper={field.helper}>
      {p => field.control === 'select' ? (
        <select {...p} name={field.key} className={fieldControlClassName} required={field.required} defaultValue={current}>
          {!field.required && <option value="">—</option>}
          {field.required && !current && <option value="" disabled>Choose…</option>}
          {(field.options ?? []).map(opt => <option key={opt} value={opt}>{referenceValueLabel(opt)}</option>)}
        </select>
      ) : field.control === 'textarea' ? (
        <textarea {...p} name={field.key} className={fieldControlClassName} rows={3} maxLength={field.max} defaultValue={current} />
      ) : (
        <input {...p} name={field.key} type={field.inputType ?? 'text'} className={fieldControlClassName} maxLength={field.max} defaultValue={current} />
      )}
    </Field>
  );
}

function StatusConfirm({ singular, kind, row, activate, busy, error, onCancel, onConfirm }: {
  singular: string; kind: ReferenceKind; row: ReferenceRowView; activate: boolean; busy: boolean; error: string | null;
  onCancel: () => void; onConfirm: () => void;
}) {
  const cfg = REFERENCE_CONFIG[kind];
  return (
    <div className={styles.riskForm}>
      {activate ? (
        <p className={styles.riskBody}><strong>{row.name}</strong> will be offered again when recording new {cfg.usedOn}.</p>
      ) : (
        <>
          <p className={styles.riskBody}><strong>{row.name}</strong> will no longer be offered when recording new {cfg.usedOn}.</p>
          <p className={styles.riskBody}>Existing records keep this {singular.toLowerCase()} and continue to show it. Nothing is deleted or reassigned.</p>
          {row.usage_count !== null && (
            <p className={styles.riskHelp} style={{ margin: 0 }}>Currently used by {row.usage_count} {row.usage_count === 1 ? 'record' : 'records'}.</p>
          )}
        </>
      )}
      {error && <FormError>{error}</FormError>}
      <FormActions>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant={activate ? 'primary' : 'danger'} onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Working…' : activate ? 'Reactivate' : 'Deactivate'}
        </Button>
      </FormActions>
    </div>
  );
}
