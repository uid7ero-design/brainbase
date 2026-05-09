import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'

const ORG_ID = process.env.LD_TENNIS_ORG_ID

export async function POST(req: NextRequest) {
  if (!ORG_ID) return NextResponse.json({ error: 'Booking not available' }, { status: 503 })

  let body: { session_instance_id: string; name: string; email: string; phone?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  if (!body.session_instance_id || !body.name?.trim() || !body.email?.trim()) {
    return NextResponse.json({ error: 'session_instance_id, name and email are required' }, { status: 400 })
  }

  // Verify instance exists and is available
  const instances = await sql`
    SELECT si.id, si.session_id, si.date, si.start_time, si.duration_minutes, si.max_capacity,
           s.name AS session_name, s.session_type
    FROM session_instances si
    JOIN sessions s ON s.id = si.session_id
    WHERE si.id = ${body.session_instance_id}
      AND s.organisation_id = ${ORG_ID}
      AND si.status = 'scheduled'
  `
  if (!instances[0]) return NextResponse.json({ error: 'Session not found or unavailable' }, { status: 404 })

  const inst = instances[0] as {
    id: string; session_id: string; date: string; start_time: string
    duration_minutes: number; max_capacity: number
    session_name: string; session_type: string
  }

  // Capacity check
  const enrolled = await sql`
    SELECT COUNT(*)::int AS count FROM bookings
    WHERE session_instance_id = ${body.session_instance_id} AND status != 'cancelled'
  `
  if ((enrolled[0].count as number) >= inst.max_capacity) {
    return NextResponse.json({ error: 'This session is full' }, { status: 409 })
  }

  // Duplicate check — same email already booked this instance
  const existing = await sql`
    SELECT id FROM bookings
    WHERE session_instance_id = ${body.session_instance_id}
      AND LOWER(client_email) = LOWER(${body.email.trim()})
      AND status != 'cancelled'
  `
  if (existing[0]) {
    return NextResponse.json({ error: 'You have already booked this session' }, { status: 409 })
  }

  try {
    // Create pipeline entry first (so we have its ID for the booking)
    const pipelineId = crypto.randomUUID()
    const dateLabel = new Date(inst.date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
    const pipelineTitle = `${inst.session_name} — ${dateLabel}`

    await sql`
      INSERT INTO client_pipeline (id, organisation_id, type, title, description, status, priority, submitted_by_name)
      VALUES (
        ${pipelineId}::uuid,
        ${ORG_ID},
        'request',
        ${pipelineTitle},
        ${`Booked via website · ${inst.session_type} · ${inst.start_time}${body.phone ? ' · ' + body.phone : ''}`},
        'new',
        'medium',
        ${body.name.trim()}
      )
    `

    // Create booking
    const bookingId = crypto.randomUUID()
    await sql`
      INSERT INTO bookings (
        id, organisation_id, session_id, session_instance_id, pipeline_id,
        client_name, client_email, date, time, session_type, status
      ) VALUES (
        ${bookingId},
        ${ORG_ID},
        ${inst.session_id},
        ${body.session_instance_id},
        ${pipelineId},
        ${body.name.trim()},
        ${body.email.trim()},
        ${inst.date}::timestamp,
        ${inst.start_time},
        ${inst.session_type},
        'confirmed'
      )
    `

    // Pipeline message
    await sql`
      INSERT INTO pipeline_messages (pipeline_id, organisation_id, author_type, body)
      VALUES (
        ${pipelineId}::uuid,
        ${ORG_ID},
        'client',
        ${`Booked online: ${inst.session_name} on ${dateLabel} at ${inst.start_time}`}
      )
    `.catch(err => console.error('[tennis/book] message error:', err))

    return NextResponse.json({
      success: true,
      booking: { id: bookingId, session_name: inst.session_name, date: inst.date, start_time: inst.start_time }
    }, { status: 201 })
  } catch (err) {
    console.error('[tennis/book POST]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
