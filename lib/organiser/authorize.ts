import { NextResponse } from 'next/server';
import { requireSession, roleGte, unauthorized, forbidden, type OrgSession } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import type { Role } from '@/lib/session';

export type OrganiserAuthResult =
  | { ok: true; session: OrgSession }
  // Response, not NextResponse — lib/org.ts's unauthorized()/forbidden()
  // helpers return a plain Response (Response.json(...)), which is not
  // assignable to NextResponse's stricter type despite being a valid
  // Next.js route handler return value at runtime.
  | { ok: false; response: Response };

// Phase D.4.4C — every app/api/organiser/** route calls this before touching
// the database. Modeled directly on lib/events/authorize.ts's
// authorizeEventsRequest, which is the established pattern for a
// capability + role composed API gate in this repo. Enforces, additively
// (never as substitutes for one another):
//   1. an authenticated session (401 if missing/invalid)
//   2. the calling organisation's 'organiser' capability entitlement
//      (403 if not entitled, 503 if entitlement could not be determined)
//   3. a minimum role for the specific operation (403 if below minimum)
//
// Every existing app/api/organiser/** handler previously called
// requireRole('viewer') directly with no capability check at all (see
// Phase D.4.4A/B audits) — this wrapper preserves that exact 'viewer'
// floor for every call site while adding the capability layer that was
// missing. Never resolves organisationId from anything other than
// requireSession()'s own DB-backed result — the caller can never supply
// their own organisationId and have it trusted.
export async function authorizeOrganiserRequest(minRole: Role): Promise<OrganiserAuthResult> {
  let session: OrgSession;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, response: unauthorized() };
  }

  try {
    await requireCapability(session.organisationId, 'organiser');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Unable to verify Organiser access.' }, { status: 503 }),
      };
    }
    return { ok: false, response: forbidden() };
  }

  if (!roleGte(session.role, minRole)) {
    return { ok: false, response: forbidden() };
  }

  return { ok: true, session };
}
