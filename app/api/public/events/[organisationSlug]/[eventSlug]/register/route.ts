import { NextRequest, NextResponse } from 'next/server';
import { resolvePublicEvent } from '@/lib/events/publicResolve';
import { validatePublicRegistrationInput, type PublicRegistrationInput } from '@/lib/events/publicValidation';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';
import { registerFreeOrder, type FreeRegistrationResult } from '@/lib/events/services/freeRegistration';
import { syncEventOrderContact, recordEventBookingActivity } from '@/lib/crm/eventSync';

type Ctx = { params: Promise<{ organisationSlug: string; eventSlug: string }> };

// HTTP adapter for free public registration. Rate limiting, body
// parsing/shape validation and slug -> event resolution happen here;
// every business rule, the R1 capacity-gated transaction and the
// automatic ticket-email attempt live in
// lib/events/services/freeRegistration.ts (extracted unchanged — Eve
// Phase 1). This route translates that service's result into the exact
// same status codes and response bodies it has always returned.
//
// Fully anonymous — never calls requireSession()/requireRole()/
// getSession() or reads any cookie. organisationId is resolved exactly
// once, by resolvePublicEvent() from the URL's slug pair, and used for
// every subsequent query; the request body is never read for an
// organisation id, a price, a capability, or a role, and none would be
// trusted if present (see validatePublicRegistrationInput — those keys
// don't even exist in its accepted shape).
function toResponse(result: FreeRegistrationResult): NextResponse {
  if (result.ok) {
    // booking_token is the exact value minted and persisted by the same
    // atomic transaction (never a second token, never regenerated
    // here) — returned so a genuinely multi-attendee confirmation screen
    // can offer the booking-wallet link (/b/[bookingToken]/tickets)
    // alongside the individual ticket links it already returns. Matches
    // this response's own existing snake_case wire convention
    // (confirmation_reference, ticket_token, attendee_name).
    return NextResponse.json(
      { confirmation_reference: result.orderId, quantity: result.quantity, tickets: result.tickets, booking_token: result.bookingToken },
      { status: 201 },
    );
  }
  switch (result.code) {
    case 'TICKET_TYPE_NOT_FOUND':
      return NextResponse.json({ error: 'Selected ticket type is not available for this event.' }, { status: 400 });
    case 'TICKET_TYPE_INACTIVE':
      return NextResponse.json({ error: 'Selected ticket type is not currently available.' }, { status: 400 });
    case 'TICKET_TYPE_REQUIRES_PAYMENT':
      return NextResponse.json({ error: 'This ticket type requires payment. Use the checkout flow instead.' }, { status: 400 });
    // Phase 2 — an order is all-free or all-paid (see
    // lib/events/services/cart.ts).
    case 'MIXED_FREE_AND_PAID':
      return NextResponse.json({ error: 'Free and paid tickets must be booked in separate orders.' }, { status: 400 });
    case 'SESSION_NOT_FOUND':
      return NextResponse.json({ error: 'Selected session is not available for this event.' }, { status: 400 });
    case 'RESPONSES_INVALID':
      return NextResponse.json({ error: result.message }, { status: 400 });
    // Phase 4 — sale windows are enforced server-side at submit (a page
    // kept open across a boundary gets this 409, never a sale); access
    // and promotion codes fail with ONE generic message regardless of
    // why (unknown / inactive / expired / another event's code), so the
    // public API never reveals which codes exist elsewhere.
    case 'SALE_NOT_STARTED':
      return NextResponse.json({ error: 'Tickets for this selection are not on sale yet.' }, { status: 409 });
    case 'SALE_ENDED':
      return NextResponse.json({ error: 'Sales for this selection have ended.' }, { status: 409 });
    case 'ACCESS_CODE_REQUIRED':
      return NextResponse.json({ error: 'An access code is required for this selection.' }, { status: 400 });
    case 'ACCESS_CODE_INVALID':
      return NextResponse.json({ error: 'Code not valid.' }, { status: 400 });
    case 'PROMOTION_NOT_APPLICABLE':
      return NextResponse.json({ error: "This code can't be applied to this order." }, { status: 400 });
    // A DB/transaction failure must fail safely — never leak SQL, lock
    // state, organisation ids, or capability internals to an anonymous
    // caller.
    case 'TRANSACTION_FAILED':
      return NextResponse.json(
        { error: 'Registration could not be completed. Please try again.' },
        { status: 500 },
      );
    case 'CAPACITY_UNAVAILABLE':
      return NextResponse.json(
        { error: 'This ticket type is no longer available in the requested quantity.' },
        { status: 409 },
      );
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { organisationSlug, eventSlug } = await params;

  // Rate limit before any DB read/write — keyed by route + both slugs +
  // IP, so sustained abuse against one event cannot exhaust the
  // limiter's shared in-memory budget for every other event on the
  // platform. Uses the existing lib/rateLimit.ts (in-memory, resets on
  // cold start — the same accepted MVP limitation as every other public
  // endpoint in this repo; see that file's own header comment).
  const ip = getClientIp(req);
  const rateLimitKey = `public-events-register:${organisationSlug}:${eventSlug}:${ip}`;
  if (!checkRateLimit(rateLimitKey, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many registration attempts. Please try again later.' }, { status: 429 });
  }

  // Validate the request body's shape before touching the database at
  // all — structurally invalid input (bad quantity, malformed email, a
  // mismatched attendee count) can never depend on which event was
  // selected, so there is no reason to spend a DB round-trip resolving
  // one before rejecting garbage input.
  let rawBody: PublicRegistrationInput;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const validated = validatePublicRegistrationInput(rawBody);
  if (typeof validated === 'string') {
    return NextResponse.json({ error: validated }, { status: 400 });
  }

  const resolved = await resolvePublicEvent(organisationSlug, eventSlug);
  if (!resolved.ok) return NextResponse.json({ error: 'Event not available.' }, { status: 404 });
  const { organisationId, event } = resolved;

  const result = await registerFreeOrder({
    organisationId,
    event,
    validated,
    // Events -> CRM sync (Phase 5) — invoked by the service deliberately
    // AFTER the booking transaction has already committed, never inside
    // it: CRM must never hold up or fail a capacity-critical
    // registration. Both calls are best-effort and never throw (see
    // lib/crm/eventSync.ts) — a CRM failure here is logged and otherwise
    // invisible; the registration response is unconditional. Free
    // registrations are always immediately CONFIRMED (no PENDING stage),
    // so the booking activity is recorded in the same request rather
    // than waiting for a later webhook, matching Phase 5's own
    // free-registration behaviour spec.
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

  return toResponse(result);
}
