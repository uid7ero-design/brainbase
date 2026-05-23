import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

const VALID_STATUSES = ['draft', 'sent', 'viewed', 'approved', 'rejected'] as const;
type ProposalStatus  = typeof VALID_STATUSES[number];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await getAuthSession(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  const rows = await sql`
    SELECT
      p.*,
      l.full_name AS lead_name, l.business_name, l.email AS lead_email, l.phone AS lead_phone
    FROM deployment_proposals p
    LEFT JOIN web_service_leads l ON l.id = p.lead_id
    WHERE p.id = ${id}
    LIMIT 1
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ proposal: rows[0] });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await getAuthSession(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as ProposalStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    updates.status = body.status;
    // set timestamp fields when status transitions
    if (body.status === 'sent')     updates.sent_at     = new Date().toISOString();
    if (body.status === 'viewed')   updates.viewed_at   = new Date().toISOString();
    if (body.status === 'approved') updates.approved_at = new Date().toISOString();
  }

  if (body.proposal_title !== undefined) {
    updates.proposal_title = typeof body.proposal_title === 'string' ? body.proposal_title.trim().slice(0, 300) : 'Untitled';
  }
  if (body.deployment_scope !== undefined) {
    updates.deployment_scope = typeof body.deployment_scope === 'string' ? body.deployment_scope.trim().slice(0, 10000) : null;
  }
  if (body.proposal_content !== undefined) {
    updates.proposal_content = typeof body.proposal_content === 'string' ? body.proposal_content.trim().slice(0, 50000) : null;
  }
  if (body.notes !== undefined) {
    updates.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) : null;
  }
  if (body.monthly_recurring !== undefined) {
    const v = Number(body.monthly_recurring);
    updates.monthly_recurring = Number.isFinite(v) && v >= 0 ? v : 0;
  }
  if (body.one_time_cost !== undefined) {
    const v = Number(body.one_time_cost);
    updates.one_time_cost = Number.isFinite(v) && v >= 0 ? v : 0;
  }
  if (body.included_modules !== undefined && Array.isArray(body.included_modules)) {
    updates.included_modules = (body.included_modules as string[]).slice(0, 20);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const rows = await sql`
    UPDATE deployment_proposals
    SET
      status           = CASE WHEN ${Object.hasOwn(updates, 'status')}           THEN ${updates.status as string | null}           ELSE status END,
      proposal_title   = CASE WHEN ${Object.hasOwn(updates, 'proposal_title')}   THEN ${updates.proposal_title as string | null}   ELSE proposal_title END,
      deployment_scope = CASE WHEN ${Object.hasOwn(updates, 'deployment_scope')} THEN ${updates.deployment_scope as string | null} ELSE deployment_scope END,
      proposal_content = CASE WHEN ${Object.hasOwn(updates, 'proposal_content')} THEN ${updates.proposal_content as string | null} ELSE proposal_content END,
      notes            = CASE WHEN ${Object.hasOwn(updates, 'notes')}            THEN ${updates.notes as string | null}            ELSE notes END,
      monthly_recurring= CASE WHEN ${Object.hasOwn(updates, 'monthly_recurring')}THEN ${updates.monthly_recurring as number | null}ELSE monthly_recurring END,
      one_time_cost    = CASE WHEN ${Object.hasOwn(updates, 'one_time_cost')}    THEN ${updates.one_time_cost as number | null}    ELSE one_time_cost END,
      included_modules = CASE WHEN ${Object.hasOwn(updates, 'included_modules')} THEN ${updates.included_modules as string[] | null}ELSE included_modules END,
      sent_at          = CASE WHEN ${Object.hasOwn(updates, 'sent_at')}          THEN ${updates.sent_at as string | null}          ELSE sent_at END,
      viewed_at        = CASE WHEN ${Object.hasOwn(updates, 'viewed_at')}        THEN ${updates.viewed_at as string | null}        ELSE viewed_at END,
      approved_at      = CASE WHEN ${Object.hasOwn(updates, 'approved_at')}      THEN ${updates.approved_at as string | null}      ELSE approved_at END,
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ proposal: rows[0] });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await getAuthSession(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const rows = await sql`DELETE FROM deployment_proposals WHERE id = ${id} RETURNING id`;
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, id });
}
