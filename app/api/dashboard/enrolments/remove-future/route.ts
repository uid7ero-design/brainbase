import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function POST(req: NextRequest) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  let body: { client_name: string; client_email?: string | null; session_id: string; from_date: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (!body.client_name?.trim() || !body.session_id || !body.from_date) {
    return NextResponse.json({ error: 'client_name, session_id, and from_date are required' }, { status: 400 })
  }

  const clientEmail = body.client_email ?? null

  try {
    // Stop recurring propagation from the current instance without cancelling the booking
    await sql`
      UPDATE bookings SET is_recurring = false
      WHERE session_instance_id IN (
        SELECT id FROM session_instances
        WHERE session_id = ${body.session_id}
          AND date = ${body.from_date}::date
      )
        AND client_name = ${body.client_name.trim()}
        AND (${clientEmail}::text IS NULL OR client_email = ${clientEmail})
        AND status != 'cancelled'
        AND organisation_id = ${session.organisationId}
    `

    // Cancel all bookings in future instances for this player
    const result = await sql`
      UPDATE bookings SET status = 'cancelled', is_recurring = false
      WHERE session_instance_id IN (
        SELECT id FROM session_instances
        WHERE session_id = ${body.session_id}
          AND date > ${body.from_date}::date
      )
        AND client_name = ${body.client_name.trim()}
        AND (${clientEmail}::text IS NULL OR client_email = ${clientEmail})
        AND status != 'cancelled'
        AND organisation_id = ${session.organisationId}
      RETURNING id
    `

    return NextResponse.json({ cancelled: result.length })
  } catch (err) {
    console.error('[enrolments/remove-future POST]', err)
    return NextResponse.json({ error: 'Failed to remove future enrolments' }, { status: 500 })
  }
}
