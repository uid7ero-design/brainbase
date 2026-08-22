import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

const VALID_STAGES = new Set([
  'planning', 'discovery', 'setup', 'build', 'client_review',
  'testing', 'ready_to_launch', 'live', 'on_hold', 'cancelled',
]);
const VALID_HEALTH = new Set(['on_track', 'at_risk', 'blocked']);

// GET one — scoped identically to the list route: non-super_admin callers
// only ever see a row that belongs to their own organisation. A row that
// exists but belongs to a different organisation returns 404, not 403 —
// this does not confirm to the caller whether the id exists at all, only
// that they can't see it, matching the general "don't leak existence of
// other tenants' records" principle already followed elsewhere in this
// codebase.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

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
      WHERE i.id = ${id}
      LIMIT 1
    `;
    const implementation = rows[0];
    if (!implementation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (session.role !== 'super_admin' && implementation.organisation_id !== session.organisationId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ implementation });
  } catch (err) {
    console.error('[GET /api/implementations/[id]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH — admin/super_admin only, same not-found-if-not-yours scoping as
// GET. organisation_id itself is intentionally not patchable here — moving
// an implementation to a different client is a deliberately unsupported
// operation in this first slice, not an oversight.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const existingRows = await sql`SELECT id, organisation_id FROM implementations WHERE id = ${id} LIMIT 1`;
  const existing = existingRows[0];
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (session.role !== 'super_admin' && existing.organisation_id !== session.organisationId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : undefined;
  if (name !== undefined && !name) {
    return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
  }
  const serviceType = typeof body.service_type === 'string' ? (body.service_type.trim().slice(0, 200) || null) : undefined;
  const stage = typeof body.stage === 'string' ? body.stage : undefined;
  if (stage !== undefined && !VALID_STAGES.has(stage)) {
    return NextResponse.json({ error: 'Invalid stage' }, { status: 400 });
  }
  const health = typeof body.health === 'string' ? body.health : undefined;
  if (health !== undefined && !VALID_HEALTH.has(health)) {
    return NextResponse.json({ error: 'Invalid health' }, { status: 400 });
  }
  const targetLaunchDate = typeof body.target_launch_date === 'string' ? (body.target_launch_date || null) : undefined;
  const actualLaunchDate = typeof body.actual_launch_date === 'string' ? (body.actual_launch_date || null) : undefined;
  const summary = typeof body.summary === 'string' ? (body.summary.trim().slice(0, 5000) || null) : undefined;
  const nextAction = typeof body.next_action === 'string' ? (body.next_action.trim().slice(0, 2000) || null) : undefined;

  let ownerUserId: string | null | undefined;
  if (body.owner_user_id === null) {
    ownerUserId = null; // explicit unassign
  } else if (typeof body.owner_user_id === 'string' && body.owner_user_id.trim()) {
    const candidate = body.owner_user_id.trim();
    const ownerRows = await sql`SELECT id FROM users WHERE id = ${candidate} LIMIT 1`;
    if (ownerRows.length === 0) {
      return NextResponse.json({ error: 'owner_user_id does not refer to an existing user' }, { status: 400 });
    }
    ownerUserId = candidate;
  }

  try {
    const rows = await sql`
      UPDATE implementations
      SET
        name                = CASE WHEN ${name !== undefined} THEN ${name ?? null} ELSE name END,
        service_type        = CASE WHEN ${serviceType !== undefined} THEN ${serviceType ?? null} ELSE service_type END,
        stage               = CASE WHEN ${stage !== undefined} THEN ${stage ?? null} ELSE stage END,
        health              = CASE WHEN ${health !== undefined} THEN ${health ?? null} ELSE health END,
        owner_user_id       = CASE WHEN ${ownerUserId !== undefined} THEN ${ownerUserId ?? null} ELSE owner_user_id END,
        target_launch_date  = CASE WHEN ${targetLaunchDate !== undefined} THEN ${targetLaunchDate ?? null} ELSE target_launch_date END,
        actual_launch_date  = CASE WHEN ${actualLaunchDate !== undefined} THEN ${actualLaunchDate ?? null} ELSE actual_launch_date END,
        summary             = CASE WHEN ${summary !== undefined} THEN ${summary ?? null} ELSE summary END,
        next_action         = CASE WHEN ${nextAction !== undefined} THEN ${nextAction ?? null} ELSE next_action END
      WHERE id = ${id}
      RETURNING id, organisation_id, name, service_type, stage, health, owner_user_id,
        target_launch_date, actual_launch_date, summary, next_action,
        source_lead_id, source_proposal_id, created_at, updated_at
    `;
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ implementation: rows[0] });
  } catch (err) {
    console.error('[PATCH /api/implementations/[id]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
