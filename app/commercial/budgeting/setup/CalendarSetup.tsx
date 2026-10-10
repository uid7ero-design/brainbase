'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Field, PageHeader, TableContainer, buttonProps, fieldControlClassName, tableStyles } from '@/components/ui/app';
import { australianDateToIso, formatAustralianDate } from '@/lib/commercial/financeSetupDisplay';
import styles from './page.module.css';

type Period = { id: string; name: string; starts_on: string; ends_on: string; status: string };
type Year = Period & { periods: Period[] };

function isPeriod(value: unknown): value is Period {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return ['id', 'name', 'starts_on', 'ends_on', 'status'].every(key => typeof row[key] === 'string' && row[key] !== '');
}

function readYears(value: unknown): Year[] {
  if (!Array.isArray(value) || !value.every(year => isPeriod(year) && Array.isArray((year as Year).periods) && (year as Year).periods.every(isPeriod))) {
    throw new Error('Unable to read the financial calendar. Reload it before continuing.');
  }
  return value;
}

function CalendarFields({ prefix }: { prefix: string }) {
  return <>
    <Field label={`${prefix} name`} required>{control => <input {...control} name="name" required maxLength={100} className={fieldControlClassName} />}</Field>
    <Field label={`${prefix} start date`} required>{control => <input {...control} name="startsOn" placeholder="DD/MM/YYYY" maxLength={10} required className={fieldControlClassName} />}</Field>
    <Field label={`${prefix} end date`} required>{control => <input {...control} name="endsOn" placeholder="DD/MM/YYYY" maxLength={10} required className={fieldControlClassName} />}</Field>
  </>;
}

export default function CalendarSetup({ onChange }: { onChange?: () => void }) {
  const [years, setYears] = useState<Year[]>([]);
  const [yearId, setYearId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const operation = useRef(false);
  const recoveryRequired = useRef(false);
  const pendingYear = useRef<{ id?: string; name?: string; starts_on?: string; ends_on?: string } | null>(null);
  const review = useRef<HTMLElement>(null);
  const locked = loading || busy || needsReload || !loaded;
  const selectedYear = years.find(year => year.id === yearId);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/commercial/budgeting/financial-periods', { signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load the financial calendar.');
        const data = await response.json();
        if (controller.signal.aborted) return;
        const calendar = readYears(data.years);
        setYears(calendar);
        setLoaded(true);
        setYearId(calendar.find((year: Year) => year.status === 'OPEN')?.id ?? '');
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load the financial calendar.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function reload() {
    if (operation.current || loading) return;
    operation.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/commercial/budgeting/financial-periods');
      if (!response.ok) throw new Error('Unable to reload the financial calendar.');
      const calendar = readYears((await response.json()).years);
      const pending = pendingYear.current;
      const recovered = pending && calendar.find(year => pending.id ? year.id === pending.id : year.name === pending.name && year.starts_on === pending.starts_on && year.ends_on === pending.ends_on);
      setYears(calendar);
      setYearId(recovered?.id ?? calendar.find(year => year.id === yearId)?.id ?? calendar.find(year => year.status === 'OPEN')?.id ?? '');
      setLoaded(true); setNeedsReload(false); recoveryRequired.current = false; pendingYear.current = null;
      setEditorRevision(current => current + 1);
      setMessage('Financial calendar reloaded. Review the saved years and periods before continuing. Unsaved entries have been cleared.');
      onChange?.();
      review.current?.focus();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to reload the financial calendar.');
    } finally { operation.current = false; setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>, kind: 'year' | 'period') {
    event.preventDefault();
    if (operation.current || recoveryRequired.current || locked || (kind === 'period' && selectedYear?.status !== 'OPEN')) return;
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    const targetYearId = yearId;
    operation.current = true;
    let outcome: 'local' | 'sent' | 'confirmed' | 'rejected' = 'local';
    setBusy(true); setError(''); setMessage('');
    try {
      body.startsOn = australianDateToIso(String(body.startsOn));
      body.endsOn = australianDateToIso(String(body.endsOn));
      pendingYear.current = kind === 'year' ? { name: String(body.name).trim(), starts_on: String(body.startsOn), ends_on: String(body.endsOn) } : { id: targetYearId };
      outcome = 'sent';
      const response = await fetch(kind === 'year' ? '/api/commercial/budgeting/financial-years' : `/api/commercial/budgeting/financial-years/${targetYearId}/periods`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      outcome = response.ok ? 'confirmed' : response.status < 500 ? 'rejected' : 'sent';
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to save the financial calendar.');
      if (!isPeriod(kind === 'year' ? data.year : data.period)) throw new Error('Incomplete save response.');
      if (kind === 'year') {
        setYears(current => [...current, { ...data.year, periods: [] }].sort((a, b) => b.starts_on.localeCompare(a.starts_on)));
        setYearId(data.year.id);
      } else {
        setYears(current => current.map(year => year.id === targetYearId ? { ...year, periods: [...year.periods, data.period].sort((a, b) => a.starts_on.localeCompare(b.starts_on)) } : year));
      }
      pendingYear.current = null;
      form.reset();
      onChange?.();
      setMessage(kind === 'year' ? 'Financial year created. Add its periods below.' : 'Financial period created.');
    } catch (failure) {
      if (outcome === 'sent' || outcome === 'confirmed') {
        recoveryRequired.current = true; setNeedsReload(true);
        setError(outcome === 'confirmed' ? 'The calendar change was saved, but its response could not be read. Reload the financial calendar before continuing.' : 'The save outcome could not be confirmed. Reload the financial calendar before continuing.');
      } else {
        pendingYear.current = null;
        setError(failure instanceof Error ? failure.message : 'Unable to save the financial calendar.');
      }
    }
    finally { operation.current = false; setBusy(false); }
  }

  return <div style={{ maxWidth: 1100 }}>
    <PageHeader title="Finance setup" />
    <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Start with your financial calendar. Enter dates as DD/MM/YYYY. Dates are inclusive; years and periods must not overlap. Each period must stay within its year.</p>
    <p><Link href="/commercial/budgeting/finance-controls">Open finance controls</Link></p>
    {error && <p role="alert" style={{ color: 'var(--status-danger)' }}>{error}</p>}
    <p role="status">{loading ? 'Loading financial calendar…' : message}</p>
    <div className={styles.reloadControls}>
      <button {...buttonProps('secondary')} type="button" disabled={loading || busy} onClick={() => void reload()}>Reload financial calendar</button>
      <p>{needsReload ? 'Saving is paused until the saved calendar can be checked.' : 'Reload to check saved years and periods. A successful reload clears unsaved entries.'}</p>
    </div>
    <section aria-labelledby="create-year" className={styles.panel}>
      <h2 id="create-year" style={{ marginTop: 0, fontSize: 16 }}>Create financial year</h2>
      <form key={editorRevision} aria-label="Create financial year" onSubmit={event => void create(event, 'year')}>
        <fieldset disabled={locked} className={styles.formGrid}>
          <CalendarFields prefix="Year" />
          <button {...buttonProps('primary')} type="submit">Create year</button>
        </fieldset>
      </form>
    </section>
    <section ref={review} tabIndex={-1} aria-labelledby="configure-periods" className={styles.panel}>
      <h2 id="configure-periods" style={{ marginTop: 0, fontSize: 16 }}>Financial periods</h2>
      <Field label="Financial year">{control => <select {...control} className={fieldControlClassName} value={yearId} onChange={event => setYearId(event.target.value)} disabled={locked}>
        <option value="">Choose year</option>
        {years.map(year => <option key={year.id} value={year.id}>{year.name} · {year.status}</option>)}
      </select>}</Field>
      {selectedYear ? <>
        <p style={{ fontSize: 13 }}>{formatAustralianDate(selectedYear.starts_on)} to {formatAustralianDate(selectedYear.ends_on)} · {selectedYear.status}</p>
        {selectedYear.status === 'OPEN' ? <form key={`${yearId}-${editorRevision}`} aria-label="Create financial period" onSubmit={event => void create(event, 'period')}>
          <fieldset disabled={locked} className={styles.formGrid}>
            <CalendarFields prefix="Period" />
            <button {...buttonProps('primary')} type="submit">Create period</button>
          </fieldset>
        </form> : <p>This year is closed. Reopen it in finance controls before adding periods.</p>}
        <TableContainer label="Financial period calendar" minWidth={500}>
          <table className={tableStyles.table}>
            <thead><tr>{['Period', 'Start date', 'End date', 'Status'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{selectedYear.periods.length ? selectedYear.periods.map(period => <tr key={period.id}><td>{period.name}</td><td>{formatAustralianDate(period.starts_on)}</td><td>{formatAustralianDate(period.ends_on)}</td><td>{period.status}</td></tr>) : <tr><td colSpan={4}>No periods yet. Add the first period above.</td></tr>}</tbody>
          </table>
        </TableContainer>
      </> : !loading && loaded && <p>{years.length ? 'Choose a financial year to view its periods.' : 'No financial years yet. Create your first year above.'}</p>}
    </section>
  </div>;
}
