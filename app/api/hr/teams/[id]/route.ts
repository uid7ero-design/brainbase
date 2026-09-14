import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { logHrEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { isPersonInOrganisation } from '@/lib/hr/validation';

type HrTeamRow = {
  id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  manager_person_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

async function loadTeam(id: string, organisationId: string): Promise<HrTeamRow | null> {
  // organisation_id is part of the WHERE clause, not applied after the
  // fact — a valid team id from a DIFFERENT organisation returns zero
  // rows, indistinguishable from a non-existent id (same discipline as
  // app/api/hr/people/[id]/route.ts's own loadPerson()).
  const rows = await sql`
    SELECT id, organisation_id, name, description, manager_person_id, archived_at, created_at, updated_at
    FROM hr_teams
    WHERE id = ${id}::uuid AND organisation_id = ${organisationId}
    LIMIT 1
  ` as HrTeamRow[];
  return rows[0] ?? null;
}

const ALLOWED_FIELDS = ['name', 'description', 'manager_person_id'] as const;

// HR-2 Step 1B — PATCH allows editing an ACTIVE team's name/description/
// manager only. An archived team is frozen: any PATCH against it is
// rejected with 409 team_archived — to edit an archived team's fields,
// restore it first (POST .../restore), edit, then optionally archive
// again. This avoids silently rewriting organisational structure that
// looks retired.
//
// Uses the exact same actual-change discipline PR #212 established for
// app/api/hr/people/[id]/route.ts's own PATCH: validate the requested
// fields, build `updates`, diff against the real DB row, and
// short-circuit to a true no-op (no UPDATE, no updated_at bump, no
// audit event) when nothing actually changed.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId, role: session.role });
  if (!ctx.isHrAdministrator) return forbidden();

  const existing = await loadTeam(id, session.organisationId);
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  if (existing.archived_at !== null) {
    return NextResponse.json({ error: 'Team is archived.', code: 'team_archived' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const unknownField = Object.keys(body).find(f => !(ALLOWED_FIELDS as readonly string[]).includes(f));
  if (unknownField) return NextResponse.json({ error: `Unknown or unsupported field: ${unknownField}` }, { status: 400 });

  const updates: Record<string, unknown> = {};

  if ('name' in body) {
    const v = typeof body.name === 'string' ? body.name.trim() : '';
    if (!v) return NextResponse.json({ error: 'name is required.' }, { status: 400 });
    updates.name = v;
  }
  if ('description' in body) {
    updates.description = typeof body.description === 'string' ? body.description.trim() || null : null;
  }
  if ('manager_person_id' in body) {
    const managerPersonId = typeof body.manager_person_id === 'string' && body.manager_person_id ? body.manager_person_id : null;
    if (managerPersonId && !(await isPersonInOrganisation(managerPersonId, session.organisationId))) {
      return NextResponse.json({ error: 'Invalid manager.' }, { status: 400 });
    }
    updates.manager_person_id = managerPersonId;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided.' }, { status: 400 });
  }

  // Actual-change detection (PR #212 pattern) — `updates` (validated
  // above) is compared directly against `existing`'s real DB values, so
  // a caller resubmitting a team's current, unchanged values triggers
  // neither a write nor an audit event.
  const changedFields = Object.keys(updates).filter(
    key => (existing as unknown as Record<string, unknown>)[key] !== (updates as Record<string, unknown>)[key],
  );

  if (changedFields.length === 0) {
    return NextResponse.json({ team: existing });
  }

  let rows;
  try {
    rows = await sql`
      UPDATE hr_teams SET
        name               = COALESCE(${(updates.name as string) ?? null}, name),
        description        = CASE WHEN ${'description' in updates} THEN ${(updates.description as string | null) ?? null} ELSE description END,
        manager_person_id  = CASE WHEN ${'manager_person_id' in updates} THEN ${(updates.manager_person_id as string | null) ?? null}::uuid ELSE manager_person_id END,
        updated_at         = NOW()
      WHERE id = ${existing.id}::uuid AND organisation_id = ${session.organisationId}
      RETURNING id, organisation_id, name, description, manager_person_id, archived_at, created_at, updated_at
    `;
  } catch (err) {
    console.error('[hr/teams/[id] PATCH] update failed', err);
    return NextResponse.json({ error: 'Could not update team.' }, { status: 500 });
  }

  const updated = rows[0] as HrTeamRow;

  {
    const { ipAddress, userAgent } = extractRequestMeta(req);
    const beforeState: Record<string, unknown> = {};
    const afterState: Record<string, unknown> = {};
    for (const key of changedFields) {
      beforeState[key] = (existing as unknown as Record<string, unknown>)[key];
      afterState[key] = (updated as unknown as Record<string, unknown>)[key];
    }
    await logHrEvent(
      { organisationId: session.organisationId, userId: session.userId, ipAddress, userAgent },
      { action: 'hr_team.updated', resourceType: 'hr_team', resourceId: updated.id, beforeState, afterState },
    );
  }

  return NextResponse.json({ team: updated });
}
