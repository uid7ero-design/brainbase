import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/org';
import {
  revokeIntegrationCredential,
  setIntegrationCredentialEnabled,
} from '@/lib/integrationCredentials/service';
import { adminForbidden, adminJson, credentialErrorResponse } from '@/lib/integrationCredentials/adminHttp';

// Essio integration B2 — super_admin credential lifecycle.
//
//   PATCH /api/admin/integration-credentials/<credentialId>
//         { "organisation_id": "<org>", "action": "disable" | "enable" | "revoke" }
//
// Revocation is permanent; a revoked credential cannot be re-enabled (409).
// Never returns secret material.

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ credentialId: string }> }) {
  let session;
  try {
    session = await requireRole('super_admin');
  } catch {
    return adminForbidden();
  }
  const { credentialId } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const organisationId = typeof body?.organisation_id === 'string' ? body.organisation_id : '';
  const action = body?.action;
  if (action !== 'disable' && action !== 'enable' && action !== 'revoke') {
    return adminJson({ error: { code: 'invalid_action', message: 'action must be "disable", "enable" or "revoke".' } }, 400);
  }
  try {
    if (action === 'revoke') {
      const result = await revokeIntegrationCredential({ organisationId, credentialId, revokedByUserId: session.userId });
      return adminJson(result);
    }
    const credential = await setIntegrationCredentialEnabled({
      organisationId,
      credentialId,
      enabled: action === 'enable',
      actorUserId: session.userId,
    });
    return adminJson({ credential });
  } catch (err) {
    return credentialErrorResponse(err);
  }
}
