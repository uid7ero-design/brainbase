import 'server-only';
import { requireSession, type OrgSession } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { getUserPermissions } from '@/lib/organisationUsers/access';
import { SCHEDULING_CAPABILITY_KEY, permissionsForRole } from './adapters/brainbase';
import { resolveOrganisationTimezone } from './organisationTimezone';

// Phase 2B.2c — the page/layout gate for the Scheduling dashboard. It is a UX gate, not the security boundary: every number and
// every button on a page comes from /api/scheduling/**, where schedulingRoute() re-checks the session, the organisation's
// entitlement and the role on every request. This helper only decides which shell to render ("not enabled" message, or the
// dashboard) and whether to show management controls (`canManage`), so a viewer sees no buttons that the API would refuse.
//
// `canManage` is the EFFECTIVE permission, the same decision the server will make for a write: the organisation is entitled (above), the
// role grants scheduling.manage, and (PR #489) a user with a managed-access row has Scheduling at `use`. `view` shows the dashboard
// read-only and `none` is treated as not enabled. A user with no access row is decided by role alone, exactly like the middleware.
//
// It reads no Scheduling data and writes nothing. It never takes an organisation from anywhere but the session.
// Fail closed: no session, a denied or unreadable entitlement, and any role without scheduling.view all end in a message.

export type SchedulingPageAccess =
  | { status: 'unauthenticated' }
  | { status: 'not_enabled' }
  | { status: 'unavailable' }
  | { status: 'ok'; canManage: boolean; role: string; timezone: string | null };

export async function getSchedulingPageAccess(): Promise<SchedulingPageAccess> {
  let session: OrgSession;
  try {
    session = await requireSession();
  } catch {
    return { status: 'unauthenticated' };
  }
  if (!session || !session.organisationId || !session.userId) return { status: 'unauthenticated' };

  // The organisation's timezone (host data, the same value /api/scheduling/status reports) is read BESIDE the entitlement check, not after it, so the page can hand it to a
  // screen that would otherwise have to ask for it in a request of its own. It is only passed on when the access check passes; if it cannot be read the screen asks, as before.
  const [capability, timezone] = await Promise.all([
    checkCapability(session.organisationId, SCHEDULING_CAPABILITY_KEY),
    resolveOrganisationTimezone(session.organisationId).then(z => z.value, () => null),
  ]);
  if (!capability.allowed) return capability.reason === 'DATABASE_ERROR' ? { status: 'unavailable' } : { status: 'not_enabled' };

  const permissions = permissionsForRole(session.role);
  if (!permissions.includes('scheduling.view')) return { status: 'not_enabled' };

  // null: no managed-access row (or a platform owner), so the role alone decides.
  let level: 'none' | 'view' | 'use' | null = null;
  if (session.role !== 'super_admin') {
    try {
      const managed = await getUserPermissions(session.organisationId, session.userId);
      if (managed !== null) level = managed.scheduling ?? 'none';
    } catch {
      return { status: 'unavailable' }; // fail closed: access could not be verified
    }
  }
  if (level === 'none') return { status: 'not_enabled' };
  return { status: 'ok', canManage: permissions.includes('scheduling.manage') && level !== 'view', role: session.role, timezone };
}
