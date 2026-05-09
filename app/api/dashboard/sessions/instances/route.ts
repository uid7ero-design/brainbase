import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function GET() {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  try {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const end   = new Date(today); end.setDate(today.getDate() + 14)
    const todayStr = today.toISOString().split('T')[0]
    const endStr   = end.toISOString().split('T')[0]

    const instances = await sql`
      SELECT
        si.id, si.session_id, si.date, si.start_time, si.duration_minutes, si.max_capacity, si.status,
        s.name AS session_name, s.session_type, s.resource_id,
        COALESCE(
          (SELECT COUNT(*)::int FROM bookings b WHERE b.session_instance_id = si.id AND b.status != 'cancelled'),
          0
        ) AS enrolled_count
      FROM session_instances si
      JOIN sessions s ON s.id = si.session_id
      WHERE s.organisation_id = ${session.organisationId}
        AND si.date >= ${todayStr}::date
        AND si.date <= ${endStr}::date
        AND si.status = 'scheduled'
      ORDER BY si.date ASC, si.start_time ASC
    `

    return NextResponse.json({ instances })
  } catch (err) {
    console.error('[dashboard/sessions/instances GET]', err)
    return NextResponse.json({ instances: [] })
  }
}
