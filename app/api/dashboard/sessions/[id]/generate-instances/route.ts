import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'
import { reconcileFutureInstances, type EndMode } from '@/lib/tennisSchedule'

// "Repair future dates" — the manual recovery action kept for admin/manager
// use once automatic schedule maintenance exists (session save + dashboard
// load already call reconcileFutureInstances; this route exists for when
// Luke wants to force it immediately, e.g. right after fixing a typo'd
// schedule, without waiting for the next dashboard load). Reuses the exact
// same additive, future-only, protected-booking-safe reconciliation as
// every other trigger — it no longer blindly deletes and regenerates a
// fixed 6 weeks the way this endpoint used to.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let authSession
  try { authSession = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  const rows = await sql`
    SELECT id, organisation_id, day_of_week, start_time, duration_minutes, max_capacity, session_type,
      to_char(start_date, 'YYYY-MM-DD') AS start_date, end_mode, end_after_weeks, to_char(end_date, 'YYYY-MM-DD') AS end_date
    FROM sessions WHERE id = ${id} AND organisation_id = ${authSession.organisationId}
  `
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const tmpl = rows[0] as {
    id: string; organisation_id: string; day_of_week: number
    start_time: string; duration_minutes: number; max_capacity: number; session_type: string
    start_date: string | null; end_mode: EndMode; end_after_weeks: number | null; end_date: string | null
  }

  const reconcile = await reconcileFutureInstances({
    organisationId: tmpl.organisation_id,
    sessionId: tmpl.id,
    rules: { day_of_week: tmpl.day_of_week, start_date: tmpl.start_date, end_mode: tmpl.end_mode, end_after_weeks: tmpl.end_after_weeks, end_date: tmpl.end_date },
    startTime: tmpl.start_time, durationMinutes: tmpl.duration_minutes, maxCapacity: tmpl.max_capacity, sessionType: tmpl.session_type,
  })

  const instances = await sql`
    SELECT
      si.id,
      si.session_id,
      to_char(si.date, 'YYYY-MM-DD') AS date,
      si.start_time,
      si.duration_minutes,
      si.max_capacity,
      si.status,
      si.created_at,
      COALESCE(ec.cnt, 0) AS enrolled_count,
      COALESCE(ec.cnt * s.price_per_session, 0)::int AS revenue,
      COALESCE(ROUND(ec.cnt::numeric / NULLIF(si.max_capacity, 0) * 100), 0)::int AS utilisation
    FROM session_instances si
    JOIN sessions s ON s.id = si.session_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
      FROM bookings b
      WHERE b.session_instance_id = si.id AND b.status != 'cancelled'
    ) ec ON true
    WHERE si.session_id = ${id}
    ORDER BY si.date ASC
  `

  return NextResponse.json({ instances, generated: reconcile.generated, reconcile })
}
