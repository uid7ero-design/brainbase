import 'server-only';
import { checkoutCancelUrl, checkoutSuccessUrl, publicTicketUrl, currentEveLegalAcceptance, isDraftLegalVersion } from '@ticketing/core';
import { getPublicEventDetail } from '@/lib/events/publicEventDetail';
import { getPublicTicketDetail } from '@/lib/events/publicTicket';
import { getPublicBookingDetail } from '@/lib/events/publicBooking';
import { resolvePublicEvent } from '@/lib/events/publicResolve';
import { validatePublicRegistrationInput, type PublicRegistrationInput } from '@/lib/events/publicValidation';
import { startPaidCheckout } from '@/lib/events/services/paidCheckout';
import { paidCheckoutResultResponse } from '@/lib/events/paidCheckoutResponse';
import { freeRegistrationResultResponse } from '@/lib/events/freeRegistrationResponse';
import { registerFreeOrder } from '@/lib/events/services/freeRegistration';
import { generateTicketQrSvg } from '@/lib/events/qr';
import { syncEventOrderContact, recordEventBookingActivity } from '@/lib/crm/eventSync';
import { LIMITS, limit } from './rateLimit';
import { POST as publicQuote } from '@/app/api/public/events/[organisationSlug]/[eventSlug]/quote/route';
import { GET as publicCheckoutStatus } from '@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route';
import { checkTicketingGate } from './gate';
import { isEvePaidCheckoutAllowedForOrg, isEvePaidCheckoutEnabled } from './paidCheckoutFlag';
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

// Read-only answer to "would handleTicketingCheckout get past its
// configuration gates for this organisation right now?" — the same checks,
// from the same functions: the kill switch, the organisation allow-list, the
// product return-URL base, and the Production draft-legal guard. It only
// tells the buyer page whether to offer the paid flow; handleTicketingCheckout
// still enforces every one of these itself, so a client that ignores this
// answer is refused there (503, nothing reserved, no Stripe call).
function isEvePaidCheckoutAvailableFor(organisationSlug: string): boolean {
  if (!isEvePaidCheckoutEnabled() || !isEvePaidCheckoutAllowedForOrg(organisationSlug)) return false;
  if (!eveLinkBase()) return false;
  const legal = currentEveLegalAcceptance();
  if (process.env.VERCEL_ENV === 'production' && (isDraftLegalVersion(legal.termsVersion) || isDraftLegalVersion(legal.refundsVersion))) {
    return false;
  }
  return true;
}

export async function handleTicketingPublicEvent(req: Request, params: EventParams): Promise<Response> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate.response;
  if (!validEventParams(params)) return notAvailable();
  const result = await getPublicEventDetail(params.organisationSlug, params.eventSlug);
  if (!result.ok) return notAvailable();
  // One server-derived boolean; never the flag or allow-list values.
  return ticketingJson({ ...result.detail, paid_checkout_available: isEvePaidCheckoutAvailableFor(params.organisationSlug) });
}

export async function handleTicketingQuote(req: Request, params: EventParams): Promise<Response> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate.response;
  if (!validEventParams(params)) return notAvailable();
  // Shared (distributed) budget per buyer address and event; checked before the
  // quote is computed. Quotes have no side effects.
  if (!(await limit(LIMITS.publicQuote, [params.organisationSlug, params.eventSlug, ticketingClientIp(req)])).allowed) {
    return ticketingJson({ error: 'Too many requests. Please try again later.' }, 429);
  }
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
  const { organisationSlug, eventSlug } = params;

  // Same limiter key as the public register route: one budget per buyer
  // address and event, whichever product they register through.
  const ip = ticketingClientIp(req);
  // Checked before anything is read, validated or created: a 429 has no side effect.
  if (!(await limit(LIMITS.freeRegistration, [organisationSlug, eventSlug, ip], `public-events-register:${organisationSlug}:${eventSlug}:${ip}`)).allowed) {
    return ticketingJson({ error: 'Too many registration attempts. Please try again later.' }, 429);
  }

  const body = await readBodyText(req);
  if (body === null) return ticketingJson({ error: 'Invalid request body.' }, 400);
  let rawBody: PublicRegistrationInput;
  try {
    rawBody = JSON.parse(body);
  } catch {
    return ticketingJson({ error: 'Invalid request body.' }, 400);
  }
  const validated = validatePublicRegistrationInput(rawBody);
  if (typeof validated === 'string') return ticketingJson({ error: validated }, 400);

  const resolved = await resolvePublicEvent(organisationSlug, eventSlug);
  if (!resolved.ok) return notAvailable();
  const { organisationId, event } = resolved;

  // Calls the shared service directly (not the BrainBase route handler) so
  // the order is stamped with this entry point's product identity. The
  // identity comes from the gate above, never from the request body.
  const result = await registerFreeOrder({
    organisationId,
    event,
    validated,
    productSurface: 'EVE',
    // Same best-effort post-commit CRM hooks as the public register route.
    onCommitted: async (orderId) => {
      await syncEventOrderContact({
        organisationId,
        orderId,
        purchaserName: validated.purchaser_name,
        purchaserEmail: validated.purchaser_email,
        purchaserPhone: validated.purchaser_phone,
      });
      await recordEventBookingActivity({
        organisationId,
        orderId,
        eventName: event.name,
        quantity: validated.quantity,
        totalCents: 0,
        currency: 'AUD',
        paymentStatus: 'NOT_REQUIRED',
      });
    },
  });
  return freeRegistrationResultResponse(result);
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

  // Eve paid-checkout kill switch + organisation allow-list (both fail closed).
  // First thing after the gate: before the limiter, the body, the event lookup,
  // any reservation or order, and any Stripe call. The response is identical
  // for both and says nothing about Stripe or the organisation.
  if (!isEvePaidCheckoutEnabled() || !isEvePaidCheckoutAllowedForOrg(organisationSlug)) {
    return ticketingJson({ error: 'Paid checkout is not currently available.' }, 503);
  }

  // Same limiter key as the public checkout route: one budget per buyer
  // address and event, whichever product they check out through.
  const ip = ticketingClientIp(req);
  // Checked before any reservation, order or Stripe call: a 429 has no side effect.
  if (!(await limit(LIMITS.paidCheckout, [organisationSlug, eventSlug, ip], `public-events-checkout:${organisationSlug}:${eventSlug}:${ip}`)).allowed) {
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
  // Paid checkout needs explicit acceptance of the Terms and the Refunds &
  // cancellations policy. Checked HERE, server-side, before the event is
  // resolved or anything is reserved: the browser checkbox is only a prompt and
  // a client that omits or falsifies the field is refused. (Acceptance itself
  // is persisted on the order by startPaidCheckout — ADR 0013 — and never waives consumer
  // rights.)
  if ((rawBody as { accept_terms?: unknown } | null)?.accept_terms !== true) {
    return ticketingJson({ error: 'Please agree to the Terms and the Refunds & cancellations policy to continue.', code: 'TERMS_NOT_ACCEPTED' }, 400);
  }
  // Versions are trusted server constants, never request values. Production
  // refuses to record a draft version: it would be evidence of acceptance of
  // unpublished text.
  const legalAcceptance = currentEveLegalAcceptance();
  if (
    process.env.VERCEL_ENV === 'production' &&
    (isDraftLegalVersion(legalAcceptance.termsVersion) || isDraftLegalVersion(legalAcceptance.refundsVersion))
  ) {
    return ticketingJson({ error: 'Paid checkout is not currently available.' }, 503);
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
    // Product identity comes from this trusted entry point (the request has
    // passed the server-to-server gate), never from the request body.
    productSurface: 'EVE',
    legalAcceptance,
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
async function lookupAllowed(req: Request): Promise<boolean> {
  const ip = ticketingClientIp(req);
  return (await limit(LIMITS.ticketLookup, [ip], `public-ticket-lookup:${ip}`)).allowed;
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
  if (!(await lookupAllowed(req))) return ticketingJson({ error: 'Too many requests. Please try again later.' }, 429);
  if (!isIdentifier(token)) return ticketingJson({ error: 'Ticket not found.' }, 404);
  const result = await getPublicTicketDetail(token);
  if (!result.ok) return ticketingJson({ error: 'Ticket not found.' }, 404);
  return ticketingJson({ ...result.detail, qr_svg: await productTicketQr(token) });
}

export async function handleTicketingBooking(req: Request, bookingToken: string): Promise<Response> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate.response;
  if (!(await lookupAllowed(req))) return ticketingJson({ error: 'Too many requests. Please try again later.' }, 429);
  if (!isIdentifier(bookingToken)) return ticketingJson({ error: 'Booking not found.' }, 404);
  const result = await getPublicBookingDetail(bookingToken);
  if (!result.ok) return ticketingJson({ error: 'Booking not found.' }, 404);
  return ticketingJson(result.detail);
}
