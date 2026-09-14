import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { logHrEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { isPersonInOrganisation } from '@/lib/hr/validation';

// HR-1 — team names are organisation structure, not sensitive HR data
// (there is no 'team' entry in lib/hr/personFieldTiers.ts's tiers
// because team_id/team_name are not hr_people fields at all). GET is
// therefore gated on the People module capability alone, matching the
// HR-1 brief's own directory requirement ("team name in directory")
// for every viewer of the directory, not HR administrators only.
// Creating/renaming a team is a structural change, HR-administrator
// only.
//
// HR-2 Step 1B — archived teams. Default GET behavior (no query param)
// is UNCHANGED for every caller: organisation-scoped, active
// (archived_at IS NULL) teams only — this is deliberately what
// PersonForm's own unfiltered `fetch('/api/hr/teams')` already relies
// on, so archived teams stop appearing in the person-edit team
// dropdown with zero client-side change. ?include_archived=1 additionally
// requires the caller to be HR management authority (ctx.isHrAdministrator
// — already true for both a real HR-administrator grant and, via HR-2
// Step 1A's central resolveHrAccessContext(), super_admin) — an
// ordinary module-entitled user (manager, linked user) may still list
// team names as before, but may not enumerate archived ones. Matches
// the exact `include_archived=1` query-param convention already used
// by app/api/dashboard/sessions/route.ts for the identical archived_at
// pattern.
export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const includeArchived = new URL(req.url).searchParams.get('include_archived') === '1';

  if (includeArchived) {
    const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId, role: session.role });
    if (!ctx.isHrAdministrator) return forbidden();
  }

  const teams = await sql`
    SELECT id, organisation_id, name, description, manager_person_id, archived_at, created_at, updated_at
    FROM hr_teams
    WHERE organisation_id = ${session.organisationId}
      AND (${includeArchived} OR archived_at IS NULL)
    ORDER BY name
  `;

  return NextResponse.json({ teams });
}

export async function POST(req: NextRequest) {
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

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 });

  const description = typeof body.description === 'string' ? body.description.trim() || null : null;

  const managerPersonId = typeof body.manager_person_id === 'string' && body.manager_person_id ? body.manager_person_id : null;
  if (managerPersonId && !(await isPersonInOrganisation(managerPersonId, session.organisationId))) {
    return NextResponse.json({ error: 'Invalid manager.' }, { status: 400 });
  }

  let rows;
  try {
    rows = await sql`
      INSERT INTO hr_teams (organisation_id, name, description, manager_person_id)
      VALUES (${session.organisationId}, ${name}, ${description}, ${managerPersonId}::uuid)
      RETURNING *
    `;
  } catch (err) {
    console.error('[hr/teams POST] insert failed', err);
    return NextResponse.json({ error: 'Could not create team.' }, { status: 500 });
  }

  const created = rows[0];

  {
    const { ipAddress, userAgent } = extractRequestMeta(req);
    await logHrEvent(
      { organisationId: session.organisationId, userId: session.userId, ipAddress, userAgent },
      {
        action: 'hr_team.created',
        resourceType: 'hr_team',
        resourceId: created.id as string,
        afterState: { name: created.name, manager_person_id: created.manager_person_id },
      },
    );
  }

  return NextResponse.json({ team: created }, { status: 201 });
}
