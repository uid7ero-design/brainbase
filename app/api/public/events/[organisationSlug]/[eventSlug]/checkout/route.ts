import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { resolvePublicEvent } from '@/lib/events/publicResolve';
import { validatePublicRegistrationInput, type PublicRegistrationInput } from '@/lib/events/publicValidation';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';
import { startPaidCheckout, type PaidCheckoutResult } from '@/lib/events/services/paidCheckout';
import { syncEventOrderContact } from '@/lib/crm/eventSync';

type Ctx = { params: Promise<{ organisationSlug: string; eventSlug: string }> };

// HTTP adapter for the paid public checkout. Rate limiting, body
// parsing/shape validation and slug -> event resolution happen here;
// every business rule, the capacity-reserving transaction, the
// Checkout-vs-Retry race closure and Stripe Checkout Session creation
// live in lib/events/services/paidCheckout.ts (extracted unchanged —
// Eve Phase 1). This route translates that service's result into the
// exact same status codes and response bodies it has always returned.
//
// ── When attendees are created (§14) ─────────────────────────────────
//
// Chosen approach: attendee rows are created at reservation time,
// inside the same capacity-gated transaction as the free-registration
// route — WITHOUT a ticket_token (left NULL). The webhook issues
// ticket_token for each row only once payment_status flips to PAID
// (see lib/events/stripe.ts's issueTicketTokensForPaidOrder).
//
// This is a deliberate choice over creating attendees only inside the
// webhook (the brief's option B), for one overriding reason: it lets
// this flow reuse the EXACT same R1-fixed, harness-proven
// capacity-gated transaction shape as the free registration flow
// (see lib/events/services/freeRegistration.ts's extensive comment on
// the lock-order/fresh-snapshot technique), with the only changes being
// the extra payment columns and passing NULL for ticket_token — no new
// transaction shape needs independent concurrency proof from scratch.
// It also needs no new schema to hold attendee names between
// reservation and payment (no pending-attendees table, no Stripe
// metadata size risk for several attendees' names).
//
// The trade-off the brief names — "prefer the option that creates the
// fewest partial records" — is accepted deliberately: an abandoned
// paid checkout leaves attendee rows with a name/email but no
// ticket_token, tied to an order that is CANCELLED/EXPIRED once
// released. These rows are fully inert: ticket_token IS NULL makes
// them unreachable at /t/[token] (no token exists to link to) and
// unreachable via check-in (which requires resolving a token or an
// already-payment-valid order), and the backend orders panel shows the
// owning order as Cancelled/Expired, not a live registration. They are
// not a functional half-issued ticket at any point.
const CHECKOUT_FAILED = 'Checkout could not be started. Please try again.';

function toResponse(result: PaidCheckoutResult): NextResponse {
  if (result.ok) return NextResponse.json({ checkout_url: result.checkoutUrl }, { status: 201 });
  switch (result.code) {
    // Generic rejection for an anonymous purchaser — never Brainbase's
    // own internal Connect-status wording (that belongs only in the
    // authenticated backend UI).
    case 'NOT_ELIGIBLE':
      return NextResponse.json({ error: 'Paid tickets are not currently available for this event.' }, { status: 503 });
    case 'TICKET_TYPE_NOT_FOUND':
      return NextResponse.json({ error: 'Selected ticket type is not available for this event.' }, { status: 400 });
    case 'TICKET_TYPE_INACTIVE':
      return NextResponse.json({ error: 'Selected ticket type is not currently available.' }, { status: 400 });
    case 'TICKET_TYPE_FREE':
      return NextResponse.json({ error: 'This ticket type is free. Use the registration flow instead.' }, { status: 400 });
    // Phase 2 — an order is all-free or all-paid (see
    // lib/events/services/cart.ts).
    case 'MIXED_FREE_AND_PAID':
      return NextResponse.json({ error: 'Free and paid tickets must be booked in separate orders.' }, { status: 400 });
    case 'CURRENCY_MISMATCH':
      return NextResponse.json({ error: 'All tickets in one order must use the same currency.' }, { status: 400 });
    case 'SESSION_NOT_FOUND':
      return NextResponse.json({ error: 'Selected session is not available for this event.' }, { status: 400 });
    case 'RESPONSES_INVALID':
      return NextResponse.json({ error: result.message }, { status: 400 });
    case 'CAPACITY_UNAVAILABLE':
      return NextResponse.json(
        { error: 'This ticket type is no longer available in the requested quantity.' },
        { status: 409 },
      );
    case 'STRIPE_NOT_CONFIGURED':
      return NextResponse.json({ error: 'Paid checkout is not currently available.' }, { status: 503 });
    case 'RESERVATION_FAILED':
    case 'RESPONSE_WRITE_FAILED':
    case 'WRITE_BACK_RACE_LOST':
    case 'STRIPE_FAILED':
      return NextResponse.json({ error: CHECKOUT_FAILED }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { organisationSlug, eventSlug } = await params;

  const ip = getClientIp(req);
  const rateLimitKey = `public-events-checkout:${organisationSlug}:${eventSlug}:${ip}`;
  if (!checkRateLimit(rateLimitKey, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many checkout attempts. Please try again later.' }, { status: 429 });
  }

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

  const result = await startPaidCheckout({
    organisationId,
    event,
    validated,
    // Events -> CRM sync (Phase 5) — invoked by the service after the
    // order + responses have committed, BEFORE the Stripe redirect.
    // Payment is still PENDING at this point (matching Phase 5's
    // paid-registration behaviour spec: "create/update/reuse purchaser
    // CRM contact if safe to do so... payment may still be PENDING").
    // Deliberately NOT recording a booking activity here yet — that
    // happens once Stripe actually confirms payment (see
    // lib/events/stripe.ts's webhook handlers), so the activity reflects
    // a real payment outcome rather than an as-yet-unpaid reservation.
    // Best-effort and never throws (see lib/crm/eventSync.ts) — a CRM
    // failure here must never cancel the reservation or block the
    // Stripe redirect.
    onReserved: async (orderId) => {
      await syncEventOrderContact({
        organisationId,
        orderId,
        purchaserName: validated.purchaser_name,
        purchaserEmail: validated.purchaser_email,
        purchaserPhone: validated.purchaser_phone,
      });
    },
    buildReturnUrls: async () => {
      const h = await headers();
      const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
      const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
      const origin = `${proto}://${host}`;
      return {
        successUrl: `${origin}/e/${organisationSlug}/${eventSlug}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/e/${organisationSlug}/${eventSlug}?checkout=cancelled`,
      };
    },
  });

  return toResponse(result);
}
