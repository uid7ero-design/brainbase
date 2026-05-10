import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; instanceId: string }> }
) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id, instanceId } = await params
  const body = await req.json().catch(() => null)
  if (!body?.client_name?.trim()) return NextResponse.json({ error: 'client_name is required' }, { status: 400 })

  try {
    const instances = await sql`
      SELECT si.id, si.max_capacity, to_char(si.date, 'YYYY-MM-DD') AS date, si.start_time, s.session_type,
        COALESCE((SELECT COUNT(*)::int FROM bookings b WHERE b.session_instance_id = si.id AND b.status != 'cancelled'), 0) AS enrolled
      FROM session_instances si
      JOIN sessions s ON s.id = si.session_id
      WHERE si.id = ${instanceId} AND si.session_id = ${id} AND s.organisation_id = ${session.organisationId}
    `
    if (!instances[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const inst = instances[0] as { id: string; max_capacity: number; enrolled: number; date: string; start_time: string; session_type: string }
    if (inst.enrolled >= inst.max_capacity) return NextResponse.json({ error: 'Session is full' }, { status: 409 })

    const rows = await sql`
      INSERT INTO bookings (id, organisation_id, session_id, session_instance_id, client_name, client_email, date, time, session_type, status, paid, is_recurring)
      VALUES (${crypto.randomUUID()}, ${session.organisationId}, ${id}, ${instanceId}, ${body.client_name.trim()}, ${body.client_email?.trim() || null}, ${inst.date}, ${inst.start_time}, ${inst.session_type}, 'confirmed', false, false)
      RETURNING id, client_name, client_email, paid, attendance_status, status, pipeline_id, is_recurring, created_at
    `
    return NextResponse.json({ booking: rows[0] }, { status: 201 })
  } catch (err) {
    console.error('[dashboard/sessions/instances/[instanceId] POST]', err)
    return NextResponse.json({ error: 'Failed to enroll' }, { status: 500 })
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; instanceId: string }> }
) {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id, instanceId } = await params

  try {
    const instances = await sql`
      SELECT si.id, si.session_id, to_char(si.date, 'YYYY-MM-DD') AS date, si.start_time, si.duration_minutes, si.max_capacity, si.status
      FROM session_instances si
      JOIN sessions s ON s.id = si.session_id
      WHERE si.id = ${instanceId} AND si.session_id = ${id} AND s.organisation_id = ${session.organisationId}
    `
    if (!instances[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let bookings: unknown[] = []
    try {
      bookings = await sql`
        SELECT b.id, b.client_name, b.client_email, b.paid, b.attendance_status, b.status, b.pipeline_id, b.is_recurring, b.created_at
        FROM bookings b
        WHERE b.session_instance_id = ${instanceId} AND b.status != 'cancelled'
        ORDER BY b.created_at ASC
      `
    } catch {
      // bookings table not yet created — return empty list
    }

    return NextResponse.json({ instance: instances[0], bookings })
  } catch (err) {
    console.error('[dashboard/sessions/instances/[instanceId] GET]', err)
    return NextResponse.json({ error: 'Failed to fetch instance' }, { status: 500 })
  }
}
