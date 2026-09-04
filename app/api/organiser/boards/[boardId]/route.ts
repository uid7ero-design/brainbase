import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { boardId } = await params;

  const boardRows = await sql`
    SELECT id, name, color, icon, position, created_at, updated_at
    FROM organiser_boards
    WHERE id = ${boardId} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (boardRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const groups = await sql`
    SELECT id, name, color, position
    FROM organiser_groups
    WHERE board_id = ${boardId} AND organisation_id = ${session.organisationId}
    ORDER BY position ASC, created_at ASC
  `;

  const items = await sql`
    SELECT id, group_id, parent_item_id, name, status, priority, owner,
           due_date::text AS due_date, notes, fields, custom_values, position, created_at, updated_at
    FROM organiser_items
    WHERE board_id = ${boardId} AND organisation_id = ${session.organisationId}
    ORDER BY position ASC, created_at ASC
  `;

  const columns = await sql`
    SELECT id, name, type, options, position
    FROM organiser_columns
    WHERE board_id = ${boardId} AND organisation_id = ${session.organisationId}
    ORDER BY position ASC, created_at ASC
  `;

  return NextResponse.json({ board: boardRows[0], groups, items, columns });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { boardId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  const color = typeof body.color === 'string' ? body.color : null;
  const position = typeof body.position === 'number' ? body.position : null;

  // Phase D.4.5F — board.updated, race-safe and atomic: the same
  // FOR UPDATE-locked "old" CTE + field_diff pattern the item PATCH route
  // already established. `position` is deliberately excluded from the
  // field list — it is reordering/operational state, not a user-meaningful
  // change (see the task's own "do not log position/noise fields" rule) —
  // so a position-only PATCH produces field_diff.any_changed = FALSE and
  // therefore no activity row, exactly like a same-value name/color PATCH.
  const rows = await sql`
    WITH old AS MATERIALIZED (
      SELECT id, name, color, position
      FROM organiser_boards
      WHERE id = ${boardId} AND organisation_id = ${session.organisationId}
      FOR UPDATE
    ),
    updated AS (
      UPDATE organiser_boards b SET
        name       = COALESCE(${name}, old.name),
        color      = COALESCE(${color}, old.color),
        position   = COALESCE(${position}, old.position),
        updated_at = NOW()
      FROM old
      WHERE b.id = old.id
      RETURNING b.id, b.name, b.color, b.icon, b.position, b.created_at, b.updated_at
    ),
    field_diff AS (
      SELECT
        jsonb_object_agg(f.key, f.old_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS before_obj,
        jsonb_object_agg(f.key, f.new_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS after_obj,
        bool_or(f.old_val IS DISTINCT FROM f.new_val) AS any_changed
      FROM old, updated,
      LATERAL (VALUES
        ('name', organiser_activity_sanitise_scalar(to_jsonb(old.name)), organiser_activity_sanitise_scalar(to_jsonb(updated.name))),
        ('color', organiser_activity_sanitise_scalar(to_jsonb(old.color)), organiser_activity_sanitise_scalar(to_jsonb(updated.color)))
      ) AS f(key, old_val, new_val)
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, updated.id, ${session.userId}, ${session.name},
        'board.updated', 'board', updated.id::text,
        field_diff.before_obj, field_diff.after_obj
      FROM updated, field_diff
      WHERE field_diff.any_changed IS TRUE
      RETURNING id
    )
    SELECT id, name, color, icon, position, created_at, updated_at FROM updated
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ board: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { boardId } = await params;

  // Phase D.4.5F — board.deleted. before_json preserves the board's name
  // (the only field worth keeping a snapshot of); after_json is NULL, same
  // convention as item.deleted. organiser_activity.board_id carries no FK
  // to organiser_boards (see the CREATE TABLE comment in
  // app/api/admin/migrate/route.ts, step 40) specifically so this row —
  // and every other activity row this board's own DELETE CASCADE removes
  // history for via organiser_groups/organiser_items — is never itself
  // cascaded away; the DELETE below only ever removes the organiser_boards
  // row and whatever legitimately FK-cascades from it, never
  // organiser_activity.
  const rows = await sql`
    WITH deleted AS (
      DELETE FROM organiser_boards
      WHERE id = ${boardId} AND organisation_id = ${session.organisationId}
      RETURNING id, name
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, deleted.id, ${session.userId}, ${session.name},
        'board.deleted', 'board', deleted.id::text,
        jsonb_build_object('name', organiser_activity_sanitise_scalar(to_jsonb(deleted.name))),
        NULL
      FROM deleted
      RETURNING id
    )
    SELECT id FROM deleted
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
