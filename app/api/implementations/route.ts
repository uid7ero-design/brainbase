import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

// ── Client Implementations — core record (Phase 2A) ─────────────────────
//
// Deliberately minimal: no services list, no milestones, no tasks, no
// progress tracking. Founder/admin delivery-tracking tool — organisation
// scoping always resolved server-side from the authenticated session,
// never trusted from a request body.

const VALID_STAGES = new Set([
  'planning', 'discovery', 'setup', 'build', 'client_review',
  'testing', 'ready_to_launch', 'live', 'on_hold', 'cancelled',
]);
const VALID_HEALTH = new Set(['on_track', 'at_risk', 'blocked']);

// GET — any authenticated user may list implementations, always scoped to
// their own organisation. super_admin sees every organisation by default,
// or a single one via ?organisationId= (still server-validated, not a
// blind pass-through — the value only ever narrows an already-authorised
// super_admin's own cross-org visibility, it can't be used by anyone else
// to escape their own org scope).
export async function GET(req: Request) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedOrgId = new URL(req.url).searchParams.get('organisationId');
  const scopeOrgId = session.role === 'super_admin' ? requestedOrgId : session.organisationId;

  try {
    const rows = await sql`
      SELECT
        i.id, i.organisation_id, i.name, i.service_type, i.stage, i.health,
        i.owner_user_id, i.target_launch_date, i.actual_launch_date,
        i.summary, i.next_action, i.source_lead_id, i.source_proposal_id,
        i.created_at, i.updated_at,
        o.name AS organisation_name,
        u.name AS owner_name
      FROM implementations i
      LEFT JOIN organisations o ON o.id = i.organisation_id
      LEFT JOIN users u ON u.id = i.owner_user_id
      WHERE (${scopeOrgId}::text IS NULL OR i.organisation_id = ${scopeOrgId}::text)
      ORDER BY i.updated_at DESC
    `;
    return NextResponse.json({ implementations: rows });
  } catch (err) {
    console.error('[GET /api/implementations]', err);
    return NextResponse.json(
      { error: 'Internal server error', implementations: [] },
      { status: 500 },
    );
  }
}

// POST — admin/super_admin only. Non-super_admin callers always get
// organisation_id forced to their own session org, regardless of what (if
// anything) the request body sends — a body-supplied organisation_id is
// never trusted for them. super_admin must explicitly select a target
// organisation, which is then verified to actually exist before the
// insert — not blindly trusted either, just deliberately allowed to
// differ from the caller's own org.
export async function POST(req: Request) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  let organisationId: string;
  if (session.role === 'super_admin') {
    const requested = typeof body.organisation_id === 'string' ? body.organisation_id.trim() : '';
    if (!requested) {
      return NextResponse.json({ error: 'organisation_id is required' }, { status: 400 });
    }
    const orgRows = await sql`SELECT id FROM organisations WHERE id = ${requested} LIMIT 1`;
    if (orgRows.length === 0) {
      return NextResponse.json({ error: 'organisation_id does not refer to an existing organisation' }, { status: 400 });
    }
    organisationId = requested;
  } else {
    // Non-super_admin: session org always wins, no matter what the body says.
    organisationId = session.organisationId;
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const serviceType = typeof body.service_type === 'string' && body.service_type.trim() ? body.service_type.trim().slice(0, 200) : null;

  // stage/health: default when omitted, but reject (not silently correct)
  // an explicitly-supplied invalid value — same rule the PATCH route below
  // enforces.
  if (body.stage !== undefined && (typeof body.stage !== 'string' || !VALID_STAGES.has(body.stage))) {
    return NextResponse.json({ error: 'Invalid stage' }, { status: 400 });
  }
  if (body.health !== undefined && (typeof body.health !== 'string' || !VALID_HEALTH.has(body.health))) {
    return NextResponse.json({ error: 'Invalid health' }, { status: 400 });
  }
  const stage = typeof body.stage === 'string' ? body.stage : 'planning';
  const health = typeof body.health === 'string' ? body.health : 'on_track';
  const targetLaunchDate = typeof body.target_launch_date === 'string' && body.target_launch_date ? body.target_launch_date : null;
  const actualLaunchDate = typeof body.actual_launch_date === 'string' && body.actual_launch_date ? body.actual_launch_date : null;
  const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 5000) : null;
  const nextAction = typeof body.next_action === 'string' ? body.next_action.trim().slice(0, 2000) : null;
  const sourceLeadId = typeof body.source_lead_id === 'string' && body.source_lead_id ? body.source_lead_id : null;
  const sourceProposalId = typeof body.source_proposal_id === 'string' && body.source_proposal_id ? body.source_proposal_id : null;

  // Owner must refer to a real, existing user. Deliberately NOT required to
  // belong to the implementation's own organisation: an implementation's
  // owner is the BrainBase delivery staff member responsible for the work
  // (per the product brief's own example, "Owner: James"), not a member of
  // the client organisation being delivered to. This mirrors the existing
  // repository precedent of crm_deals.assigned_to (a real FK to users(id)
  // with no organisation-match constraint) — the closest existing
  // "assignee/owner" pattern in the codebase.
  let ownerUserId: string | null = null;
  if (typeof body.owner_user_id === 'string' && body.owner_user_id.trim()) {
    const candidate = body.owner_user_id.trim();
    const ownerRows = await sql`SELECT id FROM users WHERE id = ${candidate} LIMIT 1`;
    if (ownerRows.length === 0) {
      return NextResponse.json({ error: 'owner_user_id does not refer to an existing user' }, { status: 400 });
    }
    ownerUserId = candidate;
  }

  try {
    const rows = await sql`
      INSERT INTO implementations (
        organisation_id, name, service_type, stage, health, owner_user_id,
        target_launch_date, actual_launch_date, summary, next_action,
        source_lead_id, source_proposal_id
      ) VALUES (
        ${organisationId}, ${name}, ${serviceType}, ${stage}, ${health}, ${ownerUserId},
        ${targetLaunchDate}, ${actualLaunchDate}, ${summary}, ${nextAction},
        ${sourceLeadId}, ${sourceProposalId}
      )
      RETURNING id, organisation_id, name, service_type, stage, health, owner_user_id,
        target_launch_date, actual_launch_date, summary, next_action,
        source_lead_id, source_proposal_id, created_at, updated_at
    `;
    return NextResponse.json({ implementation: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/implementations]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
