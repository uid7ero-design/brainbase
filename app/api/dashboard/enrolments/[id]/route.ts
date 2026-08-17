import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'
import { propagateRecurringEnrolment, normalizeEmail, findDuplicateEnrolment } from '@/lib/tennisRecurrence'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    const rows = await sql`
      UPDATE bookings SET status = 'cancelled'
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
      RETURNING id
    `
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error('[enrolments DELETE]', err)
    return NextResponse.json({ error: 'Failed to remove' }, { status: 500 })
  }
}

// Once -> Weekly and Weekly -> Once both go through this endpoint, and both
// use the same propagateRecurringEnrolment() primitive that initial Weekly
// enrolment does (see app/api/dashboard/sessions/[id]/instances/[instanceId]/route.ts)
// — one propagation algorithm, not two.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params
  let body: { is_recurring: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (typeof body.is_recurring !== 'boolean') {
    return NextResponse.json({ error: 'is_recurring must be a boolean' }, { status: 400 })
  }

  try {
    const [current] = await sql`
      SELECT id, session_id, session_instance_id, client_name, client_email, to_char(date, 'YYYY-MM-DD') AS date, recurring_group_id
      FROM bookings WHERE id = ${id} AND organisation_id = ${session.organisationId}
    `
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const booking = current as {
      id: string; session_id: string | null; session_instance_id: string | null
      client_name: string; client_email: string | null; date: string; recurring_group_id: string | null
    }
    if (!booking.session_id) {
      return NextResponse.json({ error: 'This booking has no associated recurring session.' }, { status: 400 })
    }

    if (body.is_recurring) {
      // Guard against the exact production duplicate scenario: this same
      // person already has a *different*, separate Weekly lineage in this
      // session (e.g. from an earlier enrolment that was also toggled to
      // Weekly) — toggling this booking to Weekly too would create a
      // second recurring lineage for the same person in the same class.
      const emailNorm = normalizeEmail(booking.client_email)
      if (emailNorm && booking.session_instance_id) {
        const dup = await findDuplicateEnrolment({
          organisationId: session.organisationId, sessionId: booking.session_id,
          instanceId: booking.session_instance_id, emailNorm, wantWeekly: true,
        })
        // 'once_upgradeable' would only ever refer to this exact booking
        // (same email + same instance), so it is not a real duplicate here.
        if (dup.type === 'weekly_exists' || dup.type === 'once_exists_elsewhere') {
          return NextResponse.json({ error: dup.message }, { status: 409 })
        }
      }

      // Once -> Weekly: mint a lineage id if this booking doesn't already
      // have one, mark it recurring, then backfill exactly like initial
      // Weekly enrolment does.
      const recurringGroupId = booking.recurring_group_id ?? crypto.randomUUID()
      const rows = await sql`
        UPDATE bookings SET is_recurring = true, recurring_group_id = ${recurringGroupId}
        WHERE id = ${id} AND organisation_id = ${session.organisationId}
        RETURNING id, is_recurring, recurring_group_id
      `
      const propagation = await propagateRecurringEnrolment({
        organisationId: session.organisationId,
        sessionId: booking.session_id,
        recurringGroupId,
        clientName: booking.client_name,
        clientEmail: booking.client_email,
        afterDate: booking.date,
      })
      return NextResponse.json({ booking: rows[0], propagation })
    }

    // Weekly -> Once: stop future generation from inheriting this lineage
    // (is_recurring = false is sufficient — getActiveRecurringLineages only
    // reads is_recurring = true rows) and cancel already-generated future
    // copies of it, preserving history. recurring_group_id is kept on both
    // this row and its now-cancelled future copies for audit/reactivation.
    const rows = await sql`
      UPDATE bookings SET is_recurring = false
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
      RETURNING id, is_recurring, recurring_group_id
    `
    let futureCancelled = 0
    if (booking.recurring_group_id) {
      const cancelled = await sql`
        UPDATE bookings SET status = 'cancelled'
        WHERE organisation_id = ${session.organisationId}
          AND recurring_group_id = ${booking.recurring_group_id}
          AND id != ${id}
          AND status != 'cancelled'
          AND session_instance_id IN (
            SELECT id FROM session_instances WHERE session_id = ${booking.session_id} AND date > ${booking.date}::date
          )
        RETURNING id
      `
      futureCancelled = cancelled.length
    }
    return NextResponse.json({ booking: rows[0], futureCancelled })
  } catch (err) {
    console.error('[enrolments PATCH]', err)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}
