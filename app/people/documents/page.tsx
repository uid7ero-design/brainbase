'use client';

import { useEffect, useState } from 'react';
import { validateRegisterPagination, type RegisterPagination } from '@/lib/hr/registerPaging';
import { HrOperationsNav, HrRegisterReset, HrRegisterSearch, HrRegisterPagination } from '../_components/HrRegisterControls';
import PersonDrawer from '../_components/PersonDrawer';
import { PageHeader, TableContainer, TableStateRow, buttonProps, tableStyles } from '@/components/ui/app';

const COLUMNS = {
  documents: 'Documents', missing_version: 'No current version', pending_acknowledgement: 'Unacknowledged',
  unlinked_employee: 'Employee not linked', pending_verification: 'Not verified', rejected: 'Rejected', expired: 'Expired', expiring_soon: 'Expiring within 30 days',
};
type Counts = Record<keyof typeof COLUMNS, number>;
type Person = Counts & { person_id: string; first_name: string; last_name: string };
type Snapshot = { pagination: RegisterPagination; as_of_date: string; expiring_through: string; people: Person[] };

function parseSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object' || !('people' in value) || !Array.isArray(value.people)
    || !('as_of_date' in value) || typeof value.as_of_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.as_of_date)
    || !('expiring_through' in value) || typeof value.expiring_through !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.expiring_through)) throw new Error('Invalid overview');
  for (const person of value.people) {
    if (!person || typeof person.person_id !== 'string' || typeof person.first_name !== 'string' || typeof person.last_name !== 'string'
      || !Object.keys(COLUMNS).every(key => Number.isSafeInteger(person[key]) && person[key] >= 0)) throw new Error('Invalid counts');
  }
  validateRegisterPagination((value as Snapshot).pagination, value.people.length);
  return value as Snapshot;
}

export default function DocumentOverviewPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [personId, setPersonId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      setState('loading'); setSnapshot(null);
      try {
        const response = await fetch(`/api/hr/documents/overview?${new URLSearchParams({ page: String(page), search, filter })}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Unavailable');
        const next = parseSnapshot(await response.json());
        if (!controller.signal.aborted) { setSnapshot(next); setState('ready'); }
      } catch { if (!controller.signal.aborted) setState('error'); }
    });
    return () => controller.abort();
  }, [refresh, page, search, filter]);
  const rows = snapshot?.people ?? [];
  const currentPage = snapshot?.pagination.page ?? 1;
  return <div style={{ maxWidth: 1300 }}>
    <PageHeader title="Document assurance overview" description="Current employee-document assurance and expiry work within your document access." actions={<>
      <HrOperationsNav current="/people/documents" />
      <button type="button" {...buttonProps('secondary')} disabled={state === 'loading'} onClick={() => setRefresh(value => value + 1)}>Refresh</button>
    </>} />
    <HrRegisterSearch value={search} onChange={value => { setSearch(value); setPage(1); }} />
    <label>Show documents{' '}<select value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}>
      <option value="all">All visible documents</option>
      {Object.entries(COLUMNS).filter(([key]) => key !== 'documents').map(([key, title]) => <option key={key} value={key}>{title}</option>)}
    </select></label>
    <HrRegisterReset active={Boolean(search) || filter !== 'all' || page !== 1} onReset={() => { setSearch(''); setFilter('all'); setPage(1); }} />
    <TableContainer label="Employee document assurance" minWidth={1100}>
      <table className={tableStyles.table}>
        <thead><tr><th scope="col">Person</th>{Object.entries(COLUMNS).map(([key, title]) => <th scope="col" key={key}>{title}</th>)}</tr></thead>
        <tbody>
          {state === 'loading' && <TableStateRow colSpan={9} kind="loading">Loading document overview…</TableStateRow>}
          {state === 'error' && <TableStateRow colSpan={9} kind="error">Unable to load document overview. Please refresh to try again.</TableStateRow>}
          {state === 'ready' && rows.length === 0 && <TableStateRow colSpan={9} kind="empty">No visible employee documents match this view.</TableStateRow>}
          {state === 'ready' && rows.map(person => <tr key={person.person_id}>
            <td className={tableStyles.primary}><button type="button" onClick={() => setPersonId(person.person_id)}>{person.first_name} {person.last_name}</button></td>
            {Object.keys(COLUMNS).map(key => <td key={key}>{person[key as keyof Counts]}</td>)}
          </tr>)}
        </tbody>
      </table>
    </TableContainer>
    {state === 'ready' && <HrRegisterPagination page={currentPage} total={snapshot?.pagination.total ?? 0} onChange={setPage} />}
    <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
      {snapshot && <>As of {snapshot.as_of_date} (UTC); upcoming expiry through {snapshot.expiring_through}. </>}
      Expiry excludes today. Counts cover current versions and may overlap. Unacknowledged means no acknowledgement by the currently linked employee; it does not imply a required acknowledgement. Employees without a linked account are shown separately. Open a person to review documents.
    </p>
    <PersonDrawer personId={personId} canManage={false} onEdit={() => {}} onClose={() => { setPersonId(null); setRefresh(value => value + 1); }} />
  </div>;
}
