import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { canViewPerson } from '@/lib/hr/access';
import { projectPersonRow, type HrPersonRow } from '@/lib/hr/projectPerson';
import { logHrEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import {
  isValidWorkerType, isValidEmploymentStatus,
  isTeamInOrganisation, isPersonInOrganisation, isUserInOrganisation,
} from '@/lib/hr/validation';

// HR-1 — GET lists the people the caller may view (lib/hr/access.ts's
// canViewPerson(), applied per row), never the whole organisation
// unconditionally: an HR administrator sees everyone; anyone else sees
// only their own linked record (if any) and, if a future phase adds a
// direct-manager list index, their direct reports. HR-1 does not yet
// track "who manages whom" the other direction efficiently beyond a
// linear scan, which is fine at this phase's expected scale (a single
// organisation's people, not a platform-wide query).
export async function GET() {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireCapability(session.organisationId, 'people');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId });

  const rows = await sql`
    SELECT
      p.*,
      t.name AS team_name,
      m.first_name AS manager_first_name,
      m.last_name AS manager_last_name
    FROM hr_people p
    LEFT JOIN hr_teams t ON t.id = p.team_id
    LEFT JOIN hr_people m ON m.id = p.manager_person_id
    WHERE p.organisation_id = ${session.organisationId}
    ORDER BY p.first_name, p.last_name
  ` as HrPersonRow[];

  const visible = rows.filter(row =>
    canViewPerson(ctx, { organisationId: row.organisation_id, personId: row.id, managerPersonId: row.manager_person_id }),
  );

  const people = visible.map(row =>
    projectPersonRow(ctx, { organisationId: row.organisation_id, personId: row.id, managerPersonId: row.manager_person_id }, row),
  );

  // canManage is a task-oriented UX flag only ("may this viewer see
  // admin actions like Add Person"), not a general entitlement
  // disclosure — it carries no user id, no grant record, nothing about
  // HOW the caller became an HR administrator. Server-side enforcement
  // (POST /api/hr/people's own ctx.isHrAdministrator check) remains
  // authoritative regardless of what the client does with this value.
  return NextResponse.json({ people, canManage: ctx.isHrAdministrator });
}

// HR-1 — POST creates a new hr_people record. HR-administrator only:
// there is no "self" or "manager" creation path in lib/hr/access.ts's
// model (canEditPerson/canManageEmployment both require an EXISTING
// target), so creation is gated directly on ctx.isHrAdministrator,
// matching the HR-1 brief's own permission model exactly ("HR
// administrator: can... create People").
export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireCapability(session.organisationId, 'people');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId });
  if (!ctx.isHrAdministrator) return forbidden();

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : '';
  const lastName = typeof body.last_name === 'string' ? body.last_name.trim() : '';
  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'first_name and last_name are required.' }, { status: 400 });
  }

  const workerType = body.worker_type === undefined ? 'employee' : body.worker_type;
  if (!isValidWorkerType(workerType)) {
    return NextResponse.json({ error: 'Invalid worker_type.' }, { status: 400 });
  }
  const employmentStatus = body.employment_status === undefined ? 'active' : body.employment_status;
  if (!isValidEmploymentStatus(employmentStatus)) {
    return NextResponse.json({ error: 'Invalid employment_status.' }, { status: 400 });
  }

  const teamId = typeof body.team_id === 'string' && body.team_id ? body.team_id : null;
  if (teamId && !(await isTeamInOrganisation(teamId, session.organisationId))) {
    return NextResponse.json({ error: 'Invalid team.' }, { status: 400 });
  }

  const managerPersonId = typeof body.manager_person_id === 'string' && body.manager_person_id ? body.manager_person_id : null;
  if (managerPersonId && !(await isPersonInOrganisation(managerPersonId, session.organisationId))) {
    return NextResponse.json({ error: 'Invalid manager.' }, { status: 400 });
  }

  // Explicit-link only — never inferred by email/name/phone (HR-0's
  // Critical Domain Rule). A caller who supplies linked_user_id is
  // asserting a deliberate, specific link; validated for existence AND
  // organisation match before use.
  const linkedUserId = typeof body.linked_user_id === 'string' && body.linked_user_id ? body.linked_user_id : null;
  if (linkedUserId && !(await isUserInOrganisation(linkedUserId, session.organisationId))) {
    return NextResponse.json({ error: 'Invalid linked user.' }, { status: 400 });
  }

  const preferredName = typeof body.preferred_name === 'string' ? body.preferred_name.trim() || null : null;
  const workEmail = typeof body.work_email === 'string' ? body.work_email.trim() || null : null;
  const workPhone = typeof body.work_phone === 'string' ? body.work_phone.trim() || null : null;
  const jobTitle = typeof body.job_title === 'string' ? body.job_title.trim() || null : null;
  const startDate = typeof body.start_date === 'string' ? body.start_date : null;

  let rows;
  try {
    rows = await sql`
      INSERT INTO hr_people (
        organisation_id, linked_user_id, first_name, last_name, preferred_name,
        work_email, work_phone, job_title, worker_type, employment_status,
        team_id, manager_person_id, start_date
      ) VALUES (
        ${session.organisationId}, ${linkedUserId}, ${firstName}, ${lastName}, ${preferredName},
        ${workEmail}, ${workPhone}, ${jobTitle}, ${workerType}, ${employmentStatus},
        ${teamId}, ${managerPersonId}, ${startDate}::date
      )
      RETURNING *
    `;
  } catch (err) {
    console.error('[hr/people POST] insert failed', err);
    return NextResponse.json({ error: 'Could not create person.' }, { status: 500 });
  }

  const created = rows[0] as HrPersonRow;

  {
    const { ipAddress, userAgent } = extractRequestMeta(req);
    await logHrEvent(
      { organisationId: session.organisationId, userId: session.userId, ipAddress, userAgent },
      {
        action: 'hr_person.created',
        resourceType: 'hr_person',
        resourceId: created.id,
        afterState: {
          first_name: created.first_name,
          last_name: created.last_name,
          worker_type: created.worker_type,
          employment_status: created.employment_status,
          team_id: created.team_id,
          manager_person_id: created.manager_person_id,
          linked_user_id: created.linked_user_id,
        },
      },
    );
  }

  // The creator is an HR administrator — project as such (full
  // internal + confidential visibility of the record just created).
  const target = { organisationId: created.organisation_id, personId: created.id, managerPersonId: created.manager_person_id };
  return NextResponse.json({ person: projectPersonRow(ctx, target, created) }, { status: 201 });
}
