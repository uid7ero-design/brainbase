import 'server-only';
import { getSession, type SessionPayload, type Role } from './session';
import sql from './db';

export type OrgSession = {
  userId: string;
  organisationId: string;
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
    SELECT id, organisation_id, role, email_verified, email
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

  return {
    userId: session.userId,
    organisationId: user.organisation_id as string,
    role: user.role as Role,
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
