import 'server-only';
import { requireSession, type OrgSession } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { getUserPermissions } from '@/lib/organisationUsers/access';
import { deriveRecoverySecret } from './recoverySecret';
import { SCHEDULING_CAPABILITY_KEY, SCHEDULING_FACILITY_HIRE_CAPABILITY_KEY, permissionsForRole, facilityHireKillSwitchOn } from './adapters/brainbase';

// "May THIS page show the facility-hire booking controls at all?". A server component calls this and passes the
// answer down as a plain boolean prop (default false); no client component ever decides it, and no API call is made to find out.
//
// It is a UX gate, never the security boundary: every request the dialog makes is authorised again by schedulingRoute() with the same
// checks (kill switch, organisation capability, scheduling.reserve, tenant from the session). It deliberately mirrors the order of
// authorizeSchedulingRequest so a page can never show a control the API would answer with 404/403:
//   1. the environment switch SCHEDULING_FACILITY_HIRE is exactly 'on'   (checked FIRST: with it off the session, the capability tables
//      and the database are never touched, for anyone)
//   2. an authenticated, DB-backed session; the organisation is the session's and nothing else
//   3. the organisation holds scheduling.facility_hire AND the base scheduling capability
//   4. the session's role grants scheduling.reserve
//   5. a managed-access row (if any) puts Scheduling at `use` (a platform owner has no row and is decided by role)
// It shares NOTHING with getStaffBookingVisibility (Coach squads/enrolment): neither switch nor capability of the other feature is read here, and neither can satisfy this check.
// Fail closed everywhere: any refusal, any unreadable state and any thrown error is `false`. It returns no data and writes nothing.

async function visibleSession(): Promise<OrgSession | null> {
  if (!facilityHireKillSwitchOn()) return null;
  try {
    let session: OrgSession;
    try {
      session = await requireSession();
    } catch {
      return null;
    }
    if (!session || !session.organisationId || !session.userId) return null;

    const [hire, base] = await Promise.all([
      checkCapability(session.organisationId, SCHEDULING_FACILITY_HIRE_CAPABILITY_KEY),
      checkCapability(session.organisationId, SCHEDULING_CAPABILITY_KEY),
    ]);
    if (!hire.allowed || !base.allowed) return null;

    if (!permissionsForRole(session.role).includes('scheduling.reserve')) return null;

    if (session.role !== 'super_admin') {
      const managed = await getUserPermissions(session.organisationId, session.userId);
      if (managed !== null && managed.scheduling !== 'use') return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function getFacilityHireVisibility(): Promise<boolean> {
  return (await visibleSession()) !== null;
}

/**
 * The page's whole facility-hire booking decision: whether to show the controls, and the reload-recovery secret for THIS user and organisation
 * (see recoverySecret.ts). The secret is derived only when every facility-hire gate above holds, so with the switch off, or without the
 * scheduling.facility_hire capability, nothing is derived, read or sent. A Coach-only organisation (SCHEDULING_STAFF_BOOKING on, scheduling.staff_booking
 * entitled) gets { canBook: false, recoverySecret: null }: nothing in this file reads the Coach switch or capability. Fail closed: no SESSION_SECRET means
 * no booking (a booking build must not have a mode without recovery).
 */
export async function getFacilityHireContext(): Promise<{ canBook: boolean; recoverySecret: string | null }> {
  const session = await visibleSession();
  const sessionSecret = process.env.SESSION_SECRET;
  if (!session || !sessionSecret) return { canBook: false, recoverySecret: null };
  return { canBook: true, recoverySecret: deriveRecoverySecret(sessionSecret, session.userId, session.organisationId) };
}
