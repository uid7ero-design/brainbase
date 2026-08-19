import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import { restoreSessionWithCompensation } from '@/lib/tennisSchedule'

// Un-retires a session template: clears archived_at, then immediately
// reconciles it (same call Create/Edit already make on save) so its
// future horizon regenerates right away from its existing, untouched
// schedule rules — nothing about the session's configuration is
// recreated or duplicated, only its normal future-instance maintenance
// resumes.
//
// If reconciliation fails unexpectedly after archived_at was already
// cleared, restoreSessionWithCompensation compensates by putting
// archived_at back to its previous value before returning — this route
// never reports success in that case, and the session is never left
// silently active with a schedule that was never actually regenerated.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    const result = await restoreSessionWithCompensation({
      organisationId: session.organisationId,
      sessionId: id,
      actingUserId: session.userId,
    })

    if (result.outcome === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (result.outcome === 'not_archived') return NextResponse.json({ error: 'Not archived' }, { status: 409 })
    if (result.outcome === 'reconcile_failed') {
      // archived_at was already compensated back to its previous value
      // inside restoreSessionWithCompensation — this is a genuine failure,
      // not a partial success, so it must not return 200.
      return NextResponse.json({ error: 'Failed to restore session' }, { status: 500 })
    }

    return NextResponse.json({ restored: true, reconcile: result.reconcile })
  } catch (err) {
    console.error('[dashboard/sessions/[id]/restore POST]', err)
    return NextResponse.json({ error: 'Failed to restore session' }, { status: 500 })
  }
}
