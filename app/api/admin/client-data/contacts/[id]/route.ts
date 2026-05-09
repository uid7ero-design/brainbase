import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

const VALID_STATUSES = new Set(['lead', 'contacted', 'active', 'inactive'])

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params
  const body = await req.json() as {
    orgId: string
    name: string; email: string | null; phone: string | null; status: string
    address: string | null; age: string | null; program: string | null
    session_times: string | null; next_action: string | null
  }

  if (!body.orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })
  if (!VALID_STATUSES.has(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

  const rows = await sql`
    UPDATE contacts SET
      name          = ${body.name},
      email         = ${body.email},
      phone         = ${body.phone},
      status        = ${body.status},
      address       = ${body.address},
      age           = ${body.age},
      program       = ${body.program},
      session_times = ${body.session_times},
      next_action   = ${body.next_action},
      updated_at    = NOW()
    WHERE id = ${id}::uuid AND organisation_id = ${body.orgId}::uuid
    RETURNING id, name, email, phone, status, address, age, program, session_times, next_action, last_contacted_at
  `
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ contact: rows[0] })
}
