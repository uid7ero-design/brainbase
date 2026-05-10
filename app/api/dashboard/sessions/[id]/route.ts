import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    const sessions = await sql`
      SELECT id, name, day_of_week, start_time, duration_minutes, max_capacity, session_type, resource_id, recurring,
             price_per_session, created_at
      FROM sessions
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
    `
    if (!sessions[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const instances = await sql`
      SELECT
        si.id,
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

    return NextResponse.json({ session: sessions[0], instances })
  } catch (err) {
    console.error('[dashboard/sessions/[id] GET]', err)
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params
  let body: Partial<{ name: string; day_of_week: number; start_time: string; duration_minutes: number; max_capacity: number; session_type: string; resource_id: string | null; recurring: boolean; price_per_session: number }>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  try {
    const rows = await sql`
      UPDATE sessions SET
        name              = COALESCE(${body.name?.trim() ?? null}, name),
        day_of_week       = COALESCE(${body.day_of_week ?? null}, day_of_week),
        start_time        = COALESCE(${body.start_time ?? null}, start_time),
        duration_minutes  = COALESCE(${body.duration_minutes ?? null}, duration_minutes),
        max_capacity      = COALESCE(${body.max_capacity ?? null}, max_capacity),
        session_type      = COALESCE(${body.session_type?.trim() ?? null}, session_type),
        resource_id       = ${body.resource_id !== undefined ? (body.resource_id?.trim() || null) : sql`resource_id`},
        recurring         = COALESCE(${body.recurring ?? null}, recurring),
        price_per_session = COALESCE(${body.price_per_session ?? null}, price_per_session)
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
      RETURNING id, name, day_of_week, start_time, duration_minutes, max_capacity, session_type, resource_id, recurring, price_per_session, created_at
    `
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ session: rows[0] })
  } catch (err) {
    console.error('[dashboard/sessions/[id] PATCH]', err)
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    // Delete bookings → instances → session (foreign key order)
    await sql`
      DELETE FROM bookings WHERE session_instance_id IN (
        SELECT id FROM session_instances WHERE session_id = ${id}
      )
    `
    await sql`DELETE FROM session_instances WHERE session_id = ${id}`
    const rows = await sql`
      DELETE FROM sessions WHERE id = ${id} AND organisation_id = ${session.organisationId} RETURNING id
    `
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error('[dashboard/sessions/[id] DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
  }
}
