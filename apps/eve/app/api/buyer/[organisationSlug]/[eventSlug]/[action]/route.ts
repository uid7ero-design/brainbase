import { getTicketingGateway, type GatewayResult } from '@/lib/ticketing/gateway';
import { forbiddenOrigin, isIdentifier, jsonResponse, readJsonBody, sameOriginRequest, visitorIp } from '@/lib/requestGuards';

// Buyer actions for the public event page: the browser calls this origin;
// this server relays to the ticketing API. Nothing is decided here — the
// API owns validation, pricing, capacity, codes and payment; this route
// only relays the buyer's JSON and the API's answer (status and message).

type Ctx = { params: Promise<{ organisationSlug: string; eventSlug: string; action: string }> };

function relay<T>(result: GatewayResult<T>): Response {
  switch (result.status) {
    case 'ok': return jsonResponse(result.data);
    case 'not_found': return jsonResponse({ error: 'Event not available.' }, 404);
    case 'error': {
      // The API's buyer-facing messages are already generic and safe to show.
      const status = result.httpStatus >= 400 && result.httpStatus < 600 ? result.httpStatus : 502;
      return jsonResponse({ error: result.message }, status);
    }
    default: return jsonResponse({ error: 'Booking is unavailable right now. Please try again shortly.' }, 503);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { organisationSlug, eventSlug, action } = await params;
  if (!sameOriginRequest(req)) return forbiddenOrigin();
  if (!isIdentifier(organisationSlug) || !isIdentifier(eventSlug)) return jsonResponse({ error: 'Event not available.' }, 404);
  if (action !== 'quote' && action !== 'register' && action !== 'checkout') return jsonResponse({ error: 'Not found.' }, 404);

  const body = await readJsonBody(req);
  if (!body) return jsonResponse({ error: 'Invalid request body.' }, 400);
  return relay(await getTicketingGateway().buyerAction(organisationSlug, eventSlug, action, body, visitorIp(req)));
}

export async function GET(req: Request, { params }: Ctx) {
  const { organisationSlug, eventSlug, action } = await params;
  if (action !== 'status') return jsonResponse({ error: 'Not found.' }, 404);
  if (!isIdentifier(organisationSlug) || !isIdentifier(eventSlug)) return jsonResponse({ error: 'Event not available.' }, 404);
  const sessionId = new URL(req.url).searchParams.get('session_id') ?? '';
  if (!sessionId || sessionId.length > 255) return jsonResponse({ error: 'Missing session_id.' }, 400);
  return relay(await getTicketingGateway().getCheckoutStatus(organisationSlug, eventSlug, sessionId, visitorIp(req)));
}
