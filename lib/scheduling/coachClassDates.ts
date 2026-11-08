import 'server-only';
import { isLocalDate, isLocalTime, resolveLocalTime, addLocalDays } from '@scheduling/core';
import { createSchedulingExecutor, loadSchedulingRuntime } from './runtime';
import type { OrgSession } from '@/lib/org';

export function weekStart(day: string) {
  if (!isLocalDate(day) || !/^20\d\d-/.test(day)) throw Error('Invalid week');
  return addLocalDays(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7));
}
export { addLocalDays };
export function dateChoices(org: string) {
  return createSchedulingExecutor().query<{
    id: string;
    name: string;
    resource: string | null;
    venue: string | null;
    zone: string;
  }>(
    `
    SELECT f.id,s.name||' / '||f.name AS name,r.id AS resource,r.name AS venue,coalesce(s.timezone,nullif(n.timezone,''),'Australia/Adelaide') AS zone
    FROM scheduling_offerings f JOIN scheduling_schedules s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id
    JOIN organisations n ON n.id=s.organisation_id
    LEFT JOIN scheduling_offering_resources l ON l.organisation_id=f.organisation_id AND l.offering_id=f.id
    LEFT JOIN scheduling_resources r ON r.organisation_id=l.organisation_id AND r.id=l.resource_id
    WHERE f.organisation_id=$1 AND s.preset_key='classes_coaching' AND s.id<>'tennis-coaching' AND f.archived_at IS NULL
    AND f.duration_minutes IS NOT NULL AND f.capacity IS NOT NULL AND s.archived_at IS NULL AND (l.resource_id IS NULL OR r.active) ORDER BY s.name,f.name,r.name`,
    [org],
  );
}
export async function addClassDate(
  session: OrgSession,
  offeringId: string,
  resourceId: string | null,
  day: string,
  time: string,
) {
  if (!isLocalDate(day) || !isLocalTime(time)) return false;
  const { tenant, persistence, timezone } = await loadSchedulingRuntime(session);
  const config = persistence.config;
  const offering = await config.getOffering(tenant, offeringId);
  if (
    !offering ||
    offering.archivedAt ||
    !offering.durationMinutes ||
    !offering.capacity ||
    offering.scheduleId === 'tennis-coaching'
  )
    return false;
  const schedule = await config.getSchedule(tenant, offering.scheduleId);
  if (!schedule || schedule.archivedAt || schedule.presetKey !== 'classes_coaching') return false;
  const resources = await config.listOfferingResources(tenant, offeringId);
  if (resourceId === null ? resources.length > 0 : !resources.some((r) => r.id === resourceId && r.active))
    return false;
  const zone = schedule.timezone ?? timezone.value;
  const start = resolveLocalTime(day, time, zone);
  if (start.kind !== 'ok' || Date.parse(start.instant) <= Date.now()) return false;
  const result = await config.createOccurrence(tenant, {
    offeringId,
    resourceId,
    date: day,
    startTime: time,
    timezone: zone,
    startsAt: start.instant,
    endsAt: new Date(Date.parse(start.instant) + offering.durationMinutes * 60000).toISOString(),
    capacity: offering.capacity,
  });
  return result.ok;
}
