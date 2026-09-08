import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

// Phase D.4.6H — same UUID-format pre-check the item PATCH route
// (D.4.6F) already established. A malformed group_id/parent_item_id is
// rejected here, before it ever reaches SQL, so the ::uuid casts below
// can never throw.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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

  // Phase D.4.6H — the D.4.6F relationship-validation hardening only
  // covered the item PATCH route; item CREATE accepted a client-supplied
  // group_id/parent_item_id with no organisation/board scoping check at
  // all beyond the bare FK (which only proves the target row exists
  // SOMEWHERE, not that it belongs to this item's own board/org — see the
  // D.4.6F audit for the full reasoning, which applies identically here).
  // A brand-new item can never already be an ancestor of anything, so
  // (unlike PATCH) no cycle check is needed here — only same-org/same-
  // board membership.
  if (groupId !== null && !UUID_RE.test(groupId)) {
    return NextResponse.json({ error: 'Invalid group for this item.' }, { status: 400 });
  }
  if (parentItemId !== null && !UUID_RE.test(parentItemId)) {
    return NextResponse.json({ error: 'Invalid parent item.' }, { status: 400 });
  }

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
    WITH validation AS (
      SELECT
        (
          ${groupId}::uuid IS NULL OR EXISTS (
            SELECT 1 FROM organiser_groups g
            WHERE g.id = ${groupId}::uuid AND g.organisation_id = ${session.organisationId} AND g.board_id = ${boardId}::uuid
          )
        ) AS group_valid,
        (
          ${parentItemId}::uuid IS NULL OR EXISTS (
            SELECT 1 FROM organiser_items p
            WHERE p.id = ${parentItemId}::uuid AND p.organisation_id = ${session.organisationId} AND p.board_id = ${boardId}::uuid
          )
        ) AS parent_valid
    ),
    inserted AS (
      INSERT INTO organiser_items (board_id, organisation_id, group_id, parent_item_id, name, status, position)
      SELECT ${boardId}::uuid, ${session.organisationId}, ${groupId}::uuid, ${parentItemId}::uuid, ${name}, ${status}, ${position}
      FROM validation
      WHERE validation.group_valid AND validation.parent_valid
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
    SELECT validation.group_valid, validation.parent_valid, inserted.*
    FROM validation
    LEFT JOIN inserted ON true
  `;

  const row = rows[0] as Record<string, unknown>;
  if (!row.group_valid) return NextResponse.json({ error: 'Invalid group for this item.' }, { status: 400 });
  if (!row.parent_valid) return NextResponse.json({ error: 'Invalid parent item.' }, { status: 400 });
  // board_id is deliberately excluded here — it's only in RETURNING so
  // activity_row can reference inserted.board_id; it was never part of
  // the { item: ... } response contract (see D.4.5C-T/U) and stays that
  // way despite the new validation/LEFT JOIN plumbing above.
  const {
    id, group_id, parent_item_id, name: itemName, status: itemStatus, priority, owner,
    due_date, notes, fields, custom_values, position: itemPosition, created_at, updated_at,
  } = row;
  return NextResponse.json({
    item: {
      id, group_id, parent_item_id, name: itemName, status: itemStatus, priority, owner,
      due_date, notes, fields, custom_values, position: itemPosition, created_at, updated_at,
    },
  });
}
