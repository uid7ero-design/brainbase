import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

// Safe, finite colour palette — the client never sends raw CSS, only one of
// these keys. Keep in sync with SESSION_TYPE_COLOUR_PALETTE in
// app/dashboard/sessions/page.tsx.
const VALID_COLOUR_KEYS = [
  'purple', 'violet', 'indigo', 'green', 'emerald', 'blue',
  'orange', 'amber', 'sky', 'slate', 'rose', 'teal',
]

function slugify(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'TYPE'
}

// Org-scoped: LD Tennis's custom types never appear for another
// organisation — every query here is filtered by the caller's own
// organisation_id, exactly like sessions/bookings/contacts already are.
export async function GET(req: NextRequest) {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const includeArchived = new URL(req.url).searchParams.get('include_archived') === '1'

  try {
    const types = includeArchived
      ? await sql`
          SELECT id, name, slug, colour_key, active, sort_order
          FROM session_types WHERE organisation_id = ${session.organisationId}
          ORDER BY sort_order ASC, name ASC
        `
      : await sql`
          SELECT id, name, slug, colour_key, active, sort_order
          FROM session_types WHERE organisation_id = ${session.organisationId} AND active = true
          ORDER BY sort_order ASC, name ASC
        `
    return NextResponse.json({ types })
  } catch (err) {
    console.error('[dashboard/session-types GET]', err)
    // session_types may not exist yet (migration not applied) — degrade to
    // an empty list so the UI falls back to its hardcoded type map rather
    // than breaking the Create/Edit Session form entirely.
    return NextResponse.json({ types: [] })
  }
}

export async function POST(req: NextRequest) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  let body: { name?: string; colour_key?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const colourKey = body.colour_key && VALID_COLOUR_KEYS.includes(body.colour_key) ? body.colour_key : 'slate'

  try {
    const existing = await sql`
      SELECT id FROM session_types
      WHERE organisation_id = ${session.organisationId} AND LOWER(name) = LOWER(${name})
    `
    if (existing.length > 0) {
      return NextResponse.json({ error: 'A session type with this name already exists.' }, { status: 409 })
    }

    let slug = slugify(name)
    let attempt = 0
    // Extremely unlikely to collide given the name-uniqueness check above
    // already ran, but slugs can theoretically coincide for differently-cased
    // or punctuated names that normalise to the same value — de-duplicate
    // deterministically rather than failing the whole request.
    for (;;) {
      const clash = await sql`SELECT id FROM session_types WHERE organisation_id = ${session.organisationId} AND slug = ${slug}`
      if (clash.length === 0) break
      attempt++
      slug = `${slugify(name)}_${attempt + 1}`
    }

    const [{ maxSort }] = await sql`SELECT COALESCE(MAX(sort_order), -1) + 1 AS "maxSort" FROM session_types WHERE organisation_id = ${session.organisationId}`

    const rows = await sql`
      INSERT INTO session_types (organisation_id, name, slug, colour_key, sort_order)
      VALUES (${session.organisationId}, ${name}, ${slug}, ${colourKey}, ${maxSort})
      RETURNING id, name, slug, colour_key, active, sort_order
    `
    return NextResponse.json({ type: rows[0] }, { status: 201 })
  } catch (err) {
    console.error('[dashboard/session-types POST]', err)
    return NextResponse.json({ error: 'Failed to create session type' }, { status: 500 })
  }
}
