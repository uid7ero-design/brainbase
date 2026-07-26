import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

/**
 * POST /api/admin/pipeline/[id]/booking
 *
 * Books a session on behalf of whichever client submitted the pipeline
 * request identified by [id] — deliberately NOT the same as /api/bookings,
 * which scopes strictly to the caller's own effective organisation. This
 * route exists so the founder/admin console can book across organisations
 * without ever touching org_override or the impersonation cookie: the
 * organisation is derived server-side from the pipeline record itself, and
 * every downstream lookup (session / session instance) is re-verified
 * against that same organisation before anything is written.
 */

type Body = {
  session_instance_id?: string
  session_id?: string
  client_name?: string
  client_email?: string
  date?: string
  time?: string
  session_type?: string
  notes?: string
}

type PipelineRow = { id: string; organisation_id: string; title: string; status: string }
type InstanceRow = {
  id: string; session_id: string; date: string; start_time: string
  duration_minutes: number; max_capacity: number
  name: string; session_type: string; day_of_week: number
}
type SessionRow = {
  id: string; name: string; start_time: string; session_type: string
  max_capacity: number; day_of_week: number
}
type BookingResult = { id: string; date: string; time: string; session_type: string; status: string; confirmed_at: string | null }

const RETURNING = 'id, date, time, session_type, status, confirmed_at'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('super_admin')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: pipelineId } = await params

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!body.client_name?.trim()) {
    return NextResponse.json({ error: 'client_name is required' }, { status: 400 })
  }

  // Organisation is derived strictly from the server-loaded pipeline record.
  // The request body has no organisation_id field at all — there is nothing
  // for a caller to spoof, and any pipeline_id-like value in the body is
  // simply never read; only the URL's [id] segment identifies the pipeline.
  let pipelineRows: PipelineRow[]
  try {
    pipelineRows = await sql`
      SELECT id, organisation_id, title, status FROM client_pipeline WHERE id = ${pipelineId}::uuid
    ` as unknown as PipelineRow[]
  } catch (err) {
    console.error('[admin/pipeline/[id]/booking] pipeline lookup failed:', err)
    return NextResponse.json({ error: 'Failed to load pipeline request' }, { status: 500 })
  }

  const pipeline = pipelineRows[0]
  if (!pipeline) return NextResponse.json({ error: 'Pipeline request not found' }, { status: 404 })

  const organisationId = pipeline.organisation_id

  // ── Specific session-instance booking (a chosen calendar date) ───────────
  if (body.session_instance_id) {
    const instances = await sql`
      SELECT si.id, si.session_id, si.date, si.start_time, si.duration_minutes, si.max_capacity,
             s.name, s.session_type, s.day_of_week
      FROM session_instances si
      JOIN sessions s ON s.id = si.session_id
      WHERE si.id = ${body.session_instance_id} AND s.organisation_id = ${organisationId}
        AND si.status = 'scheduled'
    ` as unknown as InstanceRow[]
    const inst = instances[0]
    // A session instance that exists but belongs to a different organisation
    // is rejected identically to "not found" — never distinguished, so no
    // cross-org existence signal is ever leaked.
    if (!inst) return NextResponse.json({ error: 'Session instance not found or cancelled' }, { status: 404 })

    const enrolled = await sql`
      SELECT COUNT(*)::int AS count FROM bookings
      WHERE session_instance_id = ${body.session_instance_id} AND status != 'cancelled'
    `
    if ((enrolled[0].count as number) >= inst.max_capacity) {
      return NextResponse.json({ error: 'Session instance is full' }, { status: 409 })
    }

    const bookingId = crypto.randomUUID()
    const dateLabel = new Date(inst.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    const msgBody = `✅ Added to ${inst.name} — ${dateLabel} at ${inst.start_time}`

    try {
      const results = await sql.transaction([
        sql`
          INSERT INTO bookings
            (id, organisation_id, session_id, session_instance_id, pipeline_id, client_name, client_email,
             date, time, session_type, status, notes)
          VALUES (
            ${bookingId}, ${organisationId}, ${inst.session_id}, ${body.session_instance_id}, ${pipelineId}::uuid,
            ${body.client_name.trim()}, ${body.client_email ?? null},
            ${inst.date}::timestamp, ${inst.start_time}, ${inst.session_type}, 'confirmed', ${body.notes ?? null}
          )
          RETURNING ${sql.unsafe(RETURNING)}
        `,
        sql`
          UPDATE client_pipeline SET status = 'resolved', updated_at = NOW()
          WHERE id = ${pipelineId}::uuid AND organisation_id = ${organisationId}
        `,
        sql`
          INSERT INTO pipeline_messages (pipeline_id, organisation_id, author_type, body)
          VALUES (${pipelineId}::uuid, ${organisationId}, 'founder', ${msgBody})
        `,
      ])
      const bookingRows = results[0] as unknown as BookingResult[]
      return NextResponse.json({ booking: bookingRows[0] }, { status: 201 })
    } catch (err) {
      console.error('[admin/pipeline/[id]/booking POST/instance]', err)
      return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
    }
  }

  // ── Legacy session-based booking (kept for backward compat) ──────────────
  if (body.session_id) {
    const sess = await sql`
      SELECT id, name, start_time, session_type, max_capacity, day_of_week
      FROM sessions WHERE id = ${body.session_id} AND organisation_id = ${organisationId}
    ` as unknown as SessionRow[]
    const s = sess[0]
    if (!s) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    if (!body.date) return NextResponse.json({ error: 'date is required' }, { status: 400 })

    const enrolled = await sql`
      SELECT COUNT(*)::int AS count FROM bookings
      WHERE session_id = ${body.session_id} AND session_instance_id IS NULL AND status != 'cancelled'
    `
    if ((enrolled[0].count as number) >= s.max_capacity) {
      return NextResponse.json({ error: 'Session is full' }, { status: 409 })
    }

    const bookingId = crypto.randomUUID()
    const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const msgBody = `✅ Added to ${s.name} — ${DAY[s.day_of_week]} at ${s.start_time}`

    try {
      const results = await sql.transaction([
        sql`
          INSERT INTO bookings
            (id, organisation_id, session_id, pipeline_id, client_name, client_email, date, time, session_type, status, notes)
          VALUES (
            ${bookingId}, ${organisationId}, ${body.session_id}, ${pipelineId}::uuid,
            ${body.client_name.trim()}, ${body.client_email ?? null},
            ${body.date}::timestamp, ${s.start_time}, ${s.session_type}, 'confirmed', ${body.notes ?? null}
          )
          RETURNING ${sql.unsafe(RETURNING)}
        `,
        sql`
          UPDATE client_pipeline SET status = 'resolved', updated_at = NOW()
          WHERE id = ${pipelineId}::uuid AND organisation_id = ${organisationId}
        `,
        sql`
          INSERT INTO pipeline_messages (pipeline_id, organisation_id, author_type, body)
          VALUES (${pipelineId}::uuid, ${organisationId}, 'founder', ${msgBody})
        `,
      ])
      const bookingRows = results[0] as unknown as BookingResult[]
      return NextResponse.json({ booking: bookingRows[0] }, { status: 201 })
    } catch (err) {
      console.error('[admin/pipeline/[id]/booking POST/session]', err)
      return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
    }
  }

  // ── One-off appointment (pending_confirmation flow) ───────────────────────
  if (!body.date || !body.time || !body.session_type) {
    return NextResponse.json({ error: 'date, time, and session_type are required' }, { status: 400 })
  }

  const bookingId = crypto.randomUUID()
  const dateLabel = new Date(body.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
  const msgBody = `🎾 Session proposed for ${dateLabel} at ${body.time} — ${body.session_type}. Please confirm or request a change.`

  try {
    const results = await sql.transaction([
      sql`
        UPDATE bookings SET status = 'cancelled', updated_at = NOW()
        WHERE pipeline_id = ${pipelineId}::uuid AND organisation_id = ${organisationId}
          AND status IN ('pending_confirmation', 'reschedule_requested')
      `,
      sql`
        INSERT INTO bookings
          (id, organisation_id, pipeline_id, client_name, client_email, date, time, session_type, status, notes)
        VALUES (
          ${bookingId}, ${organisationId}, ${pipelineId}::uuid, ${body.client_name.trim()}, ${body.client_email ?? null},
          ${body.date}::timestamp, ${body.time}, ${body.session_type}, 'pending_confirmation', ${body.notes ?? null}
        )
        RETURNING ${sql.unsafe(RETURNING)}
      `,
      sql`
        UPDATE client_pipeline SET status = 'awaiting_client', updated_at = NOW()
        WHERE id = ${pipelineId}::uuid AND organisation_id = ${organisationId}
      `,
      sql`
        INSERT INTO pipeline_messages (pipeline_id, organisation_id, author_type, body)
        VALUES (${pipelineId}::uuid, ${organisationId}, 'founder', ${msgBody})
      `,
    ])
    const bookingRows = results[1] as unknown as BookingResult[]
    return NextResponse.json({ booking: bookingRows[0] }, { status: 201 })
  } catch (err) {
    console.error('[admin/pipeline/[id]/booking POST]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
