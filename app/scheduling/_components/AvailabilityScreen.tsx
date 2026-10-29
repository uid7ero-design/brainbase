'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge, Button, PageHeader, Panel, StateMessage, buttonProps } from '@/components/ui/app';
import { seg } from '@/lib/scheduling/dashboard/api';
import { daylightSavingNotices, describeTimezone, effectiveTimezone, localToday } from '@/lib/scheduling/dashboard/availability';
import type { AvailabilityView, OfferingView, ResourceView, ScheduleView, StatusView } from '@/lib/scheduling/dashboard/types';
import { wordingFor } from '@/lib/scheduling/dashboard/wording';
import { Closures } from './Closures';
import { LoadError } from './parts';
import { useSchedulingData } from './useSchedulingData';
import { WeeklyHours } from './WeeklyHours';
import styles from './scheduling.module.css';

// The weekly hours and closures of ONE offering or resource. Everything on it comes from /api/scheduling/**, which authorises every
// request on its own; canManage only decides which controls are drawn. Product rules shown here:
//   - no saved hours means NO availability (nothing is implied by an empty week);
//   - closures only remove availability: there are no opening-hours overrides;
//   - times are wall-clock times in the zone shown, never converted for the viewer, and a later timezone change does not move them.

export default function AvailabilityScreen({ kind, id, canManage }: { kind: 'offering' | 'resource'; id: string; canManage: boolean }) {
  const ownerPath = kind === 'offering' ? `/offerings/${seg(id)}` : `/resources/${seg(id)}`;
  const availability = useSchedulingData<AvailabilityView>(`${ownerPath}/availability`);
  const owner = useSchedulingData<{ offering?: OfferingView; resource?: ResourceView }>(ownerPath);
  const scheduleId = owner.data?.offering?.scheduleId ?? null;
  const schedule = useSchedulingData<{ schedule: ScheduleView; offerings: OfferingView[] }>(scheduleId ? `/schedules/${seg(scheduleId)}` : null);
  const status = useSchedulingData<StatusView>('/status');
  const [message, setMessage] = useState('');

  const offering = owner.data?.offering ?? null;
  const resource = owner.data?.resource ?? null;
  const scheduleView = schedule.data?.schedule ?? null;
  const noun = kind === 'offering' ? (scheduleView ? wordingFor(scheduleView).offering.toLowerCase() : 'offering') : 'resource';
  const name = offering?.name ?? resource?.name ?? '';
  const blocked = kind === 'offering' ? offering !== null && (offering.archivedAt !== null || (scheduleView?.archivedAt ?? null) !== null) : resource !== null && !resource.active;
  const canAdd = canManage && !blocked;

  const tz = useMemo(
    () =>
      effectiveTimezone({
        kind,
        scheduleTimezone: scheduleView?.timezone ?? null,
        organisationTimezone: status.data?.timezone ?? null,
        organisationSource: status.data?.timezone_source ?? null,
        pinnedTimezone: availability.data?.zone?.pinned ? availability.data.zone.timezone : null,
      }),
    [kind, scheduleView, status.data, availability.data],
  );
  const today = useMemo(() => (tz ? localToday(tz.zone) : ''), [tz]);
  const view = availability.data;
  const notices = useMemo(() => (tz && view ? daylightSavingNotices(view.rules, view.exceptions, tz.zone, today) : []), [tz, view, today]);
  const deviceZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return '';
    }
  }, []);

  const back = kind === 'offering' && scheduleView ? <Link href={`/scheduling/schedules/${seg(scheduleView.id)}`}>{scheduleView.name}</Link> : <Link href="/scheduling/resources">Resources</Link>;
  const reloadAll = () => {
    availability.reload();
    owner.reload();
  };

  if (availability.state === 'loading' || owner.state === 'loading') {
    return (
      <div className={`${styles.page} ${styles.availability}`}>
        <StateMessage kind="loading" title="Loading hours…" />
      </div>
    );
  }

  const failed = availability.state === 'error' ? availability.problem : owner.state === 'error' ? owner.problem : null;
  if (failed) {
    return (
      <div className={`${styles.page} ${styles.availability}`}>
        {failed.code === 'NOT_FOUND' ? (
          <StateMessage kind="empty" size="page" title={`This ${noun} no longer exists`}>{failed.message}</StateMessage>
        ) : failed.code === 'AVAILABILITY_NOT_READY' ? (
          <StateMessage kind="empty" size="page" title="Hours aren’t set up yet" action={<Button className={styles.touch} onClick={reloadAll}>Check again</Button>}>
            {failed.message}
          </StateMessage>
        ) : (
          <LoadError problem={failed} onRetry={reloadAll} />
        )}
        <p className={styles.dim}>{back}</p>
      </div>
    );
  }
  if (!view || (!offering && !resource)) return null;

  const partialClosures = view.capabilities?.partialClosures === true;
  const hasHours = view.rules.length > 0;
  // Saving hours pins the owner's zone in the same write (migration 036). Without it nothing can be saved, so the controls are withheld, not offered and refused.
  const zonesReady = view.capabilities?.zones !== false;
  const canCreate = canAdd && zonesReady;

  return (
    <div className={`${styles.page} ${styles.availability}`}>
      <PageHeader
        eyebrow={back}
        title={`Hours: ${name}`}
        meta={blocked ? <Badge state="inactive">{kind === 'offering' ? 'Archived' : 'Inactive'}</Badge> : undefined}
        actions={<Link href={`/scheduling${ownerPath}/calendar`} {...buttonProps('secondary', 'md')} className={`${buttonProps('secondary', 'md').className} ${styles.touch}`} data-testid="calendar-link">View calendar</Link>}
        description={`Weekly hours and closures for this ${noun}. Times are local to the timezone below.`}
      />
      {!canManage && <p className={styles.notice} role="note">You have view-only access to Scheduling. Ask a manager to change hours.</p>}
      {!zonesReady && canManage && (
        <p className={styles.notice} role="note" data-testid="zones-not-ready">
          Saving hours isn’t set up on this installation yet, so hours and closures can’t be added. Ask a BrainBase admin to finish the setup. Existing hours can still be viewed and removed.
        </p>
      )}
      {blocked && (
        <p className={styles.notice} role="note">
          {kind === 'offering'
            ? 'This offering is archived. Its hours cannot be added or changed, but they can still be removed.'
            : 'This resource is inactive. Its hours cannot be added or changed until it is reactivated on the Resources page, but they can still be removed.'}
        </p>
      )}
      {!hasHours && (
        <p className={styles.notice} role="status" data-testid="unavailable-state">
          {kind === 'resource'
            ? 'This resource has no weekly hours, so it is unavailable, including when an offering needs it.'
            : `This ${noun} has no weekly hours, so it has no availability.`}
        </p>
      )}
      {message && <p className={styles.notice} role="status" data-testid="saved-message">{message}</p>}

      <div className={styles.stack}>
        <Panel title="Timezone">
          {tz ? (
            <p className={styles.zoneFacts}>
              <strong data-testid="timezone">{describeTimezone(tz.zone)}</strong>
              <span>{tz.source}. Hours are saved as local times in this zone.</span>
              {deviceZone && deviceZone !== tz.zone && <span>Your device is set to {deviceZone}. Hours are shown as saved, not converted to your time.</span>}
              {tz.pinned ? (
                <span>Changing your organisation’s or schedule’s timezone later does not move these hours. Changing this zone is not offered here.</span>
              ) : (
                <span>This zone is fixed when you save the first hours. After that, changing your organisation’s or schedule’s timezone does not move them.</span>
              )}
            </p>
          ) : status.state === 'error' ? (
            <p className={styles.dim} role="status">The timezone could not be loaded, so daylight-saving notes are unavailable. Hours are unaffected.</p>
          ) : (
            <p className={styles.dim} role="status">Loading the timezone…</p>
          )}
        </Panel>

        {notices.length > 0 && (
          <aside className={styles.notice} role="note" aria-label="Daylight saving" data-testid="dst-notice">
            <strong>Daylight saving</strong>
            <ul className={styles.dstList}>
              {notices.map(n => (
                <li key={n.date + n.text}>{n.text}</li>
              ))}
            </ul>
          </aside>
        )}

        <WeeklyHours ownerPath={ownerPath} ownerNoun={noun} rules={view.rules} canAdd={canCreate} canRemove={canManage} zone={tz?.zone} onChanged={availability.reload} announce={setMessage} />
        <Closures
          ownerPath={ownerPath}
          closures={view.exceptions}
          today={today || localToday('UTC')}
          partialClosures={partialClosures}
          canAdd={canCreate}
          canRemove={canManage}
          zone={tz?.zone}
          onChanged={availability.reload}
          announce={setMessage}
        />
      </div>
    </div>
  );
}
