import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

/**
 * GET /api/files/[id]
 * Returns a single uploaded file with its parsed waste records.
 * Enforces that the file belongs to the caller's organisation.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const { id } = await params;

  const fileRows = await sql`
    SELECT f.*, u.name AS uploaded_by_name
    FROM uploaded_files f
    JOIN users u ON u.id = f.uploaded_by
    WHERE f.id = ${id} AND f.organisation_id = ${session.organisationId}
    LIMIT 1
  `;

  if (fileRows.length === 0) {
    return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  }

  const records = await sql`
    SELECT * FROM waste_records
    WHERE uploaded_file_id = ${id} AND organisation_id = ${session.organisationId}
    ORDER BY created_at ASC
  `;

  return NextResponse.json({ file: fileRows[0], records });
}

/**
 * DELETE /api/files/[id]
 * Deletes the file and its waste records.
 * Only admin and super_admin may delete.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  const check = await sql`
    SELECT id FROM uploaded_files
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (check.length === 0) {
    return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  }

  await sql`DELETE FROM waste_records WHERE uploaded_file_id = ${id}`;
  await sql`DELETE FROM uploaded_files WHERE id = ${id}`;

  return NextResponse.json({ success: true });
}
