import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

export async function POST(req: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { boardId } = await params;
  const board = await sql`
    SELECT id FROM organiser_boards WHERE id = ${boardId} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (board.length === 0) return NextResponse.json({ error: 'Board not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Group name is required.' }, { status: 400 });
  const color = typeof body?.color === 'string' ? body.color : null;

  const posRows = await sql`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM organiser_groups WHERE board_id = ${boardId}
  `;
  const position = posRows[0].next as number;

  // Phase D.4.5F — group.created, atomic with the INSERT. boardId is
  // already known and tenant-validated above (the board-existence check),
  // so it's interpolated directly rather than re-derived from the row.
  const rows = await sql`
    WITH inserted AS (
      INSERT INTO organiser_groups (board_id, organisation_id, name, color, position)
      VALUES (${boardId}, ${session.organisationId}, ${name}, ${color}, ${position})
      RETURNING id, name, color, position
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, ${boardId}, ${session.userId}, ${session.name},
        'group.created', 'group', inserted.id::text, NULL,
        jsonb_build_object('name', organiser_activity_sanitise_scalar(to_jsonb(inserted.name)))
      FROM inserted
      RETURNING id
    )
    SELECT id, name, color, position FROM inserted
  `;

  return NextResponse.json({ group: rows[0] });
}
