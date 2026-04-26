import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

/**
 * GET /api/reports/[id]
 * Returns the full report including content.
 * Enforces org boundary — a user cannot read another org's reports.
 *
 * Optional query param: ?format=pdf
 * When format=pdf, returns report metadata formatted for jsPDF export
 * (the PDF is generated client-side using jsPDF).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const { id } = await params;

  const rows = await sql`
    SELECT
      r.*,
      u.name  AS created_by_name,
      o.name  AS organisation_name,
      o.slug  AS organisation_slug,
      uf.file_name AS source_file_name
    FROM reports r
    JOIN users        u  ON u.id  = r.created_by
    JOIN organisations o ON o.id  = r.organisation_id
    LEFT JOIN uploaded_files uf ON uf.id = r.source_file_id
    WHERE r.id = ${id}
      AND r.organisation_id = ${session.organisationId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  }

  const report = rows[0];
  const { searchParams } = req.nextUrl;

  if (searchParams.get('format') === 'pdf') {
    // Return structured payload for the client-side jsPDF renderer
    return NextResponse.json({
      pdf: {
        title:            report.report_title,
        organisationName: report.organisation_name,
        reportType:       report.report_type,
        createdBy:        report.created_by_name,
        createdAt:        report.created_at,
        content:          report.report_content,
        sourceFile:       report.source_file_name ?? null,
      },
    });
  }

  return NextResponse.json({ report });
}

/**
 * DELETE /api/reports/[id]
 * Only admin and super_admin may delete reports.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  const check = await sql`
    SELECT id FROM reports
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (check.length === 0) {
    return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  }

  await sql`DELETE FROM reports WHERE id = ${id}`;
  return NextResponse.json({ success: true });
}
