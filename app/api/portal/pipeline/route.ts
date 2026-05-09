import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function GET() {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  try {
    const requests = await sql`
      SELECT
        cp.id, cp.type, cp.title, cp.description, cp.status, cp.priority,
        cp.created_at, cp.updated_at,
        (
          SELECT json_agg(pm ORDER BY pm.created_at ASC)
          FROM pipeline_messages pm
          WHERE pm.pipeline_id = cp.id
        ) AS messages,
        (
          SELECT row_to_json(b)
          FROM (
            SELECT id, date, time, session_type, status, confirmed_at
            FROM bookings
            WHERE pipeline_id = cp.id::text
            ORDER BY created_at DESC
            LIMIT 1
          ) b
        ) AS booking
      FROM client_pipeline cp
      WHERE cp.organisation_id = ${session.organisationId}
      ORDER BY
        CASE cp.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
        cp.created_at DESC
    `
    return NextResponse.json({ requests })
  } catch (err) {
    console.error('[portal/pipeline GET]', err)
    return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  let body: { type?: string; title?: string; description?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const { type = 'request', title, description } = body

  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  if (!['request', 'issue', 'feedback'].includes(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  try {
    const rows = await sql`
      INSERT INTO client_pipeline (organisation_id, type, title, description)
      VALUES (${session.organisationId}, ${type}, ${title.trim()}, ${description?.trim() ?? null})
      RETURNING id, type, title, description, status, priority, created_at
    `
    return NextResponse.json({ request: rows[0] }, { status: 201 })
  } catch (err) {
    console.error('[portal/pipeline POST]', err)
    return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 })
  }
}
