import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

const VALID_COLOUR_KEYS = [
  'purple', 'violet', 'indigo', 'green', 'emerald', 'blue',
  'orange', 'amber', 'sky', 'slate', 'rose', 'teal',
]

// Rename / recolour / reorder / archive-or-reactivate. Never deletes a row
// — archiving (active = false) is the only "removal" a manager can do, so
// existing sessions that already saved this type's slug keep resolving it
// (see sessionLabel()/sessionChip() in app/dashboard/sessions/page.tsx,
// which look the slug up regardless of active state); only the Create/Edit
// Session dropdown filters to active = true.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params
  let body: { name?: string; colour_key?: string; active?: boolean; sort_order?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (body.colour_key !== undefined && !VALID_COLOUR_KEYS.includes(body.colour_key)) {
    return NextResponse.json({ error: 'Invalid colour_key' }, { status: 400 })
  }

  try {
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
      const clash = await sql`
        SELECT id FROM session_types
        WHERE organisation_id = ${session.organisationId} AND LOWER(name) = LOWER(${name}) AND id != ${id}
      `
      if (clash.length > 0) return NextResponse.json({ error: 'A session type with this name already exists.' }, { status: 409 })
    }

    const rows = await sql`
      UPDATE session_types SET
        name       = COALESCE(${body.name?.trim() ?? null}, name),
        colour_key = COALESCE(${body.colour_key ?? null}, colour_key),
        active     = COALESCE(${body.active ?? null}, active),
        sort_order = COALESCE(${body.sort_order ?? null}, sort_order),
        updated_at = now()
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
      RETURNING id, name, slug, colour_key, active, sort_order
    `
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ type: rows[0] })
  } catch (err) {
    console.error('[dashboard/session-types/[id] PATCH]', err)
    return NextResponse.json({ error: 'Failed to update session type' }, { status: 500 })
  }
}
