import 'server-only';
import { getAuthSession, type AuthSession } from '@/lib/authSession';
import { roleGte } from '@/lib/org';
import type { Role } from '@/lib/session';

/**
 * Gmail, Google Calendar, and Spotify integrations currently store a single
 * set of tokens per service in a global file (see lib/gmail/tokens.ts,
 * lib/gcal/tokens.ts, lib/spotify/tokens.ts) — there is no per-organisation
 * partition. This is TEMPORARY containment, not the final architecture:
 * until token storage becomes organisation-scoped, access to these globally
 * shared connections is restricted to super_admin, or to a single explicitly
 * configured "owner organisation" (via the env var named by ownerOrgEnvVar).
 * If that env var is not set, access fails closed for everyone except
 * super_admin — an unconfigured owner org is never treated as "allow all".
 */
export class IntegrationAccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function requireGlobalIntegrationAccess(
  ownerOrgEnvVar: string,
  minRole: Role = 'viewer',
): Promise<AuthSession> {
  let session: AuthSession;
  try {
    session = await getAuthSession();
  } catch {
    throw new IntegrationAccessError('Unauthorized', 401);
  }

  if (session.role === 'super_admin') return session;

  const ownerOrgId = process.env[ownerOrgEnvVar];
  if (!ownerOrgId) {
    throw new IntegrationAccessError('Forbidden', 403);
  }
  if (session.organisationId !== ownerOrgId) {
    throw new IntegrationAccessError('Forbidden', 403);
  }
  if (!roleGte(session.role as Role, minRole)) {
    throw new IntegrationAccessError('Forbidden', 403);
  }

  return session;
}

export function integrationAccessErrorStatus(err: unknown): number {
  return err instanceof IntegrationAccessError ? err.status : 401;
}
