import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import { archiveSessionAtomically } from '@/lib/tennisSchedule'

// Retires a session template without deleting it: stops it from ever
// generating new future instances again (see reconcileAllSessionsForOrg's
// archived_at IS NULL filter), then cancels its already-generated future
// instances — except any with a protected (paid or attendance-recorded)
// booking, which are left scheduled and reported back as a conflict for a
// manager to resolve manually, exactly like an edited schedule's conflicts.
// Historical instances/bookings/attendance are never touched.
//
// The archived_at write, every safe instance/booking cancellation, and the
// audit log entry all happen inside one atomic Postgres transaction (see
// archiveSessionAtomically) — an unexpected failure partway through can
// never leave this route reporting success on a partially-completed archive.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    const result = await archiveSessionAtomically({
      organisationId: session.organisationId,
      sessionId: id,
      actingUserId: session.userId,
    })

    if (result.outcome === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (result.outcome === 'already_archived') return NextResponse.json({ error: 'Already archived' }, { status: 409 })

    return NextResponse.json({
      archived: true,
      cancel: { cancelledInstances: result.cancelledInstances, conflicts: result.conflicts },
    })
  } catch (err) {
    console.error('[dashboard/sessions/[id]/archive POST]', err)
    return NextResponse.json({ error: 'Failed to archive session' }, { status: 500 })
  }
}
