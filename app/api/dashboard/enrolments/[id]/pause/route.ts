import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'
import { propagateRecurringEnrolment } from '@/lib/tennisRecurrence'

type BookingRow = {
  id: string; session_id: string | null; client_name: string; client_email: string | null
  date: string; recurring_group_id: string | null; is_recurring: boolean
}

async function loadRecurringBooking(id: string, organisationId: string): Promise<BookingRow | null> {
  const [row] = await sql`
    SELECT id, session_id, client_name, client_email, to_char(date, 'YYYY-MM-DD') AS date, recurring_group_id, is_recurring
    FROM bookings WHERE id = ${id} AND organisation_id = ${organisationId}
  `
  return (row as BookingRow) ?? null
}

// Pauses a recurring lineage for a bounded date range without disabling
// is_recurring — the lineage stays recurring; propagation and generation
// simply skip dates inside any pause window for it (see
// lib/tennisRecurrence.ts's isDateWithinAnyPause / loadPauseWindows, used
// by every propagation path). Already-generated future bookings that fall
// inside the new window are cancelled (not deleted) so history is
// preserved — except ones already paid or with attendance recorded, which
// are left untouched and reported back as conflicts for Luke to resolve
// manually rather than silently discarded.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params
  let body: { pause_from?: string; pause_until?: string; reason?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (!body.pause_from || !body.pause_until) {
    return NextResponse.json({ error: 'pause_from and pause_until are required' }, { status: 400 })
  }
  if (body.pause_until < body.pause_from) {
    return NextResponse.json({ error: 'pause_until must not be before pause_from' }, { status: 400 })
  }

  try {
    const booking = await loadRecurringBooking(id, session.organisationId)
    if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!booking.is_recurring || !booking.recurring_group_id || !booking.session_id) {
      return NextResponse.json({ error: 'This booking is not a weekly recurring enrolment.' }, { status: 400 })
    }

    const [pause] = await sql`
      INSERT INTO booking_recurrence_pauses (organisation_id, recurring_group_id, session_id, pause_from, pause_until, reason, created_by)
      VALUES (${session.organisationId}, ${booking.recurring_group_id}, ${booking.session_id}, ${body.pause_from}::date, ${body.pause_until}::date, ${body.reason?.trim() || null}, ${session.userId})
      RETURNING id, to_char(pause_from, 'YYYY-MM-DD') AS pause_from, to_char(pause_until, 'YYYY-MM-DD') AS pause_until, reason
    `

    // Cancel already-generated future bookings inside the window, skipping
    // (and reporting) any that already have payment or attendance recorded.
    const candidates = await sql`
      SELECT b.id, b.paid, b.attendance_status, to_char(si.date, 'YYYY-MM-DD') AS date
      FROM bookings b
      JOIN session_instances si ON si.id = b.session_instance_id
      WHERE b.organisation_id = ${session.organisationId}
        AND b.recurring_group_id = ${booking.recurring_group_id}
        AND b.status != 'cancelled'
        AND si.date >= ${body.pause_from}::date AND si.date <= ${body.pause_until}::date
    `
    const conflicts: { id: string; date: string }[] = []
    let cancelled = 0
    for (const c of candidates as { id: string; paid: boolean; attendance_status: string | null; date: string }[]) {
      if (c.paid || c.attendance_status) {
        conflicts.push({ id: c.id, date: c.date })
        continue
      }
      await sql`UPDATE bookings SET status = 'cancelled' WHERE id = ${c.id} AND organisation_id = ${session.organisationId}`
      cancelled++
    }

    return NextResponse.json({ pause: pause[0] ?? pause, cancelled, conflicts })
  } catch (err) {
    console.error('[enrolments/[id]/pause POST]', err)
    return NextResponse.json({ error: 'Failed to create pause' }, { status: 500 })
  }
}

// Clears every pause window for this booking's recurring lineage and
// backfills eligible already-generated future instances — Luke never has
// to toggle Weekly off/on to resume.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    const booking = await loadRecurringBooking(id, session.organisationId)
    if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!booking.is_recurring || !booking.recurring_group_id || !booking.session_id) {
      return NextResponse.json({ error: 'This booking is not a weekly recurring enrolment.' }, { status: 400 })
    }

    await sql`
      DELETE FROM booking_recurrence_pauses
      WHERE organisation_id = ${session.organisationId} AND recurring_group_id = ${booking.recurring_group_id}
    `

    const propagation = await propagateRecurringEnrolment({
      organisationId: session.organisationId,
      sessionId: booking.session_id,
      recurringGroupId: booking.recurring_group_id,
      clientName: booking.client_name,
      clientEmail: booking.client_email,
      afterDate: booking.date,
    })

    return NextResponse.json({ cleared: true, propagation })
  } catch (err) {
    console.error('[enrolments/[id]/pause DELETE]', err)
    return NextResponse.json({ error: 'Failed to clear pause' }, { status: 500 })
  }
}
