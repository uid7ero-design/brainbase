'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Field, TableContainer, buttonProps, fieldControlClassName, tableStyles } from '@/components/ui/app';

type RecordRow = { id: string; code: string; name: string; description: string | null; active: boolean };
export default function DimensionSetup({ kind, title, onChange }: { kind: 'accounts' | 'cost-centres'; title: string; onChange?: () => void }) {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const endpoint = '/api/commercial/budgeting/setup/' + kind;
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load ' + title.toLowerCase() + '.');
        setRecords((await response.json()).records);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load records.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [endpoint, title]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (loading || busy) return;
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to create record.');
      setRecords(current => [...current, data.record].sort((a, b) => a.code.localeCompare(b.code)));
      form.reset(); setMessage('Created ' + data.record.code + '.');
      onChange?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to create record.'); }
    finally { setBusy(false); }
  }
  async function changeActive(record: RecordRow) {
    if (busy) return; setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint + '/' + record.id + (record.active ? '/deactivate' : '/reactivate'), { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to change record status.');
      setRecords(current => current.map(row => row.id === record.id ? data.record : row));
      setMessage(record.code + (record.active ? ' deactivated.' : ' reactivated.') + ' Historical references remain available.');
      onChange?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to change record status.'); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby={'dimension-' + kind} style={{ marginTop: 20, padding: 20, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-surface)' }}>
    <h2 id={'dimension-' + kind} style={{ marginTop: 0, fontSize: 16 }}>{title}</h2>
    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Codes are unique within your organisation. Deactivation retains the record and its history; records used by an active Budget cannot be deactivated. Reactivate an inactive record to restore its use in drafts.</p>
    {error && <p role="alert" style={{ color: 'var(--status-danger)' }}>{error}</p>}
    <p role="status">{loading ? 'Loading…' : message}</p>
    <form onSubmit={event => void create(event)}>
      <fieldset disabled={busy || loading} style={{ border: 0, padding: 0, margin: '16px 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 12, alignItems: 'end' }}>
        <Field label="Code" required>{control => <input {...control} name="code" maxLength={50} required className={fieldControlClassName} />}</Field>
        <Field label="Name" required>{control => <input {...control} name="name" maxLength={100} required className={fieldControlClassName} />}</Field>
        <Field label="Description">{control => <input {...control} name="description" maxLength={1000} className={fieldControlClassName} />}</Field>
        <button {...buttonProps('primary')} type="submit">Create {kind === 'accounts' ? 'account' : 'cost centre'}</button>
      </fieldset>
    </form>
    <TableContainer label={title + ' list'} minWidth={620}>
      <table className={tableStyles.table}>
        <thead><tr>{['Code', 'Name', 'Description', 'Status', 'Action'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{records.length ? records.map(record => <tr key={record.id}><td>{record.code}</td><td>{record.name}</td><td>{record.description ?? '—'}</td><td>{record.active ? 'Active' : 'Inactive'}</td><td><button {...buttonProps('secondary')} disabled={busy || loading} onClick={() => void changeActive(record)} aria-label={(record.active ? 'Deactivate ' : 'Reactivate ') + record.code}>{record.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>) : <tr><td colSpan={5}>{loading ? 'Loading…' : 'No records yet. Create the first record above.'}</td></tr>}</tbody>
      </table>
    </TableContainer>
  </section>;
}
