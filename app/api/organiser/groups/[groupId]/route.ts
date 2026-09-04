import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  const color = typeof body.color === 'string' ? body.color : null;
  const position = typeof body.position === 'number' ? body.position : null;

  // Phase D.4.5F — group.updated, race-safe and atomic (same FOR UPDATE +
  // field_diff pattern as board.updated / item.updated). `position` is
  // excluded from the diffed field list for the same reason as board
  // position — reordering, not a user-meaningful change — so a
  // position-only PATCH produces no activity row.
  const rows = await sql`
    WITH old AS MATERIALIZED (
      SELECT id, board_id, name, color, position
      FROM organiser_groups
      WHERE id = ${groupId} AND organisation_id = ${session.organisationId}
      FOR UPDATE
    ),
    updated AS (
      UPDATE organiser_groups g SET
        name     = COALESCE(${name}, old.name),
        color    = COALESCE(${color}, old.color),
        position = COALESCE(${position}, old.position)
      FROM old
      WHERE g.id = old.id
      RETURNING g.id, g.board_id, g.name, g.color, g.position
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
        ${session.organisationId}, updated.board_id, ${session.userId}, ${session.name},
        'group.updated', 'group', updated.id::text,
        field_diff.before_obj, field_diff.after_obj
      FROM updated, field_diff
      WHERE field_diff.any_changed IS TRUE
      RETURNING id
    )
    SELECT id, name, color, position FROM updated
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ group: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { groupId } = await params;

  // Phase D.4.5F — group.deleted. before_json preserves the group's name;
  // after_json is NULL. IMPORTANT (see the D.4.5F task's own explicit
  // instruction): organiser_items.group_id is
  // "REFERENCES organiser_groups(id) ON DELETE SET NULL" (see
  // app/api/admin/migrate/route.ts step 35) — deleting a group moves its
  // items to "No group" via this FK constraint, entirely inside Postgres,
  // invisible to and untouched by this route's own SQL. This route never
  // reads or writes organiser_items, so it has no way to know — let alone
  // prove — which individual items were affected without an extra,
  // separately-racy pre-DELETE read. Recording a per-item item.moved event
  // here would therefore be fabricated, not observed. Only ONE group.deleted
  // event is recorded; the item-side effect is a real, silent, DB-level
  // side effect of this delete that this phase deliberately does not
  // synthesize history for.
  const rows = await sql`
    WITH deleted AS (
      DELETE FROM organiser_groups
      WHERE id = ${groupId} AND organisation_id = ${session.organisationId}
      RETURNING id, board_id, name
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, deleted.board_id, ${session.userId}, ${session.name},
        'group.deleted', 'group', deleted.id::text,
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
