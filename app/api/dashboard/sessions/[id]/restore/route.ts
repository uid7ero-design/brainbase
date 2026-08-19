import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'
import { reconcileFutureInstances, type EndMode } from '@/lib/tennisSchedule'

// Un-retires a session template: clears archived_at, then immediately
// reconciles it (same call Create/Edit already make on save) so its
// future horizon regenerates right away from its existing, untouched
// schedule rules — nothing about the session's configuration is
// recreated or duplicated, only its normal future-instance maintenance
// resumes.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    const rows = await sql`
      UPDATE sessions SET archived_at = NULL
      WHERE id = ${id} AND organisation_id = ${session.organisationId} AND archived_at IS NOT NULL
      RETURNING id, day_of_week, start_time, duration_minutes, max_capacity, session_type,
        to_char(start_date, 'YYYY-MM-DD') AS start_date, end_mode, end_after_weeks, to_char(end_date, 'YYYY-MM-DD') AS end_date
    `
    if (!rows[0]) {
      const exists = await sql`SELECT id FROM sessions WHERE id = ${id} AND organisation_id = ${session.organisationId}`
      if (!exists[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ error: 'Not archived' }, { status: 409 })
    }

    const s = rows[0] as {
      id: string; day_of_week: number; start_time: string; duration_minutes: number; max_capacity: number
      session_type: string; start_date: string | null; end_mode: EndMode; end_after_weeks: number | null; end_date: string | null
    }
    const reconcile = await reconcileFutureInstances({
      organisationId: session.organisationId,
      sessionId: id,
      rules: { day_of_week: s.day_of_week, start_date: s.start_date, end_mode: s.end_mode, end_after_weeks: s.end_after_weeks, end_date: s.end_date },
      startTime: s.start_time, durationMinutes: s.duration_minutes, maxCapacity: s.max_capacity, sessionType: s.session_type,
    })
    return NextResponse.json({ restored: true, reconcile })
  } catch (err) {
    console.error('[dashboard/sessions/[id]/restore POST]', err)
    return NextResponse.json({ error: 'Failed to restore session' }, { status: 500 })
  }
}
