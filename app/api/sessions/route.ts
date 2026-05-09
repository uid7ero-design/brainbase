import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function GET() {
  let session
  try { session = await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  try {
    const sessions = await sql`
      SELECT
        s.id, s.name, s.day_of_week, s.start_time, s.duration_minutes,
        s.max_capacity, s.session_type, s.resource_id, s.recurring, s.created_at,
        COALESCE(
          (SELECT COUNT(*)::int FROM bookings b
           WHERE b.session_id = s.id AND b.status != 'cancelled'),
          0
        ) AS enrolled_count
      FROM sessions s
      WHERE s.organisation_id = ${session.organisationId}
      ORDER BY s.day_of_week, s.start_time
    `
    return NextResponse.json({ sessions })
  } catch (err) {
    console.error('[sessions GET]', err)
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let session
  try { session = await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  let body: {
    name: string
    day_of_week: number
    start_time: string
    duration_minutes?: number
    max_capacity?: number
    session_type: string
    resource_id?: string
    recurring?: boolean
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (!body.name?.trim() || body.day_of_week == null || !body.start_time || !body.session_type?.trim()) {
    return NextResponse.json({ error: 'name, day_of_week, start_time, and session_type are required' }, { status: 400 })
  }
  if (body.day_of_week < 0 || body.day_of_week > 6) {
    return NextResponse.json({ error: 'day_of_week must be 0–6' }, { status: 400 })
  }

  try {
    const id = crypto.randomUUID()
    const rows = await sql`
      INSERT INTO sessions (id, organisation_id, name, day_of_week, start_time, duration_minutes, max_capacity, session_type, resource_id, recurring)
      VALUES (
        ${id},
        ${session.organisationId},
        ${body.name.trim()},
        ${body.day_of_week},
        ${body.start_time},
        ${body.duration_minutes ?? 60},
        ${body.max_capacity ?? 8},
        ${body.session_type.trim()},
        ${body.resource_id?.trim() ?? null},
        ${body.recurring ?? true}
      )
      RETURNING id, organisation_id, name, day_of_week, start_time, duration_minutes, max_capacity, session_type, resource_id, recurring, created_at
    `

    // Auto-generate instances for the next 6 weeks (fire-and-forget, non-blocking)
    generateInstances(id, session.organisationId, body.day_of_week, body.start_time, body.duration_minutes ?? 60, body.max_capacity ?? 8)
      .catch(err => console.error('[sessions POST] generate-instances error:', err))

    return NextResponse.json({ session: { ...rows[0], enrolled_count: 0 } }, { status: 201 })
  } catch (err) {
    console.error('[sessions POST]', err)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }
}

async function generateInstances(
  sessionId: string, organisationId: string,
  dayOfWeek: number, startTime: string, durationMinutes: number, maxCapacity: number
) {
  const WEEKS_AHEAD = 6
  const today = new Date(); today.setHours(0, 0, 0, 0)

  for (let w = 0; w < WEEKS_AHEAD; w++) {
    const d = new Date(today)
    let daysAhead = dayOfWeek - today.getDay() + w * 7
    if (daysAhead < 0) daysAhead += 7
    d.setDate(today.getDate() + daysAhead)
    if (d < today) continue
    const dateStr = d.toISOString().split('T')[0]
    const instanceId = crypto.randomUUID()
    await sql`
      INSERT INTO session_instances (id, session_id, organisation_id, date, start_time, duration_minutes, max_capacity, status)
      VALUES (${instanceId}, ${sessionId}, ${organisationId}, ${dateStr}::date, ${startTime}, ${durationMinutes}, ${maxCapacity}, 'scheduled')
      ON CONFLICT (session_id, date) DO NOTHING
    `
  }
}
