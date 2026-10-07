import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/org';
import { createIntegrationCredential, listIntegrationCredentials } from '@/lib/integrationCredentials/service';
import {
  adminForbidden,
  adminJson,
  credentialErrorResponse,
  TOKEN_WARNING,
} from '@/lib/integrationCredentials/adminHttp';

// Essio integration B2 — super_admin management of integration credentials.
//
//   GET  /api/admin/integration-credentials?organisation_id=<org>   list (no secrets)
//   POST /api/admin/integration-credentials                          create
//        { "organisation_id": "<org>", "label": "...", "scopes": ["work:create", ...] }
//
// requireRole('super_admin') re-reads the caller's role/status from the
// database (SEC-1A pattern); the JWT role claim is never trusted. The
// organisation is chosen by the authorised super_admin and validated to exist
// by the service. Create/disable/enable/revoke are audited by the service in
// the same statement as the change. The plaintext token is returned exactly
// once, by POST, and never logged.

export async function GET(req: NextRequest) {
  try {
    await requireRole('super_admin');
  } catch {
    return adminForbidden();
  }
  const organisationId = req.nextUrl.searchParams.get('organisation_id');
  if (!organisationId) {
    return adminJson({ error: { code: 'invalid_organisation', message: 'organisation_id is required.' } }, 400);
  }
  try {
    return adminJson({ credentials: await listIntegrationCredentials(organisationId) });
  } catch (err) {
    return credentialErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireRole('super_admin');
  } catch {
    return adminForbidden();
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return adminJson({ error: { code: 'invalid_request', message: 'A JSON body is required.' } }, 400);
  }
  try {
    const { credential, token } = await createIntegrationCredential({
      organisationId: typeof body.organisation_id === 'string' ? body.organisation_id : '',
      integrationKey: 'essio',
      label: typeof body.label === 'string' ? body.label : '',
      scopes: Array.isArray(body.scopes) ? (body.scopes as string[]) : [],
      createdByUserId: session.userId,
    });
    return adminJson({ credential, token, token_warning: TOKEN_WARNING }, 201);
  } catch (err) {
    return credentialErrorResponse(err);
  }
}
