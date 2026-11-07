import 'server-only';
import { requireSession, type OrgSession } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { getUserPermissions } from '@/lib/organisationUsers/access';
import { SCHEDULING_CAPABILITY_KEY, SCHEDULING_STAFF_BOOKING_CAPABILITY_KEY, permissionsForRole, staffBookingKillSwitchOn } from './adapters/brainbase';

// Phase 2C.3c UI slice 1: "may THIS page show the staff booking controls at all?". A server component calls this and passes the
// answer down as a plain boolean prop (default false); no client component ever decides it, and no API call is made to find out.
//
// It is a UX gate, never the security boundary: every request the dialog makes is authorised again by schedulingRoute() with the same
// checks (kill switch, organisation capability, scheduling.reserve, tenant from the session). It deliberately mirrors the order of
// authorizeSchedulingRequest so a page can never show a control the API would answer with 404/403:
//   1. the environment switch SCHEDULING_STAFF_BOOKING is exactly 'on'   (checked FIRST: with it off the session, the capability tables
//      and the database are never touched, for anyone)
//   2. an authenticated, DB-backed session; the organisation is the session's and nothing else
//   3. the organisation holds scheduling.staff_booking AND the base scheduling capability
//   4. the session's role grants scheduling.reserve
//   5. a managed-access row (if any) puts Scheduling at `use` (a platform owner has no row and is decided by role)
// Fail closed everywhere: any refusal, any unreadable state and any thrown error is `false`. It returns no data and writes nothing.

export async function getStaffBookingVisibility(): Promise<boolean> {
  if (!staffBookingKillSwitchOn()) return false;
  try {
    let session: OrgSession;
    try {
      session = await requireSession();
    } catch {
      return false;
    }
    if (!session || !session.organisationId || !session.userId) return false;

    const [staff, base] = await Promise.all([
      checkCapability(session.organisationId, SCHEDULING_STAFF_BOOKING_CAPABILITY_KEY),
      checkCapability(session.organisationId, SCHEDULING_CAPABILITY_KEY),
    ]);
    if (!staff.allowed || !base.allowed) return false;

    if (!permissionsForRole(session.role).includes('scheduling.reserve')) return false;

    if (session.role !== 'super_admin') {
      const managed = await getUserPermissions(session.organisationId, session.userId);
      if (managed !== null && managed.scheduling !== 'use') return false;
    }
    return true;
  } catch {
    return false;
  }
}
