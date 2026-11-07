import 'server-only';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from './authorize';
import type { FinanceWorkspace } from './financeWorkspace';
import { getUserPermissions } from '@/lib/organisationUsers/access';
import { roleGte } from '@/lib/org';
import { tennisBusinessAccess } from '@/lib/tennisBusiness/access';
import { receiptAccess } from '@/lib/tennisBusiness/receiptAccess';

export async function financeRegisterAccess(workspace: FinanceWorkspace, capability: 'invoicing' | 'purchasing') {
  if (workspace === 'tennis') {
    if (capability === 'purchasing') return receiptAccess();
    const access = await tennisBusinessAccess();
    if (!access.ok) return access;
    if (!access.modules.includes(capability)) return { ok: false as const, status: 403 };
    return { ...access, canRecord: false };
  }

  const access = await authorizeCommercialRequest(capability, COMMERCIAL_MIN_ROLE.view);
  if (!access.ok) return { ok: false as const, status: access.response.status };
  const { organisationId, userId, role } = access.session;
  try {
    const permissions = role === 'super_admin' ? null : await getUserPermissions(organisationId, userId);
    const grant = permissions?.[capability];
    if (permissions !== null && grant !== 'view' && grant !== 'use') return { ok: false as const, status: 403 };
    const canRecord = capability === 'purchasing' && roleGte(role, COMMERCIAL_MIN_ROLE.approve)
      && (permissions === null || grant === 'use');
    return { ...access, canRecord };
  } catch {
    return { ok: false as const, status: 503 };
  }
}
