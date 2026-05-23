import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

const VALID_STATUSES = new Set([
  'new', 'contacted', 'discovery', 'qualified',
  'proposal_sent', 'proposal_approved',
  'onboarding', 'in_deployment', 'active_client',
  'paused', 'won', 'lost',
]);

export async function GET(req: Request) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Query params ─────────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const statusRaw = searchParams.get('status') ?? '';
  const search    = searchParams.get('search') ?? '';
  const limit     = Math.min(parseInt(searchParams.get('limit')  ?? '100', 10), 200);
  const offset    = Math.max(parseInt(searchParams.get('offset') ?? '0',   10), 0);

  // 'ALL' / '%' sentinels keep every param a string — no boolean/null type issues
  const statusParam = (statusRaw && VALID_STATUSES.has(statusRaw)) ? statusRaw : 'ALL';
  const searchPat   = search.trim().length > 0
    ? `%${search.trim().replace(/[%_]/g, '\\$&')}%`
    : '%';  // '%' matches every non-null value; full_name is NOT NULL so always hits

  // ── Queries ───────────────────────────────────────────────────────────────
  try {
    const rows = await sql`
      SELECT
        id, created_at, updated_at, full_name, business_name,
        email, phone, website_url, business_type, service_interest,
        budget_range, project_description, status, source, notes,
        priority, score, pipeline_notes
      FROM web_service_leads
      WHERE
        (${statusParam} = 'ALL' OR status::text = ${statusParam})
        AND (full_name ILIKE ${searchPat} OR email ILIKE ${searchPat} OR business_name ILIKE ${searchPat})
      ORDER BY created_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `;

    const statsRows = await sql`
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM web_service_leads
      GROUP BY status
    `;

    const stats = Object.fromEntries(
      statsRows.map(r => [r.status as string, r.count as number]),
    );

    return NextResponse.json({ leads: rows, stats, total: rows.length });
  } catch (err) {
    console.error('[GET /api/web-services/leads] query error:', err);
    return NextResponse.json(
      { error: 'Internal server error', leads: [], stats: {}, total: 0 },
      { status: 500 },
    );
  }
}
