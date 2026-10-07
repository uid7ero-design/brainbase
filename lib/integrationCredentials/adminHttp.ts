import 'server-only';
import { NextResponse } from 'next/server';
import { IntegrationCredentialDatabaseError, IntegrationCredentialError } from './service';

// Essio integration B2 — shared response helpers for the super_admin
// credential-management routes (app/api/admin/integration-credentials/**).
// Responses are no-store and never contain secret material or error internals.

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export const TOKEN_WARNING =
  'Copy this token now. It is shown only once and cannot be recovered; if it is lost, revoke this credential and create a new one.';

export function adminJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function adminForbidden(): NextResponse {
  return adminJson({ error: { code: 'forbidden', message: 'Forbidden' } }, 403);
}

export function credentialErrorResponse(err: unknown): NextResponse {
  if (err instanceof IntegrationCredentialError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'revoked' ? 409 : 400;
    return adminJson({ error: { code: err.code, message: 'The credential request was rejected.' } }, status);
  }
  if (err instanceof IntegrationCredentialDatabaseError) {
    return adminJson({ error: { code: 'unavailable', message: 'The service is temporarily unavailable.' } }, 503);
  }
  return adminJson({ error: { code: 'internal_error', message: 'The request could not be processed.' } }, 500);
}
