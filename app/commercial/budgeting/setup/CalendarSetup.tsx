'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Field, PageHeader, TableContainer, buttonProps, fieldControlClassName, tableStyles } from '@/components/ui/app';
import { australianDateToIso, formatAustralianDate } from '@/lib/commercial/financeSetupDisplay';
import styles from './page.module.css';

type Period = { id: string; name: string; starts_on: string; ends_on: string; status: string };
type Year = Period & { periods: Period[] };

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
  const selectedYear = years.find(year => year.id === yearId);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/commercial/budgeting/financial-periods', { signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load the financial calendar.');
        const data = await response.json();
        setYears(data.years);
        setYearId(data.years.find((year: Year) => year.status === 'OPEN')?.id ?? '');
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load the financial calendar.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function create(event: FormEvent<HTMLFormElement>, kind: 'year' | 'period') {
    event.preventDefault();
    if (busy || loading) return;
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    const targetYearId = yearId;
    setBusy(true); setError(''); setMessage('');
    try {
      body.startsOn = australianDateToIso(String(body.startsOn));
      body.endsOn = australianDateToIso(String(body.endsOn));
      const response = await fetch(kind === 'year' ? '/api/commercial/budgeting/financial-years' : `/api/commercial/budgeting/financial-years/${targetYearId}/periods`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to save the financial calendar.');
      if (kind === 'year') {
        setYears(current => [...current, { ...data.year, periods: [] }].sort((a, b) => b.starts_on.localeCompare(a.starts_on)));
        setYearId(data.year.id);
      } else {
        setYears(current => current.map(year => year.id === targetYearId ? { ...year, periods: [...year.periods, data.period].sort((a, b) => a.starts_on.localeCompare(b.starts_on)) } : year));
      }
      form.reset();
      onChange?.();
      setMessage(kind === 'year' ? 'Financial year created. Add its periods below.' : 'Financial period created.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save the financial calendar.'); }
    finally { setBusy(false); }
  }

  return <div style={{ maxWidth: 1100 }}>
    <PageHeader title="Finance setup" />
    <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Start with your financial calendar. Enter dates as DD/MM/YYYY. Dates are inclusive; years and periods must not overlap. Each period must stay within its year.</p>
    <p><Link href="/commercial/budgeting/finance-controls">Open finance controls</Link></p>
    {error && <p role="alert" style={{ color: 'var(--status-danger)' }}>{error}</p>}
    <p role="status">{loading ? 'Loading financial calendar…' : message}</p>
    <section aria-labelledby="create-year" className={styles.panel}>
      <h2 id="create-year" style={{ marginTop: 0, fontSize: 16 }}>Create financial year</h2>
      <form onSubmit={event => void create(event, 'year')}>
        <fieldset disabled={loading || busy} className={styles.formGrid}>
          <CalendarFields prefix="Year" />
          <button {...buttonProps('primary')} type="submit">Create year</button>
        </fieldset>
      </form>
    </section>
    <section aria-labelledby="configure-periods" className={styles.panel}>
      <h2 id="configure-periods" style={{ marginTop: 0, fontSize: 16 }}>Financial periods</h2>
      <Field label="Financial year">{control => <select {...control} className={fieldControlClassName} value={yearId} onChange={event => setYearId(event.target.value)} disabled={loading || busy}>
        <option value="">Choose year</option>
        {years.map(year => <option key={year.id} value={year.id}>{year.name} · {year.status}</option>)}
      </select>}</Field>
      {selectedYear ? <>
        <p style={{ fontSize: 13 }}>{formatAustralianDate(selectedYear.starts_on)} to {formatAustralianDate(selectedYear.ends_on)} · {selectedYear.status}</p>
        {selectedYear.status === 'OPEN' ? <form onSubmit={event => void create(event, 'period')}>
          <fieldset disabled={busy || loading} className={styles.formGrid}>
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
      </> : !loading && <p>{years.length ? 'Choose a financial year to view its periods.' : 'No financial years yet. Create your first year above.'}</p>}
    </section>
  </div>;
}
