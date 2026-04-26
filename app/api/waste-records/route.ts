import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

/**
 * GET /api/waste-records
 * Returns waste records scoped to the caller's organisation.
 *
 * Optional query params:
 *   fileId        — filter by uploaded_file_id
 *   serviceType   — filter by service_type
 *   suburb        — filter by suburb
 *   month         — filter by month
 *   financialYear — filter by financial_year
 *   limit         — default 500
 *   offset        — default 0
 */
export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const { searchParams } = req.nextUrl;
  const fileId        = searchParams.get('fileId');
  const serviceType   = searchParams.get('serviceType');
  const suburb        = searchParams.get('suburb');
  const month         = searchParams.get('month');
  const financialYear = searchParams.get('financialYear');
  const limit         = Math.min(Number(searchParams.get('limit')  ?? 500), 5000);
  const offset        = Number(searchParams.get('offset') ?? 0);

  // Build a dynamic filter while still using the parameterised neon driver.
  // neon's tagged-template driver doesn't support dynamic WHERE clauses directly,
  // so we collect filter fragments as sql fragments using the neon helper.
  const records = await sql`
    SELECT wr.*,
           uf.file_name
    FROM   waste_records wr
    LEFT JOIN uploaded_files uf ON uf.id = wr.uploaded_file_id
    WHERE  wr.organisation_id = ${session.organisationId}
      ${fileId        ? sql`AND wr.uploaded_file_id = ${fileId}`         : sql``}
      ${serviceType   ? sql`AND wr.service_type     = ${serviceType}`    : sql``}
      ${suburb        ? sql`AND wr.suburb            = ${suburb}`         : sql``}
      ${month         ? sql`AND wr.month             = ${month}`          : sql``}
      ${financialYear ? sql`AND wr.financial_year    = ${financialYear}`  : sql``}
    ORDER BY wr.created_at DESC
    LIMIT  ${limit}
    OFFSET ${offset}
  `;

  const countRows = await sql`
    SELECT COUNT(*) AS total
    FROM   waste_records
    WHERE  organisation_id = ${session.organisationId}
      ${fileId        ? sql`AND uploaded_file_id = ${fileId}`         : sql``}
      ${serviceType   ? sql`AND service_type     = ${serviceType}`    : sql``}
      ${suburb        ? sql`AND suburb            = ${suburb}`         : sql``}
      ${month         ? sql`AND month             = ${month}`          : sql``}
      ${financialYear ? sql`AND financial_year    = ${financialYear}`  : sql``}
  `;

  return NextResponse.json({
    records,
    total: Number(countRows[0].total),
    limit,
    offset,
  });
}
