'use client';
import { useMemo, useState } from 'react';
import { Button, Dialog, Field, FormActions, StateMessage, fieldControlClassName } from '@/components/ui/app';
import { schedulingApi, seg, type ApiProblem } from '@/lib/scheduling/dashboard/api';
import type { OfferingView, ResourceView, ScheduleView } from '@/lib/scheduling/dashboard/types';
import { RESOURCE_KIND_LABELS, kindsFor, wordingFor } from '@/lib/scheduling/dashboard/wording';
import { LoadError, ProblemNotice } from './parts';
import { useSchedulingData } from './useSchedulingData';
import styles from './scheduling.module.css';

// Assign resources to an offering and remove them again. Only active resources of a type the schedule accepts are offered; the
// API (and the database behind it) refuse anything else. Removing an assignment deletes only the link: reservations and history
// are never touched, and the API refuses while a live reservation of the offering holds the resource.

export function AssignDialog({
  schedule,
  offering,
  canManage,
  onClose,
  onChanged,
}: {
  schedule: ScheduleView;
  offering: OfferingView;
  canManage: boolean;
  onClose: () => void;
  /** Called after any change so the screen behind can refresh its own list. */
  onChanged: () => void;
}) {
  const words = wordingFor(schedule);
  const assigned = useSchedulingData<{ resources: ResourceView[] }>(`/offerings/${seg(offering.id)}/resources`);
  const all = useSchedulingData<{ resources: ResourceView[] }>('/resources');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const accepted = kindsFor(schedule.presetKey);

  const assignedIds = useMemo(() => new Set((assigned.data?.resources ?? []).map(r => r.id)), [assigned.data]);
  const candidates = useMemo(
    () => (all.data?.resources ?? []).filter(r => r.active && accepted.includes(r.kind) && !assignedIds.has(r.id)),
    [all.data, accepted, assignedIds],
  );

  async function assign() {
    if (!pick) return;
    setBusy('assign');
    setProblem(null);
    const result = await schedulingApi('POST', `/offerings/${seg(offering.id)}/resources`, { resourceId: pick });
    setBusy(null);
    if (!result.ok) return setProblem(result.problem);
    setPick('');
    assigned.reload();
    onChanged();
  }

  async function remove(resource: ResourceView) {
    setBusy(resource.id);
    setProblem(null);
    const result = await schedulingApi('DELETE', `/offerings/${seg(offering.id)}/resources/${seg(resource.id)}`);
    setBusy(null);
    if (!result.ok) return setProblem(result.problem);
    assigned.reload();
    onChanged();
  }

  const loading = assigned.state === 'loading' || all.state === 'loading';
  const failed = assigned.state === 'error' ? assigned.problem : all.state === 'error' ? all.problem : null;

  return (
    <Dialog open onClose={onClose} title={`${words.resourcePlural} for ${offering.name}`} width={560}>
      <div className={styles.form}>
        {loading && <StateMessage kind="loading" title="Loading…" />}
        {failed && <LoadError problem={failed} onRetry={() => { assigned.reload(); all.reload(); }} />}
        {!loading && !failed && (
          <>
            <p className={styles.dim}>
              {schedule.presetKey === 'classes_coaching'
                ? `Optional: assign ${words.resourcePlural.toLowerCase()} a ${words.offering.toLowerCase()} can use.`
                : `Customers can only book ${words.resourcePlural.toLowerCase()} assigned here.`}{' '}
              Accepted types: {accepted.map(k => RESOURCE_KIND_LABELS[k]).join(', ')}.
            </p>

            {assignedIds.size === 0 ? (
              <p className={styles.notice} role="status">No {words.resourcePlural.toLowerCase()} assigned yet.</p>
            ) : (
              <ul className={styles.assignList} aria-label={`Assigned ${words.resourcePlural.toLowerCase()}`}>
                {(assigned.data?.resources ?? []).map(r => (
                  <li key={r.id} className={styles.assignRow}>
                    <span>
                      <strong>{r.name}</strong> <span className={styles.dim}>{RESOURCE_KIND_LABELS[r.kind]}{r.active ? '' : ' (inactive)'}</span>
                    </span>
                    {canManage && (
                      <Button size="sm" variant="ghost" disabled={busy !== null} aria-busy={busy === r.id || undefined} onClick={() => remove(r)} aria-label={`Remove ${r.name}`}>
                        {busy === r.id ? 'Removing…' : 'Remove'}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canManage && (
              candidates.length === 0 ? (
                <p className={styles.dim}>No other active {words.resourcePlural.toLowerCase()} of an accepted type. Add one under Resources.</p>
              ) : (
                <div className={styles.assignAdd}>
                  <Field label={`Add a ${words.resource.toLowerCase()}`}>
                    {p => (
                      <select {...p} className={fieldControlClassName} value={pick} onChange={e => setPick(e.target.value)}>
                        <option value="">Choose…</option>
                        {candidates.map(r => <option key={r.id} value={r.id}>{r.name} ({RESOURCE_KIND_LABELS[r.kind]})</option>)}
                      </select>
                    )}
                  </Field>
                  <Button variant="primary" disabled={!pick || busy !== null} aria-busy={busy === 'assign' || undefined} onClick={assign}>
                    {busy === 'assign' ? 'Adding…' : 'Add'}
                  </Button>
                </div>
              )
            )}
          </>
        )}
        {problem && <ProblemNotice problem={problem} />}
        <FormActions>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </FormActions>
      </div>
    </Dialog>
  );
}
