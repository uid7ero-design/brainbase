import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { canManageHrAccess } from '@/lib/hr/access';
import { logHrEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { isActiveUserInOrganisation } from '@/lib/hr/validation';

// HR-1 — explicit HR-administrator entitlement management. Deliberately
// NOT part of the People directory UI (no dedicated settings page is
// built in this phase; see the HR-1 report's own note) — this exists so
// the entitlement lib/hr/access.ts's isHrAdministrator depends on can
// actually be granted, including the genuine bootstrap case: a
// newly-enabled organisation has ZERO hr_administrators rows, so
// canManageHrAccess() (== ctx.isHrAdministrator) is false for every one
// of its users until someone grants the first one.
//
// HR-2 — canManageHrAccess(ctx) alone is now sufficient for a
// super_admin caller: lib/hr/context.ts's resolveHrAccessContext()
// resolves isHrAdministrator: true for role === 'super_admin'
// unconditionally (no hr_administrators row needed), so
// canManageHrAccess(ctx) (== ctx.isHrAdministrator) is already true for
// super_admin by the time it reaches this check. The route-level
// bootstrap special-case this file used to carry (`isBootstrapSuperAdmin`)
// is gone — it's fully subsumed by the central context resolution, not
// duplicated here. Bootstrapping a brand-new organisation's first HR
// administrator still works exactly as before: a super_admin can always
// grant/revoke, with zero existing hr_administrators rows required.
//
// HR Administrator Management UI — GET added so the settings page this
// file's own header comment always said was deferred ("no dedicated
// settings page is built in this phase") can finally list who
// currently holds the grant, and offer a same-org candidate pool to
// grant it to next. Gated identically to POST/DELETE
// (canManageHrAccess(ctx) — HR administrator or super_admin only, no
// route-local role check): listing WHO the HR administrators are is
// itself sensitive organisational metadata, not a general-read action.
// Response is one minimal, deliberately narrow allowlist — id, name,
// email, and the domain-specific is_hr_administrator boolean (computed
// via a same-organisation LEFT JOIN against hr_administrators, never a
// second round trip) — mirroring GET /api/hr/linkable-users's own
// shape exactly. Never role, status, password/password_hash, tokens,
// or any other organisation's rows. No email/name matching of any
// kind: the boolean is a plain per-row existence check against this
// caller's own already-resolved organisation_id, not an identity
// inference.
export async function GET() {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId, role: session.role });
  if (!canManageHrAccess(ctx)) return forbidden();

  const rows = await sql`
    SELECT
      u.id,
      u.name,
      u.email,
      u.status,
      (ha.id IS NOT NULL) AS is_hr_administrator
    FROM users u
    LEFT JOIN hr_administrators ha ON ha.user_id = u.id AND ha.organisation_id = u.organisation_id
    WHERE u.organisation_id = ${session.organisationId}
      AND (u.status = 'ACTIVE' OR ha.id IS NOT NULL)
    ORDER BY u.name
  `;

  const users = rows.map(row => ({
    id: row.id as string,
    name: row.name as string,
    email: (row.email as string | null) ?? null,
    is_hr_administrator: Boolean(row.is_hr_administrator),
    grant_eligible: row.status === 'ACTIVE',
  }));

  return NextResponse.json({ users });
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
  if (!canManageHrAccess(ctx)) return forbidden();

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  if (!userId) return NextResponse.json({ error: 'user_id is required.' }, { status: 400 });
  if (!(await isActiveUserInOrganisation(userId, session.organisationId))) {
    return NextResponse.json(
      {
        error: 'User is not eligible for HR administrator access.',
        code: 'hr_admin_user_not_eligible',
      },
      { status: 400 },
    );
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
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId, role: session.role });
  if (!canManageHrAccess(ctx)) return forbidden();

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
