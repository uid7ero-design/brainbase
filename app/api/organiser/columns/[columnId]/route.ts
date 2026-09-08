import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ columnId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { columnId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const name     = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  const position = typeof body.position === 'number' ? body.position : null;
  const options  = Array.isArray(body.options) ? JSON.stringify(body.options) : null;

  // Phase D.4.6G — column.updated, race-safe and atomic: the same
  // FOR UPDATE-locked "old" CTE + field_diff pattern boards/items already
  // use. `position` is deliberately excluded from the diffed field list —
  // reordering is operational state, not a user-meaningful change, matching
  // every other route's own "position is noise" policy.
  const rows = await sql`
    WITH old AS MATERIALIZED (
      SELECT id, board_id, name, type, options, position
      FROM organiser_columns
      WHERE id = ${columnId} AND organisation_id = ${session.organisationId}
      FOR UPDATE
    ),
    updated AS (
      UPDATE organiser_columns c SET
        name     = COALESCE(${name}, old.name),
        position = COALESCE(${position}, old.position),
        options  = COALESCE(${options}::jsonb, old.options)
      FROM old
      WHERE c.id = old.id
      RETURNING c.id, c.name, c.type, c.options, c.position
    ),
    field_diff AS (
      SELECT
        jsonb_object_agg(f.key, f.old_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS before_obj,
        jsonb_object_agg(f.key, f.new_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS after_obj,
        bool_or(f.old_val IS DISTINCT FROM f.new_val) AS any_changed
      FROM old, updated,
      LATERAL (VALUES
        ('name', organiser_activity_sanitise_scalar(to_jsonb(old.name)), organiser_activity_sanitise_scalar(to_jsonb(updated.name))),
        ('options', organiser_activity_sanitise_scalar(old.options), organiser_activity_sanitise_scalar(updated.options))
      ) AS f(key, old_val, new_val)
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, old.board_id, ${session.userId}, ${session.name},
        'column.updated', 'column', updated.id::text,
        field_diff.before_obj, field_diff.after_obj
      FROM old, updated, field_diff
      WHERE field_diff.any_changed IS TRUE
      RETURNING id
    )
    SELECT id, name, type, options, position FROM updated
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ column: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ columnId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { columnId } = await params;

  // Phase D.4.6G — column.deleted. before_json preserves name/type (the
  // only fields worth a snapshot); after_json is NULL, same convention as
  // item.deleted/board.deleted. Atomic: the DELETE and the activity INSERT
  // are one statement.
  const rows = await sql`
    WITH deleted AS (
      DELETE FROM organiser_columns
      WHERE id = ${columnId} AND organisation_id = ${session.organisationId}
      RETURNING id, board_id, name, type
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, deleted.board_id, ${session.userId}, ${session.name},
        'column.deleted', 'column', deleted.id::text,
        jsonb_build_object(
          'name', organiser_activity_sanitise_scalar(to_jsonb(deleted.name)),
          'type', organiser_activity_sanitise_scalar(to_jsonb(deleted.type))
        ),
        NULL
      FROM deleted
      RETURNING id
    )
    SELECT id FROM deleted
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Column values live inside organiser_items.custom_values keyed by column id —
  // strip the now-orphaned key from every item on this org so stale data doesn't
  // linger (harmless if left, but keeps things tidy for a future re-added column
  // with a colliding id, and avoids unbounded growth of the jsonb blob).
  await sql`
    UPDATE organiser_items
    SET custom_values = custom_values - ${columnId}
    WHERE organisation_id = ${session.organisationId} AND custom_values ? ${columnId}
  `;

  return NextResponse.json({ success: true });
}
