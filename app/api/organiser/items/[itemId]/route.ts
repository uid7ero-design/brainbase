import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { itemId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  if (body.parent_item_id === itemId) {
    return NextResponse.json({ error: 'An item cannot be its own parent.' }, { status: 400 });
  }

  const name     = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  const status   = typeof body.status === 'string' && body.status ? body.status : null;
  const priority = typeof body.priority === 'string' ? body.priority : null;
  const owner    = typeof body.owner === 'string' ? body.owner : null;
  const dueDate  = typeof body.due_date === 'string' && body.due_date ? body.due_date : (body.due_date === null ? null : undefined);
  const notes    = typeof body.notes === 'string' ? body.notes : null;
  const position = typeof body.position === 'number' ? body.position : null;

  const hasGroupId  = Object.prototype.hasOwnProperty.call(body, 'group_id');
  const groupIdVal  = hasGroupId ? (typeof body.group_id === 'string' ? body.group_id : null) : null;
  const hasParentId = Object.prototype.hasOwnProperty.call(body, 'parent_item_id');
  const parentIdVal = hasParentId ? (typeof body.parent_item_id === 'string' ? body.parent_item_id : null) : null;
  const hasDueDate  = Object.prototype.hasOwnProperty.call(body, 'due_date');

  // Merge (not replace) custom column values via jsonb `||` so editing one
  // cell never clobbers another column's value written by a concurrent edit.
  const customValues = body.custom_values && typeof body.custom_values === 'object' && !Array.isArray(body.custom_values)
    ? body.custom_values as Record<string, unknown>
    : null;

  const hasCustomValues = customValues !== null;
  const customValuesJson = JSON.stringify(customValues ?? {});

  // Phase D.4.5C-B — item.updated/item.moved activity, captured
  // race-safely and atomically in ONE statement. Empirically proven
  // against real PostgreSQL 16 (see scripts/tests/
  // verify-organiser-item-activity-concurrency.sh) — a naive "SELECT the
  // old row, then separately UPDATE + INSERT activity" is UNSAFE (the
  // read can go stale the instant another request commits a change to
  // the same row before this one's own write runs — see the D.4.5C-A
  // audit's concurrency analysis). The fix, mirroring the ALREADY-SHIPPED
  // pattern in app/api/public/events/[organisationSlug]/[eventSlug]/
  // register/route.ts's own "R1" fix:
  //   - `old` is a FOR UPDATE-locked, explicitly MATERIALIZED CTE — this
  //     is what makes it safe: when it blocks on a concurrent writer, it
  //     re-fetches the TRUE latest committed row once unblocked (Postgres's
  //     own EvalPlanQual mechanism), never a stale statement-start
  //     snapshot.
  //   - `updated` performs the EXACT SAME CASE/COALESCE merge logic the
  //     route always has, just reading its "keep the old value" fallback
  //     from the now-locked `old` row.
  //   - `field_diff`/`custom_diff` compute the changed-key diff via
  //     `IS DISTINCT FROM` — comparing what ACTUALLY changed, not merely
  //     what the request included (a same-value PATCH produces no diff).
  //     `position` is deliberately excluded from the field list entirely
  //     — a position-only change can never produce an activity row, and
  //     position is never included in a payload even when another field
  //     also changed (position remains operational ordering state, not
  //     activity history).
  //   - `activity_row` only inserts when `field_diff.any_changed OR
  //     custom_diff.any_changed` — the position-suppression gate.
  //     event_type is `item.moved` iff group_id or parent_item_id
  //     genuinely changed (NULL-safe `IS DISTINCT FROM`), else
  //     `item.updated` — a move plus other field changes in the same
  //     PATCH still produces exactly ONE row, containing every meaningful
  //     diff together, never split into two rows.
  //   - Every string value (and every custom_values entry) is run through
  //     organiser_activity_sanitise_scalar (app/api/admin/migrate/
  //     route.ts step 41) — the SQL-side equivalent of
  //     lib/organiser/activity.ts's sanitiseActivityFieldValue, same
  //     200-char limit, same '…(truncated)' marker; this is necessary
  //     because the true race-safe "old" values only ever exist inside
  //     this locked, in-database CTE — there is no JS-side value to run
  //     the TypeScript sanitiser on before this statement executes.
  //   - The whole statement is one atomic unit: if the activity INSERT's
  //     own CHECK constraint were ever violated, Postgres aborts the
  //     entire statement and the item UPDATE rolls back with it — no
  //     best-effort write, no separate round trip.
  // Known, disclosed, tested divergence from the TypeScript sanitiser:
  // Postgres's length()/left() count Unicode CODEPOINTS,
  // sanitiseActivityFieldValue's .length/.slice() count UTF-16 CODE
  // UNITS — for text made of supplementary-plane characters (e.g. emoji
  // outside the Basic Multilingual Plane) that also exceeds 200
  // units/codepoints, the two sides truncate at a different point. Both
  // still truncate safely with the same explicit marker; only the exact
  // cutoff for that narrow class of input can differ.
  const rows = await sql`
    WITH old AS MATERIALIZED (
      SELECT id, board_id, group_id, parent_item_id, name, status, priority, owner,
             due_date, notes, position, custom_values
      FROM organiser_items
      WHERE id = ${itemId} AND organisation_id = ${session.organisationId}
      FOR UPDATE
    ),
    updated AS (
      UPDATE organiser_items i SET
        group_id       = CASE WHEN ${hasGroupId}  THEN ${groupIdVal}  ELSE old.group_id       END,
        parent_item_id = CASE WHEN ${hasParentId} THEN ${parentIdVal} ELSE old.parent_item_id END,
        due_date       = CASE WHEN ${hasDueDate}  THEN ${dueDate ?? null}::date ELSE old.due_date END,
        name           = COALESCE(${name}, old.name),
        status         = COALESCE(${status}, old.status),
        priority       = COALESCE(${priority}, old.priority),
        owner          = COALESCE(${owner}, old.owner),
        notes          = COALESCE(${notes}, old.notes),
        position       = COALESCE(${position}, old.position),
        custom_values  = CASE WHEN ${hasCustomValues} THEN old.custom_values || ${customValuesJson}::jsonb ELSE old.custom_values END,
        updated_at     = NOW()
      FROM old
      WHERE i.id = old.id
      RETURNING i.id, i.board_id, i.group_id, i.parent_item_id, i.name, i.status, i.priority, i.owner,
                i.due_date::text AS due_date, i.notes, i.fields, i.custom_values, i.position, i.created_at, i.updated_at
    ),
    field_diff AS (
      SELECT
        jsonb_object_agg(f.key, f.old_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS before_obj,
        jsonb_object_agg(f.key, f.new_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS after_obj,
        bool_or(f.old_val IS DISTINCT FROM f.new_val) AS any_changed
      FROM old, updated,
      LATERAL (VALUES
        ('group_id', organiser_activity_sanitise_scalar(to_jsonb(old.group_id)), organiser_activity_sanitise_scalar(to_jsonb(updated.group_id))),
        ('parent_item_id', organiser_activity_sanitise_scalar(to_jsonb(old.parent_item_id)), organiser_activity_sanitise_scalar(to_jsonb(updated.parent_item_id))),
        ('due_date', organiser_activity_sanitise_scalar(to_jsonb(old.due_date)), organiser_activity_sanitise_scalar(to_jsonb(updated.due_date))),
        ('name', organiser_activity_sanitise_scalar(to_jsonb(old.name)), organiser_activity_sanitise_scalar(to_jsonb(updated.name))),
        ('status', organiser_activity_sanitise_scalar(to_jsonb(old.status)), organiser_activity_sanitise_scalar(to_jsonb(updated.status))),
        ('priority', organiser_activity_sanitise_scalar(to_jsonb(old.priority)), organiser_activity_sanitise_scalar(to_jsonb(updated.priority))),
        ('owner', organiser_activity_sanitise_scalar(to_jsonb(old.owner)), organiser_activity_sanitise_scalar(to_jsonb(updated.owner))),
        ('notes', organiser_activity_sanitise_scalar(to_jsonb(old.notes)), organiser_activity_sanitise_scalar(to_jsonb(updated.notes)))
      ) AS f(key, old_val, new_val)
    ),
    custom_diff AS (
      SELECT
        jsonb_object_agg(kv.key, organiser_activity_sanitise_scalar(old.custom_values -> kv.key)) FILTER (WHERE old.custom_values -> kv.key IS DISTINCT FROM kv.value) AS before_obj,
        jsonb_object_agg(kv.key, organiser_activity_sanitise_scalar(kv.value)) FILTER (WHERE old.custom_values -> kv.key IS DISTINCT FROM kv.value) AS after_obj,
        bool_or(old.custom_values -> kv.key IS DISTINCT FROM kv.value) AS any_changed
      FROM old, jsonb_each(${customValuesJson}::jsonb) AS kv(key, value)
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, item_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json, metadata_json
      )
      SELECT
        ${session.organisationId}, updated.board_id, updated.id, ${session.userId}, ${session.name},
        CASE WHEN old.group_id IS DISTINCT FROM updated.group_id OR old.parent_item_id IS DISTINCT FROM updated.parent_item_id
          THEN 'item.moved' ELSE 'item.updated' END,
        'item', updated.id::text,
        COALESCE(field_diff.before_obj, '{}'::jsonb) ||
          (CASE WHEN custom_diff.any_changed THEN jsonb_build_object('custom_values', custom_diff.before_obj) ELSE '{}'::jsonb END),
        COALESCE(field_diff.after_obj, '{}'::jsonb) ||
          (CASE WHEN custom_diff.any_changed THEN jsonb_build_object('custom_values', custom_diff.after_obj) ELSE '{}'::jsonb END),
        '{}'::jsonb
      FROM old, updated, field_diff, custom_diff
      WHERE field_diff.any_changed IS TRUE OR custom_diff.any_changed IS TRUE
      RETURNING id
    )
    SELECT updated.* FROM updated
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ item: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { itemId } = await params;

  // Phase D.4.5C-B — Gate B resolution (see the phase report). Deleting a
  // parent item cascades to its subitems at the DB level (organiser_items
  // .parent_item_id ON DELETE CASCADE) — D.4.5C-A deliberately did NOT
  // prove a race-safe, same-statement mechanism for counting how many
  // subitems were cascade-removed (the natural approaches all either
  // require a pre-DELETE read racing against the same DELETE, or rely on
  // unproven sibling-CTE execution ordering), and the task's own
  // instruction is explicit that correct history without that count is
  // preferable to unverified cleverness. This DELETE therefore records
  // exactly ONE item.deleted event, for the explicitly-requested item
  // only — no cascaded_subitem_count field, no per-subitem history, and
  // no pre-read outside this statement. Atomic: the DELETE and the
  // activity INSERT are one statement — if the activity INSERT failed,
  // the whole statement (and the DELETE) would roll back with it.
  const rows = await sql`
    WITH deleted AS (
      DELETE FROM organiser_items
      WHERE id = ${itemId} AND organisation_id = ${session.organisationId}
      RETURNING id, board_id, group_id, parent_item_id, name, status
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, item_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, deleted.board_id, deleted.id, ${session.userId}, ${session.name},
        'item.deleted', 'item', deleted.id::text,
        jsonb_build_object(
          'name', organiser_activity_sanitise_scalar(to_jsonb(deleted.name)),
          'status', organiser_activity_sanitise_scalar(to_jsonb(deleted.status)),
          'group_id', to_jsonb(deleted.group_id),
          'parent_item_id', to_jsonb(deleted.parent_item_id)
        ),
        NULL
      FROM deleted
      RETURNING id
    )
    SELECT deleted.id FROM deleted
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
