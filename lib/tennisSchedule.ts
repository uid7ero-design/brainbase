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

// Shared by reconcileFutureInstances (real `expected` set — a schedule
// changed) and cancelFutureInstancesForArchive (empty `expected` set — no
// date is ever expected again). Cancels every future 'scheduled' instance
// not in `expected`, unless it has a protected booking (paid or
// attendance recorded), in which case it's left scheduled and reported as
// a conflict. Never touches any instance dated before today, never
// deletes a row — this is the one place that decision gets made, so
// archiving reuses it instead of re-implementing the same safety rule.
async function cancelStaleFutureInstances(
  organisationId: string,
  sessionId: string,
  todayStr: string,
  expected: Set<string>,
): Promise<{ cancelledInstances: number; conflicts: { instanceId: string; date: string }[] }> {
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
  return { cancelledInstances, conflicts }
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

  const { cancelledInstances, conflicts } = await cancelStaleFutureInstances(organisationId, sessionId, todayStr, expected)

  return { generated, cancelledInstances, conflicts }
}

// ─── Audit logging (reuses the existing audit_logs table/model — see
// prisma/schema.prisma's AuditLog — via raw sql rather than Prisma,
// because this whole feature is raw-sql-first and, more importantly,
// because it needs to sit inside the SAME sql.transaction() as the
// archive write below; Prisma's $transaction() is a separate connection
// and can't be combined with neon's HTTP transaction() in one atomic
// unit) ──────────────────────────────────────────────────────────────
//
// Deliberately counts only, never row-level detail: before_state/
// after_state carry archived_at, and — for archive — cancelledInstances/
// conflictCount as plain numbers. No contact/booking name, email, phone,
// or payment field is ever read by this function, let alone logged.
function auditLogInsertQuery(entry: {
  organisationId: string
  userId: string | null
  action: 'session.archive' | 'session.restore'
  sessionId: string
  beforeState: Record<string, unknown>
  afterState: Record<string, unknown>
}) {
  return sql`
    INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
    VALUES (
      ${crypto.randomUUID()}, ${entry.organisationId}, ${entry.userId}, ${entry.action}, 'session', ${entry.sessionId},
      ${JSON.stringify(entry.beforeState)}::jsonb, ${JSON.stringify(entry.afterState)}::jsonb
    )
  `
}

export type ArchiveOutcome =
  | { outcome: 'archived'; cancelledInstances: number; conflicts: { instanceId: string; date: string }[] }
  | { outcome: 'not_found' }
  | { outcome: 'already_archived' }

// Archives a session and cancels its safe future instances/bookings as
// ONE atomic Postgres transaction (via neon's sql.transaction(), the
// same client already used everywhere else in this module) — either the
// archived_at write, every safe instance/booking cancellation, and the
// audit log entry all land together, or none of them do. An unexpected
// failure partway through can never leave the API reporting success on a
// partially-completed archive.
//
// Protected (paid/attended) future instances are never part of the
// transaction at all — determined by a preliminary read-only query, left
// completely untouched, and reported back as conflicts. A conflict is a
// successful, expected outcome of archiving, not a failure: it never
// aborts the transaction or triggers an error response.
//
// sql.transaction() only accepts a flat, pre-built array of queries (see
// its own docs — "non-interactive": no branching on one query's result
// while inside the transaction), so which instances are safe to cancel
// must be decided before the transaction is constructed. There is a
// narrow theoretical race between that read and the transaction itself
// (e.g. two concurrent archive calls for the same session) — the
// transaction's own `archived_at IS NULL` guard still prevents a double
// state-change (it would affect zero rows and this function reports
// already_archived), but in that specific interleaving the instance
// cancellations built from the earlier read would still execute. This is
// an existing, narrower version of a race already inherent to the
// original non-transactional design, not one this change introduces;
// full concurrent-write locking is out of scope for this round (which
// hardens against unexpected mid-operation *failure*, not concurrent
// *modification*).
export async function archiveSessionAtomically(params: {
  organisationId: string
  sessionId: string
  actingUserId: string | null
}): Promise<ArchiveOutcome> {
  const { organisationId, sessionId, actingUserId } = params

  const existing = await sql`SELECT archived_at FROM sessions WHERE id = ${sessionId} AND organisation_id = ${organisationId}`
  if (existing.length === 0) return { outcome: 'not_found' }
  if ((existing[0] as { archived_at: string | null }).archived_at !== null) return { outcome: 'already_archived' }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = toDateStr(today)

  const candidates = (await sql`
    SELECT si.id, to_char(si.date, 'YYYY-MM-DD') AS date,
      EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.session_instance_id = si.id AND b.status != 'cancelled' AND (b.paid = true OR b.attendance_status IS NOT NULL)
      ) AS protected
    FROM session_instances si
    WHERE si.session_id = ${sessionId} AND si.organisation_id = ${organisationId}
      AND si.status = 'scheduled' AND si.date >= ${todayStr}::date
  `) as { id: string; date: string; protected: boolean }[]

  const safe = candidates.filter(c => !c.protected)
  const conflicts = candidates.filter(c => c.protected).map(c => ({ instanceId: c.id, date: c.date }))

  const queries = [
    sql`UPDATE sessions SET archived_at = NOW() WHERE id = ${sessionId} AND organisation_id = ${organisationId} AND archived_at IS NULL RETURNING id, archived_at`,
    ...safe.flatMap(c => [
      sql`UPDATE bookings SET status = 'cancelled' WHERE session_instance_id = ${c.id} AND status != 'cancelled'`,
      sql`UPDATE session_instances SET status = 'cancelled' WHERE id = ${c.id}`,
    ]),
    auditLogInsertQuery({
      organisationId, userId: actingUserId, action: 'session.archive', sessionId,
      beforeState: { archived_at: null },
      afterState: { archived_at: 'now', cancelledInstances: safe.length, conflictCount: conflicts.length },
    }),
  ]

  const results = await sql.transaction(queries)
  const archivedRows = results[0] as { id: string; archived_at: string }[]
  if (archivedRows.length === 0) {
    // Lost the race described above — someone else archived it between
    // our pre-check and this transaction. The transaction as submitted
    // still committed (its other statements are unconditional), but the
    // session's own state didn't change as a result of THIS call.
    return { outcome: 'already_archived' }
  }

  return { outcome: 'archived', cancelledInstances: safe.length, conflicts }
}

export type RestoreOutcome =
  | { outcome: 'restored'; reconcile: ReconcileResult }
  | { outcome: 'not_found' }
  | { outcome: 'not_archived' }
  | { outcome: 'reconcile_failed'; error: string }

// Un-archives a session, then immediately reconciles its future dates
// from its existing (untouched) schedule rules. The state-clear itself
// is one atomic statement (trivially safe on its own); reconciliation is
// a separate, data-dependent, multi-step process (a variable number of
// INSERTs plus per-instance recurring-lineage enrolment via
// enrolActiveLineagesIntoNewInstance — code shared with ordinary
// Create/Edit saves) that cannot practically be folded into one
// non-interactive sql.transaction() without restructuring that shared
// machinery, which this hardening round deliberately does not touch.
//
// Instead: if reconcileFutureInstances() throws after archived_at has
// already been cleared, a compensating UPDATE puts archived_at back to
// its exact previous value (not just "now" — the original archive
// timestamp is preserved) before re-throwing, so the session is never
// left silently active with a schedule that was never actually
// regenerated. The audit log entry is written only after reconcile has
// also succeeded — never on the compensated/failed path — so a failed
// restore can never produce a "success" audit record.
export async function restoreSessionWithCompensation(params: {
  organisationId: string
  sessionId: string
  actingUserId: string | null
}): Promise<RestoreOutcome> {
  const { organisationId, sessionId, actingUserId } = params

  const rows = (await sql`
    SELECT archived_at, day_of_week, start_time, duration_minutes, max_capacity, session_type,
      to_char(start_date, 'YYYY-MM-DD') AS start_date, end_mode, end_after_weeks, to_char(end_date, 'YYYY-MM-DD') AS end_date
    FROM sessions WHERE id = ${sessionId} AND organisation_id = ${organisationId}
  `) as (SessionScheduleRow & { archived_at: string | null })[]

  if (rows.length === 0) return { outcome: 'not_found' }
  const previousArchivedAt = rows[0].archived_at
  if (previousArchivedAt === null) return { outcome: 'not_archived' }

  const cleared = await sql`
    UPDATE sessions SET archived_at = NULL
    WHERE id = ${sessionId} AND organisation_id = ${organisationId} AND archived_at IS NOT NULL
    RETURNING id
  `
  if (cleared.length === 0) return { outcome: 'not_archived' } // lost a race with a concurrent restore

  let reconcile: ReconcileResult
  try {
    reconcile = await reconcileFutureInstances({
      organisationId, sessionId,
      rules: { day_of_week: rows[0].day_of_week, start_date: rows[0].start_date, end_mode: rows[0].end_mode, end_after_weeks: rows[0].end_after_weeks, end_date: rows[0].end_date },
      startTime: rows[0].start_time, durationMinutes: rows[0].duration_minutes, maxCapacity: rows[0].max_capacity, sessionType: rows[0].session_type,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    try {
      await sql`UPDATE sessions SET archived_at = ${previousArchivedAt} WHERE id = ${sessionId} AND organisation_id = ${organisationId}`
    } catch (compensationErr) {
      // The compensating rollback itself failed — the session may now be
      // stuck active with an unreconciled schedule. Logged loudly rather
      // than silently swallowed; no audit entry is written either way,
      // matching "a failed operation never writes a success audit event."
      console.error('[restoreSessionWithCompensation] compensating rollback FAILED — session may be left active with a stale schedule', { sessionId, organisationId }, compensationErr)
    }
    return { outcome: 'reconcile_failed', error: message }
  }

  // Best-effort: a failure writing the audit entry after a genuinely
  // successful restore does not undo or fail the restore itself — audit
  // logging is a record of what happened, not a precondition for it.
  try {
    await auditLogInsertQuery({
      organisationId, userId: actingUserId, action: 'session.restore', sessionId,
      beforeState: { archived_at: previousArchivedAt },
      afterState: { archived_at: null, generated: reconcile.generated, cancelledInstances: reconcile.cancelledInstances },
    })
  } catch (auditErr) {
    console.error('[restoreSessionWithCompensation] audit log write failed after a successful restore', { sessionId, organisationId }, auditErr)
  }

  return { outcome: 'restored', reconcile }
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
// Archived sessions (archived_at IS NOT NULL) are excluded — they were
// deliberately retired via POST .../[id]/archive, which already cancelled
// their safe future instances and left protected ones scheduled; an
// archived session must never have new future instances generated for it
// by the org-wide top-up, or archiving would be silently undone the next
// time this runs. Active sessions (archived_at IS NULL) behave exactly as
// before this feature existed.
export async function reconcileAllSessionsForOrg(organisationId: string): Promise<ReconcileAllResult> {
  const sessions = (await sql`
    SELECT id, day_of_week, start_time, duration_minutes, max_capacity, session_type,
      to_char(start_date, 'YYYY-MM-DD') AS start_date, end_mode, end_after_weeks, to_char(end_date, 'YYYY-MM-DD') AS end_date
    FROM sessions WHERE organisation_id = ${organisationId} AND archived_at IS NULL
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
