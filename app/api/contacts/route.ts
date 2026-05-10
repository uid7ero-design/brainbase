import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function POST(req: NextRequest) {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { name, email, phone, status, address, age, program, session_times, next_action,
          guardian_name, guardian_phone, session_id } = body
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })

  const rows = await sql`
    INSERT INTO contacts (
      organisation_id, name, email, phone, status, address, age,
      program, session_times, next_action, guardian_name, guardian_phone, session_id
    ) VALUES (
      ${session.organisationId}, ${name.trim()},
      ${email || null}, ${phone || null}, ${status || 'lead'},
      ${address || null}, ${age != null ? Number(age) : null},
      ${program || null}, ${session_times || null}, ${next_action || null},
      ${guardian_name || null}, ${guardian_phone || null}, ${session_id || null}
    )
    RETURNING id, name, email, phone, status, address, age, program, session_times,
              next_action, guardian_name, guardian_phone, session_id, last_contacted_at, created_at
  `
  return NextResponse.json({ contact: rows[0] }, { status: 201 })
}

export async function GET(req: NextRequest) {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''

  try {
    const contacts = q
      ? await sql`
          SELECT id, name, email, phone FROM contacts
          WHERE organisation_id = ${session.organisationId}
            AND (name ILIKE ${'%' + q + '%'} OR email ILIKE ${'%' + q + '%'})
          ORDER BY name ASC LIMIT 20
        `
      : await sql`
          SELECT id, name, email, phone FROM contacts
          WHERE organisation_id = ${session.organisationId}
          ORDER BY name ASC LIMIT 100
        `
    return NextResponse.json({ contacts })
  } catch (err) {
    console.error('[api/contacts GET]', err)
    return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 })
  }
}
