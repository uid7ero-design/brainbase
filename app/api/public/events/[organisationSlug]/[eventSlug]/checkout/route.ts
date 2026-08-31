import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import sql from '@/lib/db';
import { resolvePublicEvent } from '@/lib/events/publicResolve';
import { validatePublicRegistrationInput, type PublicRegistrationInput } from '@/lib/events/publicValidation';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';
import { createCheckoutSession, RESERVATION_WINDOW_SECONDS, StripeNotConfiguredError } from '@/lib/events/stripe';
import { checkPaidTicketingEligibility } from '@/lib/events/stripeConnect';
import { listActiveQuestions, validateSubmittedResponses, writeRegistrationResponses } from '@/lib/events/registrationQuestions';
import { syncEventOrderContact } from '@/lib/crm/eventSync';

type Ctx = { params: Promise<{ organisationSlug: string; eventSlug: string }> };

// ── When attendees are created (§14) ─────────────────────────────────
//
// Chosen approach: attendee rows are created HERE, at reservation time,
// inside the same capacity-gated transaction as the free-registration
// route — WITHOUT a ticket_token (left NULL). The webhook issues
// ticket_token for each row only once payment_status flips to PAID
// (see lib/events/stripe.ts's issueTicketTokensForPaidOrder).
//
// This is a deliberate choice over creating attendees only inside the
// webhook (the brief's option B), for one overriding reason: it lets
// this route reuse the EXACT same R1-fixed, harness-proven
// capacity-gated transaction shape as the free registration route
// (see that route's own extensive comment on the lock-order/fresh-
// snapshot technique), with the only changes being the extra payment
// columns and passing NULL for ticket_token — no new transaction shape
// needs independent concurrency proof from scratch. It also needs no
// new schema to hold attendee names between reservation and payment
// (no pending-attendees table, no Stripe metadata size risk for
// several attendees' names).
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

  // Phase 4A paid-ticketing gate (§10): checked before anything else
  // that would consume capacity — an anonymous purchaser gets a clean,
  // generic rejection (never Brainbase's own internal Connect-status
  // wording; that belongs only in the authenticated backend UI) rather
  // than a reservation that could never actually be paid for.
  const eligibility = await checkPaidTicketingEligibility(organisationId);
  if (!eligibility.eligible) {
    return NextResponse.json({ error: 'Paid tickets are not currently available for this event.' }, { status: 503 });
  }
  const connectedAccountId = eligibility.accountId;

  // This route is the PAID path only — price must be > 0. A free
  // ticket type must go through the free-registration route instead
  // (see that route's own updated comment); this is not merely a
  // mirror-image check, it is the thing that keeps free orders from
  // ever touching Stripe at all (§6).
  const ticketTypeRows = await sql`
    SELECT id, active, price_cents, currency, name FROM event_ticket_types
    WHERE id = ${validated.ticket_type_id} AND organisation_id = ${organisationId} AND event_id = ${event.id}
    LIMIT 1
  `;
  const ticketType = ticketTypeRows[0] as { id: string; active: boolean; price_cents: number; currency: string; name: string } | undefined;
  if (!ticketType) {
    return NextResponse.json({ error: 'Selected ticket type is not available for this event.' }, { status: 400 });
  }
  if (!ticketType.active) {
    return NextResponse.json({ error: 'Selected ticket type is not currently available.' }, { status: 400 });
  }
  if (ticketType.price_cents === 0) {
    return NextResponse.json({ error: 'This ticket type is free. Use the registration flow instead.' }, { status: 400 });
  }

  if (validated.event_session_id) {
    const sessionRows = await sql`
      SELECT id FROM event_sessions
      WHERE id = ${validated.event_session_id} AND organisation_id = ${organisationId} AND event_id = ${event.id}
      LIMIT 1
    `;
    if (!sessionRows.length) {
      return NextResponse.json({ error: 'Selected session is not available for this event.' }, { status: 400 });
    }
  }

  // Phase 4B §5/§8 — identical server-authoritative validation as the
  // free registration route (see that file's own comment), run before
  // any capacity is reserved for this paid attempt either.
  const activeQuestions = await listActiveQuestions(organisationId, event.id);
  const validatedResponses = validateSubmittedResponses(
    activeQuestions,
    validated.order_responses,
    validated.attendees.map(a => a.responses),
  );
  if (typeof validatedResponses === 'string') {
    return NextResponse.json({ error: validatedResponses }, { status: 400 });
  }

  const attendeeNames = validated.attendees.map(a => a.name);
  const attendeeEmails = validated.attendees.map(a => a.email ?? '');
  const totalCents = ticketType.price_cents * validated.quantity;

  // ── Capacity-reserving transaction (§8/§9) ──────────────────────────
  //
  // Identical lock order and statement-sequencing discipline as the
  // free registration route's own R1-fixed transaction (see that
  // file's extensive comment — not reproduced here verbatim, but every
  // invariant it documents applies unchanged): lock ticket_type (then
  // session, if any) FOR UPDATE first; only after that lock is granted
  // does the capacity-gated INSERT run as its own statement, so it
  // observes a fresh, post-lock snapshot of sold quantity under READ
  // COMMITTED.
  //
  // The one substantive difference: the "sold" aggregate now also
  // excludes a PENDING paid reservation whose expires_at has passed —
  // `AND (payment_status <> 'PENDING' OR expires_at > NOW())`. A free/
  // NOT_REQUIRED order (payment_status never 'PENDING') and a
  // currently-valid pending paid reservation both still count, exactly
  // preserving existing behaviour; only a STALE pending reservation is
  // excluded, and it is excluded by a plain time comparison evaluated
  // fresh inside this same post-lock statement — not dependent on the
  // `checkout.session.expired` webhook ever having arrived (§17).
  let transactionResults: unknown[];
  try {
    transactionResults = validated.event_session_id
      ? await sql.transaction([
          sql`SELECT capacity FROM event_ticket_types WHERE id = ${validated.ticket_type_id} AND organisation_id = ${organisationId} FOR UPDATE`,
          sql`SELECT capacity FROM event_sessions WHERE id = ${validated.event_session_id} AND organisation_id = ${organisationId} FOR UPDATE`,
          sql`
            WITH sold_tt AS (
              SELECT COALESCE(SUM(oi.quantity), 0) AS qty
              FROM event_order_items oi
              JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
              WHERE oi.ticket_type_id = ${validated.ticket_type_id} AND oi.organisation_id = ${organisationId}
                AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
            ),
            sold_sess AS (
              SELECT COALESCE(SUM(oi.quantity), 0) AS qty
              FROM event_order_items oi
              JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
              WHERE oi.event_session_id = ${validated.event_session_id} AND oi.organisation_id = ${organisationId}
                AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
            ),
            ins_order AS (
              INSERT INTO event_orders (
                organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone,
                status, total_cents, payment_status, payment_provider, currency, expires_at, stripe_account_id
              )
              SELECT
                ${organisationId}, ${event.id}, ${validated.purchaser_name}, ${validated.purchaser_email}, ${validated.purchaser_phone},
                'PENDING', ${totalCents}, 'PENDING', 'stripe', ${ticketType.currency}, NOW() + make_interval(secs => ${RESERVATION_WINDOW_SECONDS}), ${connectedAccountId}
              FROM sold_tt, sold_sess
              WHERE sold_tt.qty + ${validated.quantity} <= (SELECT capacity FROM event_ticket_types WHERE id = ${validated.ticket_type_id} AND organisation_id = ${organisationId})
                AND sold_sess.qty + ${validated.quantity} <= (SELECT capacity FROM event_sessions WHERE id = ${validated.event_session_id} AND organisation_id = ${organisationId})
              RETURNING id
            ),
            ins_item AS (
              INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
              SELECT ${organisationId}, ins_order.id, ${event.id}, ${validated.ticket_type_id}, ${validated.event_session_id}, ${validated.quantity}, ${ticketType.price_cents}
              FROM ins_order
              RETURNING id, order_id
            )
            INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
            SELECT ${organisationId}, ${event.id}, ins_item.order_id, ins_item.id, a.name, NULLIF(a.email, '')
            FROM ins_item, UNNEST(${attendeeNames}::text[], ${attendeeEmails}::text[]) AS a(name, email)
            RETURNING id, order_id
          `,
        ])
      : await sql.transaction([
          sql`SELECT capacity FROM event_ticket_types WHERE id = ${validated.ticket_type_id} AND organisation_id = ${organisationId} FOR UPDATE`,
          sql`
            WITH sold_tt AS (
              SELECT COALESCE(SUM(oi.quantity), 0) AS qty
              FROM event_order_items oi
              JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
              WHERE oi.ticket_type_id = ${validated.ticket_type_id} AND oi.organisation_id = ${organisationId}
                AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
            ),
            ins_order AS (
              INSERT INTO event_orders (
                organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone,
                status, total_cents, payment_status, payment_provider, currency, expires_at, stripe_account_id
              )
              SELECT
                ${organisationId}, ${event.id}, ${validated.purchaser_name}, ${validated.purchaser_email}, ${validated.purchaser_phone},
                'PENDING', ${totalCents}, 'PENDING', 'stripe', ${ticketType.currency}, NOW() + make_interval(secs => ${RESERVATION_WINDOW_SECONDS}), ${connectedAccountId}
              FROM sold_tt
              WHERE sold_tt.qty + ${validated.quantity} <= (SELECT capacity FROM event_ticket_types WHERE id = ${validated.ticket_type_id} AND organisation_id = ${organisationId})
              RETURNING id
            ),
            ins_item AS (
              INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
              SELECT ${organisationId}, ins_order.id, ${event.id}, ${validated.ticket_type_id}, NULL, ${validated.quantity}, ${ticketType.price_cents}
              FROM ins_order
              RETURNING id, order_id
            )
            INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
            SELECT ${organisationId}, ${event.id}, ins_item.order_id, ins_item.id, a.name, NULLIF(a.email, '')
            FROM ins_item, UNNEST(${attendeeNames}::text[], ${attendeeEmails}::text[]) AS a(name, email)
            RETURNING id, order_id
          `,
        ]);
  } catch (err) {
    console.error('[public checkout] reservation transaction failed', err);
    return NextResponse.json({ error: 'Checkout could not be started. Please try again.' }, { status: 500 });
  }

  const insertResult = transactionResults[transactionResults.length - 1] as { id: string; order_id: string }[];
  if (!insertResult.length) {
    return NextResponse.json(
      { error: 'This ticket type is no longer available in the requested quantity.' },
      { status: 409 },
    );
  }
  const orderId = insertResult[0].order_id;

  // Phase 4B §8 — responses MUST be persisted before the Stripe
  // redirect: they need to survive the browser leaving and coming back,
  // and retry payment (which never re-touches attendees/responses, see
  // that route) must never need to recreate them. Unlike the free
  // route, a write failure here is treated as fatal — the reservation
  // is released with the exact same compensating-cancellation pattern
  // already used below for a Stripe Checkout Session creation failure,
  // rather than sending an anonymous purchaser into a paid checkout
  // whose attendee-requirement answers are already lost.
  try {
    await writeRegistrationResponses(organisationId, event.id, orderId, insertResult.map(row => row.id), validatedResponses);
  } catch (err) {
    console.error('[public checkout] response write failed, releasing reservation', err, { orderId });
    await sql`UPDATE event_orders SET status = 'CANCELLED', payment_status = 'FAILED' WHERE id = ${orderId} AND payment_status = 'PENDING'`;
    return NextResponse.json({ error: 'Checkout could not be started. Please try again.' }, { status: 500 });
  }

  // Events -> CRM sync (Phase 5) — after the order + responses have
  // committed, BEFORE the Stripe redirect. Payment is still PENDING at
  // this point (matching Phase 5's paid-registration behaviour spec:
  // "create/update/reuse purchaser CRM contact if safe to do so...
  // payment may still be PENDING"). Deliberately NOT recording a
  // booking activity here yet — that happens once Stripe actually
  // confirms payment (see lib/events/stripe.ts's webhook handlers),
  // so the activity reflects a real payment outcome rather than an
  // as-yet-unpaid reservation. Best-effort and never throws (see
  // lib/crm/eventSync.ts) — a CRM failure here must never cancel the
  // reservation or block the Stripe redirect below.
  await syncEventOrderContact({
    organisationId,
    orderId,
    purchaserName: validated.purchaser_name,
    purchaserEmail: validated.purchaser_email,
    purchaserPhone: validated.purchaser_phone,
  });

  // ── Stripe Checkout Session creation ────────────────────────────────
  //
  // If this fails (network error, misconfiguration), the reservation
  // just created must not be left as an indefinite hold — release it
  // immediately rather than waiting 30 minutes for expiry. Safe to do
  // unconditionally: this order was created by THIS request and has no
  // stripe_checkout_session_id yet, so nothing else can be racing on it.
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${proto}://${host}`;

  try {
    const { sessionId, url } = await createCheckoutSession({
      organisationId,
      eventId: event.id,
      orderId,
      ticketTypeName: ticketType.name,
      unitAmountCents: ticketType.price_cents,
      currency: ticketType.currency,
      quantity: validated.quantity,
      purchaserEmail: validated.purchaser_email,
      successUrl: `${origin}/e/${organisationSlug}/${eventSlug}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/e/${organisationSlug}/${eventSlug}?checkout=cancelled`,
      connectedAccountId,
    });

    await sql`UPDATE event_orders SET stripe_checkout_session_id = ${sessionId} WHERE id = ${orderId}`;
    return NextResponse.json({ checkout_url: url }, { status: 201 });
  } catch (err) {
    await sql`UPDATE event_orders SET status = 'CANCELLED', payment_status = 'FAILED' WHERE id = ${orderId} AND payment_status = 'PENDING'`;
    if (err instanceof StripeNotConfiguredError) {
      console.error('[public checkout] Stripe is not configured', err);
      return NextResponse.json({ error: 'Paid checkout is not currently available.' }, { status: 503 });
    }
    console.error('[public checkout] Stripe Checkout Session creation failed', err);
    return NextResponse.json({ error: 'Checkout could not be started. Please try again.' }, { status: 500 });
  }
}
