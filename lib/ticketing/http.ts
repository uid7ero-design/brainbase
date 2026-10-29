import 'server-only';
import { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/clientIp';
import { TICKETING_CLIENT_IP_HEADER } from './gate';

// Small HTTP helpers shared by the /api/ticketing/* handlers. Nothing here
// authorizes anything — see gate.ts and authorize.ts.

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function ticketingJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

// The Eve server forwards its visitor's address so per-IP rate limits key
// on the buyer, not on the Eve server's egress address. Accepted only as an
// IP literal (it becomes part of a rate-limit key); otherwise the request's
// own forwarded address is used.
const IP_LITERAL = /^[0-9A-Fa-f:.]{2,45}$/;

export function ticketingClientIp(req: Request): string {
  const forwarded = req.headers.get(TICKETING_CLIENT_IP_HEADER)?.trim();
  if (forwarded && IP_LITERAL.test(forwarded)) return forwarded;
  return getClientIp(req);
}

// Builds the request handed to an existing BrainBase route handler that the
// ticketing API reuses. Carries only what that handler reads: the path and
// query it parses, a JSON body, and the buyer's address as X-Forwarded-For
// (what getClientIp() reads). No cookie, no ticketing secret, no session.
export function delegatedRequest(
  req: Request,
  pathname: string,
  init: { method: 'GET' | 'POST'; body?: string; search?: string },
): NextRequest {
  const url = new URL(pathname, req.url);
  url.search = init.search ?? '';
  const headers = new Headers({ 'x-forwarded-for': ticketingClientIp(req) });
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(url, { method: init.method, headers, body: init.body });
}

// Re-emits a reused handler's JSON response with the same status and body
// and nothing else: no Set-Cookie, no CORS, always no-store.
export async function reissue(res: Response): Promise<Response> {
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json', ...NO_STORE } });
}

const MAX_BODY_BYTES = 64 * 1024;

// Reads a request body as text for forwarding, refusing oversized bodies.
export async function readBodyText(req: Request): Promise<string | null> {
  const text = await req.text().catch(() => null);
  if (text === null || text.length > MAX_BODY_BYTES) return null;
  return text;
}

// The standalone product's public origin, configured on THIS deployment
// (EVE_PUBLIC_BASE_URL, server-only) — never taken from a request header, so
// a hosted-checkout return URL or a ticket QR can only ever point at the
// configured product. https is required outside local development. It lives
// with the product identity so order creation, Retry and this API all
// resolve the same value.
export { eveLinkBase } from '@/lib/events/productSurface';

// Path identifiers (event ids, slugs, tokens) are bounded and charset-
// limited before they reach a reused handler; anything else is a 404.
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
export function isIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}
