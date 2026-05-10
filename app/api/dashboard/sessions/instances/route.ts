import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function GET() {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  try {
    const instances = await sql`
      SELECT
        si.id, si.session_id, to_char(si.date, 'YYYY-MM-DD') AS date, si.start_time, si.duration_minutes,
        si.max_capacity, si.status,
        s.name AS session_name, s.session_type, s.resource_id,
        COALESCE(ec.cnt, 0) AS enrolled_count,
        COALESCE(ec.cnt * s.price_per_session, 0)::int AS revenue,
        COALESCE(ROUND(ec.cnt::numeric / NULLIF(si.max_capacity, 0) * 100), 0)::int AS utilisation
      FROM session_instances si
      JOIN sessions s ON s.id = si.session_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt FROM bookings b
        WHERE b.session_instance_id = si.id AND b.status != 'cancelled'
      ) ec ON true
      WHERE s.organisation_id = ${session.organisationId}
        AND si.status = 'scheduled'
      ORDER BY si.date ASC, si.start_time ASC
    `

    return NextResponse.json({ instances })
  } catch (err) {
    console.error('[dashboard/sessions/instances GET]', err)
    return NextResponse.json({ instances: [] })
  }
}
