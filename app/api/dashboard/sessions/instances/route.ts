import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  // date_from/date_to bound the query for calendar (week/month) views so
  // navigating never fetches the full unbounded instance history. Both are
  // optional and independent — omitting them preserves the pre-existing
  // unbounded behaviour relied on elsewhere (e.g. the wrong-weekday
  // auto-fix check on initial page load).
  const { searchParams } = new URL(req.url)
  const dateFromParam = searchParams.get('date_from')
  const dateToParam = searchParams.get('date_to')
  if (dateFromParam && !DATE_RE.test(dateFromParam)) {
    return NextResponse.json({ error: 'date_from must be YYYY-MM-DD' }, { status: 400 })
  }
  if (dateToParam && !DATE_RE.test(dateToParam)) {
    return NextResponse.json({ error: 'date_to must be YYYY-MM-DD' }, { status: 400 })
  }
  const dateFrom = dateFromParam ?? null
  const dateTo = dateToParam ?? null

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
        AND (${dateFrom}::date IS NULL OR si.date >= ${dateFrom}::date)
        AND (${dateTo}::date IS NULL OR si.date <= ${dateTo}::date)
      ORDER BY si.date ASC, si.start_time ASC
    `

    return NextResponse.json({ instances })
  } catch (err) {
    console.error('[dashboard/sessions/instances GET]', err)
    return NextResponse.json({ instances: [] })
  }
}
