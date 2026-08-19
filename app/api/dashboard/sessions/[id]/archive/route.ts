import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'
import { cancelFutureInstancesForArchive } from '@/lib/tennisSchedule'

// Retires a session template without deleting it: stops it from ever
// generating new future instances again (see reconcileAllSessionsForOrg's
// archived_at IS NULL filter), then cancels its already-generated future
// instances — except any with a protected (paid or attendance-recorded)
// booking, which are left scheduled and reported back as a conflict for a
// manager to resolve manually, exactly like an edited schedule's conflicts.
// Historical instances/bookings/attendance are never touched.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    // Scoped by both id AND organisation_id, and only transitions a
    // currently-active row — a cross-org id or an already-archived one
    // simply matches zero rows here, never silently no-ops on someone
    // else's data.
    const rows = await sql`
      UPDATE sessions SET archived_at = NOW()
      WHERE id = ${id} AND organisation_id = ${session.organisationId} AND archived_at IS NULL
      RETURNING id
    `
    if (!rows[0]) {
      const exists = await sql`SELECT id FROM sessions WHERE id = ${id} AND organisation_id = ${session.organisationId}`
      if (!exists[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ error: 'Already archived' }, { status: 409 })
    }

    const cancel = await cancelFutureInstancesForArchive({ organisationId: session.organisationId, sessionId: id })
    return NextResponse.json({ archived: true, cancel })
  } catch (err) {
    console.error('[dashboard/sessions/[id]/archive POST]', err)
    return NextResponse.json({ error: 'Failed to archive session' }, { status: 500 })
  }
}
