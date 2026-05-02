import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.organisationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { title, briefingType, agentName, responseText, evidenceJson } = await req.json();
  if (!title || !responseText) return NextResponse.json({ error: 'title and responseText are required' }, { status: 400 });

  const [row] = await sql`
    INSERT INTO saved_briefings (organisation_id, user_id, title, briefing_type, agent_name, response_text, evidence_json)
    VALUES (
      ${session.organisationId}::uuid,
      ${session.userId ?? null}::uuid,
      ${title},
      ${briefingType ?? null},
      ${agentName ?? null},
      ${responseText},
      ${evidenceJson ? JSON.stringify(evidenceJson) : null}::jsonb
    )
    RETURNING id, created_at
  `;
  return NextResponse.json({ id: row.id, createdAt: row.created_at });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.organisationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') ?? null;

  const rows = await sql`
    SELECT id, title, briefing_type, agent_name, response_text, evidence_json, created_at
    FROM saved_briefings
    WHERE organisation_id = ${session.organisationId}::uuid
      AND (${type}::text IS NULL OR briefing_type = ${type})
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return NextResponse.json({ briefings: rows });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.organisationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  await sql`
    DELETE FROM saved_briefings
    WHERE id = ${id}::uuid AND organisation_id = ${session.organisationId}::uuid
  `;
  return NextResponse.json({ success: true });
}
