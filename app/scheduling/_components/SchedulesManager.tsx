'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge, Button, PageHeader, StateMessage, fieldControlClassName } from '@/components/ui/app';
import { schedulingApi, seg } from '@/lib/scheduling/dashboard/api';
import type { ScheduleView } from '@/lib/scheduling/dashboard/types';
import { describeCancellation, presetName, wordingFor } from '@/lib/scheduling/dashboard/wording';
import { ConfirmDialog } from './ConfirmDialog';
import { DataList, EmptyBlock, LoadError, type Column } from './parts';
import { ScheduleDialog } from './ScheduleDialog';
import { useSchedulingData } from './useSchedulingData';
import styles from './scheduling.module.css';

// Schedules: list, create (with the preset picker), edit, archive. A "schedule" is a line of business; its type decides the wording
// everywhere else ("Sessions", "Services", "Facilities"), so the wording below always comes from the schedule's own preset.

type Mode = { kind: 'create' } | { kind: 'edit'; schedule: ScheduleView } | { kind: 'archive'; schedule: ScheduleView };
type StatusFilter = 'active' | 'archived' | 'all';

export default function SchedulesManager({ canManage }: { canManage: boolean }) {
  const { state, data, problem, refreshing, reload } = useSchedulingData<{ schedules: ScheduleView[] }>('/schedules');
  const [mode, setMode] = useState<Mode | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const schedules = useMemo(() => data?.schedules ?? [], [data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return schedules.filter(s => (status === 'all' || (status === 'active') === (s.archivedAt === null)) && (!q || s.name.toLowerCase().includes(q)));
  }, [schedules, query, status]);
  const archivedCount = schedules.filter(s => s.archivedAt !== null).length;

  const close = () => setMode(null);
  const closeAndReload = () => {
    setMode(null);
    reload();
  };

  const columns: Column<ScheduleView>[] = [
    {
      key: 'name',
      header: 'Name',
      primary: true,
      cell: s => (
        <Link className={styles.nameLink} href={`/scheduling/schedules/${seg(s.id)}`}>
          {s.name}
        </Link>
      ),
    },
    { key: 'type', header: 'Type', cell: s => presetName(s.presetKey) },
    { key: 'cancel', header: 'Cancellation', cell: s => describeCancellation(s.cancellationPolicy) },
    { key: 'status', header: 'Status', cell: s => <Badge state={s.archivedAt === null ? 'success' : 'inactive'}>{s.archivedAt === null ? 'Active' : 'Archived'}</Badge> },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Schedules"
        description="Each schedule is a line of business, such as coaching, appointments or facility hire. Its type sets the wording used throughout."
        actions={canManage ? <Button variant="primary" onClick={() => setMode({ kind: 'create' })}>New schedule</Button> : undefined}
      />
      {!canManage && <p className={styles.notice} role="note">You have view-only access to Scheduling. Ask a manager to make changes.</p>}

      {state === 'loading' && <StateMessage kind="loading" title="Loading schedules…" />}
      {state === 'error' && problem && <LoadError problem={problem} onRetry={reload} />}

      {state === 'ready' && (
        <>
          {schedules.length === 0 ? (
            <EmptyBlock
              title="No schedules yet"
              action={canManage ? <Button variant="primary" onClick={() => setMode({ kind: 'create' })}>Create your first schedule</Button> : undefined}
            >
              {canManage ? 'Start by choosing what kind of bookings you take. You can add offerings and resources next.' : 'A manager has not set up any schedules yet.'}
            </EmptyBlock>
          ) : (
            <>
              <div className={styles.toolbar}>
                <label className={styles.toolbarGrow}>
                  <span className="bb-visually-hidden">Search schedules</span>
                  <input type="search" className={fieldControlClassName} placeholder="Search by name" value={query} onChange={e => setQuery(e.target.value)} />
                </label>
                <label className={styles.toolbarFilter}>
                  <span className="bb-visually-hidden">Status</span>
                  <select className={fieldControlClassName} value={status} onChange={e => setStatus(e.target.value as StatusFilter)}>
                    <option value="active">Active</option>
                    <option value="archived">Archived{archivedCount ? ` (${archivedCount})` : ''}</option>
                    <option value="all">All</option>
                  </select>
                </label>
                {refreshing && <span className={styles.dim} role="status">Refreshing…</span>}
              </div>
              {visible.length === 0 ? (
                <p className={styles.dim} role="status">No schedules match this filter.</p>
              ) : (
                <DataList
                  label="Schedules"
                  rows={visible}
                  columns={columns}
                  archivedOf={s => s.archivedAt !== null}
                  actions={
                    canManage
                      ? s =>
                          s.archivedAt === null ? (
                            <span className={styles.actionButtons}>
                              <Button size="sm" onClick={() => setMode({ kind: 'edit', schedule: s })} aria-label={`Edit ${s.name}`}>Edit</Button>
                              <Button size="sm" variant="ghost" onClick={() => setMode({ kind: 'archive', schedule: s })} aria-label={`Archive ${s.name}`}>Archive</Button>
                            </span>
                          ) : null
                      : undefined
                  }
                />
              )}
            </>
          )}
        </>
      )}

      {mode?.kind === 'create' && <ScheduleDialog mode="create" onClose={close} onSaved={closeAndReload} />}
      {mode?.kind === 'edit' && (
        <ScheduleDialog mode="edit" schedule={mode.schedule} presetChangeable={false} onClose={close} onSaved={closeAndReload} onReload={closeAndReload} />
      )}
      {mode?.kind === 'archive' && (
        <ConfirmDialog
          title={`Archive ${mode.schedule.name}`}
          confirmLabel="Archive schedule"
          busyLabel="Archiving…"
          danger
          run={() => schedulingApi<{ archived: true }>('POST', `/schedules/${seg(mode.schedule.id)}/archive`)}
          onClose={close}
          onDone={closeAndReload}
          onReload={closeAndReload}
        >
          <p className={styles.body}>
            <strong>{mode.schedule.name}</strong> will be archived. Its {wordingFor(mode.schedule).offeringPlural.toLowerCase()} and any reservations already made are kept, but nothing new can be added to it.
          </p>
          <p className={styles.body}>Archiving cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
