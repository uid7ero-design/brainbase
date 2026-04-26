import 'server-only';
import { getSession, type SessionPayload, type Role } from './session';

export type OrgSession = {
  userId: string;
  organisationId: string;
  role: Role;
  name: string;
};

/**
 * Resolves the session and enforces that an organisationId is present.
 * Throws a 401-flavoured Error on missing/invalid session so callers can
 * catch and return NextResponse.json({ error }, { status: 401 }).
 */
export async function requireSession(): Promise<OrgSession> {
  const session = await getSession();
  if (!session || !session.organisationId) {
    throw new Error('Unauthorized');
  }
  return {
    userId: session.userId,
    organisationId: session.organisationId,
    role: session.role,
    name: session.name,
  };
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
