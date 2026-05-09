import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; instanceId: string }> }
) {
  let session
  try { session = await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id, instanceId } = await params

  try {
    const instances = await sql`
      SELECT si.id, si.session_id, si.date, si.start_time, si.duration_minutes, si.max_capacity, si.status
      FROM session_instances si
      JOIN sessions s ON s.id = si.session_id
      WHERE si.id = ${instanceId} AND si.session_id = ${id} AND s.organisation_id = ${session.organisationId}
    `
    if (!instances[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const bookings = await sql`
      SELECT b.id, b.client_name, b.client_email, b.paid, b.attendance_status,
             b.status, b.pipeline_id, b.created_at
      FROM bookings b
      WHERE b.session_instance_id = ${instanceId} AND b.status != 'cancelled'
      ORDER BY b.created_at ASC
    `

    return NextResponse.json({ instance: instances[0], bookings })
  } catch (err) {
    console.error('[sessions/instances/[instanceId] GET]', err)
    return NextResponse.json({ error: 'Failed to fetch instance' }, { status: 500 })
  }
}
