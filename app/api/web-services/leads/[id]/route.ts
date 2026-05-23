import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

const VALID_STATUSES = [
  'new', 'contacted', 'discovery', 'qualified',
  'proposal_sent', 'proposal_approved',
  'onboarding', 'in_deployment', 'active_client',
  'paused', 'won', 'lost',
] as const;
type LeadStatus = typeof VALID_STATUSES[number];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Auth: admin or super_admin ───────────────────────────────────────────
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // ── Build update ─────────────────────────────────────────────────────────
  const updates: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as LeadStatus)) {
      return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
    }
    updates.status = body.status;
  }

  if (body.notes !== undefined) {
    updates.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) : null;
  }

  if (body.pipeline_notes !== undefined) {
    updates.pipeline_notes = typeof body.pipeline_notes === 'string' ? body.pipeline_notes.trim().slice(0, 5000) : null;
  }

  if (body.priority !== undefined) {
    const p = body.priority as string;
    updates.priority = ['high', 'medium', 'low'].includes(p) ? p : 'medium';
  }

  if (body.score !== undefined) {
    const s = Number(body.score);
    updates.score = Number.isFinite(s) ? Math.min(100, Math.max(0, Math.round(s))) : 0;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  // ── Persist ──────────────────────────────────────────────────────────────
  const rows = await sql`
    UPDATE web_service_leads
    SET
      status         = COALESCE(${updates.status as string ?? null}::web_lead_status, status),
      notes          = CASE WHEN ${Object.hasOwn(updates, 'notes')}          THEN ${updates.notes as string | null}          ELSE notes END,
      pipeline_notes = CASE WHEN ${Object.hasOwn(updates, 'pipeline_notes')} THEN ${updates.pipeline_notes as string | null} ELSE pipeline_notes END,
      priority       = CASE WHEN ${Object.hasOwn(updates, 'priority')}       THEN ${updates.priority as string | null}       ELSE priority END,
      score          = CASE WHEN ${Object.hasOwn(updates, 'score')}          THEN ${updates.score as number | null}           ELSE score END,
      updated_at = now()
    WHERE id = ${id}
    RETURNING
      id, created_at, updated_at, full_name, business_name, email,
      phone, website_url, service_interest, budget_range,
      project_description, status, source, notes, priority, score, pipeline_notes
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  return NextResponse.json({ lead: rows[0] });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Auth: super_admin only ───────────────────────────────────────────────
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const rows = await sql`
    DELETE FROM web_service_leads
    WHERE id = ${id}
    RETURNING id
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, id });
}
