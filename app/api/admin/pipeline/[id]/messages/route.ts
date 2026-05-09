import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  let body: { body?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (!body.body?.trim()) return NextResponse.json({ error: 'Message body required' }, { status: 400 })

  try {
    const owns = await sql`SELECT id, organisation_id FROM client_pipeline WHERE id = ${id}::uuid`
    if (!owns[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const rows = await sql`
      INSERT INTO pipeline_messages (pipeline_id, organisation_id, author_type, body)
      VALUES (${id}::uuid, ${owns[0].organisation_id as string}, 'founder', ${body.body.trim()})
      RETURNING id, author_type, body, created_at
    `
    await sql`
      UPDATE client_pipeline SET status = 'awaiting_client', updated_at = NOW()
      WHERE id = ${id}::uuid AND status != 'resolved'
    `
    return NextResponse.json({ message: rows[0] }, { status: 201 })
  } catch (err) {
    console.error('[admin/pipeline/messages POST]', err)
    return NextResponse.json({ error: 'Failed to post message' }, { status: 500 })
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    const messages = await sql`
      SELECT id, author_type, body, created_at
      FROM pipeline_messages
      WHERE pipeline_id = ${id}::uuid
      ORDER BY created_at ASC
    `
    return NextResponse.json({ messages })
  } catch (err) {
    console.error('[admin/pipeline/messages GET]', err)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
}
