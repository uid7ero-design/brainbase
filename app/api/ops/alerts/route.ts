import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'
import { getAuthSession } from '@/lib/authSession'

export async function GET() {
  let organisationId: string

  try {
    const session = await getAuthSession()
    organisationId = session.organisationId
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const alerts = await sql`
      SELECT *
      FROM public.alerts
      WHERE organisation_id = ${organisationId}
      ORDER BY severity DESC, created_at DESC
      LIMIT 100
    `

    return NextResponse.json({ alerts })
  } catch (err) {
    console.error('[ops/alerts GET]', err)
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let session

  try {
    session = await getAuthSession()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()

  if (!body.title || !body.description) {
    return NextResponse.json(
      { error: 'title and description are required' },
      { status: 400 }
    )
  }

  try {
    const [alert] = await sql`
      INSERT INTO public.alerts (
        id,
        organisation_id,
        title,
        description,
        severity,
        module,
        rule_key,
        metadata,
        created_at
      ) VALUES (
        ${crypto.randomUUID()},
        ${session.organisationId},
        ${body.title},
        ${body.description},
        ${body.severity ?? 'MEDIUM'},
        ${body.module ?? null},
        ${body.rule_key ?? null},
        ${JSON.stringify(body.metadata ?? {})},
        NOW()
      )
      RETURNING *
    `

    return NextResponse.json({ alert }, { status: 201 })
  } catch (err) {
    console.error('[ops/alerts POST]', err)
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 })
  }
}