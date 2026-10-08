'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PersonDrawer from '../_components/PersonDrawer';
import { PageHeader, TableContainer, TableStateRow, buttonProps, tableStyles } from '@/components/ui/app';

type Workflow = {
  workflow_id: string; person_id: string; lifecycle_type: 'onboarding' | 'offboarding';
  visible_tasks: number; outstanding_tasks: number; awaiting_approval: number; overdue_tasks: number;
};
type Person = { id: string; first_name: string; last_name: string };
type Snapshot = { workflows: Workflow[]; people: Person[] };

function parseSnapshot(overview: unknown, people: unknown): Snapshot {
  if (!overview || typeof overview !== 'object' || !('workflows' in overview) || !Array.isArray(overview.workflows)
    || !people || typeof people !== 'object' || !('people' in people) || !Array.isArray(people.people)) throw new Error('Invalid overview');
  for (const row of overview.workflows) {
    if (!row || typeof row !== 'object' || typeof row.workflow_id !== 'string' || typeof row.person_id !== 'string'
      || !['onboarding', 'offboarding'].includes(row.lifecycle_type)
      || !['visible_tasks', 'outstanding_tasks', 'awaiting_approval', 'overdue_tasks'].every(key => Number.isSafeInteger(row[key]) && row[key] >= 0)) throw new Error('Invalid workflow');
  }
  for (const row of people.people) {
    if (!row || typeof row.id !== 'string' || typeof row.first_name !== 'string' || typeof row.last_name !== 'string') throw new Error('Invalid person');
  }
  return { workflows: overview.workflows, people: people.people };
}

export default function LifecycleOverviewPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState('all');
  const [personId, setPersonId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      setState('loading');
      setSnapshot(null);
      try {
        const options = { signal: controller.signal, cache: 'no-store' as const };
        const [overview, people] = await Promise.all([
          fetch('/api/hr/lifecycle/overview', options), fetch('/api/hr/people', options),
        ]);
        if (!overview.ok || !people.ok) throw new Error('Unavailable');
        const [overviewBody, peopleBody] = await Promise.all([overview.json(), people.json()]);
        const next = parseSnapshot(overviewBody, peopleBody);
        if (!controller.signal.aborted) { setSnapshot(next); setState('ready'); }
      } catch { if (!controller.signal.aborted) setState('error'); }
    });
    return () => controller.abort();
  }, [refresh]);

  const people = new Map(snapshot?.people.map(person => [person.id, `${person.first_name} ${person.last_name}`]));
  const rows = snapshot?.workflows.filter(row => filter === 'all'
    || (filter === 'outstanding' && row.outstanding_tasks > 0)
    || (filter === 'approvals' && row.awaiting_approval > 0)
    || (filter === 'overdue' && row.overdue_tasks > 0)) ?? [];

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader title="Lifecycle overview" description="Active workflows and visible outstanding work. Hidden tasks are excluded from all counts." actions={
        <><Link href="/people" {...buttonProps('secondary')}>People</Link><Link href="/people/lifecycle/tasks" {...buttonProps('secondary')}>Task queue</Link><button type="button" {...buttonProps('secondary')} onClick={() => setRefresh(value => value + 1)} disabled={state === 'loading'}>Refresh</button></>
      } />
      <label>Show workflows{' '}
        <select value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">All active</option><option value="outstanding">Outstanding work</option><option value="approvals">Awaiting approval</option><option value="overdue">Overdue work</option>
        </select>
      </label>
      <TableContainer label="Active lifecycle workflows" minWidth={700}>
        <table className={tableStyles.table}>
          <thead><tr><th scope="col">Person</th><th scope="col">Lifecycle</th><th scope="col">Visible tasks</th><th scope="col">Outstanding</th><th scope="col">Awaiting approval</th><th scope="col">Overdue</th></tr></thead>
          <tbody>
            {state === 'loading' && <TableStateRow colSpan={6} kind="loading">Loading lifecycle overview…</TableStateRow>}
            {state === 'error' && <TableStateRow colSpan={6} kind="error">Unable to load lifecycle overview. Please refresh to try again.</TableStateRow>}
            {state === 'ready' && rows.length === 0 && <TableStateRow colSpan={6} kind="empty">No active workflows match this view.</TableStateRow>}
            {state === 'ready' && rows.map(row => <tr key={row.workflow_id}>
              <td className={tableStyles.primary}><button type="button" onClick={() => setPersonId(row.person_id)}>{people.get(row.person_id) ?? 'Open person'}</button></td>
              <td>{row.lifecycle_type === 'onboarding' ? 'Onboarding' : 'Offboarding'}</td>
              <td>{row.visible_tasks}</td><td>{row.outstanding_tasks}</td><td>{row.awaiting_approval}</td><td>{row.overdue_tasks}</td>
            </tr>)}
          </tbody>
        </table>
      </TableContainer>
      <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Overdue means an outstanding task’s due time has passed. Counts reflect your current access when refreshed.</p>
      <PersonDrawer personId={personId} canManage={false} onEdit={() => {}} onClose={() => { setPersonId(null); setRefresh(value => value + 1); }} />
    </div>
  );
}
