import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession } from '@/lib/org';

function forbidden() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

export async function POST(req: NextRequest) {
  // SEC-1B3: was raw getSession() — the JWT-only claim, never revalidated
  // against the DB. requireSession() (lib/org.ts) re-reads the caller's
  // current role/organisation/status from the database on every call, so
  // a since-deactivated, since-reassigned, or deleted user's still-valid
  // JWT can no longer save/read/delete briefings under their old org.
  let session;
  try { session = await requireSession(); } catch { return forbidden(); }

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
  let session;
  try { session = await requireSession(); } catch { return forbidden(); }

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
  let session;
  try { session = await requireSession(); } catch { return forbidden(); }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  await sql`
    DELETE FROM saved_briefings
    WHERE id = ${id}::uuid AND organisation_id = ${session.organisationId}::uuid
  `;
  return NextResponse.json({ success: true });
}
