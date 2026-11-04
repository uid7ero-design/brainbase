import { NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden, type OrgSession } from '@/lib/org';
import { requireCapability, CapabilityAccessError } from '@/lib/capabilities/requireCapability';
import type { SchedulingPermission, TenantContext } from '@scheduling/core';
import { SCHEDULING_CAPABILITY_KEY, SCHEDULING_STAFF_BOOKING_CAPABILITY_KEY, permissionsForRole, staffBookingKillSwitchOn, staffTenantContext } from './adapters/brainbase';
import { getUserPermissions } from '@/lib/organisationUsers/access';

// The fail-closed gate for every Scheduling route. Routes never call it directly: they are built with schedulingRoute()
// in lib/scheduling/route.ts, the one importer of this file (tests/containment/schedulingPhase2b1Containment.test.ts pins
// that). The capability is registered for nobody (120 adds the module, never an organisation_modules row), so every call
// below ends in 403 until an organisation is deliberately enabled.
//
// Same composed shape as lib/events/authorize.ts and lib/commercial/authorize.ts, in this order:
//   1. an authenticated, DB-backed session                           -> 401
//   2. the SESSION's organisation is entitled to 'scheduling'        -> 403 (503 if entitlement cannot be determined)
//   3. the session's role grants the requested scheduling permission -> 403
// and only then a TenantContext for the core. The organisation is taken from the session and from nothing else: this
// function accepts no organisation argument, so a request body or query string cannot name one. While a super_admin is
// impersonating, the session's organisationId is the impersonated organisation, and that is the one checked.
//
// Fail closed everywhere: an unknown permission string, a missing session field, a denied or unreadable entitlement
// and an unrecognised role (including 'analyst') all end in a refusal before any scheduling data is touched.
//
// Deliberately NOT here (Phase 2B.1): wiring the repositories over lib/db, and the privacy-preserving reduced read
// shape for 'viewer'. This function only answers "may this caller do this?"; it returns no scheduling data.
// The organisation's own timezone is not read yet (the first reader arrives in 2B.2), so the tenant carries the
// platform fallback.

export type SchedulingAuthResult =
  | { ok: true; session: OrgSession; tenant: TenantContext }
  | { ok: false; response: Response };

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set<SchedulingPermission>([
  'scheduling.view',
  'scheduling.manage',
  'scheduling.reserve',
  'scheduling.attendance',
  'scheduling.audit.identity',
]);

/** Phase 2C.3b: a route that belongs to a gated feature. Today only 'staff_booking'. */
export interface SchedulingAuthOptions {
  feature?: 'staff_booking';
}

/** A disabled feature is indistinguishable from a route that does not exist. Same body for the kill switch and for an organisation that is not entitled. */
const featureOff = (): Response => NextResponse.json({ error: 'not_found' }, { status: 404 });

export async function authorizeSchedulingRequest(permission: SchedulingPermission, options: SchedulingAuthOptions = {}): Promise<SchedulingAuthResult> {
  if (!KNOWN_PERMISSIONS.has(permission)) return { ok: false, response: forbidden() };
  // Staff booking, gate 1: the environment kill switch. Checked before the session is even read: with the switch off the route does not exist for anyone, signed in or not,
  // and nothing (session store, capability table, database) is touched.
  if (options.feature === 'staff_booking' && !staffBookingKillSwitchOn()) return { ok: false, response: featureOff() };

  let session: OrgSession;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, response: unauthorized() };
  }
  if (!session || !session.organisationId || !session.userId) return { ok: false, response: unauthorized() };

  // Staff booking, gate 2: the organisation's own entitlement. Absent, disabled, inactive or unregistered all answer 404 like the kill switch; only a failure to DETERMINE it is a 503.
  if (options.feature === 'staff_booking') {
    try {
      await requireCapability(session.organisationId, SCHEDULING_STAFF_BOOKING_CAPABILITY_KEY);
    } catch (err) {
      if (err instanceof CapabilityAccessError) return { ok: false, response: featureOff() };
      return { ok: false, response: NextResponse.json({ error: 'Unable to verify Scheduling access.' }, { status: 503 }) };
    }
  }

  try {
    await requireCapability(session.organisationId, SCHEDULING_CAPABILITY_KEY);
  } catch (err) {
    // A denial the lookup determined (unknown, inactive, no entitlement, disabled) is a 403. Anything else,
    // including a database failure or an unexpected throw, means entitlement could not be determined: 503, still closed.
    if (err instanceof CapabilityAccessError) return { ok: false, response: forbidden() };
    return { ok: false, response: NextResponse.json({ error: 'Unable to verify Scheduling access.' }, { status: 503 }) };
  }

  if (!permissionsForRole(session.role).includes(permission)) return { ok: false, response: forbidden() };

  // Roster GETs require reserve permission because they disclose customer data.
  // Middleware's GET/view rule alone is insufficient for that distinction.
  if(session.role!=='super_admin') {
    try {
      const managed=await getUserPermissions(session.organisationId,session.userId);
      if(managed && (permission==='scheduling.view' ? !['view','use'].includes(managed.scheduling ?? 'none') : managed.scheduling!=='use')) return {ok:false,response:forbidden()};
    } catch {return {ok:false,response:NextResponse.json({error:'Unable to verify Scheduling access.'},{status:503})};}
  }

  const tenant = staffTenantContext({
    organisationId: session.organisationId,
    userId: session.userId,
    role: session.role,
    timezone: null,
  });
  // Belt and braces: the TenantContext must agree with the permission lookup above.
  if (!tenant.can(permission)) return { ok: false, response: forbidden() };

  return { ok: true, session, tenant };
}
