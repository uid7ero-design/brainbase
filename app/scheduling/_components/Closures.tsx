'use client';
import { useMemo, useState } from 'react';
import { Badge, Button, Panel } from '@/components/ui/app';
import { schedulingApi, seg } from '@/lib/scheduling/dashboard/api';
import { closureTimesText, formatDateRange, splitClosures } from '@/lib/scheduling/dashboard/availability';
import type { AvailabilityClosureView } from '@/lib/scheduling/dashboard/types';
import { ClosureDialog } from './ClosureDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { DataList, EmptyBlock, type Column } from './parts';
import styles from './scheduling.module.css';

// Closures: dates when the offering or resource is closed, for the whole day or for part of it. They only ever REMOVE availability.

type Mode =
  | { kind: 'add' }
  | { kind: 'edit'; closure: AvailabilityClosureView }
  | { kind: 'remove'; closure: AvailabilityClosureView };

export function Closures({
  ownerPath,
  closures,
  today,
  partialClosures,
  canAdd,
  canRemove,
  onChanged,
  announce,
}: {
  ownerPath: string;
  closures: AvailabilityClosureView[];
  /** Today's date in the hours' timezone, to tell upcoming closures from past ones. */
  today: string;
  partialClosures: boolean;
  canAdd: boolean;
  canRemove: boolean;
  onChanged: () => void;
  announce: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [showPast, setShowPast] = useState(false);
  const { upcoming, past } = useMemo(() => splitClosures(closures, today), [closures, today]);
  const rows = showPast ? [...upcoming, ...past] : upcoming;

  const close = () => setMode(null);
  const saved = (message: string) => {
    setMode(null);
    announce(message);
    onChanged();
  };
  const closeAndReload = () => {
    setMode(null);
    onChanged();
  };

  const columns: Column<AvailabilityClosureView>[] = [
    {
      key: 'dates',
      header: 'Dates',
      primary: true,
      cell: c => (
        <>
          {formatDateRange(c.fromDate, c.toDate)}
          {c.toDate < today && <span className={styles.windowMuted}> (past)</span>}
        </>
      ),
    },
    { key: 'times', header: 'Closed', cell: c => (c.startTime !== null ? <Badge state="warning">{closureTimesText(c)}</Badge> : <Badge state="inactive">Whole day</Badge>) },
    { key: 'reason', header: 'Reason', cell: c => c.reason ?? <span className={styles.dim}>None</span> },
  ];

  return (
    <Panel title="Closures" actions={canAdd ? <Button variant="primary" className={styles.touch} onClick={() => setMode({ kind: 'add' })}>Add closure</Button> : undefined}>
      {closures.length === 0 ? (
        <EmptyBlock
          title="No closures"
          action={canAdd ? <Button className={styles.touch} onClick={() => setMode({ kind: 'add' })}>Add a closure</Button> : undefined}
        >
          {canAdd ? 'Add a closure for a public holiday, a shutdown, or part of a day. Closures only remove availability.' : 'No closures have been saved.'}
        </EmptyBlock>
      ) : (
        <>
          {past.length > 0 && (
            <label className={styles.checkTouch}>
              <input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} />
              <span>Show past closures ({past.length})</span>
            </label>
          )}
          {rows.length === 0 ? (
            <p className={styles.dim} role="status">No upcoming closures.</p>
          ) : (
            <DataList
              label="Closures"
              rows={rows}
              columns={columns}
              archivedOf={c => c.toDate < today}
              actions={
                canAdd || canRemove
                  ? c => (
                      <span className={styles.actionButtons}>
                        {canAdd && (
                          <Button size="sm" className={styles.touch} aria-label={`Edit closure ${formatDateRange(c.fromDate, c.toDate)} ${closureTimesText(c)}`} onClick={() => setMode({ kind: 'edit', closure: c })}>Edit</Button>
                        )}
                        {canRemove && (
                          <Button size="sm" variant="ghost" className={styles.touch} aria-label={`Remove closure ${formatDateRange(c.fromDate, c.toDate)} ${closureTimesText(c)}`} onClick={() => setMode({ kind: 'remove', closure: c })}>Remove</Button>
                        )}
                      </span>
                    )
                  : undefined
              }
            />
          )}
        </>
      )}

      {mode?.kind === 'add' && <ClosureDialog mode="add" ownerPath={ownerPath} partialClosures={partialClosures} onClose={close} onSaved={saved} />}
      {mode?.kind === 'edit' && <ClosureDialog mode="edit" ownerPath={ownerPath} closure={mode.closure} partialClosures={partialClosures} onClose={close} onSaved={saved} onReload={closeAndReload} />}
      {mode?.kind === 'remove' && (
        <ConfirmDialog
          title="Remove closure"
          confirmLabel="Remove closure"
          busyLabel="Removing…"
          danger
          run={() => schedulingApi<{ deleted: true }>('DELETE', `/availability-exceptions/${seg(mode.closure.id)}`, { expectedUpdatedAt: mode.closure.updatedAt })}
          onClose={close}
          onDone={() => saved(`Closure removed: ${formatDateRange(mode.closure.fromDate, mode.closure.toDate)}.`)}
          onReload={closeAndReload}
        >
          <p className={styles.body}>
            The closure on <strong>{formatDateRange(mode.closure.fromDate, mode.closure.toDate)}</strong> ({closureTimesText(mode.closure).toLowerCase()}) will be removed, so the regular weekly hours apply on those dates again.
          </p>
        </ConfirmDialog>
      )}
    </Panel>
  );
}
