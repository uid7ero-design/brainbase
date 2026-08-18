import 'server-only'
import sql from '@/lib/db'
import { parseLocalDate, toDateStr, addDays, addWeeks } from '@/lib/date'
import { enrolActiveLineagesIntoNewInstance } from '@/lib/tennisRecurrence'

// Automatic schedule maintenance: replaces the old manual "Generate 6 weeks"
// workflow, which silently stopped producing future dates once its one-time
// batch expired (the exact production bug that dropped Monday classes off
// the calendar). A session now carries its own schedule rule
// (start_date/end_mode/end_after_weeks/end_date); reconcileFutureInstances()
// is the single function that keeps session_instances in sync with that
// rule, called from session create/edit and available as a manual "Repair
// future dates" action for recovery. It never touches a past instance, and
// never deletes a row — protected/cancelled state is preserved via
// session_instances.status and bookings.status, matching the existing
// pause-conflict pattern in app/api/dashboard/enrolments/[id]/pause/route.ts.

export type EndMode = 'ongoing' | 'after_weeks' | 'on_date'

export type ScheduleRules = {
  day_of_week: number
  start_date: string | null // YYYY-MM-DD; null = "no defined start, generate from today" (legacy sessions)
  end_mode: EndMode
  end_after_weeks: number | null // only meaningful when end_mode === 'after_weeks'
  end_date: string | null        // YYYY-MM-DD; only meaningful when end_mode === 'on_date'
}

// Never keep more than this many weeks of future instances generated at
// once for an Ongoing schedule — a rolling window, not infinite rows.
// 10 weeks sits in the middle of the requested 8-12 week range: comfortably
// covers a school-term-length gap between dashboard visits (LD Tennis's
// actual usage pattern — Luke checks in most weeks) while keeping the
// per-reconcile row count small (max ~10 INSERT attempts per session, most
// of them no-ops via ON CONFLICT once topped up).
export const HORIZON_WEEKS = 10

/**
 * The exact set of calendar dates (YYYY-MM-DD) this schedule should have a
 * scheduled instance on, bounded to [today, today + HORIZON_WEEKS]. Pure
 * function, no DB access — independently testable.
 *
 * 'after_weeks' counts occurrences from the schedule's actual first
 * occurrence (on/after start_date), not from "today" — so a 10-week term
 * that's already 3 weeks in still ends on its originally-intended week 10,
 * rather than silently shrinking every time this is recomputed.
 */
export function computeExpectedOccurrences(rules: ScheduleRules, today: Date): string[] {
  const horizonEnd = addWeeks(today, HORIZON_WEEKS)

  if (rules.end_mode === 'after_weeks' && rules.end_after_weeks != null && rules.end_after_weeks > 0 && rules.start_date) {
    let occ = nextOccurrenceOnOrAfter(parseLocalDate(rules.start_date), rules.day_of_week)
    const dates: string[] = []
    for (let i = 0; i < rules.end_after_weeks; i++) {
      if (occ >= today && occ <= horizonEnd) dates.push(toDateStr(occ))
      occ = addWeeks(occ, 1)
    }
    return dates
  }

  let boundary = horizonEnd
  if (rules.end_mode === 'on_date' && rules.end_date) {
    const endDate = parseLocalDate(rules.end_date)
    if (endDate < boundary) boundary = endDate
  }

  const anchor = rules.start_date ? parseLocalDate(rules.start_date) : today
  let cursor = nextOccurrenceOnOrAfter(anchor < today ? today : anchor, rules.day_of_week)

  const dates: string[] = []
  while (cursor <= boundary) {
    dates.push(toDateStr(cursor))
    cursor = addWeeks(cursor, 1)
  }
  return dates
}

function nextOccurrenceOnOrAfter(d: Date, dayOfWeek: number): Date {
  const diff = (dayOfWeek - d.getDay() + 7) % 7
  return addDays(d, diff)
}

export type ReconcileResult = {
  generated: number
  cancelledInstances: number
  conflicts: { instanceId: string; date: string }[]
}

/**
 * Brings session_instances in line with the session's current schedule
 * rule and template fields (start_time/duration_minutes/max_capacity):
 *  1. Updates those three fields on every already-generated FUTURE
 *     'scheduled' instance (never touches bookings, so safe regardless of
 *     protected state — only the class's own time/capacity, not who's in it).
 *  2. Inserts any missing expected future occurrence (idempotent via
 *     ON CONFLICT, same pattern as every other instance-creation path in
 *     this codebase), auto-enrolling active recurring lineages into each
 *     newly created row exactly as the old generate-instances route did.
 *  3. Cancels (status = 'cancelled', never deletes) any future 'scheduled'
 *     instance that no longer matches the expected occurrence set (e.g.
 *     day_of_week changed, or the schedule was shortened) — but only if it
 *     has no protected booking (paid or attendance recorded); protected
 *     ones are left untouched and reported back as conflicts for Luke to
 *     resolve manually, identical to the pause-conflict UX.
 * Never touches any instance dated before today.
 */
export async function reconcileFutureInstances(params: {
  organisationId: string
  sessionId: string
  rules: ScheduleRules
  startTime: string
  durationMinutes: number
  maxCapacity: number
  sessionType: string
}): Promise<ReconcileResult> {
  const { organisationId, sessionId, rules, startTime, durationMinutes, maxCapacity, sessionType } = params

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = toDateStr(today)
  const expected = new Set(computeExpectedOccurrences(rules, today))

  await sql`
    UPDATE session_instances
    SET start_time = ${startTime}, duration_minutes = ${durationMinutes}, max_capacity = ${maxCapacity}
    WHERE session_id = ${sessionId} AND organisation_id = ${organisationId}
      AND status = 'scheduled' AND date >= ${todayStr}::date
  `

  let generated = 0
  for (const date of expected) {
    const rows = (await sql`
      INSERT INTO session_instances (id, session_id, organisation_id, date, start_time, duration_minutes, max_capacity, status)
      VALUES (${crypto.randomUUID()}, ${sessionId}, ${organisationId}, ${date}::date, ${startTime}, ${durationMinutes}, ${maxCapacity}, 'scheduled')
      ON CONFLICT (session_id, date) DO NOTHING
      RETURNING id
    `) as { id: string }[]
    if (rows.length === 0) continue
    generated++
    const countRows = (await sql`SELECT COUNT(*)::int AS cnt FROM bookings WHERE session_instance_id = ${rows[0].id} AND status != 'cancelled'`) as { cnt: number }[]
    await enrolActiveLineagesIntoNewInstance({
      organisationId, sessionId,
      instance: { id: rows[0].id, date, start_time: startTime, max_capacity: maxCapacity, session_type: sessionType, enrolled: countRows[0].cnt },
    })
  }

  const staleCandidates = (await sql`
    SELECT id, to_char(date, 'YYYY-MM-DD') AS date FROM session_instances
    WHERE session_id = ${sessionId} AND organisation_id = ${organisationId}
      AND status = 'scheduled' AND date >= ${todayStr}::date
  `) as { id: string; date: string }[]

  const conflicts: { instanceId: string; date: string }[] = []
  let cancelledInstances = 0
  for (const inst of staleCandidates) {
    if (expected.has(inst.date)) continue
    const protectedBookings = await sql`
      SELECT id FROM bookings
      WHERE session_instance_id = ${inst.id} AND status != 'cancelled' AND (paid = true OR attendance_status IS NOT NULL)
    `
    if (protectedBookings.length > 0) { conflicts.push({ instanceId: inst.id, date: inst.date }); continue }
    await sql`UPDATE bookings SET status = 'cancelled' WHERE session_instance_id = ${inst.id} AND status != 'cancelled'`
    await sql`UPDATE session_instances SET status = 'cancelled' WHERE id = ${inst.id}`
    cancelledInstances++
  }

  return { generated, cancelledInstances, conflicts }
}

export type ReconcileAllResult = {
  reconciled: number
  totalGenerated: number
  totalCancelledInstances: number
  conflicts: { sessionId: string; instanceId: string; date: string }[]
  errors: { sessionId: string; message: string }[]
}

type SessionScheduleRow = {
  id: string; day_of_week: number; start_time: string; duration_minutes: number; max_capacity: number
  session_type: string; start_date: string | null; end_mode: EndMode; end_after_weeks: number | null; end_date: string | null
}

// Reconciles every session belonging to one organisation in a single
// awaited call. This is the actual automatic-top-up mechanism for Ongoing
// schedules — invoked from an explicit, authenticated POST
// (/api/dashboard/sessions/reconcile), never as an unawaited side effect of
// a GET. One session's failure never aborts the batch: it's caught,
// recorded in `errors`, and the loop continues, so a single bad row can't
// take down horizon maintenance for every other session in the org.
//
// The `sessions` table currently has no active/archived/deleted concept —
// every row is reconciled unconditionally, exactly matching the existing
// pre-this-feature behaviour where every session always got automatic
// instance generation regardless of any notion of "in use." No lifecycle
// field is invented here; if LD Tennis later needs to pause/retire a
// session without deleting it, that is new schema and out of scope for
// this fix.
export async function reconcileAllSessionsForOrg(organisationId: string): Promise<ReconcileAllResult> {
  const sessions = (await sql`
    SELECT id, day_of_week, start_time, duration_minutes, max_capacity, session_type,
      to_char(start_date, 'YYYY-MM-DD') AS start_date, end_mode, end_after_weeks, to_char(end_date, 'YYYY-MM-DD') AS end_date
    FROM sessions WHERE organisation_id = ${organisationId}
  `) as SessionScheduleRow[]

  const result: ReconcileAllResult = { reconciled: 0, totalGenerated: 0, totalCancelledInstances: 0, conflicts: [], errors: [] }

  for (const s of sessions) {
    try {
      const r = await reconcileFutureInstances({
        organisationId,
        sessionId: s.id,
        rules: { day_of_week: s.day_of_week, start_date: s.start_date, end_mode: s.end_mode, end_after_weeks: s.end_after_weeks, end_date: s.end_date },
        startTime: s.start_time, durationMinutes: s.duration_minutes, maxCapacity: s.max_capacity, sessionType: s.session_type,
      })
      result.reconciled++
      result.totalGenerated += r.generated
      result.totalCancelledInstances += r.cancelledInstances
      result.conflicts.push(...r.conflicts.map(c => ({ sessionId: s.id, ...c })))
    } catch (err) {
      console.error('[reconcileAllSessionsForOrg] failed for session', s.id, err)
      result.errors.push({ sessionId: s.id, message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return result
}
