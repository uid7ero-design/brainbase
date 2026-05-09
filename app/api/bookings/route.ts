import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function GET() {
  try { await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  try {
    const bookings = await sql`
      SELECT id, organisation_id, session_id, session_instance_id, pipeline_id, client_name, client_email,
             date, time, session_type, status, paid, attendance_status, confirmed_at, notes, created_at, updated_at
      FROM bookings
      ORDER BY date ASC, time ASC
    `
    return NextResponse.json({ bookings })
  } catch (err) {
    console.error('[bookings GET]', err)
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try { await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  let body: {
    organisation_id: string
    session_id?: string
    session_instance_id?: string
    pipeline_id?: string
    client_name: string
    client_email?: string
    date?: string
    time?: string
    session_type?: string
    notes?: string
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (!body.organisation_id || !body.client_name) {
    return NextResponse.json({ error: 'organisation_id and client_name are required' }, { status: 400 })
  }

  // ── Session-instance booking (specific calendar date) ────────────────────────
  if (body.session_instance_id) {
    const instances = await sql`
      SELECT si.id, si.session_id, si.date, si.start_time, si.duration_minutes, si.max_capacity,
             s.name, s.session_type, s.day_of_week
      FROM session_instances si
      JOIN sessions s ON s.id = si.session_id
      WHERE si.id = ${body.session_instance_id} AND s.organisation_id = ${body.organisation_id}
        AND si.status = 'scheduled'
    `
    if (!instances[0]) return NextResponse.json({ error: 'Session instance not found or cancelled' }, { status: 404 })

    const inst = instances[0] as {
      id: string; session_id: string; date: string; start_time: string
      duration_minutes: number; max_capacity: number
      name: string; session_type: string; day_of_week: number
    }

    const enrolled = await sql`
      SELECT COUNT(*)::int AS count FROM bookings
      WHERE session_instance_id = ${body.session_instance_id} AND status != 'cancelled'
    `
    if ((enrolled[0].count as number) >= inst.max_capacity) {
      return NextResponse.json({ error: 'Session instance is full' }, { status: 409 })
    }

    try {
      const id = crypto.randomUUID()
      const rows = await sql`
        INSERT INTO bookings
          (id, organisation_id, session_id, session_instance_id, pipeline_id, client_name, client_email,
           date, time, session_type, status, notes)
        VALUES (
          ${id},
          ${body.organisation_id},
          ${inst.session_id},
          ${body.session_instance_id},
          ${body.pipeline_id ?? null},
          ${body.client_name},
          ${body.client_email ?? null},
          ${inst.date}::timestamp,
          ${inst.start_time},
          ${inst.session_type},
          'confirmed',
          ${body.notes ?? null}
        )
        RETURNING id, organisation_id, session_id, session_instance_id, pipeline_id, client_name, client_email,
                  date, time, session_type, status, paid, attendance_status, confirmed_at, notes, created_at
      `

      if (body.pipeline_id) {
        const dateObj = new Date(inst.date)
        const dateLabel = dateObj.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
        const msgBody = `✅ Added to ${inst.name} — ${dateLabel} at ${inst.start_time}`

        await sql`
          UPDATE client_pipeline SET status = 'resolved', updated_at = NOW()
          WHERE id = ${body.pipeline_id}::uuid
        `.catch(err => console.error('[bookings POST/instance] pipeline update error:', err))

        await sql`
          INSERT INTO pipeline_messages (pipeline_id, organisation_id, author_type, body)
          VALUES (${body.pipeline_id}::uuid, ${body.organisation_id}, 'founder', ${msgBody})
        `.catch(err => console.error('[bookings POST/instance] message insert error:', err))
      }

      return NextResponse.json({ booking: rows[0] }, { status: 201 })
    } catch (err) {
      console.error('[bookings POST/instance]', err)
      return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
    }
  }

  // ── Legacy session-based booking (kept for backward compat) ──────────────────
  if (body.session_id) {
    const sess = await sql`
      SELECT id, name, start_time, session_type, max_capacity, day_of_week
      FROM sessions
      WHERE id = ${body.session_id} AND organisation_id = ${body.organisation_id}
    `
    if (!sess[0]) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    const enrolled = await sql`
      SELECT COUNT(*)::int AS count FROM bookings
      WHERE session_id = ${body.session_id} AND session_instance_id IS NULL AND status != 'cancelled'
    `
    if ((enrolled[0].count as number) >= (sess[0].max_capacity as number)) {
      return NextResponse.json({ error: 'Session is full' }, { status: 409 })
    }

    if (!body.date) return NextResponse.json({ error: 'date is required' }, { status: 400 })

    try {
      const id = crypto.randomUUID()
      const rows = await sql`
        INSERT INTO bookings
          (id, organisation_id, session_id, pipeline_id, client_name, client_email,
           date, time, session_type, status, notes)
        VALUES (
          ${id},
          ${body.organisation_id},
          ${body.session_id},
          ${body.pipeline_id ?? null},
          ${body.client_name},
          ${body.client_email ?? null},
          ${body.date}::timestamp,
          ${sess[0].start_time as string},
          ${sess[0].session_type as string},
          'confirmed',
          ${body.notes ?? null}
        )
        RETURNING id, organisation_id, session_id, session_instance_id, pipeline_id, client_name, client_email,
                  date, time, session_type, status, paid, attendance_status, confirmed_at, notes, created_at
      `

      if (body.pipeline_id) {
        const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        const msgBody = `✅ Added to ${sess[0].name as string} — ${DAY[sess[0].day_of_week as number]} at ${sess[0].start_time as string}`

        await sql`
          UPDATE client_pipeline SET status = 'resolved', updated_at = NOW()
          WHERE id = ${body.pipeline_id}::uuid
        `.catch(err => console.error('[bookings POST/session] pipeline update error:', err))

        await sql`
          INSERT INTO pipeline_messages (pipeline_id, organisation_id, author_type, body)
          VALUES (${body.pipeline_id}::uuid, ${body.organisation_id}, 'founder', ${msgBody})
        `.catch(err => console.error('[bookings POST/session] message insert error:', err))
      }

      return NextResponse.json({ booking: rows[0] }, { status: 201 })
    } catch (err) {
      console.error('[bookings POST/session]', err)
      return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
    }
  }

  // ── One-off appointment (pending_confirmation flow) ──────────────────────────
  if (!body.date || !body.time || !body.session_type) {
    return NextResponse.json({ error: 'date, time, and session_type are required' }, { status: 400 })
  }

  try {
    if (body.pipeline_id) {
      await sql`
        UPDATE bookings SET status = 'cancelled', updated_at = NOW()
        WHERE pipeline_id = ${body.pipeline_id}
          AND status IN ('pending_confirmation', 'reschedule_requested')
      `.catch(err => console.error('[bookings POST] cancel old error:', err))
    }

    const id = crypto.randomUUID()
    const rows = await sql`
      INSERT INTO bookings
        (id, organisation_id, pipeline_id, client_name, client_email, date, time, session_type, status, notes)
      VALUES (
        ${id},
        ${body.organisation_id},
        ${body.pipeline_id ?? null},
        ${body.client_name},
        ${body.client_email ?? null},
        ${body.date}::timestamp,
        ${body.time},
        ${body.session_type},
        'pending_confirmation',
        ${body.notes ?? null}
      )
      RETURNING id, organisation_id, session_id, session_instance_id, pipeline_id, client_name, client_email,
                date, time, session_type, status, paid, attendance_status, confirmed_at, notes, created_at
    `

    if (body.pipeline_id) {
      const dateLabel = new Date(body.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
      const msgBody = `🎾 Session proposed for ${dateLabel} at ${body.time} — ${body.session_type}. Please confirm or request a change.`

      await sql`
        UPDATE client_pipeline SET status = 'awaiting_client', updated_at = NOW()
        WHERE id = ${body.pipeline_id}::uuid
      `.catch(err => console.error('[bookings POST] pipeline update error:', err))

      await sql`
        INSERT INTO pipeline_messages (pipeline_id, organisation_id, author_type, body)
        VALUES (${body.pipeline_id}::uuid, ${body.organisation_id}, 'founder', ${msgBody})
      `.catch(err => console.error('[bookings POST] message insert error:', err))
    }

    return NextResponse.json({ booking: rows[0] }, { status: 201 })
  } catch (err) {
    console.error('[bookings POST]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
