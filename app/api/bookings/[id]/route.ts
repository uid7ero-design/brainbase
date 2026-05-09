import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { id } = await params

  let body: {
    action?: string
    message?: string
    paid?: boolean
    attendance_status?: string | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const bookings = await sql`
    SELECT id, organisation_id, pipeline_id, session_id, date, time, session_type, status, paid, attendance_status
    FROM bookings WHERE id = ${id}
  `
  if (!bookings[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const booking = bookings[0] as {
    id: string; organisation_id: string; pipeline_id: string | null; session_id: string | null
    date: string; time: string; session_type: string; status: string
    paid: boolean; attendance_status: string | null
  }

  // Org ownership — clients limited to their org; super_admin unrestricted
  if (session.role !== 'super_admin' && booking.organisation_id !== session.organisationId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Paid / attendance updates (admin only) ───────────────────────────────────
  if ('paid' in body || 'attendance_status' in body) {
    if (session.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    try {
      if ('paid' in body && 'attendance_status' in body) {
        await sql`
          UPDATE bookings SET paid = ${body.paid!}, attendance_status = ${body.attendance_status ?? null}, updated_at = NOW()
          WHERE id = ${id}
        `
      } else if ('paid' in body) {
        await sql`UPDATE bookings SET paid = ${body.paid!}, updated_at = NOW() WHERE id = ${id}`
      } else {
        await sql`UPDATE bookings SET attendance_status = ${body.attendance_status ?? null}, updated_at = NOW() WHERE id = ${id}`
      }
      return NextResponse.json({ booking: { ...booking, ...body } })
    } catch (err) {
      console.error('[bookings PATCH paid/attendance]', err)
      return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 })
    }
  }

  // ── Confirm / reschedule actions (client or admin) ───────────────────────────
  if (!body.action || !['confirm', 'reschedule'].includes(body.action)) {
    return NextResponse.json({ error: 'action must be confirm or reschedule' }, { status: 400 })
  }

  if (booking.status === 'confirmed' || booking.status === 'cancelled') {
    return NextResponse.json({ error: `Booking is already ${booking.status}` }, { status: 409 })
  }

  const dateLabel = new Date(booking.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
  const label = `${dateLabel} at ${booking.time}`

  try {
    if (body.action === 'confirm') {
      await sql`
        UPDATE bookings SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
        WHERE id = ${id}
      `
      if (booking.pipeline_id) {
        await sql`
          UPDATE client_pipeline SET status = 'resolved', updated_at = NOW()
          WHERE id = ${booking.pipeline_id}::uuid
        `.catch(err => console.error('[bookings PATCH confirm] pipeline update error:', err))

        await sql`
          INSERT INTO pipeline_messages (pipeline_id, organisation_id, author_type, body)
          VALUES (${booking.pipeline_id}::uuid, ${booking.organisation_id}, 'client', ${'✅ Session confirmed for ' + label})
        `.catch(err => console.error('[bookings PATCH confirm] message error:', err))
      }
      return NextResponse.json({ booking: { ...booking, status: 'confirmed', confirmed_at: new Date().toISOString() } })
    }

    if (body.action === 'reschedule') {
      await sql`
        UPDATE bookings SET status = 'reschedule_requested', updated_at = NOW()
        WHERE id = ${id}
      `
      if (booking.pipeline_id) {
        const msgBody = body.message?.trim()
          ? `🔁 Client requested a different time\n\n"${body.message.trim()}"`
          : '🔁 Client requested a different time'

        await sql`
          UPDATE client_pipeline SET status = 'in_progress', updated_at = NOW()
          WHERE id = ${booking.pipeline_id}::uuid
        `.catch(err => console.error('[bookings PATCH reschedule] pipeline update error:', err))

        await sql`
          INSERT INTO pipeline_messages (pipeline_id, organisation_id, author_type, body)
          VALUES (${booking.pipeline_id}::uuid, ${booking.organisation_id}, 'client', ${msgBody})
        `.catch(err => console.error('[bookings PATCH reschedule] message error:', err))
      }
      return NextResponse.json({ booking: { ...booking, status: 'reschedule_requested' } })
    }
  } catch (err) {
    console.error('[bookings PATCH]', err)
    return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
