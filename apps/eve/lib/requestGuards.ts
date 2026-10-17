import { isSameOrigin } from '@ticketing/core';

// State-changing browser requests must come from this product's own origin.
// The expected origin is derived from the Host the browser addressed (which
// a cross-site page cannot forge), not from any header the page controls.
export function sameOriginRequest(req: Request): boolean {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return false;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() ?? new URL(req.url).protocol.replace(':', '');
  return isSameOrigin(req.headers.get('origin'), `${proto}://${host}`);
}

export const noStore = { 'Cache-Control': 'no-store' } as const;

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: noStore });
}

export function forbiddenOrigin(): Response {
  return jsonResponse({ error: 'Forbidden' }, 403);
}

// The visitor's address as seen by this server's platform, forwarded so the
// API's per-IP rate limits apply to the buyer rather than to this server.
export function visitorIp(req: Request): string | null {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first && /^[0-9A-Fa-f:.]{2,45}$/.test(first) ? first : null;
}

export async function readJsonBody(req: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown> | null> {
  const text = await req.text().catch(() => null);
  if (text === null || text.length > maxBytes) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
export const isIdentifier = (v: string) => IDENTIFIER.test(v);
