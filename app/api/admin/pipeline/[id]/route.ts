import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  let body: { status?: string; priority?: string; founder_note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { status, priority, founder_note } = body

  void session

  try {
    const rows = await sql`
      UPDATE client_pipeline SET
        status       = CASE WHEN ${status ?? null}::text IS NOT NULL
                              AND ${status ?? ''}::text = ANY(ARRAY['new','in_progress','awaiting_client','resolved'])
                            THEN ${status ?? ''}::text ELSE status END,
        priority     = CASE WHEN ${priority ?? null}::text IS NOT NULL
                              AND ${priority ?? ''}::text = ANY(ARRAY['low','medium','high'])
                            THEN ${priority ?? ''}::text ELSE priority END,
        founder_note = COALESCE(${founder_note ?? null}::text, founder_note),
        updated_at   = NOW()
      WHERE id = ${id}::uuid
      RETURNING id, status, priority, founder_note, updated_at
    `
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ request: rows[0] })
  } catch (err) {
    console.error('[pipeline PATCH] SQL error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
