'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge, Button, PageHeader, Panel, StateMessage, buttonProps } from '@/components/ui/app';
import { schedulingApi, seg } from '@/lib/scheduling/dashboard/api';
import type { OfferingView, ScheduleView, StatusView } from '@/lib/scheduling/dashboard/types';
import { RESOURCE_KIND_LABELS, describeCancellation, formatDuration, formatMoney, presetName, recurrenceSummary, wordingFor } from '@/lib/scheduling/dashboard/wording';
import { offeringFieldPlan } from '@/lib/scheduling/dashboard/forms';
import { AssignDialog } from './AssignDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { OfferingDialog } from './OfferingDialog';
import { DataList, EmptyBlock, LoadError, type Column } from './parts';
import { ScheduleDialog } from './ScheduleDialog';
import { useSchedulingData } from './useSchedulingData';
import styles from './scheduling.module.css';

// One schedule: its details, and its offerings with their assigned resources. All wording ("sessions", "services", "facilities")
// comes from the schedule's own type, so nothing here is specific to any one business.

type Mode =
  | { kind: 'editSchedule' }
  | { kind: 'archiveSchedule' }
  | { kind: 'createOffering' }
  | { kind: 'editOffering'; offering: OfferingView }
  | { kind: 'archiveOffering'; offering: OfferingView }
  | { kind: 'assign'; offering: OfferingView };

export default function ScheduleDetail({ scheduleId, canManage }: { scheduleId: string; canManage: boolean }) {
  const { state, data, problem, reload, refreshing } = useSchedulingData<{ schedule: ScheduleView; offerings: OfferingView[] }>(`/schedules/${seg(scheduleId)}`);
  const status = useSchedulingData<StatusView>('/status');
  const [mode, setMode] = useState<Mode | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const schedule = data?.schedule ?? null;
  const offerings = useMemo(() => data?.offerings ?? [], [data]);
  const visibleOfferings = useMemo(() => offerings.filter(o => showArchived || o.archivedAt === null), [offerings, showArchived]);
  const archivedOfferings = offerings.filter(o => o.archivedAt !== null).length;
  const currency = status.data?.currency ?? offerings[0]?.price.currency ?? '';

  const close = () => setMode(null);
  const closeAndReload = () => {
    setMode(null);
    reload();
  };

  if (state === 'loading') return <div className={styles.page}><StateMessage kind="loading" title="Loading…" /></div>;
  if (state === 'error' && problem) {
    return (
      <div className={styles.page}>
        <LoadError problem={problem} onRetry={reload} />
        <p className={styles.dim}><Link href="/scheduling/schedules">Back to schedules</Link></p>
      </div>
    );
  }
  if (!schedule) return null;

  const words = wordingFor(schedule);
  const plan = offeringFieldPlan(schedule.presetKey);
  const archived = schedule.archivedAt !== null;
  const canEdit = canManage && !archived;
  const liveOfferings = offerings.filter(o => o.archivedAt === null);

  const columns: Column<OfferingView>[] = [
    { key: 'name', header: 'Name', primary: true, cell: o => o.name },
    { key: 'duration', header: 'Duration', cell: o => (o.durationMinutes === null && plan.duration === 'optional' ? 'Customer chooses' : formatDuration(o.durationMinutes)) },
    ...(plan.capacity === 'required' ? [{ key: 'capacity', header: 'Capacity', cell: (o: OfferingView) => (o.capacity === null ? '—' : o.capacity) }] : []),
    { key: 'price', header: 'Price', cell: o => formatMoney(o.price.amountCents, o.price.currency) },
    { key: 'repeat', header: 'Runs', cell: o => recurrenceSummary(o.recurrence, o.startTime) },
    {
      key: 'resources',
      header: words.resourcePlural,
      cell: o =>
        o.resourceKinds.length === 0 ? (
          <span className={styles.dim}>{schedule.presetKey === 'classes_coaching' ? 'None (optional)' : 'None assigned'}</span>
        ) : (
          <span className={styles.chips}>{o.resourceKinds.map(k => <span key={k} className={styles.chip}>{RESOURCE_KIND_LABELS[k]}</span>)}</span>
        ),
    },
    { key: 'status', header: 'Status', cell: o => <Badge state={o.archivedAt === null ? 'success' : 'inactive'}>{o.archivedAt === null ? 'Active' : 'Archived'}</Badge> },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={<Link href="/scheduling/schedules">Schedules</Link>}
        title={schedule.name}
        meta={archived ? <Badge state="inactive">Archived</Badge> : <Badge state="info">{presetName(schedule.presetKey)}</Badge>}
        description={archived ? 'This schedule is archived and can no longer be changed.' : undefined}
        actions={
          canEdit ? (
            <>
              <Button onClick={() => setMode({ kind: 'editSchedule' })}>Edit schedule</Button>
              <Button variant="ghost" onClick={() => setMode({ kind: 'archiveSchedule' })}>Archive</Button>
            </>
          ) : undefined
        }
      />
      {!canManage && <p className={styles.notice} role="note">You have view-only access to Scheduling. Ask a manager to make changes.</p>}

      <Panel title="Details">
        <dl className={styles.facts}>
          <div><dt>Type</dt><dd>{presetName(schedule.presetKey)}</dd></div>
          <div><dt>Timezone</dt><dd>{schedule.timezone ?? 'Organisation default'}</dd></div>
          <div><dt>Cancellation</dt><dd>{describeCancellation(schedule.cancellationPolicy)}</dd></div>
        </dl>
      </Panel>

      <div className={styles.sectionGap}>
        <Panel
          title={words.offeringPlural}
          actions={
            canEdit ? <Button variant="primary" onClick={() => setMode({ kind: 'createOffering' })}>New {words.offering.toLowerCase()}</Button> : undefined
          }
        >
          {offerings.length === 0 ? (
            <EmptyBlock
              title={`No ${words.offeringPlural.toLowerCase()} yet`}
              action={canEdit ? <Button variant="primary" onClick={() => setMode({ kind: 'createOffering' })}>Create the first {words.offering.toLowerCase()}</Button> : undefined}
            >
              {canEdit ? `A ${words.offering.toLowerCase()} is what a customer books. You can assign ${words.resourcePlural.toLowerCase()} to it afterwards.` : `No ${words.offeringPlural.toLowerCase()} have been set up.`}
            </EmptyBlock>
          ) : (
            <>
              {archivedOfferings > 0 && (
                <label className={styles.check}>
                  <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
                  <span>Show archived ({archivedOfferings})</span>
                </label>
              )}
              {refreshing && <p className={styles.dim} role="status">Refreshing…</p>}
              {liveOfferings.length === 0 && !showArchived ? (
                <p className={styles.dim} role="status">Every {words.offering.toLowerCase()} is archived.</p>
              ) : (
                <DataList
                  label={words.offeringPlural}
                  rows={visibleOfferings}
                  columns={columns}
                  archivedOf={o => o.archivedAt !== null}
                  actions={o =>
                    o.archivedAt !== null ? (
                      <span className={styles.actionButtons}>
                        <Link href={`/scheduling/offerings/${seg(o.id)}/availability`} {...buttonProps('secondary', 'sm')} aria-label={`Hours for ${o.name}`}>Hours</Link>
                        <Link href={`/scheduling/offerings/${seg(o.id)}/calendar`} {...buttonProps('secondary', 'sm')} aria-label={`Calendar for ${o.name}`}>Calendar</Link>
                      </span>
                    ) : (
                      <span className={styles.actionButtons}>
                        <Link href={`/scheduling/offerings/${seg(o.id)}/availability`} {...buttonProps('secondary', 'sm')} aria-label={`Hours for ${o.name}`}>Hours</Link>
                        <Link href={`/scheduling/offerings/${seg(o.id)}/calendar`} {...buttonProps('secondary', 'sm')} aria-label={`Calendar for ${o.name}`}>Calendar</Link>
                        <Button size="sm" onClick={() => setMode({ kind: 'assign', offering: o })} aria-label={`${canEdit ? 'Assign' : 'View'} ${words.resourcePlural.toLowerCase()} for ${o.name}`}>
                          {words.resourcePlural}
                        </Button>
                        {canEdit && (
                          <>
                            <Button size="sm" onClick={() => setMode({ kind: 'editOffering', offering: o })} aria-label={`Edit ${o.name}`}>Edit</Button>
                            <Button size="sm" variant="ghost" onClick={() => setMode({ kind: 'archiveOffering', offering: o })} aria-label={`Archive ${o.name}`}>Archive</Button>
                          </>
                        )}
                      </span>
                    )
                  }
                />
              )}
            </>
          )}
        </Panel>
      </div>

      {mode?.kind === 'editSchedule' && (
        <ScheduleDialog mode="edit" schedule={schedule} presetChangeable={offerings.length === 0} onClose={close} onSaved={closeAndReload} onReload={closeAndReload} />
      )}
      {mode?.kind === 'archiveSchedule' && (
        <ConfirmDialog
          title={`Archive ${schedule.name}`}
          confirmLabel="Archive schedule"
          busyLabel="Archiving…"
          danger
          run={() => schedulingApi<{ archived: true }>('POST', `/schedules/${seg(schedule.id)}/archive`)}
          onClose={close}
          onDone={closeAndReload}
          onReload={closeAndReload}
        >
          <p className={styles.body}>
            <strong>{schedule.name}</strong> will be archived. Its {words.offeringPlural.toLowerCase()} and any reservations already made are kept, but nothing new can be added to it. Archiving cannot be undone.
          </p>
        </ConfirmDialog>
      )}
      {mode?.kind === 'createOffering' && <OfferingDialog mode="create" schedule={schedule} currency={currency} onClose={close} onSaved={closeAndReload} />}
      {mode?.kind === 'editOffering' && (
        <OfferingDialog mode="edit" offering={mode.offering} schedule={schedule} currency={currency} onClose={close} onSaved={closeAndReload} onReload={closeAndReload} />
      )}
      {mode?.kind === 'archiveOffering' && (
        <ConfirmDialog
          title={`Archive ${mode.offering.name}`}
          confirmLabel={`Archive ${words.offering.toLowerCase()}`}
          busyLabel="Archiving…"
          danger
          run={() => schedulingApi<{ archived: true }>('POST', `/offerings/${seg(mode.offering.id)}/archive`)}
          onClose={close}
          onDone={closeAndReload}
          onReload={closeAndReload}
        >
          <p className={styles.body}><strong>{mode.offering.name}</strong> will stop accepting new reservations. Reservations already made are kept. Archiving cannot be undone.</p>
        </ConfirmDialog>
      )}
      {mode?.kind === 'assign' && <AssignDialog schedule={schedule} offering={mode.offering} canManage={canEdit} onClose={closeAndReload} onChanged={reload} />}
    </div>
  );
}
