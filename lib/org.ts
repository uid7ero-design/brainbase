import 'server-only';
import { cookies } from 'next/headers';
import { getSession, type SessionPayload, type Role } from './session';
import sql from './db';

export type OrgSession = {
  userId: string;
  organisationId: string;
  // The caller's TRUE, un-overridden organisation (their own row in
  // `users`) — identical to organisationId for every non-super_admin
  // session, and for a super_admin session with no active org_override.
  // Diverges from organisationId ONLY while a super_admin is actively
  // impersonating another organisation via the org_override cookie
  // (see below): organisationId becomes the impersonated org (so every
  // existing tenant-scoped query keeps working unchanged while
  // impersonating), while homeOrganisationId stays the founder's own
  // real workspace. Exists specifically so "my own workspace" can be
  // identified correctly regardless of what's currently being
  // impersonated — see app/clients/page.tsx's own use of this field for
  // the bug this was introduced to fix (a founder mid-impersonation of
  // another org saw THAT org, not their own, excluded from /clients).
  homeOrganisationId: string;
  role: Role;
  name: string;
};

// Role order — higher index = more privilege
const ROLE_ORDER: Role[] = ['viewer', 'manager', 'admin', 'super_admin'];

export function roleGte(role: Role, min: Role): boolean {
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(min);
}

/**
 * Resolves the session, re-validates the user against the DB, and returns
 * current role + organisationId from the database (not the JWT).
 *
 * This ensures that:
 *   - If a user is reassigned to a different org, their old session is rejected.
 *   - If a user is deleted, their session is rejected.
 *   - Role changes take effect immediately without requiring re-login.
 *
 * Throws 'Unauthorized' on missing/invalid session.
 * Throws 'Session invalid' if the user no longer exists or was moved to a
 * different organisation (cross-org switch protection).
 */
export async function requireSession(): Promise<OrgSession> {
  const session = await getSession();
  if (!session?.organisationId) throw new Error('Unauthorized');

  const rows = await sql`
    SELECT id, organisation_id, role
    FROM users
    WHERE id = ${session.userId}
    LIMIT 1
  `;
  const user = rows[0];

  if (!user) throw new Error('Unauthorized');

  // Cross-org switch protection: if the DB org no longer matches the session,
  // the JWT was issued under a previous org assignment — reject it.
  if ((user.organisation_id as string) !== session.organisationId) {
    throw new Error('Session invalid');
  }

  const role = (user.role as string).toLowerCase() as Role;

  const homeOrganisationId = user.organisation_id as string;
  let organisationId = homeOrganisationId;
  if (role === 'super_admin') {
    const jar = await cookies();
    const override = jar.get('org_override')?.value;
    if (override) organisationId = override;
  }

  return {
    userId: session.userId,
    organisationId,
    homeOrganisationId,
    role,
    name: session.name,
  };
}

/**
 * Like requireSession() but also enforces a minimum role.
 * Throws 'Forbidden' if the user's role is below the minimum.
 */
export async function requireRole(min: Role): Promise<OrgSession> {
  const s = await requireSession();
  if (!roleGte(s.role, min)) throw new Error('Forbidden');
  return s;
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}
