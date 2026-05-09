import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

const VALID_STATUSES = new Set(['new', 'contacted', 'booked', 'closed'])

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params
  const { orgId, status } = await req.json() as { orgId: string; status: string }

  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })
  if (!VALID_STATUSES.has(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

  const rows = await sql`
    UPDATE tennis_leads SET status = ${status}
    WHERE id = ${id}::uuid AND organisation_id = ${orgId}::uuid
    RETURNING id, status
  `
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ lead: rows[0] })
}
