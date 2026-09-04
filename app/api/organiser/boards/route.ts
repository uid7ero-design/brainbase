import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

export async function GET() {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const boards = await sql`
    SELECT
      b.id, b.name, b.color, b.icon, b.position, b.created_at, b.updated_at,
      COUNT(i.id) FILTER (WHERE i.id IS NOT NULL) AS item_count
    FROM organiser_boards b
    LEFT JOIN organiser_items i ON i.board_id = b.id
    WHERE b.organisation_id = ${session.organisationId}
    GROUP BY b.id
    ORDER BY b.position ASC, b.created_at ASC
  `;

  return NextResponse.json({ boards });
}

export async function POST(req: NextRequest) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Board name is required.' }, { status: 400 });
  const color = typeof body?.color === 'string' ? body.color : null;

  const posRows = await sql`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM organiser_boards WHERE organisation_id = ${session.organisationId}
  `;
  const position = posRows[0].next as number;

  // Phase D.4.5F — board.created, atomic with the INSERT (one writable
  // CTE, same pattern as the item routes' own instrumentation). before_json
  // is NULL (a create has no prior state); after_json carries just the
  // name — the only user-meaningful field at creation time.
  const rows = await sql`
    WITH inserted AS (
      INSERT INTO organiser_boards (organisation_id, name, color, position, created_by)
      VALUES (${session.organisationId}, ${name}, ${color}, ${position}, ${session.userId})
      RETURNING id, name, color, icon, position, created_at, updated_at
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, inserted.id, ${session.userId}, ${session.name},
        'board.created', 'board', inserted.id::text, NULL,
        jsonb_build_object('name', organiser_activity_sanitise_scalar(to_jsonb(inserted.name)))
      FROM inserted
      RETURNING id
    )
    SELECT id, name, color, icon, position, created_at, updated_at FROM inserted
  `;

  return NextResponse.json({ board: { ...rows[0], item_count: 0 } });
}
