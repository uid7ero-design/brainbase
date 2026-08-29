import { NextResponse } from 'next/server';
import { requireSession, roleGte, unauthorized, forbidden, type OrgSession } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import type { Role } from '@/lib/session';

export type EventsAuthResult =
  | { ok: true; session: OrgSession }
  // Response, not NextResponse — lib/org.ts's unauthorized()/forbidden()
  // helpers return a plain Response (Response.json(...)), which is not
  // assignable to NextResponse's stricter type despite being a valid
  // Next.js route handler return value at runtime.
  | { ok: false; response: Response };

// Every Events & Ticketing route calls this before touching the database.
// It enforces, additively (never as substitutes for one another):
//   1. an authenticated session (401 if missing/invalid)
//   2. the calling organisation's 'events' capability entitlement
//      (403 if not entitled, 503 if entitlement could not be determined)
//   3. a minimum role for the specific operation (403 if below minimum)
//
// This mirrors the layering already established for the CRM route
// boundary (requireSession() + requireCapability()), with a role-minimum
// check added on top for the read/write split Phase 1 requires (CRM has
// no such split — any authenticated, entitled user may use it). Never
// resolves organisationId from anything other than requireSession()'s
// own DB-backed result — the caller can never supply their own
// organisationId and have it trusted.
export async function authorizeEventsRequest(minRole: Role): Promise<EventsAuthResult> {
  let session: OrgSession;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, response: unauthorized() };
  }

  try {
    await requireCapability(session.organisationId, 'events');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Unable to verify Events access.' }, { status: 503 }),
      };
    }
    return { ok: false, response: forbidden() };
  }

  if (!roleGte(session.role, minRole)) {
    return { ok: false, response: forbidden() };
  }

  return { ok: true, session };
}
