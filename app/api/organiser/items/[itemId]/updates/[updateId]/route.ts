import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ itemId: string; updateId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { itemId, updateId } = await params;

  // Phase D.4.6H — comment.deleted, atomic with the DB DELETE (same
  // pattern as file.deleted's own DELETE + activity_row writable CTE).
  // Deliberately never copies the comment's body/text into activity —
  // before_json is NULL, exactly like item.deleted/file.deleted's own
  // "no content, just enough to explain what happened" convention. The
  // standard activity row columns (item_id, board_id, organisation_id,
  // actor_user_id, actor_name, created_at, event_type) already carry every
  // safe fact a reader needs (who deleted a comment, from which item, and
  // when) — no additional metadata field is needed or added, minimizing
  // the payload to the smallest truthful representation rather than
  // inventing a placeholder field with nothing safe to put in it.
  const rows = await sql`
    WITH deleted AS (
      DELETE FROM organiser_item_updates
      WHERE id = ${updateId} AND item_id = ${itemId} AND organisation_id = ${session.organisationId}
      RETURNING id, board_id
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, item_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, deleted.board_id, ${itemId}, ${session.userId}, ${session.name},
        'comment.deleted', 'comment', deleted.id::text, NULL, NULL
      FROM deleted
      RETURNING id
    )
    SELECT id FROM deleted
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
