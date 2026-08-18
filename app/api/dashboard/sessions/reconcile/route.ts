import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import { reconcileAllSessionsForOrg } from '@/lib/tennisSchedule'

// The one automatic top-up trigger for Ongoing schedules. Deliberately a
// standalone, authenticated, awaited POST rather than a side effect of
// GET /api/dashboard/sessions — see that route for why an unawaited write
// inside a GET handler was rejected (serverless requests can be frozen or
// recycled the instant the response is sent, before a fire-and-forget
// write actually lands; a GET should never surprise-mutate state that a
// refetch, prefetch, or future caching layer might trigger).
//
// Reconciliation can insert and cancel session_instances rows, so it's
// treated as a write and gated at manager, matching every other
// dashboard/sessions/* route that mutates data. Scoped entirely to the
// caller's own organisation via requireRole's organisationId — there is no
// way to reconcile another tenant's sessions through this endpoint.
//
// Idempotent: every insert inside reconcileFutureInstances() goes through
// INSERT ... ON CONFLICT (session_id, date) DO NOTHING against the
// pre-existing unique index on session_instances(session_id, date) (already
// relied on by the original "Generate 6 weeks" flow and by every other
// instance-creation path in this codebase — not a new constraint). Two
// overlapping calls for the same organisation can both attempt to insert
// the same date; the database resolves the race, not application logic —
// at most one of them wins the row, the other's INSERT is a no-op.
export async function POST() {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  try {
    const result = await reconcileAllSessionsForOrg(session.organisationId)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[dashboard/sessions/reconcile POST]', err)
    return NextResponse.json({ error: 'Failed to reconcile schedules' }, { status: 500 })
  }
}
