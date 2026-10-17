import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

// Server-to-server gate for /api/ticketing/*. The Eve server (never a browser)
// presents TICKETING_API_SECRET in `x-ticketing-api-key`. This only proves the
// caller is the Eve server; it authorizes nothing about any user — that is
// authorizeTicketingApiRequest()'s job, against the database.

export const TICKETING_API_KEY_HEADER = 'x-ticketing-api-key';
export const TICKETING_SESSION_HEADER = 'x-ticketing-session';
export const TICKETING_CLIENT_IP_HEADER = 'x-ticketing-client-ip';

const MIN_SECRET_LENGTH = 32;

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export type GateResult = { ok: true } | { ok: false; response: Response };

function deny(status: number, error: string): GateResult {
  return { ok: false, response: Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } }) };
}

export function checkTicketingGate(req: Request): GateResult {
  // Browser-origin use is refused outright: a server-side fetch carries
  // neither header, a browser always carries at least one on a cross-site
  // request. No CORS headers are ever emitted by these routes.
  // (sec-fetch-mode is deliberately NOT checked: Node's own fetch sets it, so
  // the Eve server would be refused. Browsers always add Origin on a CORS
  // request and Sec-Fetch-Site on every request, both of which Node omits.)
  if (req.headers.has('origin') || req.headers.has('sec-fetch-site')) {
    return deny(403, 'Forbidden');
  }

  const expected = process.env.TICKETING_API_SECRET;
  if (!expected || expected.length < MIN_SECRET_LENGTH) return deny(503, 'Ticketing API unavailable');

  const presented = req.headers.get(TICKETING_API_KEY_HEADER);
  if (!presented) return deny(401, 'Unauthorized');

  // Hash both sides so lengths always match for timingSafeEqual.
  if (!timingSafeEqual(digest(presented), digest(expected))) return deny(401, 'Unauthorized');
  return { ok: true };
}
