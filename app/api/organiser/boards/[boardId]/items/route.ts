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
  if (!name) return NextResponse.json({ error: 'Item name is required.' }, { status: 400 });

  const groupId = typeof body?.group_id === 'string' ? body.group_id : null;
  const parentItemId = typeof body?.parent_item_id === 'string' ? body.parent_item_id : null;
  const status = typeof body?.status === 'string' && body.status ? body.status : 'Not Started';

  const posRows = await sql`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM organiser_items
    WHERE board_id = ${boardId} AND parent_item_id IS NOT DISTINCT FROM ${parentItemId}
  `;
  const position = posRows[0].next as number;

  // Phase D.4.5C-B — item creation + its item.created activity row as ONE
  // atomic statement (a writable CTE): if the activity INSERT fails for
  // any reason, Postgres aborts the whole statement and the item INSERT
  // is rolled back too. No pre-existing "before" state to race against
  // (this is a create, not an update), so no locking is needed here —
  // unlike PATCH (see items/[itemId]/route.ts), which needs a FOR UPDATE
  // -locked "old" CTE precisely because it DOES have a before-state that
  // could otherwise go stale under concurrency (see the D.4.5C-A audit
  // and the empirical proof in scripts/tests/
  // verify-organiser-item-activity-concurrency.sh). after_json is a
  // minimum identity summary (name/status/group_id/parent_item_id), never
  // a full-row snapshot — matches D.4.5B's "diff log, not a content
  // mirror" policy. Actor/organisation come exclusively from the already-
  // authorized session; nothing here is read from the request body.
  const rows = await sql`
    WITH inserted AS (
      INSERT INTO organiser_items (board_id, organisation_id, group_id, parent_item_id, name, status, position)
      VALUES (${boardId}, ${session.organisationId}, ${groupId}, ${parentItemId}, ${name}, ${status}, ${position})
      RETURNING id, board_id, group_id, parent_item_id, name, status, priority, owner, due_date::text AS due_date, notes, fields, custom_values, position, created_at, updated_at
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, item_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, inserted.board_id, inserted.id, ${session.userId}, ${session.name},
        'item.created', 'item', inserted.id::text, NULL,
        jsonb_build_object(
          'name', organiser_activity_sanitise_scalar(to_jsonb(inserted.name)),
          'status', organiser_activity_sanitise_scalar(to_jsonb(inserted.status)),
          'group_id', to_jsonb(inserted.group_id),
          'parent_item_id', to_jsonb(inserted.parent_item_id)
        )
      FROM inserted
      RETURNING id
    )
    SELECT id, group_id, parent_item_id, name, status, priority, owner, due_date, notes, fields, custom_values, position, created_at, updated_at
    FROM inserted
  `;

  return NextResponse.json({ item: rows[0] });
}
