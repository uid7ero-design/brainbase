import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params
  const { status, priority, founder_note } = await req.json() as {
    status?: string; priority?: string; founder_note?: string
  }

  const validStatuses   = ['new', 'in_progress', 'resolved']
  const validPriorities = ['low', 'medium', 'high']

  const rows = await sql`
    UPDATE client_pipeline SET
      status       = CASE WHEN ${status ?? null} IS NOT NULL AND ${status ?? ''} = ANY(ARRAY['new','in_progress','resolved'])
                          THEN ${status ?? 'new'} ELSE status END,
      priority     = CASE WHEN ${priority ?? null} IS NOT NULL AND ${priority ?? ''} = ANY(ARRAY['low','medium','high'])
                          THEN ${priority ?? 'medium'} ELSE priority END,
      founder_note = COALESCE(${founder_note ?? null}, founder_note),
      updated_at   = NOW()
    WHERE id = ${id}::uuid
    RETURNING id, status, priority, founder_note, updated_at
  `

  void validStatuses; void validPriorities
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ request: rows[0] })
}
