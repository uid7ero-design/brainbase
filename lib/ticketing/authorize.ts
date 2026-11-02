import 'server-only';
import sql from '@/lib/db';
import { roleGte, type Role } from '@/lib/session';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { isEveEnabledSetting } from '@/lib/organisations/eveEnablement';
import { checkTicketingGate, TICKETING_SESSION_HEADER } from './gate';
import { verifyTicketingSession } from './session';

export type TicketingContext = {
  sessionId: string;
  userId: string;
  organisationId: string;
  homeOrganisationId: string;
  role: Role;
  name: string;
  organisationSlug: string;
  organisationName: string;
};

export type TicketingAuthResult =
  | { ok: true; context: TicketingContext }
  | { ok: false; response: Response };

const NO_STORE = { 'Cache-Control': 'no-store' };
const unauthorized = () => Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
const forbidden = () => Response.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
// Distinct code so the Eve server can show "not enabled" rather than
// "signed out". It describes only the caller's own organisation.
export const EVE_NOT_ENABLED = 'EVE_NOT_ENABLED';
const eveNotEnabled = () => Response.json({ error: EVE_NOT_ENABLED }, { status: 403, headers: NO_STORE });
const unavailable = () =>
  Response.json({ error: 'Unable to verify access.' }, { status: 503, headers: NO_STORE });

// Reloads everything authoritative from the database on every call; the token
// contributes only (userId, organisationId) as a pointer. Fails closed.
//   1. server-to-server gate (secret, no browser origin)
//   2. Eve session token (own secret, issuer, audience, expiry, jti), and its
//      ticketing_sessions row is live (same user + organisation, not revoked,
//      not expired) — read in the SAME query as the user
//   3. user exists and is ACTIVE (strict — missing status denies)
//   4. tenant relationship: non-super_admin must still belong to the token's
//      organisation; super_admin may act in any organisation that passes 5
//   5. organisation exists and is ACTIVE, and holds the 'events' capability
//   6. organisation is enabled on Eve (settings.events.eveEnabled === true);
//      otherwise 403 EVE_NOT_ENABLED, so a disabled organisation's existing
//      sessions stop working on their next call
//   7. current DB role meets the minimum
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
      SELECT id, organisation_id, role, status, name,
        EXISTS (
          SELECT 1 FROM ticketing_sessions s
          WHERE s.id = ${claims.jti} AND s.user_id = users.id AND s.organisation_id = ${claims.organisationId}
            AND s.revoked_at IS NULL AND s.expires_at > NOW()
        ) AS session_live
      FROM users WHERE id = ${claims.userId} LIMIT 1
    `)[0];
    if (!user) return { ok: false, response: unauthorized() };
    // A revoked, expired, unknown or mismatched session is dead whatever the token says.
    if (user.session_live !== true) return { ok: false, response: unauthorized() };
    if (String(user.status ?? '').toUpperCase() !== 'ACTIVE') return { ok: false, response: unauthorized() };

    const role = String(user.role ?? '').toLowerCase() as Role;
    if (role !== 'super_admin' && user.organisation_id !== claims.organisationId) {
      return { ok: false, response: unauthorized() };
    }

    org = (await sql`
      SELECT id, status, slug, name, settings FROM organisations WHERE id = ${claims.organisationId} LIMIT 1
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
  if (!isEveEnabledSetting(org.settings)) return { ok: false, response: eveNotEnabled() };

  const role = String(user.role ?? '').toLowerCase() as Role;
  if (!roleGte(role, minRole)) return { ok: false, response: forbidden() };

  return {
    ok: true,
    context: {
      sessionId: claims.jti,
      userId: claims.userId,
      organisationId: claims.organisationId,
      homeOrganisationId: user.organisation_id as string,
      role,
      name: (user.name as string) ?? '',
      organisationSlug: (org.slug as string) ?? '',
      organisationName: (org.name as string) ?? '',
    },
  };
}
