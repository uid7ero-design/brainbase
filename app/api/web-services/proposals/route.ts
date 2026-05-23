import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

const VALID_TYPES    = new Set(['website_deployment', 'operational_deployment', 'coaching_deployment', 'automation_deployment', 'full_system']);
const VALID_STATUSES = new Set(['draft', 'sent', 'viewed', 'approved', 'rejected']);

export async function GET(req: Request) {
  let session;
  try { session = await getAuthSession(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const leadId  = searchParams.get('lead_id') ?? '';
  const status  = searchParams.get('status') ?? '';
  const limit   = Math.min(parseInt(searchParams.get('limit')  ?? '50', 10), 200);
  const offset  = Math.max(parseInt(searchParams.get('offset') ?? '0',   10), 0);

  const statusParam = (status && VALID_STATUSES.has(status)) ? status : 'ALL';
  const leadParam   = leadId.trim() || 'ALL';

  try {
    const rows = await sql`
      SELECT
        p.id, p.created_at, p.updated_at, p.lead_id, p.organisation_id,
        p.proposal_title, p.proposal_type, p.deployment_scope,
        p.monthly_recurring, p.one_time_cost, p.status,
        p.proposal_content, p.included_modules, p.notes,
        p.sent_at, p.viewed_at, p.approved_at,
        l.full_name  AS lead_name,
        l.business_name,
        l.email      AS lead_email
      FROM deployment_proposals p
      LEFT JOIN web_service_leads l ON l.id = p.lead_id
      WHERE
        (${statusParam} = 'ALL' OR p.status::text = ${statusParam})
        AND (${leadParam}   = 'ALL' OR p.lead_id  = ${leadParam})
      ORDER BY p.created_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `;

    const statsRows = await sql`
      SELECT status::text AS status, COUNT(*)::int AS count,
             SUM(monthly_recurring)::float AS mrr,
             SUM(one_time_cost)::float AS one_time
      FROM deployment_proposals
      GROUP BY status
    `;

    const stats = Object.fromEntries(statsRows.map(r => [r.status as string, { count: r.count, mrr: r.mrr, one_time: r.one_time }]));

    return NextResponse.json({ proposals: rows, stats, total: rows.length });
  } catch (err) {
    console.error('[GET /api/web-services/proposals]', err);
    return NextResponse.json({ error: 'Internal server error', proposals: [], stats: {} }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let session;
  try { session = await getAuthSession(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const proposalType = (body.proposal_type as string) || 'website_deployment';
  if (!VALID_TYPES.has(proposalType)) {
    return NextResponse.json({ error: 'Invalid proposal_type' }, { status: 400 });
  }

  const title    = typeof body.proposal_title === 'string' ? body.proposal_title.trim().slice(0, 300) : 'Untitled Proposal';
  const leadId   = typeof body.lead_id === 'string' && body.lead_id.trim() ? body.lead_id.trim() : null;
  const scope    = typeof body.deployment_scope === 'string' ? body.deployment_scope.trim().slice(0, 10000) : null;
  const content  = typeof body.proposal_content === 'string' ? body.proposal_content.trim().slice(0, 50000) : null;
  const notes    = typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) : null;
  const monthly  = typeof body.monthly_recurring === 'number' && body.monthly_recurring >= 0 ? body.monthly_recurring : 0;
  const oneTime  = typeof body.one_time_cost     === 'number' && body.one_time_cost >= 0     ? body.one_time_cost     : 0;
  const modules  = Array.isArray(body.included_modules) ? (body.included_modules as string[]).slice(0, 20) : [];

  try {
    const rows = await sql`
      INSERT INTO deployment_proposals
        (lead_id, proposal_title, proposal_type, deployment_scope, monthly_recurring,
         one_time_cost, proposal_content, included_modules, notes, status)
      VALUES
        (${leadId}, ${title}, ${proposalType}, ${scope}, ${monthly},
         ${oneTime}, ${content}, ${modules}, ${notes}, 'draft')
      RETURNING *
    `;

    return NextResponse.json({ proposal: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/web-services/proposals]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
