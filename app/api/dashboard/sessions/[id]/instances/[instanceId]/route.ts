import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'
import { propagateRecurringEnrolment, normalizeEmail, findDuplicateEnrolment } from '@/lib/tennisRecurrence'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; instanceId: string }> }
) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id, instanceId } = await params
  const body = await req.json().catch(() => null)
  if (!body?.client_name?.trim()) return NextResponse.json({ error: 'client_name is required' }, { status: 400 })
  const weekly = body.frequency === 'weekly'

  try {
    const instances = await sql`
      SELECT si.id, si.max_capacity, to_char(si.date, 'YYYY-MM-DD') AS date, si.start_time, s.session_type
      FROM session_instances si
      JOIN sessions s ON s.id = si.session_id
      WHERE si.id = ${instanceId} AND si.session_id = ${id} AND s.organisation_id = ${session.organisationId}
    `
    if (!instances[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const inst = instances[0] as { id: string; max_capacity: number; date: string; start_time: string; session_type: string }

    const enrolledRows = await sql`SELECT COUNT(*)::int AS cnt FROM bookings WHERE session_instance_id = ${instanceId} AND status != 'cancelled'`
    const enrolled = (enrolledRows[0] as { cnt: number }).cnt
    if (enrolled >= inst.max_capacity) return NextResponse.json({ error: 'Session is full' }, { status: 409 })

    const clientName = body.client_name.trim()
    const clientEmail = body.client_email?.trim() || null
    const emailNorm = normalizeEmail(clientEmail)

    // Server-side duplicate-person guard — never relies on the UI. Only
    // possible when an email was provided; a booking with no email has no
    // reliable identity to check and is allowed through unchanged rather
    // than guessed at via name matching.
    if (emailNorm) {
      const dup = await findDuplicateEnrolment({
        organisationId: session.organisationId, sessionId: id, instanceId, emailNorm, wantWeekly: weekly,
      })
      if (dup.type === 'weekly_exists' || dup.type === 'once_same_date' || dup.type === 'once_exists_elsewhere') {
        return NextResponse.json({ error: dup.message }, { status: 409 })
      }
      if (dup.type === 'once_upgradeable') {
        // Same person already has a Once booking on this exact date and
        // Luke chose Weekly — convert that booking in place instead of
        // creating a second lineage for the same person in this class.
        const recurringGroupId = dup.existingRecurringGroupId ?? crypto.randomUUID()
        const rows = await sql`
          UPDATE bookings SET is_recurring = true, recurring_group_id = ${recurringGroupId}
          WHERE id = ${dup.existingBookingId} AND organisation_id = ${session.organisationId}
          RETURNING id, client_name, client_email, paid, attendance_status, status, pipeline_id, is_recurring, recurring_group_id, created_at
        `
        const propagation = await propagateRecurringEnrolment({
          organisationId: session.organisationId, sessionId: id, recurringGroupId,
          clientName, clientEmail, afterDate: inst.date,
        })
        return NextResponse.json({ booking: rows[0], propagation, upgraded: true }, { status: 200 })
      }
    }

    const recurringGroupId = weekly ? crypto.randomUUID() : null

    const rows = await sql`
      INSERT INTO bookings (id, organisation_id, session_id, session_instance_id, client_name, client_email, date, time, session_type, status, paid, is_recurring, recurring_group_id)
      VALUES (${crypto.randomUUID()}, ${session.organisationId}, ${id}, ${instanceId}, ${clientName}, ${clientEmail}, ${inst.date}::date, ${inst.start_time}, ${inst.session_type}, 'confirmed', false, ${weekly}, ${recurringGroupId})
      RETURNING id, client_name, client_email, paid, attendance_status, status, pipeline_id, is_recurring, recurring_group_id, created_at
    `

    let propagation = null
    if (weekly && recurringGroupId) {
      propagation = await propagateRecurringEnrolment({
        organisationId: session.organisationId,
        sessionId: id,
        recurringGroupId,
        clientName,
        clientEmail,
        afterDate: inst.date,
      })
    }

    return NextResponse.json({ booking: rows[0], propagation }, { status: 201 })
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
      const rows = await sql`
        SELECT b.id, b.client_name, b.client_email, b.paid, b.attendance_status, b.status, b.pipeline_id, b.is_recurring, b.recurring_group_id, b.created_at,
          p.pause_from AS active_pause_from, p.pause_until AS active_pause_until
        FROM bookings b
        LEFT JOIN LATERAL (
          SELECT to_char(pause_from, 'YYYY-MM-DD') AS pause_from, to_char(pause_until, 'YYYY-MM-DD') AS pause_until
          FROM booking_recurrence_pauses
          WHERE organisation_id = b.organisation_id AND recurring_group_id = b.recurring_group_id
          ORDER BY pause_until DESC LIMIT 1
        ) p ON b.recurring_group_id IS NOT NULL
        WHERE b.session_instance_id = ${instanceId} AND b.status != 'cancelled'
        ORDER BY b.created_at ASC
      `
      bookings = rows
    } catch {
      // bookings table not yet created — return empty list
    }

    return NextResponse.json({ instance: instances[0], bookings })
  } catch (err) {
    console.error('[dashboard/sessions/instances/[instanceId] GET]', err)
    return NextResponse.json({ error: 'Failed to fetch instance' }, { status: 500 })
  }
}
