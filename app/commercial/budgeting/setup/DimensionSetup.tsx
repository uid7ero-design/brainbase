'use client';
import styles from './page.module.css';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Field, TableContainer, buttonProps, fieldControlClassName, tableStyles } from '@/components/ui/app';

type RecordRow = { id: string; code: string; name: string; description: string | null; active: boolean };
function isRecord(value: unknown): value is RecordRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return ['id', 'code', 'name'].every(key => typeof row[key] === 'string' && row[key] !== '')
    && typeof row.active === 'boolean' && (row.description === null || typeof row.description === 'string');
}
function readRecords(value: unknown): RecordRow[] {
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error('Unable to read saved records. Reload before continuing.');
  return value;
}
export default function DimensionSetup({ kind, title, onChange }: { kind: 'accounts' | 'cost-centres'; title: string; onChange?: () => void }) {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const operation = useRef(false);
  const recoveryRequired = useRef(false);
  const review = useRef<HTMLHeadingElement>(null);
  const locked = loading || busy || needsReload || !loaded;
  const endpoint = '/api/commercial/budgeting/setup/' + kind;
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load ' + title.toLowerCase() + '.');
        const rows = readRecords((await response.json()).records);
        if (controller.signal.aborted) return;
        setRecords(rows); setLoaded(true);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load records.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [endpoint, title]);
  async function reload() {
    if (operation.current || loading) return;
    operation.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('Unable to reload ' + title.toLowerCase() + '.');
      const rows = readRecords((await response.json()).records);
      setRecords(rows); setLoaded(true); setNeedsReload(false); recoveryRequired.current = false;
      setEditorRevision(current => current + 1);
      setMessage(title + ' reloaded. Review saved records before continuing. Unsaved entries have been cleared.');
      onChange?.(); review.current?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to reload records.'); }
    finally { operation.current = false; setBusy(false); }
  }
  async function save(form?: HTMLFormElement, record?: RecordRow) {
    if (operation.current || recoveryRequired.current || locked) return;
    operation.current = true; setBusy(true); setError(''); setMessage('');
    let outcome: 'sent' | 'confirmed' | 'rejected' = 'sent';
    try {
      const response = await fetch(record ? endpoint + '/' + record.id + (record.active ? '/deactivate' : '/reactivate') : endpoint, {
        method: 'POST', ...(form ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) } : {}),
      });
      outcome = response.ok ? 'confirmed' : response.status < 500 ? 'rejected' : 'sent';
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to save record.');
      if (!isRecord(data.record) || (record && data.record.id !== record.id)) throw new Error('Incomplete save response.');
      const saved = data.record;
      setRecords(current => record ? current.map(row => row.id === record.id ? saved : row) : [...current, saved].sort((a, b) => a.code.localeCompare(b.code)));
      form?.reset();
      setMessage(record ? record.code + (record.active ? ' deactivated.' : ' reactivated.') + ' Historical references remain available.' : 'Created ' + saved.code + '.');
      onChange?.();
    } catch (failure) {
      if (outcome === 'sent' || outcome === 'confirmed') {
        recoveryRequired.current = true; setNeedsReload(true);
        setError(outcome === 'confirmed' ? 'The change was saved, but its response could not be read. Reload saved records before continuing.' : 'The save outcome could not be confirmed. Reload saved records before continuing.');
      } else setError(failure instanceof Error ? failure.message : 'Unable to save record.');
    } finally { operation.current = false; setBusy(false); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); void save(event.currentTarget);
  }
  return <section aria-labelledby={'dimension-' + kind} className={styles.panel}>
    <h2 ref={review} id={'dimension-' + kind} tabIndex={-1} className={styles.navigationTarget} style={{ marginTop: 0, fontSize: 16 }}>{title}</h2>
    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Codes are unique within your organisation. Deactivation retains the record and its history; records used by an active Budget cannot be deactivated. Reactivate an inactive record to restore its use in drafts.</p>
    {error && <p role="alert" style={{ color: 'var(--status-danger)' }}>{error}</p>}
    <p role="status">{loading ? 'Loading…' : message}</p>
    <div className={styles.reloadControls}>
      <button {...buttonProps('secondary')} type="button" disabled={loading || busy} onClick={() => void reload()}>Reload {title.toLowerCase()}</button>
      <p>{needsReload ? 'Saving is paused until saved records can be checked.' : 'Reload to check saved records. A successful reload clears unsaved entries.'}</p>
    </div>
    <form key={editorRevision} aria-label={'Create ' + title.toLowerCase()} onSubmit={create}>
      <fieldset disabled={locked} className={styles.formGrid}>
        <Field label="Code" required>{control => <input {...control} name="code" maxLength={50} required className={fieldControlClassName} />}</Field>
        <Field label="Name" required>{control => <input {...control} name="name" maxLength={100} required className={fieldControlClassName} />}</Field>
        <Field label="Description">{control => <input {...control} name="description" maxLength={1000} className={fieldControlClassName} />}</Field>
        <button {...buttonProps('primary')} type="submit">Create {kind === 'accounts' ? 'account' : 'cost centre'}</button>
      </fieldset>
    </form>
    <TableContainer label={title + ' list'} minWidth={620}>
      <table className={tableStyles.table}>
        <thead><tr>{['Code', 'Name', 'Description', 'Status', 'Action'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{records.length ? records.map(record => <tr key={record.id}><td>{record.code}</td><td>{record.name}</td><td>{record.description ?? '—'}</td><td>{record.active ? 'Active' : 'Inactive'}</td><td><button {...buttonProps('secondary')} disabled={locked} onClick={() => void save(undefined, record)} aria-label={(record.active ? 'Deactivate ' : 'Reactivate ') + record.code}>{record.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>) : <tr><td colSpan={5}>{loading ? 'Loading…' : !loaded ? 'Saved records are unavailable. Reload before continuing.' : 'No records yet. Create the first record above.'}</td></tr>}</tbody>
      </table>
    </TableContainer>
  </section>;
}
