import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function GET() {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  try {
    const sessions = await sql`
      SELECT
        s.id, s.name, s.day_of_week, s.start_time, s.duration_minutes,
        s.max_capacity, s.session_type, s.resource_id, s.recurring, s.price_per_session, s.created_at,
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
  } catch {
    // bookings table may not exist yet — fall back to count-free query
    try {
      const sessions = await sql`
        SELECT id, name, day_of_week, start_time, duration_minutes,
               max_capacity, session_type, resource_id, recurring, created_at
        FROM sessions
        WHERE organisation_id = ${session.organisationId}
        ORDER BY day_of_week, start_time
      `
      return NextResponse.json({ sessions: sessions.map(s => ({ ...s, enrolled_count: 0 })) })
    } catch (err2) {
      console.error('[dashboard/sessions GET]', err2)
      return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
    }
  }
}

export async function POST(req: NextRequest) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  let body: {
    name: string; day_of_week: number; start_time: string
    duration_minutes?: number; max_capacity?: number
    session_type: string; resource_id?: string; recurring?: boolean
    price_per_session?: number
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (!body.name?.trim() || body.day_of_week == null || !body.start_time || !body.session_type?.trim()) {
    return NextResponse.json({ error: 'name, day_of_week, start_time, and session_type are required' }, { status: 400 })
  }

  try {
    const id = crypto.randomUUID()
    const rows = await sql`
      INSERT INTO sessions (id, organisation_id, name, day_of_week, start_time, duration_minutes, max_capacity, session_type, resource_id, recurring, price_per_session)
      VALUES (
        ${id}, ${session.organisationId}, ${body.name.trim()}, ${body.day_of_week},
        ${body.start_time}, ${body.duration_minutes ?? 60}, ${body.max_capacity ?? 8},
        ${body.session_type.trim()}, ${body.resource_id?.trim() ?? null}, ${body.recurring ?? true},
        ${body.price_per_session ?? 0}
      )
      RETURNING id, organisation_id, name, day_of_week, start_time, duration_minutes, max_capacity, session_type, resource_id, recurring, price_per_session, created_at
    `

    // Auto-generate instances
    generateInstances(id, session.organisationId, body.day_of_week, body.start_time, body.duration_minutes ?? 60, body.max_capacity ?? 8)
      .catch(err => console.error('[dashboard/sessions POST] generate error:', err))

    return NextResponse.json({ session: { ...rows[0], enrolled_count: 0 } }, { status: 201 })
  } catch (err) {
    console.error('[dashboard/sessions POST]', err)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }
}

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

async function generateInstances(
  sessionId: string, organisationId: string,
  dayOfWeek: number, startTime: string, durationMinutes: number, maxCapacity: number
) {
  const now = new Date()
  let daysUntilNext = ((dayOfWeek - now.getDay()) + 7) % 7
  if (daysUntilNext === 0) daysUntilNext = 7
  for (let w = 0; w < 6; w++) {
    const base = new Date()
    base.setDate(base.getDate() + daysUntilNext + w * 7)
    const targetDate = toLocalDateStr(base)
    await sql`
      INSERT INTO session_instances (id, session_id, organisation_id, date, start_time, duration_minutes, max_capacity, status)
      VALUES (${crypto.randomUUID()}, ${sessionId}, ${organisationId}, ${targetDate}::date, ${startTime}, ${durationMinutes}, ${maxCapacity}, 'scheduled')
      ON CONFLICT (session_id, date) DO NOTHING
    `
  }
}
