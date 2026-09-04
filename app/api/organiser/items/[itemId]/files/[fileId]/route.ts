import { NextRequest, NextResponse } from 'next/server';
import { unlink } from 'fs/promises';
import path from 'path';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ itemId: string; fileId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { itemId, fileId } = await params;

  // Phase D.4.5F — file.deleted, atomic with the DB DELETE (the fs.unlink
  // below is a separate, best-effort disk cleanup step that already
  // tolerates failure via .catch(() => {}) — unchanged by this phase).
  // before_json preserves the filename so history stays useful once the
  // organiser_item_files row itself is gone; after_json is NULL.
  const rows = await sql`
    WITH deleted AS (
      DELETE FROM organiser_item_files
      WHERE id = ${fileId} AND item_id = ${itemId} AND organisation_id = ${session.organisationId}
      RETURNING id, board_id, file_name, file_url
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, item_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, deleted.board_id, ${itemId}, ${session.userId}, ${session.name},
        'file.deleted', 'file', deleted.id::text,
        jsonb_build_object('file_name', organiser_activity_sanitise_scalar(to_jsonb(deleted.file_name))),
        NULL
      FROM deleted
      RETURNING id
    )
    SELECT file_url FROM deleted
  `;
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const fileUrl = rows[0].file_url as string;
  const filepath = path.join(process.cwd(), 'public', fileUrl.replace(/^\//, ''));
  await unlink(filepath).catch(() => {});

  return NextResponse.json({ success: true });
}
