import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { canViewPerson, canEditPerson, canManageEmployment } from '@/lib/hr/access';
import { projectPersonRow, type HrPersonRow } from '@/lib/hr/projectPerson';
import { logHrEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import {
  isValidWorkerType, isValidEmploymentStatus,
  isTeamInOrganisation, isPersonInOrganisation, isUserInOrganisation,
} from '@/lib/hr/validation';

async function loadPerson(id: string, organisationId: string): Promise<HrPersonRow | null> {
  // organisation_id is part of the WHERE clause, not applied after the
  // fact — a valid person id from a DIFFERENT organisation returns zero
  // rows here, indistinguishable from a non-existent id. Cross-tenant
  // access fails even when the id itself is a real, guessed row from
  // another organisation.
  const rows = await sql`
    SELECT
      p.*,
      t.name AS team_name,
      m.first_name AS manager_first_name,
      m.last_name AS manager_last_name
    FROM hr_people p
    LEFT JOIN hr_teams t ON t.id = p.team_id
    LEFT JOIN hr_people m ON m.id = p.manager_person_id
    WHERE p.id = ${id}::uuid AND p.organisation_id = ${organisationId}
    LIMIT 1
  ` as HrPersonRow[];
  return rows[0] ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireCapability(session.organisationId, 'people');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const person = await loadPerson(id, session.organisationId);
  if (!person) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId });
  const target = { organisationId: person.organisation_id, personId: person.id, managerPersonId: person.manager_person_id };
  if (!canViewPerson(ctx, target)) return forbidden();

  return NextResponse.json({ person: projectPersonRow(ctx, target, person) });
}

// HR-1 — field-group-aware PATCH: identity/personal fields follow
// canEditPerson() (self or HR administrator); employment fields
// (job_title, worker_type, employment_status, team_id,
// manager_person_id, start_date, end_date) follow canManageEmployment()
// (HR administrator only, never self-service, matching the brief's own
// "employment-status/manager/team changes — HR-administrator only");
// linked_user_id changes require ctx.isHrAdministrator directly (no
// dedicated access.ts function exists for it — linking must always be
// an explicit, deliberate HR-administrator action per HR-0's Critical
// Domain Rule, never inferred and never self-service). If the caller
// supplies ANY field they are not permitted to change, the WHOLE
// request is rejected (403) rather than silently dropping fields — a
// partially-applied PATCH would be a confusing, hard-to-audit outcome.
const IDENTITY_FIELDS = ['first_name', 'last_name', 'preferred_name', 'work_email', 'work_phone'] as const;
const EMPLOYMENT_FIELDS = ['job_title', 'worker_type', 'employment_status', 'team_id', 'manager_person_id', 'start_date', 'end_date'] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireCapability(session.organisationId, 'people');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const existing = await loadPerson(id, session.organisationId);
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId });
  const target = { organisationId: existing.organisation_id, personId: existing.id, managerPersonId: existing.manager_person_id };

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const providedFields = Object.keys(body);

  const wantsIdentityChange = providedFields.some(f => (IDENTITY_FIELDS as readonly string[]).includes(f));
  const wantsEmploymentChange = providedFields.some(f => (EMPLOYMENT_FIELDS as readonly string[]).includes(f));
  const wantsLinkChange = providedFields.includes('linked_user_id');

  if (wantsIdentityChange && !canEditPerson(ctx, target)) return forbidden();
  if (wantsEmploymentChange && !canManageEmployment(ctx, target)) return forbidden();
  if (wantsLinkChange && !ctx.isHrAdministrator) return forbidden();

  const unknownField = providedFields.find(f =>
    !(IDENTITY_FIELDS as readonly string[]).includes(f) && !(EMPLOYMENT_FIELDS as readonly string[]).includes(f) && f !== 'linked_user_id',
  );
  if (unknownField) return NextResponse.json({ error: `Unknown or unsupported field: ${unknownField}` }, { status: 400 });

  const updates: Record<string, unknown> = {};

  if ('first_name' in body) {
    const v = typeof body.first_name === 'string' ? body.first_name.trim() : '';
    if (!v) return NextResponse.json({ error: 'first_name cannot be empty.' }, { status: 400 });
    updates.first_name = v;
  }
  if ('last_name' in body) {
    const v = typeof body.last_name === 'string' ? body.last_name.trim() : '';
    if (!v) return NextResponse.json({ error: 'last_name cannot be empty.' }, { status: 400 });
    updates.last_name = v;
  }
  if ('preferred_name' in body) updates.preferred_name = typeof body.preferred_name === 'string' ? body.preferred_name.trim() || null : null;
  if ('work_email' in body) updates.work_email = typeof body.work_email === 'string' ? body.work_email.trim() || null : null;
  if ('work_phone' in body) updates.work_phone = typeof body.work_phone === 'string' ? body.work_phone.trim() || null : null;
  if ('job_title' in body) updates.job_title = typeof body.job_title === 'string' ? body.job_title.trim() || null : null;

  if ('worker_type' in body) {
    if (!isValidWorkerType(body.worker_type)) return NextResponse.json({ error: 'Invalid worker_type.' }, { status: 400 });
    updates.worker_type = body.worker_type;
  }
  if ('employment_status' in body) {
    if (!isValidEmploymentStatus(body.employment_status)) return NextResponse.json({ error: 'Invalid employment_status.' }, { status: 400 });
    updates.employment_status = body.employment_status;
  }

  if ('team_id' in body) {
    const teamId = typeof body.team_id === 'string' && body.team_id ? body.team_id : null;
    if (teamId && !(await isTeamInOrganisation(teamId, session.organisationId))) {
      return NextResponse.json({ error: 'Invalid team.' }, { status: 400 });
    }
    updates.team_id = teamId;
  }

  if ('manager_person_id' in body) {
    const managerPersonId = typeof body.manager_person_id === 'string' && body.manager_person_id ? body.manager_person_id : null;
    if (managerPersonId === existing.id) {
      return NextResponse.json({ error: 'A person cannot manage themselves.' }, { status: 400 });
    }
    if (managerPersonId && !(await isPersonInOrganisation(managerPersonId, session.organisationId))) {
      return NextResponse.json({ error: 'Invalid manager.' }, { status: 400 });
    }
    updates.manager_person_id = managerPersonId;
  }

  if ('start_date' in body) updates.start_date = typeof body.start_date === 'string' ? body.start_date : null;
  if ('end_date' in body) updates.end_date = typeof body.end_date === 'string' ? body.end_date : null;

  if ('linked_user_id' in body) {
    const linkedUserId = typeof body.linked_user_id === 'string' && body.linked_user_id ? body.linked_user_id : null;
    if (linkedUserId && !(await isUserInOrganisation(linkedUserId, session.organisationId))) {
      return NextResponse.json({ error: 'Invalid linked user.' }, { status: 400 });
    }
    updates.linked_user_id = linkedUserId;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided.' }, { status: 400 });
  }

  let rows;
  try {
    rows = await sql`
      UPDATE hr_people SET
        first_name         = COALESCE(${(updates.first_name as string) ?? null}, first_name),
        last_name          = COALESCE(${(updates.last_name as string) ?? null}, last_name),
        preferred_name     = CASE WHEN ${'preferred_name' in updates} THEN ${(updates.preferred_name as string | null) ?? null} ELSE preferred_name END,
        work_email         = CASE WHEN ${'work_email' in updates} THEN ${(updates.work_email as string | null) ?? null} ELSE work_email END,
        work_phone         = CASE WHEN ${'work_phone' in updates} THEN ${(updates.work_phone as string | null) ?? null} ELSE work_phone END,
        job_title          = CASE WHEN ${'job_title' in updates} THEN ${(updates.job_title as string | null) ?? null} ELSE job_title END,
        worker_type        = COALESCE(${(updates.worker_type as string) ?? null}, worker_type),
        employment_status  = COALESCE(${(updates.employment_status as string) ?? null}, employment_status),
        team_id            = CASE WHEN ${'team_id' in updates} THEN ${(updates.team_id as string | null) ?? null}::uuid ELSE team_id END,
        manager_person_id  = CASE WHEN ${'manager_person_id' in updates} THEN ${(updates.manager_person_id as string | null) ?? null}::uuid ELSE manager_person_id END,
        start_date         = CASE WHEN ${'start_date' in updates} THEN ${(updates.start_date as string | null) ?? null}::date ELSE start_date END,
        end_date           = CASE WHEN ${'end_date' in updates} THEN ${(updates.end_date as string | null) ?? null}::date ELSE end_date END,
        linked_user_id     = CASE WHEN ${'linked_user_id' in updates} THEN ${(updates.linked_user_id as string | null) ?? null} ELSE linked_user_id END,
        updated_at         = NOW()
      WHERE id = ${existing.id}::uuid AND organisation_id = ${session.organisationId}
      RETURNING *
    `;
  } catch (err) {
    console.error('[hr/people PATCH] update failed', err);
    return NextResponse.json({ error: 'Could not update person.' }, { status: 500 });
  }

  const updated = rows[0] as HrPersonRow;
  const updatedTarget = { organisationId: updated.organisation_id, personId: updated.id, managerPersonId: updated.manager_person_id };

  {
    const { ipAddress, userAgent } = extractRequestMeta(req);
    const beforeState: Record<string, unknown> = {};
    const afterState: Record<string, unknown> = {};
    for (const key of Object.keys(updates)) {
      beforeState[key] = (existing as unknown as Record<string, unknown>)[key];
      afterState[key] = (updated as unknown as Record<string, unknown>)[key];
    }
    const action = wantsEmploymentChange && !wantsIdentityChange && !wantsLinkChange
      ? 'hr_person.employment_status_changed'
      : wantsLinkChange
        ? 'hr_person.linked_user_changed'
        : 'hr_person.updated';

    await logHrEvent(
      { organisationId: session.organisationId, userId: session.userId, ipAddress, userAgent },
      { action, resourceType: 'hr_person', resourceId: updated.id, beforeState, afterState },
    );
  }

  return NextResponse.json({ person: projectPersonRow(ctx, updatedTarget, updated) });
}
