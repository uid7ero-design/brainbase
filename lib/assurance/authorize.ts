import 'server-only';
import { NextResponse } from 'next/server';
import { requireSession, roleGte, unauthorized, forbidden, type OrgSession } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import type { Role } from '@/lib/session';

// BrainBase Assurance — the single authorization primitive for every
// Assurance page and route. Same composed session -> capability -> role
// shape as lib/commercial/authorize.ts (not a second auth system):
//   1. authenticated, DB-revalidated session (requireSession)
//   2. the organisation's 'assurance' capability entitlement
//   3. a minimum role for the operation class
//
// organisationId is ONLY ever taken from requireSession()'s DB-backed
// result. No Assurance service accepts an organisation id from a request
// body, query string or route param.

export const ASSURANCE_CAPABILITY = 'assurance';

// Role floors, the viewer shape and viewerCan() live in ./policy (pure) so
// the data services can enforce permissions without request plumbing.
export { ASSURANCE_MIN_ROLE, toAssuranceViewer, viewerCan, type AssuranceViewer } from './policy';
import { ASSURANCE_MIN_ROLE, toAssuranceViewer, type AssuranceViewer } from './policy';

export type AssuranceAuthResult =
  | { ok: true; viewer: AssuranceViewer }
  | { ok: false; response: Response };

/** API-route gate. 401 no session, 403 not entitled / role too low, 503 entitlement indeterminate. */
export async function authorizeAssuranceRequest(minRole: Role): Promise<AssuranceAuthResult> {
  let session: OrgSession;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, response: unauthorized() };
  }

  const capability = await checkCapability(session.organisationId, ASSURANCE_CAPABILITY);
  if (!capability.allowed) {
    if (capability.reason === 'DATABASE_ERROR') {
      return { ok: false, response: NextResponse.json({ error: 'Unable to verify Assurance access.' }, { status: 503 }) };
    }
    return { ok: false, response: forbidden() };
  }

  if (!roleGte(session.role, minRole)) return { ok: false, response: forbidden() };
  return { ok: true, viewer: toAssuranceViewer(session) };
}

export type AssurancePageAccess =
  | { status: 'ok'; viewer: AssuranceViewer }
  | { status: 'unauthenticated' }
  | { status: 'not_enabled' }
  | { status: 'unavailable' };

/** Page/layout gate. Never throws; callers render the appropriate state. */
export async function getAssurancePageAccess(): Promise<AssurancePageAccess> {
  let session: OrgSession;
  try {
    session = await requireSession();
  } catch {
    return { status: 'unauthenticated' };
  }
  const capability = await checkCapability(session.organisationId, ASSURANCE_CAPABILITY);
  if (!capability.allowed) {
    return capability.reason === 'DATABASE_ERROR' ? { status: 'unavailable' } : { status: 'not_enabled' };
  }
  if (!roleGte(session.role, ASSURANCE_MIN_ROLE.view)) return { status: 'not_enabled' };
  return { status: 'ok', viewer: toAssuranceViewer(session) };
}
