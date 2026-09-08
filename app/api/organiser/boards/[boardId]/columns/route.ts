import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

const TYPES = new Set(['text', 'number', 'date', 'status', 'checkbox']);

const DEFAULT_STATUS_OPTIONS = [
  { label: 'Low', color: '#60A5FA' },
  { label: 'Medium', color: '#F59E0B' },
  { label: 'High', color: '#EF4444' },
];

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
  if (!name) return NextResponse.json({ error: 'Column name is required.' }, { status: 400 });

  const type = typeof body?.type === 'string' ? body.type : '';
  if (!TYPES.has(type)) return NextResponse.json({ error: 'Invalid column type.' }, { status: 400 });

  const options = type === 'status'
    ? (Array.isArray(body?.options) ? body.options : DEFAULT_STATUS_OPTIONS)
    : [];

  const posRows = await sql`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM organiser_columns WHERE board_id = ${boardId}
  `;
  const position = posRows[0].next as number;

  // Phase D.4.6G — column.created, atomic with the INSERT (same writable-CTE
  // pattern as boards/groups' own instrumentation). after_json carries only
  // name/type — the identity fields a reader needs; options (label/color
  // pairs) is config detail, not history-worthy, matching the same
  // "position/noise fields excluded" policy already established elsewhere.
  const rows = await sql`
    WITH inserted AS (
      INSERT INTO organiser_columns (board_id, organisation_id, name, type, options, position)
      VALUES (${boardId}, ${session.organisationId}, ${name}, ${type}, ${JSON.stringify(options)}::jsonb, ${position})
      RETURNING id, name, type, options, position
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, ${boardId}, ${session.userId}, ${session.name},
        'column.created', 'column', inserted.id::text, NULL,
        jsonb_build_object(
          'name', organiser_activity_sanitise_scalar(to_jsonb(inserted.name)),
          'type', organiser_activity_sanitise_scalar(to_jsonb(inserted.type))
        )
      FROM inserted
      RETURNING id
    )
    SELECT id, name, type, options, position FROM inserted
  `;

  return NextResponse.json({ column: rows[0] });
}
