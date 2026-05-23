import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

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
    const rows = await sql`
      UPDATE bookings SET is_recurring = ${body.is_recurring}
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
      RETURNING id, is_recurring
    `
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ booking: rows[0] })
  } catch (err) {
    console.error('[enrolments PATCH]', err)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}
