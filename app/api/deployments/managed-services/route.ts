import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

export async function GET(req: Request) {
  let session;
  try { session = await getAuthSession(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? 'active';

  try {
    const rows = await sql`
      SELECT * FROM managed_services
      WHERE (${status} = 'ALL' OR status = ${status})
      ORDER BY created_at DESC
      LIMIT 200
    `;

    const mrrRow = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int               AS active_count,
        COALESCE(SUM(monthly_value) FILTER (WHERE status = 'active'), 0)::float AS mrr,
        COUNT(*) FILTER (WHERE renewal_date <= now() + INTERVAL '30 days' AND status = 'active')::int AS renewing_soon
      FROM managed_services
    `;

    return NextResponse.json({
      services: rows,
      metrics: mrrRow[0] ?? { active_count: 0, mrr: 0, renewing_soon: 0 },
      total: rows.length,
    });
  } catch (err) {
    console.error('[GET /api/deployments/managed-services]', err);
    return NextResponse.json({ error: 'Internal server error', services: [], metrics: {} }, { status: 500 });
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
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const clientName = typeof body.client_name === 'string' ? body.client_name.trim().slice(0, 200) : '';
  if (!clientName) return NextResponse.json({ error: 'client_name required' }, { status: 400 });

  const monthly  = typeof body.monthly_value === 'number' && body.monthly_value >= 0 ? body.monthly_value : 0;
  const domain   = typeof body.domain_name   === 'string' && body.domain_name   ? body.domain_name.trim()   : null;
  const provider = typeof body.hosting_provider === 'string' && body.hosting_provider ? body.hosting_provider : 'vercel';
  const domProv  = typeof body.domain_provider  === 'string' && body.domain_provider  ? body.domain_provider  : null;
  const plan     = typeof body.maintenance_plan  === 'string' ? body.maintenance_plan  : 'standard';
  const hosting  = typeof body.hosting_plan      === 'string' ? body.hosting_plan      : 'starter';
  const renewal  = typeof body.renewal_date      === 'string' && body.renewal_date ? body.renewal_date : null;
  const notes    = typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) : null;
  const leadId   = typeof body.lead_id       === 'string' && body.lead_id       ? body.lead_id       : null;
  const onbId    = typeof body.onboarding_id === 'string' && body.onboarding_id ? body.onboarding_id : null;

  try {
    const rows = await sql`
      INSERT INTO managed_services
        (client_name, lead_id, onboarding_id, hosting_provider, domain_provider, domain_name,
         maintenance_plan, hosting_plan, monthly_value, renewal_date, notes)
      VALUES
        (${clientName}, ${leadId}, ${onbId}, ${provider}, ${domProv}, ${domain},
         ${plan}, ${hosting}, ${monthly}, ${renewal}, ${notes})
      RETURNING *
    `;

    return NextResponse.json({ service: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/deployments/managed-services]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  let session;
  try { session = await getAuthSession(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : null;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const VALID_STATUSES = new Set(['active', 'paused', 'cancelled', 'pending']);
  const status  = typeof body.status === 'string' && VALID_STATUSES.has(body.status) ? body.status : null;
  const notes   = typeof body.notes  === 'string' ? body.notes.trim().slice(0, 5000) : undefined;
  const monthly = typeof body.monthly_value === 'number' && body.monthly_value >= 0 ? body.monthly_value : undefined;
  const ssl     = typeof body.ssl_status === 'string' ? body.ssl_status : null;

  const rows = await sql`
    UPDATE managed_services
    SET
      status        = CASE WHEN ${status   !== null}     THEN ${status}              ELSE status END,
      ssl_status    = CASE WHEN ${ssl     !== null}      THEN ${ssl}                 ELSE ssl_status END,
      notes         = CASE WHEN ${notes    !== undefined} THEN ${notes ?? null}       ELSE notes END,
      monthly_value = CASE WHEN ${monthly  !== undefined} THEN ${monthly ?? 0}        ELSE monthly_value END,
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ service: rows[0] });
}
