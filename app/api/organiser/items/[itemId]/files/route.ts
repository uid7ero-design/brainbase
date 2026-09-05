import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';
import { uploadOrganiserAttachment, deleteOrganiserAttachmentIfManaged } from '@/lib/organiser/attachmentStorage';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export async function GET(_req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { itemId } = await params;
  const files = await sql`
    SELECT id, file_name, file_url, file_size, created_at
    FROM organiser_item_files
    WHERE item_id = ${itemId} AND organisation_id = ${session.organisationId}
    ORDER BY created_at DESC
  `;
  return NextResponse.json({ files });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { itemId } = await params;
  const itemRows = await sql`
    SELECT id, board_id FROM organiser_items WHERE id = ${itemId} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (itemRows.length === 0) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  const boardId = itemRows[0].board_id as string;

  let formData: FormData;
  try { formData = await req.formData(); } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'File is empty.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 15 MB).' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  // Blob upload must succeed before any DB row is attempted — never insert
  // metadata pointing at an object that doesn't exist. Storage key is a
  // server-generated pathname (organisationId/itemId/uuid-name), never the
  // caller's raw filename, so a malicious filename (path traversal, etc.)
  // can never influence where the object is written.
  const upload = await uploadOrganiserAttachment(session.organisationId, itemId, buffer, file.name, file.type || undefined);
  if (!upload.ok) {
    console.error('[organiser files] Blob upload failed', upload.error);
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 502 });
  }

  // Phase D.4.5F — file.added, made atomic with the file METADATA row via
  // the same writable-CTE pattern as every other instrumented mutation. No
  // signed URL, access token, or file content is stored in activity — only
  // the filename and size (no MIME type column exists on
  // organiser_item_files to record).
  try {
    const rows = await sql`
      WITH inserted AS (
        INSERT INTO organiser_item_files (item_id, board_id, organisation_id, file_name, file_url, file_size, uploaded_by)
        VALUES (${itemId}, ${boardId}, ${session.organisationId}, ${file.name}, ${upload.url}, ${file.size}, ${session.userId})
        RETURNING id, file_name, file_url, file_size, created_at
      ),
      activity_row AS (
        INSERT INTO organiser_activity (
          organisation_id, board_id, item_id, actor_user_id, actor_name,
          event_type, entity_type, entity_id, before_json, after_json
        )
        SELECT
          ${session.organisationId}, ${boardId}, ${itemId}, ${session.userId}, ${session.name},
          'file.added', 'file', inserted.id::text, NULL,
          jsonb_build_object(
            'file_name', organiser_activity_sanitise_scalar(to_jsonb(inserted.file_name)),
            'file_size', to_jsonb(inserted.file_size)
          )
        FROM inserted
        RETURNING id
      )
      SELECT id, file_name, file_url, file_size, created_at FROM inserted
    `;

    return NextResponse.json({ file: rows[0] });
  } catch (err) {
    // DB persistence failed after the Blob object was already created —
    // compensate by deleting the now-orphaned object rather than leaving it
    // behind with no DB reference. Never leaks err (db detail/stack) to the
    // client.
    await deleteOrganiserAttachmentIfManaged(upload.url);
    console.error('[organiser files] DB insert failed after Blob upload; orphaned Blob object deleted', err);
    return NextResponse.json({ error: 'Failed to save file record. Please try again.' }, { status: 500 });
  }
}
