import 'server-only';
import sql from '@/lib/db';
import { roleGte, type Role } from '@/lib/session';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { checkTicketingGate, TICKETING_SESSION_HEADER } from './gate';
import { verifyTicketingSession } from './session';

export type TicketingContext = {
  userId: string;
  organisationId: string;
  homeOrganisationId: string;
  role: Role;
  name: string;
};

export type TicketingAuthResult =
  | { ok: true; context: TicketingContext }
  | { ok: false; response: Response };

const NO_STORE = { 'Cache-Control': 'no-store' };
const unauthorized = () => Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
const forbidden = () => Response.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
const unavailable = () =>
  Response.json({ error: 'Unable to verify access.' }, { status: 503, headers: NO_STORE });

// Reloads everything authoritative from the database on every call; the token
// contributes only (userId, organisationId) as a pointer. Fails closed.
//   1. server-to-server gate (secret, no browser origin)
//   2. Eve session token (own secret, issuer, audience, expiry)
//   3. user exists and is ACTIVE (strict — missing status denies)
//   4. tenant relationship: non-super_admin must still belong to the token's
//      organisation; super_admin may act in any organisation that passes 5
//   5. organisation exists and is ACTIVE, and holds the 'events' capability
//   6. current DB role meets the minimum
export async function authorizeTicketingApiRequest(
  req: Request,
  minRole: Role,
): Promise<TicketingAuthResult> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate;

  const claims = await verifyTicketingSession(req.headers.get(TICKETING_SESSION_HEADER));
  if (!claims) return { ok: false, response: unauthorized() };

  let user: Record<string, unknown> | undefined;
  let org: Record<string, unknown> | undefined;
  try {
    user = (await sql`
      SELECT id, organisation_id, role, status, name FROM users WHERE id = ${claims.userId} LIMIT 1
    `)[0];
    if (!user) return { ok: false, response: unauthorized() };
    if (String(user.status ?? '').toUpperCase() !== 'ACTIVE') return { ok: false, response: unauthorized() };

    const role = String(user.role ?? '').toLowerCase() as Role;
    if (role !== 'super_admin' && user.organisation_id !== claims.organisationId) {
      return { ok: false, response: unauthorized() };
    }

    org = (await sql`
      SELECT id, status FROM organisations WHERE id = ${claims.organisationId} LIMIT 1
    `)[0];
  } catch {
    return { ok: false, response: unavailable() };
  }
  if (!org || String(org.status ?? '').toUpperCase() !== 'ACTIVE') return { ok: false, response: forbidden() };

  try {
    await requireCapability(claims.organisationId, 'events');
  } catch (err) {
    return { ok: false, response: err instanceof CapabilityDatabaseError ? unavailable() : forbidden() };
  }

  const role = String(user.role ?? '').toLowerCase() as Role;
  if (!roleGte(role, minRole)) return { ok: false, response: forbidden() };

  return {
    ok: true,
    context: {
      userId: claims.userId,
      organisationId: claims.organisationId,
      homeOrganisationId: user.organisation_id as string,
      role,
      name: (user.name as string) ?? '',
    },
  };
}
