import 'server-only';
import { randomUUID } from 'node:crypto';
import { createSchedulingExecutor } from './runtime';

const db = () => createSchedulingExecutor();
export const coachLinkPattern = /^coach-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

// The imported tennis schedule has its own cutover, roster and booking rules.
const schedules = `FROM scheduling_schedules s JOIN organisations n ON n.id=s.organisation_id AND n.status='ACTIVE'
  JOIN scheduling_settings settings ON settings.organisation_id=n.id
  JOIN organisation_modules entitlement ON entitlement.organisation_id=n.id AND entitlement.module_key='scheduling' AND entitlement.enabled
  JOIN modules m ON m.key=entitlement.module_key AND m.active
  WHERE s.organisation_id=$1 AND s.preset_key='classes_coaching' AND s.id<>'tennis-coaching' AND s.archived_at IS NULL`;
const dates = `FROM scheduling_occurrences o JOIN scheduling_offerings f ON f.organisation_id=o.organisation_id AND f.id=o.offering_id
  JOIN eligible s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id WHERE f.archived_at IS NULL`;
const fields = `o.id,f.name,s.name AS schedule,to_char(o.local_date,'YYYY-MM-DD') AS day,to_char(o.local_start_time,'HH24:MI') AS time,
  o.timezone, o.capacity, f.price_cents AS cents,f.currency, o.status,
  (o.status='scheduled' AND o.starts_at>now()) AS open,
  (SELECT COALESCE(sum(r.party_size),0)::int FROM scheduling_reservations r WHERE r.organisation_id=o.organisation_id
    AND r.occurrence_id=o.id AND r.status<>'cancelled') AS enrolled`;
export type ClassDate = {
  id: string;
  name: string;
  schedule: string;
  day: string;
  time: string;
  timezone: string;
  capacity: number;
  enrolled: number;
  cents: number;
  currency: string;
  status: string;
  open: boolean;
};
export type CoachSchedule = { id: string; name: string; slug: string | null };

export function weekDates(org: string, from: string) {
  return db().query<ClassDate>(
    `WITH eligible AS (SELECT s.* ${schedules}) SELECT ${fields} ${dates}
    AND o.local_date >= $2::date AND o.local_date < $2::date+7 ORDER BY o.local_date,o.local_start_time,f.name,o.id`,
    [org, from],
  );
}
export function classSchedules(org: string) {
  return db().query<CoachSchedule>(
    `SELECT s.id,s.name,s.public_slug AS slug ${schedules} ORDER BY s.name,s.id`,
    [org],
  );
}
export function changePublication(org: string, id: string, old: string | null) {
  if (old !== null && !coachLinkPattern.test(old)) throw Error('Invalid link');
  return db().query(
    `UPDATE scheduling_schedules dest SET public_slug=$3,updated_at=now()
    WHERE dest.organisation_id=$1 AND dest.id=$2 AND dest.public_slug IS NOT DISTINCT FROM $4
    AND EXISTS(SELECT 1 ${schedules} AND s.id=dest.id) RETURNING id`,
    [org, id, old === null ? 'coach-' + randomUUID() : null, old],
  );
}
export async function publicClasses(org: string, slug: string) {
  if (!coachLinkPattern.test(slug)) return null;
  const rows = await db().query<{ name: string; classes: ClassDate[] }>(
    `WITH eligible AS (SELECT s.* ${schedules} AND s.public_slug=$2),
    listed AS (SELECT ${fields} ${dates} AND o.status='scheduled' AND o.starts_at>now() AND o.starts_at<now()+interval '90 days')
    SELECT s.name, COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY day,time,id) FROM listed l),'[]') classes FROM eligible s`,
    [org, slug],
  );
  return rows[0] ?? null;
}
export async function readRoster(org: string, id: string) {
  const rows = await db().query<
    ClassDate & {
      members: {
        id: string;
        name: string;
        status: string;
        attendance: string | null;
        version: string;
        paid: string;
      }[];
    }
  >(
    `
    WITH eligible AS (SELECT s.* ${schedules}) SELECT ${fields},COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',r.id,'name',r.customer_name,'status',r.status,'attendance',r.attendance,'version',r.updated_at::text,'paid',r.payment_status)
      ORDER BY r.customer_name,r.id) FROM scheduling_reservations r WHERE r.organisation_id=o.organisation_id AND r.occurrence_id=o.id),'[]') members
      ${dates} AND o.id=$2`,
    [org, id],
  );
  return rows[0] ?? null;
}
export type EnrolInput = {
  id: string;
  key: string;
  name: string;
  email: string;
  cents: number;
  currency: string;
};
export async function enrolClass(
  org: string,
  scope: { staff: string } | { link: string },
  input: EnrolInput,
) {
  const publicLink = 'link' in scope ? scope.link : null;
  if (publicLink !== null && !coachLinkPattern.test(publicLink)) return false;
  const key = ('staff' in scope ? 'coach-staff:' : 'coach-public:') + input.key;
  const params = [
    org,
    publicLink,
    input.id,
    input.name,
    input.email,
    input.cents,
    input.currency,
    key,
    'staff' in scope ? scope.staff : null,
  ];
  // Lock the publication and offering through the insert. The shared database trigger serialises
  // headcount across every booking channel. Only the boolean result leaves this function.
  const eligible = `WITH eligible AS (SELECT s.* ${schedules} AND ($2::text IS NULL OR s.public_slug=$2) FOR SHARE OF s,n,m,entitlement)`;
  const saved = async () =>
    (
      await db().query(
        `${eligible} SELECT 1 FROM scheduling_reservations r JOIN eligible s ON s.id=r.schedule_id
    AND s.organisation_id=r.organisation_id WHERE r.occurrence_id=$3 AND r.customer_name=$4 AND r.customer_email_normalised=$5
    AND r.price_cents=$6 AND r.currency=$7 AND r.idempotency_key=$8 AND r.created_by IS NOT DISTINCT FROM $9 AND r.status='confirmed'`,
        params,
      )
    ).length > 0;
  try {
    const rows = await db().query(
      `${eligible}, basis AS (SELECT o.*,f.schedule_id,f.price_cents,f.currency,s.preset_version ${dates}
      AND o.id=$3 AND o.status='scheduled' AND o.starts_at>now() AND ($2::text IS NULL OR o.starts_at<now()+interval '90 days')
      AND f.price_cents=$6 AND f.currency=$7 FOR SHARE OF o,f)
      INSERT INTO scheduling_reservations(id,organisation_id,schedule_id,preset_key,preset_version,offering_id,occurrence_id,span_kind,
      customer_name,customer_email,customer_email_normalised,timezone,local_start_date,local_start_time,local_end_date,local_end_time,
      starts_at,ends_at,party_size,status,price_cents,currency,idempotency_key,created_by)
      SELECT gen_random_uuid()::text,organisation_id,schedule_id,'classes_coaching',preset_version,offering_id,id,'occurrence',
      $4,$5,$5,timezone,local_date,local_start_time,(ends_at AT TIME ZONE timezone)::date,(ends_at AT TIME ZONE timezone)::time,
      starts_at,ends_at,1,'confirmed',price_cents,currency,$8,$9 FROM basis
      ON CONFLICT (organisation_id,idempotency_key) DO NOTHING RETURNING id`,
      params,
    );
    return rows.length > 0 || (await saved());
  } catch (error) {
    if (await saved()) return true;
    if (['SCCAP', 'SCCLS', 'SCARC', '23505'].includes((error as { code: string }).code)) return false;
    throw error;
  }
}
export function updateMember(
  org: string,
  occurrence: string,
  member: string,
  version: string,
  action: 'cancel' | 'attended' | 'absent',
) {
  return db().query(
    `WITH eligible AS (SELECT s.* ${schedules}), class AS (SELECT o.id,o.organisation_id ${dates} AND o.id=$2 AND o.status<>'cancelled')
    UPDATE scheduling_reservations r SET attendance=CASE WHEN $5='cancel' THEN r.attendance ELSE $5 END,
    status=CASE WHEN $5='cancel' THEN 'cancelled' ELSE r.status END,
    cancelled_by=CASE WHEN $5='cancel' THEN 'staff' ELSE r.cancelled_by END,
    cancelled_at=CASE WHEN $5='cancel' THEN now() ELSE r.cancelled_at END,updated_at=now()
    FROM class c WHERE r.organisation_id=c.organisation_id AND r.occurrence_id=c.id AND r.id=$3 AND r.status='confirmed'
    AND r.updated_at=$4::timestamptz AND ($5<>'cancel' OR (r.attendance IS NULL AND r.payment_status='unpaid'))
    RETURNING r.id`,
    [org, occurrence, member, version, action],
  );
}
