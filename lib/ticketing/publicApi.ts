import 'server-only';
import { checkoutCancelUrl, checkoutSuccessUrl, publicTicketUrl } from '@ticketing/core';
import { getPublicEventDetail } from '@/lib/events/publicEventDetail';
import { getPublicTicketDetail } from '@/lib/events/publicTicket';
import { getPublicBookingDetail } from '@/lib/events/publicBooking';
import { resolvePublicEvent } from '@/lib/events/publicResolve';
import { validatePublicRegistrationInput, type PublicRegistrationInput } from '@/lib/events/publicValidation';
import { startPaidCheckout } from '@/lib/events/services/paidCheckout';
import { paidCheckoutResultResponse } from '@/lib/events/paidCheckoutResponse';
import { generateTicketQrSvg } from '@/lib/events/qr';
import { syncEventOrderContact } from '@/lib/crm/eventSync';
import { checkRateLimit } from '@/lib/rateLimit';
import { POST as publicQuote } from '@/app/api/public/events/[organisationSlug]/[eventSlug]/quote/route';
import { POST as publicRegister } from '@/app/api/public/events/[organisationSlug]/[eventSlug]/register/route';
import { GET as publicCheckoutStatus } from '@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route';
import { checkTicketingGate } from './gate';
import {
  delegatedRequest,
  eveLinkBase,
  isIdentifier,
  readBodyText,
  reissue,
  ticketingClientIp,
  ticketingJson,
} from './http';

// Buyer-facing half of the ticketing API, for the standalone product's
// server. Every handler passes the server-to-server gate first; none takes a
// user session (these are the same anonymous flows as /api/public/events).
//
// Reuse, not re-implementation: the event/ticket/wallet reads call the same
// public-safe readers the BrainBase pages use; quote, register and checkout
// status invoke the existing public route handlers themselves (same
// validation, rate-limit keys, SQL and response bodies). Paid checkout
// calls the same startPaidCheckout() service as the public checkout route —
// the one difference is the hosted-checkout return URLs, which must point at
// the product's own origin (EVE_PUBLIC_BASE_URL) instead of this host.

type EventParams = { organisationSlug: string; eventSlug: string };

const notAvailable = () => ticketingJson({ error: 'Event not available.' }, 404);

function eventPath({ organisationSlug, eventSlug }: EventParams, suffix = ''): string {
  return `/api/public/events/${encodeURIComponent(organisationSlug)}/${encodeURIComponent(eventSlug)}${suffix}`;
}

function validEventParams(p: EventParams): boolean {
  return isIdentifier(p.organisationSlug) && isIdentifier(p.eventSlug);
}

export async function handleTicketingPublicEvent(req: Request, params: EventParams): Promise<Response> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate.response;
  if (!validEventParams(params)) return notAvailable();
  const result = await getPublicEventDetail(params.organisationSlug, params.eventSlug);
  if (!result.ok) return notAvailable();
  return ticketingJson(result.detail);
}

export async function handleTicketingQuote(req: Request, params: EventParams): Promise<Response> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate.response;
  if (!validEventParams(params)) return notAvailable();
  const body = await readBodyText(req);
  if (body === null) return ticketingJson({ error: 'Invalid request body.' }, 400);
  const res = await publicQuote(delegatedRequest(req, eventPath(params, '/quote'), { method: 'POST', body }), {
    params: Promise.resolve(params),
  });
  return reissue(res);
}

export async function handleTicketingRegister(req: Request, params: EventParams): Promise<Response> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate.response;
  if (!validEventParams(params)) return notAvailable();
  const body = await readBodyText(req);
  if (body === null) return ticketingJson({ error: 'Invalid request body.' }, 400);
  const res = await publicRegister(delegatedRequest(req, eventPath(params, '/register'), { method: 'POST', body }), {
    params: Promise.resolve(params),
  });
  return reissue(res);
}

export async function handleTicketingCheckoutStatus(req: Request, params: EventParams): Promise<Response> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate.response;
  if (!validEventParams(params)) return notAvailable();
  const sessionId = new URL(req.url).searchParams.get('session_id') ?? '';
  if (!sessionId || sessionId.length > 255) return ticketingJson({ error: 'Missing session_id.' }, 400);
  const search = `?${new URLSearchParams({ session_id: sessionId })}`;
  const res = await publicCheckoutStatus(delegatedRequest(req, eventPath(params, '/checkout/status'), { method: 'GET', search }), {
    params: Promise.resolve(params),
  });
  return reissue(res);
}

export async function handleTicketingCheckout(req: Request, params: EventParams): Promise<Response> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate.response;
  if (!validEventParams(params)) return notAvailable();
  const { organisationSlug, eventSlug } = params;

  // Same limiter key as the public checkout route: one budget per buyer
  // address and event, whichever product they check out through.
  const ip = ticketingClientIp(req);
  if (!checkRateLimit(`public-events-checkout:${organisationSlug}:${eventSlug}:${ip}`, 10, 60 * 60_000)) {
    return ticketingJson({ error: 'Too many checkout attempts. Please try again later.' }, 429);
  }

  // Refuse before reserving anything if this deployment cannot mint a
  // return URL for the product.
  const links = eveLinkBase();
  if (!links) return ticketingJson({ error: 'Paid checkout is not currently available.' }, 503);

  let rawBody: PublicRegistrationInput;
  try {
    rawBody = await req.json();
  } catch {
    return ticketingJson({ error: 'Invalid request body.' }, 400);
  }
  const validated = validatePublicRegistrationInput(rawBody);
  if (typeof validated === 'string') return ticketingJson({ error: validated }, 400);

  const resolved = await resolvePublicEvent(organisationSlug, eventSlug);
  if (!resolved.ok) return notAvailable();
  const { organisationId, event } = resolved;

  const result = await startPaidCheckout({
    organisationId,
    event,
    validated,
    // Same best-effort CRM hook as the public checkout route (purchaser
    // contact only; never attendees or answers).
    onReserved: async (orderId) => {
      await syncEventOrderContact({
        organisationId,
        orderId,
        purchaserName: validated.purchaser_name,
        purchaserEmail: validated.purchaser_email,
        purchaserPhone: validated.purchaser_phone,
      });
    },
    buildReturnUrls: async () => ({
      successUrl: checkoutSuccessUrl(links, organisationSlug, eventSlug),
      cancelUrl: checkoutCancelUrl(links, organisationSlug, eventSlug),
    }),
  });
  return paidCheckoutResultResponse(result);
}

// Same per-IP budget and key as the public ticket API route.
function lookupAllowed(req: Request): boolean {
  return checkRateLimit(`public-ticket-lookup:${ticketingClientIp(req)}`, 60, 60 * 60_000);
}

// The QR encodes the product's own ticket link (the same value its check-in
// accepts), rendered by BrainBase's QR helper so the product needs no QR
// dependency. Null when the product origin is not configured.
async function productTicketQr(ticketToken: string): Promise<string | null> {
  const links = eveLinkBase();
  if (!links) return null;
  try {
    return await generateTicketQrSvg(publicTicketUrl(links, ticketToken));
  } catch {
    return null;
  }
}

export async function handleTicketingTicket(req: Request, token: string): Promise<Response> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate.response;
  if (!lookupAllowed(req)) return ticketingJson({ error: 'Too many requests. Please try again later.' }, 429);
  if (!isIdentifier(token)) return ticketingJson({ error: 'Ticket not found.' }, 404);
  const result = await getPublicTicketDetail(token);
  if (!result.ok) return ticketingJson({ error: 'Ticket not found.' }, 404);
  return ticketingJson({ ...result.detail, qr_svg: await productTicketQr(token) });
}

export async function handleTicketingBooking(req: Request, bookingToken: string): Promise<Response> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate.response;
  if (!lookupAllowed(req)) return ticketingJson({ error: 'Too many requests. Please try again later.' }, 429);
  if (!isIdentifier(bookingToken)) return ticketingJson({ error: 'Booking not found.' }, 404);
  const result = await getPublicBookingDetail(bookingToken);
  if (!result.ok) return ticketingJson({ error: 'Booking not found.' }, 404);
  return ticketingJson(result.detail);
}
