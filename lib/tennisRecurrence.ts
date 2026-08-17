import 'server-only'
import sql from '@/lib/db'

// Single shared propagation algorithm for LD Tennis recurring enrolments.
// Used by:
//  - app/api/dashboard/sessions/[id]/instances/[instanceId]/route.ts (initial Weekly enrolment)
//  - app/api/dashboard/enrolments/[id]/route.ts (Once -> Weekly toggle, pause clear/shorten)
//  - app/api/dashboard/sessions/[id]/generate-instances/route.ts (newly-generated future instances)
// Task 6/14 requirement: one algorithm, not several independently-maintained
// copies. enrolLineageIntoInstance() is the single primitive both directions
// (one lineage -> many future instances, and one new instance -> many active
// lineages) are built from.

export type EnrolOutcome = 'enrolled' | 'already_present' | 'paused' | 'capacity_blocked' | 'error'

export type PropagationSummary = {
  propagated: number
  alreadyPresent: number
  paused: number
  capacityBlocked: number
  errors: number
  skippedDates: string[] // YYYY-MM-DD, capacity-blocked or errored, for user-facing feedback
}

function emptySummary(): PropagationSummary {
  return { propagated: 0, alreadyPresent: 0, paused: 0, capacityBlocked: 0, errors: 0, skippedDates: [] }
}

export type FutureInstance = {
  id: string
  date: string // YYYY-MM-DD
  start_time: string
  max_capacity: number
  session_type: string
  enrolled: number
}

export type RecurringLineage = { recurring_group_id: string; client_name: string; client_email: string | null }

/** Active pause windows for a recurring lineage, organisation-scoped. */
export async function loadPauseWindows(
  organisationId: string,
  recurringGroupId: string,
): Promise<{ pause_from: string; pause_until: string }[]> {
  const rows = await sql`
    SELECT to_char(pause_from, 'YYYY-MM-DD') AS pause_from, to_char(pause_until, 'YYYY-MM-DD') AS pause_until
    FROM booking_recurrence_pauses
    WHERE organisation_id = ${organisationId} AND recurring_group_id = ${recurringGroupId}
  `
  return rows as { pause_from: string; pause_until: string }[]
}

export function isDateWithinAnyPause(
  date: string,
  pauses: { pause_from: string; pause_until: string }[],
): boolean {
  return pauses.some(p => date >= p.pause_from && date <= p.pause_until)
}

/**
 * One recurring lineage x one target instance. Skips (does not insert) if
 * the date is paused, the lineage is already enrolled in that instance, or
 * the instance is at capacity — never overbooks. Conflict-safe: relies on
 * the DB-level unique index uniq_bookings_instance_recurring_group
 * (session_instance_id, recurring_group_id) WHERE status != 'cancelled' AND
 * recurring_group_id IS NOT NULL, combined with INSERT ... ON CONFLICT DO
 * NOTHING — the same pattern session_instances (session_id, date) already
 * uses elsewhere in this codebase — so concurrent requests (double-click,
 * simultaneous generation + backfill) cannot create duplicate propagated
 * bookings even if the pre-insert checks below race.
 */
export async function enrolLineageIntoInstance(params: {
  organisationId: string
  sessionId: string
  instance: FutureInstance
  recurringGroupId: string
  clientName: string
  clientEmail: string | null
  pauses: { pause_from: string; pause_until: string }[]
}): Promise<EnrolOutcome> {
  const { organisationId, sessionId, instance, recurringGroupId, clientName, clientEmail, pauses } = params

  if (isDateWithinAnyPause(instance.date, pauses)) return 'paused'

  const existing = await sql`
    SELECT 1 FROM bookings
    WHERE session_instance_id = ${instance.id} AND recurring_group_id = ${recurringGroupId} AND status != 'cancelled'
    LIMIT 1
  `
  if (existing.length > 0) return 'already_present'

  if (instance.enrolled >= instance.max_capacity) return 'capacity_blocked'

  try {
    const inserted = await sql`
      INSERT INTO bookings
        (id, organisation_id, session_id, session_instance_id, client_name, client_email, date, time, session_type, status, paid, is_recurring, recurring_group_id)
      VALUES
        (${crypto.randomUUID()}, ${organisationId}, ${sessionId}, ${instance.id},
         ${clientName}, ${clientEmail}, ${instance.date}::date, ${instance.start_time}, ${instance.session_type},
         'confirmed', false, true, ${recurringGroupId})
      ON CONFLICT (session_instance_id, recurring_group_id) WHERE status != 'cancelled' AND recurring_group_id IS NOT NULL
      DO NOTHING
      RETURNING id
    `
    // A conflict here means a concurrent request already enrolled this
    // lineage into this instance — same observable outcome as "already present".
    return inserted.length > 0 ? 'enrolled' : 'already_present'
  } catch (err) {
    console.error('[tennisRecurrence] enrol insert failed for', instance.date, err)
    return 'error'
  }
}

function applyOutcome(summary: PropagationSummary, date: string, outcome: EnrolOutcome) {
  if (outcome === 'enrolled') summary.propagated++
  else if (outcome === 'already_present') summary.alreadyPresent++
  else if (outcome === 'paused') summary.paused++
  else if (outcome === 'capacity_blocked') { summary.capacityBlocked++; summary.skippedDates.push(date) }
  else { summary.errors++; summary.skippedDates.push(date) }
}

/**
 * Propagates one recurring lineage forward into every already-generated
 * FUTURE, non-cancelled session instance for the same session, starting
 * strictly after `afterDate`. Every skip (paused / already enrolled /
 * capacity-full / error) is accounted for in the returned summary so the
 * caller never has to silently claim full success.
 */
export async function propagateRecurringEnrolment(params: {
  organisationId: string
  sessionId: string
  recurringGroupId: string
  clientName: string
  clientEmail: string | null
  afterDate: string // YYYY-MM-DD — instances strictly after this date are eligible
}): Promise<PropagationSummary> {
  const { organisationId, sessionId, recurringGroupId, clientName, clientEmail, afterDate } = params
  const summary = emptySummary()

  const pauses = await loadPauseWindows(organisationId, recurringGroupId)

  const futureInstances = (await sql`
    SELECT si.id, to_char(si.date, 'YYYY-MM-DD') AS date, si.start_time, si.max_capacity, s.session_type,
      COALESCE((SELECT COUNT(*)::int FROM bookings b WHERE b.session_instance_id = si.id AND b.status != 'cancelled'), 0) AS enrolled
    FROM session_instances si
    JOIN sessions s ON s.id = si.session_id
    WHERE si.session_id = ${sessionId} AND s.organisation_id = ${organisationId}
      AND si.date > ${afterDate}::date AND si.status = 'scheduled'
    ORDER BY si.date ASC
  `) as FutureInstance[]

  for (const inst of futureInstances) {
    const outcome = await enrolLineageIntoInstance({
      organisationId, sessionId, instance: inst, recurringGroupId, clientName, clientEmail, pauses,
    })
    applyOutcome(summary, inst.date, outcome)
  }

  return summary
}

/**
 * All distinct active recurring lineages for a session — one representative
 * row per recurring_group_id (most recent booking), used by
 * generate-instances to know who should be auto-enrolled into a newly
 * created future instance.
 */
export async function getActiveRecurringLineages(
  organisationId: string,
  sessionId: string,
): Promise<RecurringLineage[]> {
  const rows = await sql`
    SELECT DISTINCT ON (recurring_group_id) recurring_group_id, client_name, client_email
    FROM bookings
    WHERE session_id = ${sessionId} AND organisation_id = ${organisationId}
      AND is_recurring = true AND recurring_group_id IS NOT NULL AND status != 'cancelled'
    ORDER BY recurring_group_id, date DESC
  `
  return rows as RecurringLineage[]
}

/**
 * Enrols every currently-active recurring lineage into a single
 * newly-generated instance. Used by generate-instances so newly generated
 * instances apply the exact same eligibility rules (organisation scope,
 * pause windows, duplicate prevention, capacity) as backfilling an
 * already-generated instance — no separate/incompatible logic path.
 */
export async function enrolActiveLineagesIntoNewInstance(params: {
  organisationId: string
  sessionId: string
  instance: FutureInstance
}): Promise<PropagationSummary> {
  const { organisationId, sessionId, instance } = params
  const summary = emptySummary()

  const lineages = await getActiveRecurringLineages(organisationId, sessionId)
  let enrolled = instance.enrolled

  for (const lineage of lineages) {
    const pauses = await loadPauseWindows(organisationId, lineage.recurring_group_id)
    const outcome = await enrolLineageIntoInstance({
      organisationId, sessionId, instance: { ...instance, enrolled },
      recurringGroupId: lineage.recurring_group_id,
      clientName: lineage.client_name, clientEmail: lineage.client_email,
      pauses,
    })
    applyOutcome(summary, instance.date, outcome)
    if (outcome === 'enrolled') enrolled++
  }

  return summary
}
