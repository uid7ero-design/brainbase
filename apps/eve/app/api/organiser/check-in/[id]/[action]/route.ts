import { getTicketingGateway, type GatewayResult } from '@/lib/ticketing/gateway';
import { readSessionToken } from '@/lib/session';
import { extractTicketToken } from '@ticketing/core';
import { forbiddenOrigin, isIdentifier, jsonResponse, readJsonBody, sameOriginRequest } from '@/lib/requestGuards';

// Door check-in for the signed-in organiser. The role minimum (viewer for
// search/resolve, manager for confirm/undo) is enforced by the API against
// the user's CURRENT database role; this route relays and maps statuses.

type Ctx = { params: Promise<{ id: string; action: string }> };

function relay<T>(result: GatewayResult<T>): Response {
  switch (result.status) {
    case 'ok': return jsonResponse(result.data);
    case 'unauthorised': return jsonResponse({ error: 'Your session has ended. Sign in again.' }, 401);
    case 'forbidden': return jsonResponse({ error: 'You do not have permission to do that.' }, 403);
    case 'not_found': return jsonResponse({ error: 'Not found.' }, 404);
    case 'error': return jsonResponse({ ...result.body, error: result.message }, result.httpStatus);
    default: return jsonResponse({ error: 'Check-in is unavailable right now.' }, 503);
  }
}

export async function GET(req: Request, { params }: Ctx) {
  const { id, action } = await params;
  if (action !== 'search' || !isIdentifier(id)) return jsonResponse({ error: 'Not found.' }, 404);
  const token = await readSessionToken();
  if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 200);
  return relay(await getTicketingGateway().checkInSearch(token, id, q));
}

export async function POST(req: Request, { params }: Ctx) {
  const { id, action } = await params;
  if (!sameOriginRequest(req)) return forbiddenOrigin();
  if (!isIdentifier(id) || (action !== 'resolve' && action !== 'confirm' && action !== 'undo')) {
    return jsonResponse({ error: 'Not found.' }, 404);
  }
  const token = await readSessionToken();
  if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = await readJsonBody(req, 4 * 1024);
  if (!body) return jsonResponse({ error: 'Invalid body.' }, 400);

  // Accept a scanned/pasted ticket link as well as a bare token.
  const out: Record<string, string> = {};
  if (typeof body.attendee_id === 'string' && body.attendee_id) out.attendee_id = body.attendee_id;
  if (typeof body.ticket_token === 'string') {
    const parsed = extractTicketToken(body.ticket_token);
    if (!parsed) return jsonResponse({ error: 'Ticket not valid.', reason: 'not_found' }, 404);
    out.ticket_token = parsed;
  }
  return relay(await getTicketingGateway().checkInAction(token, id, action, out));
}
