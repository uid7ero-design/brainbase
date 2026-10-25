'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge, Button, PageHeader, StateMessage, buttonProps, fieldControlClassName } from '@/components/ui/app';
import { schedulingApi, seg } from '@/lib/scheduling/dashboard/api';
import type { ResourceView } from '@/lib/scheduling/dashboard/types';
import { RESOURCE_KIND_LABELS } from '@/lib/scheduling/dashboard/wording';
import { ConfirmDialog } from './ConfirmDialog';
import { DataList, EmptyBlock, LoadError, type Column } from './parts';
import { ResourceDialog } from './ResourceDialog';
import { useSchedulingData } from './useSchedulingData';
import styles from './scheduling.module.css';

// Resources: the courts, rooms, practitioners, spaces and equipment an organisation books. They belong to the organisation, not to one
// schedule: the same resource can be assigned to several offerings (assignment is done from the schedule screen).

type Mode =
  | { kind: 'create' }
  | { kind: 'edit'; resource: ResourceView }
  | { kind: 'deactivate'; resource: ResourceView }
  | { kind: 'reactivate'; resource: ResourceView };
type StatusFilter = 'active' | 'inactive' | 'all';

export default function ResourcesManager({ canManage }: { canManage: boolean }) {
  const { state, data, problem, refreshing, reload } = useSchedulingData<{ resources: ResourceView[] }>('/resources');
  const [mode, setMode] = useState<Mode | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const resources = useMemo(() => data?.resources ?? [], [data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resources.filter(r => (status === 'all' || (status === 'active') === r.active) && (!q || r.name.toLowerCase().includes(q)));
  }, [resources, query, status]);
  const inactiveCount = resources.filter(r => !r.active).length;

  const close = () => setMode(null);
  const closeAndReload = () => {
    setMode(null);
    reload();
  };

  const columns: Column<ResourceView>[] = [
    { key: 'name', header: 'Name', primary: true, cell: r => r.name },
    { key: 'kind', header: 'Type', cell: r => RESOURCE_KIND_LABELS[r.kind] },
    { key: 'capacity', header: 'Capacity', cell: r => r.capacity },
    { key: 'status', header: 'Status', cell: r => <Badge state={r.active ? 'success' : 'inactive'}>{r.active ? 'Active' : 'Inactive'}</Badge> },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Resources"
        description="The courts, rooms, practitioners, spaces and equipment you book. Assign them to offerings from a schedule."
        actions={canManage ? <Button variant="primary" onClick={() => setMode({ kind: 'create' })}>New resource</Button> : undefined}
      />
      {!canManage && <p className={styles.notice} role="note">You have view-only access to Scheduling. Ask a manager to make changes.</p>}

      {state === 'loading' && <StateMessage kind="loading" title="Loading resources…" />}
      {state === 'error' && problem && <LoadError problem={problem} onRetry={reload} />}

      {state === 'ready' && (
        <>
          {resources.length === 0 ? (
            <EmptyBlock
              title="No resources yet"
              action={canManage ? <Button variant="primary" onClick={() => setMode({ kind: 'create' })}>Add your first resource</Button> : undefined}
            >
              {canManage ? 'Add the things a customer books, such as a court, a room or a practitioner.' : 'A manager has not added any resources yet.'}
            </EmptyBlock>
          ) : (
            <>
              <div className={styles.toolbar}>
                <label className={styles.toolbarGrow}>
                  <span className="bb-visually-hidden">Search resources</span>
                  <input type="search" className={fieldControlClassName} placeholder="Search by name" value={query} onChange={e => setQuery(e.target.value)} />
                </label>
                <label className={styles.toolbarFilter}>
                  <span className="bb-visually-hidden">Status</span>
                  <select className={fieldControlClassName} value={status} onChange={e => setStatus(e.target.value as StatusFilter)}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive{inactiveCount ? ` (${inactiveCount})` : ''}</option>
                    <option value="all">All</option>
                  </select>
                </label>
                {refreshing && <span className={styles.dim} role="status">Refreshing…</span>}
              </div>
              {visible.length === 0 ? (
                <p className={styles.dim} role="status">No resources match this filter.</p>
              ) : (
                <DataList
                  label="Resources"
                  rows={visible}
                  columns={columns}
                  archivedOf={r => !r.active}
                  actions={r => (
                    <span className={styles.actionButtons}>
                      <Link href={`/scheduling/resources/${seg(r.id)}/availability`} {...buttonProps('secondary', 'sm')} aria-label={`Hours for ${r.name}`}>Hours</Link>
                      {canManage && (
                        <>
                          <Button size="sm" onClick={() => setMode({ kind: 'edit', resource: r })} aria-label={`Edit ${r.name}`}>Edit</Button>
                          {r.active ? (
                            <Button size="sm" variant="ghost" onClick={() => setMode({ kind: 'deactivate', resource: r })} aria-label={`Deactivate ${r.name}`}>Deactivate</Button>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setMode({ kind: 'reactivate', resource: r })} aria-label={`Reactivate ${r.name}`}>Reactivate</Button>
                          )}
                        </>
                      )}
                    </span>
                  )}
                />
              )}
            </>
          )}
        </>
      )}

      {mode?.kind === 'create' && <ResourceDialog mode="create" onClose={close} onSaved={closeAndReload} />}
      {mode?.kind === 'edit' && <ResourceDialog mode="edit" resource={mode.resource} onClose={close} onSaved={closeAndReload} onReload={closeAndReload} />}
      {mode?.kind === 'deactivate' && (
        <ConfirmDialog
          title={`Deactivate ${mode.resource.name}`}
          confirmLabel="Deactivate"
          busyLabel="Deactivating…"
          danger
          run={() => schedulingApi<{ resource: ResourceView }>('POST', `/resources/${seg(mode.resource.id)}/deactivate`, { expectedUpdatedAt: mode.resource.updatedAt })}
          onClose={close}
          onDone={closeAndReload}
          onReload={closeAndReload}
        >
          <p className={styles.body}><strong>{mode.resource.name}</strong> will stop being offered for new reservations. Its history is kept and you can reactivate it at any time.</p>
          <p className={styles.body}>A resource cannot be deactivated while a live reservation holds it.</p>
        </ConfirmDialog>
      )}
      {mode?.kind === 'reactivate' && (
        <ConfirmDialog
          title={`Reactivate ${mode.resource.name}`}
          confirmLabel="Reactivate"
          busyLabel="Reactivating…"
          run={() => schedulingApi<{ resource: ResourceView }>('POST', `/resources/${seg(mode.resource.id)}/reactivate`, { expectedUpdatedAt: mode.resource.updatedAt })}
          onClose={close}
          onDone={closeAndReload}
          onReload={closeAndReload}
        >
          <p className={styles.body}><strong>{mode.resource.name}</strong> will be available for new reservations again.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
