'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PersonDrawer from '../../_components/PersonDrawer';
import { PageHeader, TableContainer, TableStateRow, buttonProps, tableStyles } from '@/components/ui/app';

const STATUSES = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', AWAITING_APPROVAL: 'Awaiting approval' };
type Task = { task_id: string; workflow_id: string; person_id: string; lifecycle_type: 'onboarding' | 'offboarding'; title: string; status: keyof typeof STATUSES; due_at: string | null; overdue: boolean };
type Person = { id: string; first_name: string; last_name: string };
type Snapshot = { as_of: string; tasks: Task[]; people: Person[] };

function parseSnapshot(queue: unknown, people: unknown): Snapshot {
  if (!queue || typeof queue !== 'object' || !('as_of' in queue) || typeof queue.as_of !== 'string' || !Number.isFinite(Date.parse(queue.as_of))
    || !('tasks' in queue) || !Array.isArray(queue.tasks)
    || !people || typeof people !== 'object' || !('people' in people) || !Array.isArray(people.people)) throw new Error('Invalid queue');
  for (const task of queue.tasks) {
    if (!task || !['task_id', 'workflow_id', 'person_id', 'title'].every(key => typeof task[key] === 'string')
      || !Object.hasOwn(STATUSES, task.status) || !['onboarding', 'offboarding'].includes(task.lifecycle_type)
      || typeof task.overdue !== 'boolean' || (task.due_at !== null && (typeof task.due_at !== 'string' || !Number.isFinite(Date.parse(task.due_at))))) throw new Error('Invalid task');
  }
  for (const person of people.people) {
    if (!person || typeof person.id !== 'string' || typeof person.first_name !== 'string' || typeof person.last_name !== 'string') throw new Error('Invalid person');
  }
  return { as_of: queue.as_of, tasks: queue.tasks, people: people.people };
}

export default function LifecycleTaskQueuePage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState('all');
  const [personId, setPersonId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      setState('loading'); setSnapshot(null);
      try {
        const options = { signal: controller.signal, cache: 'no-store' as const };
        const [queue, people] = await Promise.all([fetch('/api/hr/lifecycle/queue', options), fetch('/api/hr/people', options)]);
        if (!queue.ok || !people.ok) throw new Error('Unavailable');
        const [queueBody, peopleBody] = await Promise.all([queue.json(), people.json()]);
        const next = parseSnapshot(queueBody, peopleBody);
        if (!controller.signal.aborted) { setSnapshot(next); setState('ready'); }
      } catch { if (!controller.signal.aborted) setState('error'); }
    });
    return () => controller.abort();
  }, [refresh]);
  const names = new Map(snapshot?.people.map(person => [person.id, `${person.first_name} ${person.last_name}`]));
  const tasks = snapshot?.tasks.filter(task => filter === 'all' || (filter === 'overdue' ? task.overdue : task.status === filter)) ?? [];
  return <div style={{ maxWidth: 1100 }}>
    <PageHeader title="Lifecycle task queue" description="Visible outstanding tasks from active workflows, with overdue work first." actions={<>
      <Link href="/people/lifecycle" {...buttonProps('secondary')}>Lifecycle overview</Link>
      <button type="button" {...buttonProps('secondary')} disabled={state === 'loading'} onClick={() => setRefresh(value => value + 1)}>Refresh</button>
    </>} />
    <label>Show tasks{' '}<select value={filter} onChange={event => setFilter(event.target.value)}>
      <option value="all">All outstanding</option><option value="overdue">Overdue</option>
      {Object.entries(STATUSES).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
    </select></label>
    <TableContainer label="Outstanding lifecycle tasks" minWidth={750}>
      <table className={tableStyles.table}>
        <thead><tr>{['Person', 'Lifecycle', 'Task', 'Status', 'Due (UTC)', 'Overdue'].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead>
        <tbody>
          {state === 'loading' && <TableStateRow colSpan={6} kind="loading">Loading task queue…</TableStateRow>}
          {state === 'error' && <TableStateRow colSpan={6} kind="error">Unable to load lifecycle task queue. Please refresh to try again.</TableStateRow>}
          {state === 'ready' && tasks.length === 0 && <TableStateRow colSpan={6} kind="empty">No visible outstanding tasks match this view.</TableStateRow>}
          {state === 'ready' && tasks.map(task => <tr key={task.task_id}>
            <td className={tableStyles.primary}><button type="button" onClick={() => setPersonId(task.person_id)}>{names.get(task.person_id) ?? 'Open person'}</button></td>
            <td>{task.lifecycle_type === 'onboarding' ? 'Onboarding' : 'Offboarding'}</td><td>{task.title}</td><td>{STATUSES[task.status]}</td>
            <td>{task.due_at ? `${task.due_at.slice(0, 10)} ${task.due_at.slice(11, 16)}` : 'No due date'}</td><td>{task.overdue ? 'Yes' : 'No'}</td>
          </tr>)}
        </tbody>
      </table>
    </TableContainer>
    <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Hidden tasks are excluded. Visibility does not grant execution or approval rights; open a person to review the available actions. {snapshot && <>As of {snapshot.as_of}.</>}</p>
    <PersonDrawer personId={personId} canManage={false} onEdit={() => {}} onClose={() => { setPersonId(null); setRefresh(value => value + 1); }} />
  </div>;
}
