import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

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
