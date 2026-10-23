import 'server-only';
import { requireSession, type OrgSession } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { SCHEDULING_CAPABILITY_KEY, permissionsForRole } from './adapters/brainbase';

// Phase 2B.2c — the page/layout gate for the Scheduling dashboard. It is a UX gate, not the security boundary: every number and
// every button on a page comes from /api/scheduling/**, where schedulingRoute() re-checks the session, the organisation's
// entitlement and the role on every request. This helper only decides which shell to render ("not enabled" message, or the
// dashboard) and whether to show management controls (`canManage`), so a viewer sees no buttons that the API would refuse.
//
// It reads no Scheduling data and writes nothing. It never takes an organisation from anywhere but the session.
// Fail closed: no session, a denied or unreadable entitlement, and any role without scheduling.view all end in a message.

export type SchedulingPageAccess =
  | { status: 'unauthenticated' }
  | { status: 'not_enabled' }
  | { status: 'unavailable' }
  | { status: 'ok'; canManage: boolean; role: string };

export async function getSchedulingPageAccess(): Promise<SchedulingPageAccess> {
  let session: OrgSession;
  try {
    session = await requireSession();
  } catch {
    return { status: 'unauthenticated' };
  }
  if (!session || !session.organisationId || !session.userId) return { status: 'unauthenticated' };

  const capability = await checkCapability(session.organisationId, SCHEDULING_CAPABILITY_KEY);
  if (!capability.allowed) return capability.reason === 'DATABASE_ERROR' ? { status: 'unavailable' } : { status: 'not_enabled' };

  const permissions = permissionsForRole(session.role);
  if (!permissions.includes('scheduling.view')) return { status: 'not_enabled' };
  return { status: 'ok', canManage: permissions.includes('scheduling.manage'), role: session.role };
}
