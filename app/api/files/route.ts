import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

/**
 * GET /api/files
 * Returns uploaded files scoped to the caller's organisation.
 */
export async function GET() {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const files = await sql`
    SELECT
      f.id,
      f.file_name,
      f.file_url,
      f.file_type,
      f.upload_status,
      f.created_at,
      u.name AS uploaded_by_name,
      (SELECT COUNT(*) FROM waste_records wr WHERE wr.uploaded_file_id = f.id) AS record_count
    FROM uploaded_files f
    JOIN users u ON u.id = f.uploaded_by
    WHERE f.organisation_id = ${session.organisationId}
    ORDER BY f.created_at DESC
  `;

  return NextResponse.json({ files });
}
