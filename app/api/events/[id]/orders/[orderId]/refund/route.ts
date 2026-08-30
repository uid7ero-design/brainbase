import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { createRefund } from '@/lib/events/stripe';

type Ctx = { params: Promise<{ id: string; orderId: string }> };

// POST — full refund only (§22). manager+, matching every other
// Events mutation's role convention (see the check-in confirm route's
// identical rationale, which applies unchanged here).
//
// §23 "cancellation does not silently imply refund; if refund also
// cancels tickets, make that explicit" — this route DOES also cancel
// the order (`status = 'CANCELLED'`) as part of the same refund
// action, deliberately: a refunded paid ticket must not remain a valid
// scannable ticket (§24), and this codebase has no separate concept of
// "refunded but still admits the holder". A manager wanting to cancel
// an order WITHOUT refunding a payment that was never taken (i.e. a
// free order, or before ever charging) has no need for this route at
// all — cancellation-without-refund is not implemented in Phase 4
// because nothing in the current product model creates a paid,
// non-refundable, cancellable order; this route is the only paid-order
// cancellation path that exists, and it is unconditionally also a
// refund.
export async function POST(_req: Request, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId } = await params;

  const eventRows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${session.organisationId} LIMIT 1`;
  if (!eventRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const orderRows = await sql`
    SELECT id, payment_status, stripe_payment_intent_id, stripe_account_id
    FROM event_orders
    WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  const order = orderRows[0] as { id: string; payment_status: string; stripe_payment_intent_id: string | null; stripe_account_id: string | null } | undefined;
  if (!order) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  if (order.payment_status !== 'PAID' || !order.stripe_payment_intent_id || !order.stripe_account_id) {
    return NextResponse.json({ error: 'Only a paid order can be refunded.' }, { status: 409 });
  }

  // Phase 4A (§18): refunds against the order's own HISTORICAL
  // stripe_account_id — recorded once, at reservation time — never
  // the organisation's CURRENT Connect settings. If an organisation
  // ever reconnects/changes its account, an old order's refund still
  // correctly targets the account that actually holds that specific
  // charge (see EventOrder.stripe_account_id's schema comment).
  //
  // DB state is written ONLY after Stripe confirms the refund
  // succeeded — never before (§22's explicit "update payment/order
  // state only after provider confirms success"). If Stripe's call
  // fails, this route returns an error and the order remains PAID,
  // exactly as it was; nothing is left in an ambiguous intermediate
  // state.
  const refundResult = await createRefund(order.stripe_payment_intent_id, order.stripe_account_id);
  if (!refundResult.ok) {
    return NextResponse.json({ error: refundResult.error }, { status: 502 });
  }

  // Gated on payment_status = 'PAID' — a concurrent duplicate refund
  // click/request updates zero rows on its second attempt rather than
  // calling Stripe's refund API twice for the same payment intent
  // through this route. (Stripe's own API is itself idempotent per
  // charge, but this guard means the second request never gets far
  // enough to try.)
  const updated = await sql`
    UPDATE event_orders
    SET payment_status = 'REFUNDED', refunded_at = now(), status = 'CANCELLED'
    WHERE id = ${orderId} AND organisation_id = ${session.organisationId} AND payment_status = 'PAID'
    RETURNING id
  `;
  if (!updated.length) {
    // Stripe confirmed the refund, but this order was no longer PAID
    // by the time we tried to record it (a genuine race between two
    // manager requests). The money-side refund already succeeded and
    // is not reversed; report success rather than a misleading error.
    return NextResponse.json({ ok: true, note: 'Refund processed by Stripe; order state was already updated by a concurrent request.' });
  }

  return NextResponse.json({ ok: true });
}
