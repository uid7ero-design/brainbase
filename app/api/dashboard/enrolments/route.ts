import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function POST(req: NextRequest) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  let body: { session_instance_id: string; contact_id: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (!body.session_instance_id || !body.contact_id) {
    return NextResponse.json({ error: 'session_instance_id and contact_id are required' }, { status: 400 })
  }

  try {
    const contacts = await sql`
      SELECT id, name, email FROM contacts
      WHERE id = ${body.contact_id} AND organisation_id = ${session.organisationId}
    `
    if (!contacts[0]) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    const contact = contacts[0] as { id: string; name: string; email: string | null }

    const instances = await sql`
      SELECT si.id, si.session_id, si.max_capacity, si.start_time, s.session_type,
             to_char(si.date, 'YYYY-MM-DD') AS date,
             COALESCE((SELECT COUNT(*)::int FROM bookings b WHERE b.session_instance_id = si.id AND b.status != 'cancelled'), 0) AS enrolled
      FROM session_instances si
      JOIN sessions s ON s.id = si.session_id
      WHERE si.id = ${body.session_instance_id} AND s.organisation_id = ${session.organisationId}
    `
    if (!instances[0]) return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
    const inst = instances[0] as { id: string; session_id: string; max_capacity: number; enrolled: number; date: string; start_time: string; session_type: string }
    if (inst.enrolled >= inst.max_capacity) return NextResponse.json({ error: 'Session is full' }, { status: 409 })

    const rows = await sql`
      INSERT INTO bookings (id, organisation_id, session_id, session_instance_id, client_name, client_email, date, time, session_type, status, paid, is_recurring)
      VALUES (${crypto.randomUUID()}, ${session.organisationId}, ${inst.session_id}, ${inst.id}, ${contact.name}, ${contact.email}, ${inst.date}, ${inst.start_time}, ${inst.session_type}, 'confirmed', false, false)
      RETURNING id, client_name, client_email, paid, attendance_status, status, pipeline_id, is_recurring, created_at
    `
    return NextResponse.json({ booking: rows[0] }, { status: 201 })
  } catch (err) {
    console.error('[enrolments POST]', err)
    return NextResponse.json({ error: 'Failed to enrol' }, { status: 500 })
  }
}
