import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';
import { deleteOrganiserAttachmentIfManaged } from '@/lib/organiser/attachmentStorage';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ itemId: string; fileId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { itemId, fileId } = await params;

  // Phase D.4.5F — file.deleted, atomic with the DB DELETE (the Blob cleanup
  // below is a separate, best-effort step — DB/activity correctness never
  // depends on it succeeding). before_json preserves the filename so
  // history stays useful once the organiser_item_files row itself is gone;
  // after_json is NULL.
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

  // Only ever calls Blob del() on a URL recognized as a genuine BrainBase-
  // managed Blob object — a legacy/local-path file_url (if one ever exists)
  // is silently skipped, never passed to the provider.
  const fileUrl = rows[0].file_url as string;
  await deleteOrganiserAttachmentIfManaged(fileUrl);

  return NextResponse.json({ success: true });
}
