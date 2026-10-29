import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  authenticateIntegrationCredential,
  toPublicIntegrationAuthError,
  type IntegrationPrincipal,
} from '@/lib/integrationCredentials/service';
import type { IntegrationScope } from '@/lib/integrationCredentials/scopes';
import { parseBearerAuthorization } from '@/lib/integrationCredentials/token';

// Essio integration B2 — shared HTTP helpers for /api/integrations/essio/v1/*.
// Every response is no-store. Error bodies are a stable, sanitised envelope:
//   { "error": { "code": "<stable_code>", "message": "<generic text>" } }
// never SQL, table names, stack traces, credential ids or secrets.

export const ESSIO_API_VERSION = 1;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function essioJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function essioError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json({ error: { code, message }, ...extra }, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * Authenticates an Essio machine request: Bearer integration token, required
 * scope, essio_integration enabled for the credential's organisation. The
 * organisation is taken from the credential only.
 */
export async function authenticateEssioRequest(
  req: NextRequest,
  scope: IntegrationScope,
): Promise<{ ok: true; principal: IntegrationPrincipal } | { ok: false; response: NextResponse }> {
  const token = parseBearerAuthorization(req.headers.get('authorization'));
  const result = token
    ? await authenticateIntegrationCredential(token, { integrationKey: 'essio', scope })
    : ({ ok: false, reason: 'MALFORMED' } as const);
  if (result.ok) return result;
  const pub = toPublicIntegrationAuthError(result.reason);
  return {
    ok: false,
    response: essioError(pub.status, pub.code, pub.message, {}, pub.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}),
  };
}

/** Optional contract-version header: absent, or exactly "1". */
export function contractVersionOk(req: NextRequest): boolean {
  const header = req.headers.get('essio-contract-version');
  return header === null || header.trim() === String(ESSIO_API_VERSION);
}

/** Organiser board-level URL (Brainbase has no item-level deep link). */
export function organiserBoardUrl(boardId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/organiser?board=${encodeURIComponent(boardId)}`;
}
