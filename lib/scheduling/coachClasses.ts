import 'server-only';
import { coachingAuthority } from '@/lib/tennisBusiness/coachingAuthority';
import { randomUUID } from 'node:crypto';
import { createSchedulingExecutor } from './runtime';

const db = () => createSchedulingExecutor();
export const coachLinkPattern = /^coach-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

// The imported tennis schedule has its own cutover, roster and booking rules.
const scheduleScope = `FROM scheduling_schedules s JOIN organisations n ON n.id=s.organisation_id AND n.status='ACTIVE'
  JOIN scheduling_settings settings ON settings.organisation_id=n.id
  JOIN organisation_modules entitlement ON entitlement.organisation_id=n.id AND entitlement.module_key='scheduling' AND entitlement.enabled
  JOIN modules m ON m.key=entitlement.module_key AND m.active
  WHERE s.organisation_id=$1 AND s.preset_key='classes_coaching' AND s.archived_at IS NULL`;
const schedules = scheduleScope + " AND s.id<>'tennis-coaching'";

// Public and single-booking mutations retain their original scope. Only signed-in
// calendar, roster and term operations can include the activated import.
async function staffSchedules(org: string) {
  if ((await coachingAuthority(org)) !== 'scheduling') return schedules;
  return (
    scheduleScope +
    ` AND (s.id<>'tennis-coaching' OR (n.slug='ld-tennis' AND EXISTS (
    SELECT 1 FROM scheduling_tennis_cutover c JOIN scheduling_tennis_import_receipts i
      ON i.organisation_id=c.organisation_id AND i.source_hash=c.captured_hash
    WHERE c.organisation_id=n.id AND c.phase='scheduling' FOR SHARE OF c,i)))`
  );
}
const dateScope = `FROM scheduling_occurrences o JOIN scheduling_offerings f ON f.organisation_id=o.organisation_id AND f.id=o.offering_id
  JOIN eligible s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id`;
const dates = dateScope + ' WHERE f.archived_at IS NULL';
const staffDates = dateScope + " WHERE (f.archived_at IS NULL OR s.id='tennis-coaching')";
const fields = `o.id,f.name,s.name AS schedule,to_char(o.local_date,'YYYY-MM-DD') AS day,to_char(o.local_start_time,'HH24:MI') AS time,
  o.timezone, o.capacity, f.price_cents AS cents,f.currency, o.status,
  (o.status='scheduled' AND o.starts_at>now()) AS open,
  (SELECT COALESCE(sum(r.party_size),0)::int FROM scheduling_reservations r WHERE r.organisation_id=o.organisation_id
    AND r.occurrence_id=o.id AND r.status<>'cancelled') AS enrolled`;
const squadName = `(SELECT q.name FROM scheduling_coach_term_dates d
  JOIN scheduling_coach_squad_terms st USING (organisation_id,offering_id,term_id)
  JOIN scheduling_coach_squads q ON q.organisation_id=st.organisation_id AND q.id=st.squad_id
  WHERE d.organisation_id=o.organisation_id AND d.occurrence_id=o.id AND o.starts_at>=st.assigned_at) AS squad`;
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

export async function weekDates(org: string, from: string) {
  return db().query<
    ClassDate & { squad: string | null; term: string | null; tennis: boolean; archived: boolean }
  >(
    `WITH eligible AS (SELECT s.* ${await staffSchedules(org)}) SELECT ${fields},${squadName},s.id='tennis-coaching' AS tennis,f.archived_at IS NOT NULL AS archived,
    (SELECT t.name FROM scheduling_coach_term_dates d JOIN scheduling_coach_terms t ON t.organisation_id=d.organisation_id
      AND t.offering_id=d.offering_id AND t.id=d.term_id WHERE d.organisation_id=o.organisation_id AND d.occurrence_id=o.id) AS term ${staffDates}
    AND o.local_date >= $2::date AND o.local_date < $2::date+7 ORDER BY o.local_date,o.local_start_time,f.name,o.id`,
    [org, from],
  );
}
export async function weeklyReview(org: string, start: string) {
  return db().query<{
    id: string; name: string; schedule: string; day: string; time: string; timezone: string;
    ended: boolean; planned: boolean; attended: number; late: number; absent: number; unmarked: number;
  }>(
    `WITH eligible AS (SELECT s.* ${await staffSchedules(org)})
     SELECT o.id,f.name,s.name AS schedule,o.local_date::text AS day,to_char(o.local_start_time,'HH24:MI') AS time,
       o.timezone,(o.status='completed' OR o.ends_at<=now()) AS ended,p.version IS NOT NULL AS planned,
       coalesce(sum(r.party_size) FILTER (WHERE r.attendance='attended'),0)::int AS attended,
       coalesce(sum(r.party_size) FILTER (WHERE r.attendance='late'),0)::int AS late,
       coalesce(sum(r.party_size) FILTER (WHERE r.attendance='absent'),0)::int AS absent,
       coalesce(sum(r.party_size) FILTER (WHERE r.attendance IS NULL AND r.status='confirmed'),0)::int AS unmarked
     ${dateScope}
     LEFT JOIN scheduling_coach_training_plans p ON (p.organisation_id,p.occurrence_id)=(o.organisation_id,o.id)
     LEFT JOIN scheduling_reservations r ON (r.organisation_id,r.occurrence_id)=(o.organisation_id,o.id)
       AND r.status<>'cancelled'
     WHERE o.local_date >= $2::date AND o.local_date < $2::date+7 AND o.status<>'cancelled'
       AND (f.archived_at IS NULL OR (s.id='tennis-coaching' AND (o.ends_at<=now() OR o.status='completed')))
     GROUP BY o.organisation_id,o.id,f.name,s.name,p.version
     ORDER BY o.local_date,o.local_start_time,f.name,o.id`,
    [org,start],
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
      squad: string | null;
      tennis: boolean;
      archived: boolean;
      term: { name: string; dates: string[]; last: string | null } | null;
      members: {
        id: string;
        name: string;
        status: string;
        attendance: string | null;
        version: string;
        paid: string;
        recurring: boolean;
      }[];
    }
  >(
    `
    WITH eligible AS (SELECT s.* ${await staffSchedules(org)}) SELECT ${fields},${squadName},s.id='tennis-coaching' AS tennis,f.archived_at IS NOT NULL AS archived,(SELECT jsonb_build_object('name',t.name,'dates',coalesce(array_agg(future.id ORDER BY future.starts_at) FILTER(WHERE future.id IS NOT NULL),'{}'),
      'last',max(future.local_date)) FROM scheduling_coach_term_dates base
      JOIN scheduling_coach_terms t ON t.organisation_id=base.organisation_id AND t.offering_id=base.offering_id AND t.id=base.term_id
      JOIN scheduling_coach_term_dates d ON d.organisation_id=t.organisation_id AND d.offering_id=t.offering_id AND d.term_id=t.id
      LEFT JOIN scheduling_occurrences future ON future.organisation_id=d.organisation_id AND future.id=d.occurrence_id
        AND future.starts_at>=o.starts_at AND future.starts_at>now() AND future.status='scheduled'
      WHERE base.organisation_id=o.organisation_id AND base.occurrence_id=o.id GROUP BY t.name) AS term,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',r.id,'name',r.customer_name,'status',r.status,'attendance',r.attendance,'version',r.updated_at::text,'paid',r.payment_status,'recurring',r.series_id IS NOT NULL)
      ORDER BY r.customer_name,r.id) FROM scheduling_reservations r WHERE s.id<>'tennis-coaching' AND r.organisation_id=o.organisation_id AND r.occurrence_id=o.id),'[]') members
      ${staffDates} AND o.id=$2`,
    [org, id],
  );
  return rows[0] ?? null;
}
// Group scheduled dates of one Tennis class at the same weekly time. Existing
// term membership is a boundary even if its date was subsequently cancelled.
async function tennisTermBasis(org: string) {
  return `WITH eligible AS (SELECT s.* ${await staffSchedules(org)} AND s.id='tennis-coaching' FOR SHARE OF s,n,m,entitlement),
    anchor AS (SELECT o.* ${dates} AND o.id=$2 AND o.status='scheduled' AND o.starts_at>now() FOR SHARE OF f,o),
    slots AS (SELECT o.id,o.local_date,o.organisation_id,o.offering_id FROM anchor a
      JOIN scheduling_occurrences o ON o.organisation_id=a.organisation_id AND o.offering_id=a.offering_id
        AND o.resource_id IS NOT DISTINCT FROM a.resource_id AND o.local_start_time=a.local_start_time
        AND o.local_date BETWEEN a.local_date AND a.local_date+175 AND (o.local_date-a.local_date)%7=0
      WHERE (o.status='scheduled' OR EXISTS(SELECT 1 FROM scheduling_coach_term_dates d
        WHERE d.organisation_id=o.organisation_id AND d.occurrence_id=o.id))
      ORDER BY o.local_date,o.id FOR SHARE OF o),
    available AS (SELECT * FROM slots x WHERE NOT EXISTS(SELECT 1 FROM slots prior
      JOIN scheduling_coach_term_dates d ON d.organisation_id=prior.organisation_id AND d.occurrence_id=prior.id
      WHERE prior.local_date<=x.local_date))`;
}

export async function tennisTermChoices(org: string, occurrence: string) {
  return db().query<{ id: string; day: string }>(
    `${await tennisTermBasis(org)}
    SELECT id,to_char(local_date,'YYYY-MM-DD') AS day FROM available ORDER BY local_date,id`,
    [org, occurrence],
  );
}

export async function groupTennisTerm(
  org: string,
  staff: string,
  occurrence: string,
  name: string,
  expected: unknown,
) {
  if (
    !name ||
    name.length > 120 ||
    !Array.isArray(expected) ||
    expected.length < 2 ||
    expected.length > 26 ||
    expected[0] !== occurrence ||
    !expected.every((id) => typeof id === 'string')
  )
    return false;
  try {
    const rows = await db().query(
      `${await tennisTermBasis(org)},
      selected AS (SELECT * FROM available ORDER BY local_date,id LIMIT $3),
      term AS (INSERT INTO scheduling_coach_terms(organisation_id,offering_id,id,name,created_by)
        SELECT organisation_id,offering_id,gen_random_uuid(),$4,$5 FROM selected WHERE id=$2
        AND (SELECT jsonb_agg(id ORDER BY local_date,id) FROM selected)=$6::jsonb RETURNING *)
      INSERT INTO scheduling_coach_term_dates(organisation_id,offering_id,term_id,occurrence_id)
      SELECT t.organisation_id,t.offering_id,t.id,x.id FROM term t CROSS JOIN selected x
      ORDER BY x.local_date,x.id RETURNING occurrence_id`,
      [org, occurrence, expected.length, name, staff, JSON.stringify(expected)],
    );
    return rows.length === expected.length;
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return false;
    throw error;
  }
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
// The roster supplies the exact dates and fee the coach saw. Recheck both while locking the dates
// in calendar order. One refused reservation rolls back the series and every other place.
export async function enrolTerm(org: string, staff: string, input: EnrolInput, expected: string[]) {
  if (expected.length < 1 || expected.length > 26 || expected[0] !== input.id) return false;
  const seriesId = 'coach-term:' + input.key;
  const params = [
    org,
    input.id,
    input.name,
    input.email,
    input.cents,
    input.currency,
    staff,
    seriesId,
    JSON.stringify(expected),
  ];
  try {
    const rows = await db().query(
      `WITH eligible AS (SELECT s.* ${await staffSchedules(org)} FOR SHARE OF s,n,m,entitlement),
      anchor AS (SELECT o.id,o.organisation_id,o.starts_at,d.term_id,d.offering_id
        FROM scheduling_occurrences o JOIN scheduling_coach_term_dates d ON d.organisation_id=o.organisation_id AND d.occurrence_id=o.id
        WHERE o.organisation_id=$1 AND o.id=$2 AND o.starts_at>now() AND o.status='scheduled'),
      selected AS (SELECT o.*,s.preset_version,f.schedule_id,f.price_cents,f.currency ${dates}
        AND EXISTS(SELECT 1 FROM anchor a JOIN scheduling_coach_term_dates d ON d.organisation_id=a.organisation_id
          AND d.term_id=a.term_id AND d.offering_id=a.offering_id
          WHERE d.organisation_id=o.organisation_id AND d.occurrence_id=o.id AND o.starts_at>=a.starts_at)
        AND o.status='scheduled' AND o.starts_at>now() AND f.price_cents=$5 AND f.currency=$6
        ORDER BY o.starts_at,o.id FOR UPDATE OF o FOR SHARE OF f),
      series AS (INSERT INTO scheduling_series(organisation_id,id,offering_id,customer_name,customer_email,customer_email_normalised,timezone,created_by,status)
        SELECT organisation_id,$8,offering_id,$3,$4,$4,timezone,$7,'ended' FROM selected WHERE id=$2
          AND (SELECT jsonb_agg(id ORDER BY starts_at,id) FROM selected)=$9::jsonb
        RETURNING id)
      INSERT INTO scheduling_reservations (id,organisation_id,schedule_id,preset_key,preset_version,offering_id,occurrence_id,series_id,span_kind,
        customer_name,customer_email,customer_email_normalised,timezone,local_start_date,local_start_time,local_end_date,local_end_time,
        starts_at,ends_at,party_size,status,price_cents,currency,idempotency_key,created_by)
      SELECT gen_random_uuid()::text,o.organisation_id,o.schedule_id,'classes_coaching',o.preset_version,o.offering_id,o.id,s.id,'occurrence',
        $3,$4,$4,o.timezone,o.local_date,o.local_start_time,(o.ends_at AT TIME ZONE o.timezone)::date,(o.ends_at AT TIME ZONE o.timezone)::time,
        o.starts_at,o.ends_at,1,'confirmed',o.price_cents,o.currency,s.id||':'||o.id,$7
      FROM selected o CROSS JOIN series s ORDER BY o.starts_at,o.id RETURNING id`,
      params,
    );
    return rows.length === expected.length;
  } catch (error) {
    // A repeated submission with the same key can acknowledge its original booking but never recreate a cancelled place.
    const saved = await db().query(
      `SELECT 1 FROM scheduling_reservations WHERE organisation_id=$1 AND series_id=$8
      AND customer_name=$3 AND customer_email_normalised=$4 AND price_cents=$5 AND currency=$6 AND created_by=$7
      GROUP BY series_id HAVING jsonb_agg(occurrence_id ORDER BY starts_at,occurrence_id)=$9::jsonb
        AND bool_or(occurrence_id=$2)`,
      params,
    );
    if (saved.length) return true;
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

type TrainingDrill = import('./trainingPlan').Drill;
type TrainingPlayer = import('./trainingPlan').Player;

async function trainingScope(org: string) {
  return `WITH eligible AS (SELECT s.* ${await staffSchedules(org)}),
    session AS (SELECT o.*,f.name,f.archived_at,s.name AS schedule,r.name AS venue ${dateScope}
      LEFT JOIN scheduling_resources r ON (r.organisation_id,r.id)=(o.organisation_id,o.resource_id)
      WHERE o.id=$2 AND (f.archived_at IS NULL OR s.id='tennis-coaching'))`;
}

export async function trainingSession(org: string, id: string) {
  const rows = await db().query<{
    name: string;
    day: string;
    time: string;
    schedule: string;
    venue: string | null;
    minutes: number;
    editable: boolean;
    version: number;
    drills: TrainingDrill[] | null;
    players: TrainingPlayer[];
    templates: { name: string; drills: TrainingDrill[] }[];
  }>(
    `${await trainingScope(org)}
    SELECT o.name,o.local_date::text AS day,to_char(o.local_start_time,'HH24:MI') AS time,o.schedule,o.venue,
      round(extract(epoch FROM o.ends_at-o.starts_at)/60)::int AS minutes,
      (o.status='scheduled' AND o.ends_at>now() AND o.archived_at IS NULL) AS editable,
      coalesce(p.version,0) AS version,p.drills,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.customer_name,'status',r.status,'attendance',r.attendance)
        ORDER BY r.customer_name,r.id) FROM scheduling_reservations r WHERE r.organisation_id=o.organisation_id AND r.occurrence_id=o.id),'[]') AS players,
      coalesce((SELECT jsonb_agg(jsonb_build_object('name',t.name,'drills',t.drills) ORDER BY t.name)
        FROM scheduling_coach_training_templates t WHERE t.organisation_id=o.organisation_id),'[]') AS templates
    FROM session o LEFT JOIN scheduling_coach_training_plans p ON (p.organisation_id,p.occurrence_id)=(o.organisation_id,o.id)`,
    [org, id],
  );
  return rows[0] ?? null;
}

export async function persistTrainingPlan(
  org: string,
  id: string,
  version: number,
  drills: TrainingDrill[],
  template: string,
  reusable: TrainingDrill[],
) {
  const rows = await db().query<{ version: number }>(
    `${await trainingScope(org)},
    basis AS (SELECT organisation_id,id FROM session WHERE status='scheduled' AND ends_at>now() AND archived_at IS NULL),
    saved AS (${
      version === 0
        ? `INSERT INTO scheduling_coach_training_plans AS p(organisation_id,occurrence_id,version,drills)
      SELECT organisation_id,id,1,$3::jsonb FROM basis WHERE $4::int=0 ON CONFLICT DO NOTHING`
        : `UPDATE scheduling_coach_training_plans p SET version=p.version+1,drills=$3::jsonb FROM basis b
       WHERE (p.organisation_id,p.occurrence_id)=(b.organisation_id,b.id) AND p.version=$4::int`
    } RETURNING p.organisation_id,p.version),
    template AS (INSERT INTO scheduling_coach_training_templates(organisation_id,name,drills)
      SELECT organisation_id,$5,$6::jsonb FROM saved WHERE $5<>'' RETURNING name)
    SELECT version FROM saved`,
    [org, id, JSON.stringify(drills), version, template, JSON.stringify(reusable)],
  );
  return rows[0]?.version ?? null;
}
