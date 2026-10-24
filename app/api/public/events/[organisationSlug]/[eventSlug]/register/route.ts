import { NextRequest, NextResponse } from 'next/server';
import { resolvePublicEvent } from '@/lib/events/publicResolve';
import { validatePublicRegistrationInput, type PublicRegistrationInput } from '@/lib/events/publicValidation';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';
import { freeRegistrationResultResponse } from '@/lib/events/freeRegistrationResponse';
import { registerFreeOrder } from '@/lib/events/services/freeRegistration';
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
    // Phase 3.1 - trusted entry point: this is BrainBase's own public route.
    productSurface: 'BRAINBASE',
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

  return freeRegistrationResultResponse(result);
}
