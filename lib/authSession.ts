import 'server-only';
import { getSession } from './session';
import sql from './db';

export type AuthSession = {
  userId: string;
  organisationId: string;
  role: string;
  name: string;
  email: string;
};

/**
 * Canonical session resolver — always DB-authoritative.
 * Both upload and chat must call this so organisationId is identical.
 * Throws 'Unauthorized' if no session or user not found.
 * Throws 'Session invalid' if the JWT org no longer matches the DB (cross-org protection).
 */
export async function getAuthSession(): Promise<AuthSession> {
  const jwt = await getSession();
  if (!jwt?.userId) throw new Error('Unauthorized');

  const rows = await sql`
    SELECT id, organisation_id, role, name, email
    FROM users WHERE id = ${jwt.userId} LIMIT 1
  `;
  const user = rows[0];
  if (!user) throw new Error('Unauthorized');

  if ((user.organisation_id as string) !== jwt.organisationId) {
    throw new Error('Session invalid — organisation mismatch');
  }

  return {
    userId:         jwt.userId,
    organisationId: user.organisation_id as string,
    role:           user.role as string,
    name:           user.name as string,
    email:          user.email as string,
  };
}
