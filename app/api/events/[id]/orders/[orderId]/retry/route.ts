import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { createCheckoutSession, RESERVATION_WINDOW_SECONDS, StripeNotConfiguredError } from '@/lib/events/stripe';

type Ctx = { params: Promise<{ id: string; orderId: string }> };

type OrderRow = {
  id: string; payment_status: string; purchaser_email: string; total_cents: number; currency: string; stripe_account_id: string | null;
};
type ItemRow = { ticket_type_id: string; event_session_id: string | null; quantity: number };
type TicketTypeRow = { id: string; name: string; active: boolean; price_cents: number; currency: string };

// POST — retry payment for a PENDING order (§A.2). manager+.
//
// Reuses the SAME order/order_item/attendee rows throughout — never
// inserts a new order or new attendees, so "do not create duplicate
// attendees/ticket entitlements" holds by construction: this route
// contains no INSERT into event_orders, event_order_items, or
// event_attendees anywhere. Ticket tokens remain untouched (still
// exclusively issued by lib/events/stripe.ts's
// issueTicketTokensForPaidOrder, gated on payment_status = 'PAID') —
// a retried-then-paid order becomes usable through the EXACT same
// webhook path a first-attempt payment already uses.
//
// Capacity is re-validated and the hold extended via a SINGLE atomic
// UPDATE, reusing the R1 lock-order technique (FOR UPDATE on
// ticket_type, then session if bound, then a fresh-snapshot capacity
// check) the checkout/register routes established — see this route's
// own SQL comment below for why one code path safely covers both "the
// old hold technically hadn't expired yet" and "the old hold had
// already lapsed and this reacquires it": the aggregate always
// excludes THIS order's own existing quantity (it is not new demand,
// it is the same demand being re-confirmed), so a fresh capacity
// check against everyone ELSE's current holdings is always correct
// regardless of which case applies.
//
// Connected-account attribution is PRESERVED (§14/§A.2): the retry
// uses the order's own already-stored stripe_account_id, never
// re-derived from the organisation's current Connect settings — the
// identical principle the refund route already applies.
export async function POST(_req: Request, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId } = await params;

  // Step 7 remediation: organisation/event slugs for the branded
  // return URLs below are resolved HERE, server-side, from the same
  // tenant-scoped query that already verifies event ownership —
  // never from the request body. There is deliberately no slug input
  // read anywhere in this route at all, so there is nothing for a
  // hostile/mismatched client value to override: the only slugs that
  // can ever reach createCheckoutSession()'s success/cancel URLs are
  // the ones this organisation's own database rows actually have.
  const eventRows = await sql`
    SELECT e.id, e.status, e.slug AS event_slug, o.slug AS org_slug
    FROM events e JOIN organisations o ON o.id = e.organisation_id
    WHERE e.id = ${eventId} AND e.organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  const event = eventRows[0] as { id: string; status: string; event_slug: string; org_slug: string } | undefined;
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (event.status === 'CANCELLED') {
    return NextResponse.json({ error: 'This event has been cancelled.' }, { status: 409 });
  }

  const orderRows = await sql`
    SELECT id, payment_status, purchaser_email, total_cents, currency, stripe_account_id
    FROM event_orders WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  const order = orderRows[0] as OrderRow | undefined;
  if (!order) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (order.payment_status !== 'PENDING') {
    return NextResponse.json({ error: 'Only a pending payment can be retried.' }, { status: 409 });
  }
  if (!order.stripe_account_id) {
    return NextResponse.json({ error: 'This order has no associated Stripe account to retry against.' }, { status: 409 });
  }

  const itemRows = await sql`
    SELECT ticket_type_id, event_session_id, quantity FROM event_order_items
    WHERE order_id = ${orderId} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  const item = itemRows[0] as ItemRow | undefined;
  if (!item) return NextResponse.json({ error: 'Order has no ticket line item.' }, { status: 409 });

  const ttRows = await sql`
    SELECT id, name, active, price_cents, currency FROM event_ticket_types
    WHERE id = ${item.ticket_type_id} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  const ticketType = ttRows[0] as TicketTypeRow | undefined;
  if (!ticketType || !ticketType.active) {
    return NextResponse.json({ error: 'The ticket type for this order is no longer available.' }, { status: 409 });
  }

  // ── Atomic capacity reacquisition ────────────────────────────────────
  // Excludes THIS order (`eo.id <> ${orderId}`) from the "sold" count on
  // both ticket-type and session aggregates — see this file's own header
  // comment for why that single exclusion makes one code path correct
  // whether the old hold had lapsed or not. Extends expires_at to a
  // fresh RESERVATION_WINDOW_SECONDS from now and clears the stale
  // stripe_checkout_session_id (a new one is about to be created below)
  // — both only if capacity genuinely allows it.
  let transactionResults: unknown[];
  try {
    transactionResults = item.event_session_id
      ? await sql.transaction([
          sql`SELECT capacity FROM event_ticket_types WHERE id = ${item.ticket_type_id} AND organisation_id = ${session.organisationId} FOR UPDATE`,
          sql`SELECT capacity FROM event_sessions WHERE id = ${item.event_session_id} AND organisation_id = ${session.organisationId} FOR UPDATE`,
          sql`
            WITH sold_tt AS (
              SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
              WHERE oi.ticket_type_id = ${item.ticket_type_id} AND oi.organisation_id = ${session.organisationId} AND eo.id <> ${orderId}
                AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
            ),
            sold_sess AS (
              SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
              WHERE oi.event_session_id = ${item.event_session_id} AND oi.organisation_id = ${session.organisationId} AND eo.id <> ${orderId}
                AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
            )
            UPDATE event_orders eo
            SET expires_at = NOW() + make_interval(secs => ${RESERVATION_WINDOW_SECONDS}), stripe_checkout_session_id = NULL
            FROM sold_tt, sold_sess
            WHERE eo.id = ${orderId} AND eo.organisation_id = ${session.organisationId} AND eo.payment_status = 'PENDING'
              AND sold_tt.qty + ${item.quantity} <= (SELECT capacity FROM event_ticket_types WHERE id = ${item.ticket_type_id} AND organisation_id = ${session.organisationId})
              AND sold_sess.qty + ${item.quantity} <= (SELECT capacity FROM event_sessions WHERE id = ${item.event_session_id} AND organisation_id = ${session.organisationId})
            RETURNING eo.id
          `,
        ])
      : await sql.transaction([
          sql`SELECT capacity FROM event_ticket_types WHERE id = ${item.ticket_type_id} AND organisation_id = ${session.organisationId} FOR UPDATE`,
          sql`
            WITH sold_tt AS (
              SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
              WHERE oi.ticket_type_id = ${item.ticket_type_id} AND oi.organisation_id = ${session.organisationId} AND eo.id <> ${orderId}
                AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
            )
            UPDATE event_orders eo
            SET expires_at = NOW() + make_interval(secs => ${RESERVATION_WINDOW_SECONDS}), stripe_checkout_session_id = NULL
            FROM sold_tt
            WHERE eo.id = ${orderId} AND eo.organisation_id = ${session.organisationId} AND eo.payment_status = 'PENDING'
              AND sold_tt.qty + ${item.quantity} <= (SELECT capacity FROM event_ticket_types WHERE id = ${item.ticket_type_id} AND organisation_id = ${session.organisationId})
            RETURNING eo.id
          `,
        ]);
  } catch (err) {
    console.error('[events order retry] capacity reacquisition failed', err);
    return NextResponse.json({ error: 'Could not retry payment. Please try again.' }, { status: 500 });
  }

  const reacquired = transactionResults[transactionResults.length - 1] as { id: string }[];
  if (!reacquired.length) {
    return NextResponse.json({ error: 'This ticket type is no longer available in the requested quantity.' }, { status: 409 });
  }

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${proto}://${host}`;

  // Always the branded public return flow (§7) — event.org_slug/
  // event.event_slug came from the tenant-scoped query above, never
  // from client input, so there is no generic manager-route fallback
  // to fall back to: an authoritative slug pair is available on every
  // request that reaches this point (an event with no slug cannot
  // exist — slug is NOT NULL in this schema).
  const successUrl = `${origin}/e/${event.org_slug}/${event.event_slug}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/e/${event.org_slug}/${event.event_slug}?checkout=cancelled`;

  try {
    const { sessionId, url } = await createCheckoutSession({
      organisationId: session.organisationId,
      eventId,
      orderId,
      ticketTypeName: ticketType.name,
      unitAmountCents: ticketType.price_cents,
      currency: order.currency,
      quantity: item.quantity,
      purchaserEmail: order.purchaser_email,
      successUrl,
      cancelUrl,
      connectedAccountId: order.stripe_account_id,
    });
    await sql`UPDATE event_orders SET stripe_checkout_session_id = ${sessionId} WHERE id = ${orderId} AND organisation_id = ${session.organisationId}`;
    return NextResponse.json({ checkout_url: url });
  } catch (err) {
    // Capacity has already been re-extended above (a real, live hold —
    // not left dangling) — a manager can simply retry again. Unlike a
    // brand-new checkout attempt, there is no "just-created, otherwise
    // orphaned" reservation to roll back here: this order already
    // existed for a legitimate reason before this request began.
    if (err instanceof StripeNotConfiguredError) {
      console.error('[events order retry] Stripe is not configured', err);
      return NextResponse.json({ error: 'Stripe is not currently configured.' }, { status: 503 });
    }
    console.error('[events order retry] Stripe Checkout Session creation failed', err);
    return NextResponse.json({ error: 'Could not create a new checkout session. Please try again.' }, { status: 500 });
  }
}
