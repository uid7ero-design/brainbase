import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

const VALID_STAGES = new Set([
  'discovery', 'content_collection', 'infrastructure_setup',
  'website_build', 'integrations', 'review',
  'deployment', 'live', 'maintenance',
]);

export async function GET(req: Request) {
  let session;
  try { session = await getAuthSession(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const stage  = searchParams.get('stage') ?? '';
  const stageP = (stage && VALID_STAGES.has(stage)) ? stage : 'ALL';

  try {
    const rows = await sql`
      SELECT
        o.*,
        l.full_name AS lead_name, l.business_name, l.email AS lead_email,
        p.proposal_title, p.monthly_recurring, p.one_time_cost
      FROM client_onboarding o
      LEFT JOIN web_service_leads l ON l.id = o.lead_id
      LEFT JOIN deployment_proposals p ON p.id = o.proposal_id
      WHERE (${stageP} = 'ALL' OR o.onboarding_stage = ${stageP})
      ORDER BY o.created_at DESC
      LIMIT 100
    `;

    return NextResponse.json({ onboarding: rows, total: rows.length });
  } catch (err) {
    console.error('[GET /api/deployments/onboarding]', err);
    return NextResponse.json({ error: 'Internal server error', onboarding: [] }, { status: 500 });
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

  const leadId     = typeof body.lead_id     === 'string' && body.lead_id     ? body.lead_id     : null;
  const proposalId = typeof body.proposal_id === 'string' && body.proposal_id ? body.proposal_id : null;
  const assignedTo = typeof body.assigned_to === 'string' && body.assigned_to ? body.assigned_to : null;
  const notes      = typeof body.notes       === 'string' ? body.notes.trim().slice(0, 5000)      : null;
  const targetDate = typeof body.target_launch_date === 'string' && body.target_launch_date ? body.target_launch_date : null;

  const defaultChecklist = [
    { id: 'strategy',      label: 'Strategy call completed',       done: false },
    { id: 'content',       label: 'Content collected',             done: false },
    { id: 'domain',        label: 'Domain configured',             done: false },
    { id: 'hosting',       label: 'Hosting provisioned',           done: false },
    { id: 'website_build', label: 'Website built',                 done: false },
    { id: 'crm',           label: 'CRM integration configured',    done: false },
    { id: 'automations',   label: 'Automations set up',            done: false },
    { id: 'review',        label: 'Client review completed',       done: false },
    { id: 'launch',        label: 'Site launched',                 done: false },
    { id: 'handoff',       label: 'Client handoff completed',      done: false },
  ];

  try {
    const rows = await sql`
      INSERT INTO client_onboarding
        (lead_id, proposal_id, client_name, assigned_to, notes, target_launch_date, checklist)
      VALUES
        (${leadId}, ${proposalId}, ${clientName}, ${assignedTo}, ${notes}, ${targetDate}, ${JSON.stringify(defaultChecklist)})
      RETURNING *
    `;

    return NextResponse.json({ onboarding: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/deployments/onboarding]', err);
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

  const stage   = typeof body.onboarding_stage === 'string' && VALID_STAGES.has(body.onboarding_stage) ? body.onboarding_stage : null;
  const notes   = typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) : undefined;
  const checklist = Array.isArray(body.checklist) ? body.checklist : undefined;

  const statusFields: Record<string, string | null> = {};
  for (const f of ['hosting_status', 'domain_status', 'deployment_status', 'integrations_status', 'crm_status', 'launch_status']) {
    if (typeof body[f] === 'string') statusFields[f] = body[f] as string;
  }

  const rows = await sql`
    UPDATE client_onboarding
    SET
      onboarding_stage    = CASE WHEN ${stage !== null}               THEN ${stage}              ELSE onboarding_stage END,
      notes               = CASE WHEN ${notes !== undefined}          THEN ${notes ?? null}       ELSE notes END,
      checklist           = CASE WHEN ${checklist !== undefined}      THEN ${JSON.stringify(checklist ?? [])}::jsonb ELSE checklist END,
      hosting_status      = CASE WHEN ${!!statusFields.hosting_status}      THEN ${statusFields.hosting_status ?? null}      ELSE hosting_status END,
      domain_status       = CASE WHEN ${!!statusFields.domain_status}       THEN ${statusFields.domain_status ?? null}       ELSE domain_status END,
      deployment_status   = CASE WHEN ${!!statusFields.deployment_status}   THEN ${statusFields.deployment_status ?? null}   ELSE deployment_status END,
      integrations_status = CASE WHEN ${!!statusFields.integrations_status} THEN ${statusFields.integrations_status ?? null} ELSE integrations_status END,
      crm_status          = CASE WHEN ${!!statusFields.crm_status}          THEN ${statusFields.crm_status ?? null}          ELSE crm_status END,
      launch_status       = CASE WHEN ${!!statusFields.launch_status}       THEN ${statusFields.launch_status ?? null}       ELSE launch_status END,
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ onboarding: rows[0] });
}
