import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { canManageHrAccess } from '@/lib/hr/access';
import { logHrEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { isUserInOrganisation } from '@/lib/hr/validation';

// HR-1 — explicit HR-administrator entitlement management. Deliberately
// NOT part of the People directory UI (no dedicated settings page is
// built in this phase; see the HR-1 report's own note) — this exists so
// the entitlement lib/hr/access.ts's isHrAdministrator depends on can
// actually be granted, including the genuine bootstrap case: a
// newly-enabled organisation has ZERO hr_administrators rows, so
// canManageHrAccess() (== ctx.isHrAdministrator) is false for every one
// of its users until someone grants the first one.
//
// Two, and only two, callers may use this endpoint:
//   1. An existing HR administrator (canManageHrAccess(ctx)) — the
//      steady-state path, matching lib/hr/access.ts's own model
//      exactly.
//   2. A platform super_admin (requireRole('super_admin')) — explicit
//      bootstrap/support handling ONLY for this one endpoint. This does
//      NOT make super_admin an HR administrator anywhere else: no
//      function in lib/hr/access.ts, and no other HR-1 route, ever
//      checks session.role — canManageHrAccess/canViewPerson/
//      canEditPerson/canManageEmployment remain governed exclusively by
//      the hr_administrators/hr_people rows resolved in
//      lib/hr/context.ts. A super_admin using this endpoint is
//      performing a distinct, platform-level administrative action
//      (comparable to enabling a module for an organisation), not
//      exercising an implicit HR grant.
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
  const isBootstrapSuperAdmin = session.role === 'super_admin';
  if (!canManageHrAccess(ctx) && !isBootstrapSuperAdmin) return forbidden();

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  if (!userId) return NextResponse.json({ error: 'user_id is required.' }, { status: 400 });
  if (!(await isUserInOrganisation(userId, session.organisationId))) {
    return NextResponse.json({ error: 'Invalid user.' }, { status: 400 });
  }

  let rows;
  try {
    rows = await sql`
      INSERT INTO hr_administrators (organisation_id, user_id, created_by)
      VALUES (${session.organisationId}, ${userId}, ${session.userId})
      ON CONFLICT (organisation_id, user_id) DO NOTHING
      RETURNING *
    `;
  } catch (err) {
    console.error('[hr/administrators POST] insert failed', err);
    return NextResponse.json({ error: 'Could not grant HR administrator access.' }, { status: 500 });
  }

  if (rows.length > 0) {
    const { ipAddress, userAgent } = extractRequestMeta(req);
    await logHrEvent(
      { organisationId: session.organisationId, userId: session.userId, ipAddress, userAgent },
      { action: 'hr_administrator.granted', resourceType: 'hr_administrator', resourceId: userId, afterState: { user_id: userId } },
    );
  }

  return NextResponse.json({ granted: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireCapability(session.organisationId, 'people');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId });
  const isBootstrapSuperAdmin = session.role === 'super_admin';
  if (!canManageHrAccess(ctx) && !isBootstrapSuperAdmin) return forbidden();

  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId is required.' }, { status: 400 });

  const rows = await sql`
    DELETE FROM hr_administrators
    WHERE organisation_id = ${session.organisationId} AND user_id = ${userId}
    RETURNING id
  `;

  if (rows.length > 0) {
    const { ipAddress, userAgent } = extractRequestMeta(req);
    await logHrEvent(
      { organisationId: session.organisationId, userId: session.userId, ipAddress, userAgent },
      { action: 'hr_administrator.revoked', resourceType: 'hr_administrator', resourceId: userId, beforeState: { user_id: userId } },
    );
  }

  return NextResponse.json({ revoked: true });
}
