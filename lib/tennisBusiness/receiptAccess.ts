import 'server-only';
import { getUserPermissions } from '@/lib/organisationUsers/access';
import { COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { roleGte } from '@/lib/org';
import { tennisBusinessAccess } from './access';

export async function receiptAccess() {
  const access = await tennisBusinessAccess();
  if (!access.ok) return access;
  if (!access.modules.includes('purchasing')) return { ok: false as const, status: 403 };
  const { organisationId, userId, role } = access.session;
  // A receipt records an already-paid purchase. Use the same floor as recording a supplier payment.
  let canRecord = roleGte(role, COMMERCIAL_MIN_ROLE.approve);
  if (canRecord && role !== 'super_admin') {
    try {
      const permissions = await getUserPermissions(organisationId, userId);
      canRecord = permissions === null || permissions.purchasing === 'use';
    } catch {
      return { ok: false as const, status: 503 };
    }
  }
  return { ...access, canRecord };
}
