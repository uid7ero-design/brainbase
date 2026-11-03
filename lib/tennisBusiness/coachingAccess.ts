import 'server-only';
import { tennisBusinessAccess } from './access';
import { getUserPermissions } from '@/lib/organisationUsers/access';
export async function coachingAccess(write: boolean) {
  const access = await tennisBusinessAccess();
  if (!access.ok) return access;
  // Staff-only legacy compatibility. Generic Scheduling viewer DTOs remain unchanged.
  if (!access.modules.includes('scheduling') || !['manager', 'admin', 'super_admin'].includes(access.session.role)) return { ok: false as const, status: 403 as const };
  if (write && access.session.role !== 'super_admin') {
    try {
      const permissions = await getUserPermissions(access.session.organisationId, access.session.userId);
      if (permissions && permissions.scheduling !== 'use') return { ok: false as const, status: 403 as const };
    } catch { return { ok: false as const, status: 503 as const }; }
  }
  return access;
}
