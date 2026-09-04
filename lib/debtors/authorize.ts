import { NextResponse } from 'next/server';
import { requireSession, roleGte, unauthorized, forbidden, type OrgSession } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import type { Role } from '@/lib/session';

export type DebtorsAuthResult =
  | { ok: true; session: OrgSession }
  // Response, not NextResponse — lib/org.ts's unauthorized()/forbidden()
  // helpers return a plain Response (Response.json(...)), which is not
  // assignable to NextResponse's stricter type despite being a valid
  // Next.js route handler return value at runtime.
  | { ok: false; response: Response };

// Phase C1.1 — modeled directly on lib/organiser/authorize.ts /
// lib/events/authorize.ts's identical pattern, the established shape for a
// capability + role composed API gate in this repo. Enforces, additively
// (never as substitutes for one another):
//   1. an authenticated session (401 if missing/invalid)
//   2. the calling organisation's 'debtors' capability entitlement
//      (403 if not entitled, 503 if entitlement could not be determined)
//   3. a minimum role for the specific operation (403 if below minimum)
//
// app/api/debtors/kpi/route.ts previously called only getAuthSession() —
// any authenticated member of the organisation, with no role floor and no
// capability check at all. 'viewer' is chosen as the floor here to match
// the identical read-only-reporting precedent already set by
// app/organiser/layout.tsx's ORGANISER_MIN_ROLE, not as a new decision —
// this is a read endpoint, exactly like Organiser's own 'viewer'-gated
// routes. Never resolves organisationId from anything other than
// requireSession()'s own DB-backed result.
export async function authorizeDebtorsRequest(minRole: Role): Promise<DebtorsAuthResult> {
  let session: OrgSession;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, response: unauthorized() };
  }

  try {
    await requireCapability(session.organisationId, 'debtors');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Unable to verify Debtors access.' }, { status: 503 }),
      };
    }
    return { ok: false, response: forbidden() };
  }

  if (!roleGte(session.role, minRole)) {
    return { ok: false, response: forbidden() };
  }

  return { ok: true, session };
}
