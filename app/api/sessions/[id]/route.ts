import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    const sessions = await sql`
      SELECT
        s.id, s.name, s.day_of_week, s.start_time, s.duration_minutes,
        s.max_capacity, s.session_type, s.resource_id, s.recurring, s.created_at
      FROM sessions s
      WHERE s.id = ${id} AND s.organisation_id = ${session.organisationId}
    `
    if (!sessions[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const instances = await sql`
      SELECT
        si.id, si.date, si.start_time, si.duration_minutes, si.max_capacity, si.status, si.created_at,
        COALESCE(
          (SELECT COUNT(*)::int FROM bookings b
           WHERE b.session_instance_id = si.id AND b.status != 'cancelled'),
          0
        ) AS enrolled_count
      FROM session_instances si
      WHERE si.session_id = ${id}
      ORDER BY si.date ASC
    `

    return NextResponse.json({ session: sessions[0], instances })
  } catch (err) {
    console.error('[sessions/[id] GET]', err)
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    const rows = await sql`
      DELETE FROM sessions
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
      RETURNING id
    `
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error('[sessions/[id] DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
  }
}
