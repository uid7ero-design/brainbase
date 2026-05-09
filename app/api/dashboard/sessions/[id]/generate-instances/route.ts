import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  const sessions = await sql`
    SELECT id, organisation_id, day_of_week, start_time, duration_minutes, max_capacity
    FROM sessions WHERE id = ${id} AND organisation_id = ${session.organisationId}
  `
  if (!sessions[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const tmpl = sessions[0] as {
    id: string; organisation_id: string; day_of_week: number
    start_time: string; duration_minutes: number; max_capacity: number
  }

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const inserted: string[] = []

  for (let w = 0; w < 6; w++) {
    const d = new Date(today)
    let daysAhead = tmpl.day_of_week - today.getDay() + w * 7
    if (daysAhead < 0) daysAhead += 7
    d.setDate(today.getDate() + daysAhead)
    if (d < today) continue
    const dateStr = d.toISOString().split('T')[0]
    try {
      await sql`
        INSERT INTO session_instances (id, session_id, organisation_id, date, start_time, duration_minutes, max_capacity, status)
        VALUES (${crypto.randomUUID()}, ${tmpl.id}, ${tmpl.organisation_id}, ${dateStr}::date, ${tmpl.start_time}, ${tmpl.duration_minutes}, ${tmpl.max_capacity}, 'scheduled')
        ON CONFLICT (session_id, date) DO NOTHING
      `
      inserted.push(dateStr)
    } catch (err) {
      console.error('[dashboard/generate-instances] error for', dateStr, err)
    }
  }

  const instances = await sql`
    SELECT id, session_id, date, start_time, duration_minutes, max_capacity, status, created_at,
      COALESCE((SELECT COUNT(*)::int FROM bookings b WHERE b.session_instance_id = si.id AND b.status != 'cancelled'), 0) AS enrolled_count
    FROM session_instances si WHERE si.session_id = ${id} ORDER BY si.date ASC
  `

  return NextResponse.json({ instances, generated: inserted.length })
}
