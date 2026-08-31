import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { recordEventBookingActivity } from '@/lib/crm/eventSync';

type Ctx = { params: Promise<{ id: string; orderId: string }> };

// POST — cancel a PENDING (unpaid) paid-order reservation (§A.1).
// manager+, matching every other Events mutation's role convention.
//
// Only ever acts on payment_status = 'PENDING' — a PAID order is
// never touched by this route at all (it isn't even looked up by a
// query that could match one without that exact status), so "PAID
// orders must not expose delete/remove" (§A.3) holds structurally:
// there is no code path here that can reach a PAID row. Reversing a
// PAID order continues to mean refund (see the refund route), never
// this one.
//
// Single atomic conditional UPDATE, gated on payment_status =
// 'PENDING' — the same pattern this module already established for
// check-in (lib/events/checkIn.ts) and payment webhooks
// (lib/events/stripe.ts): a duplicate/repeated cancel click updates
// zero rows rather than erroring, so this is safe to call more than
// once (§A.3's "CANCELLED/EXPIRED/REFUNDED transitions must remain
// idempotent"). Sets payment_status = 'EXPIRED' — reusing the exact
// same vocabulary a genuine Stripe-side checkout expiry already uses
// (see scripts/add-events-payments.sql's payment_status comment) —
// deliberately, rather than inventing a new enum value: a manager
// cancelling an abandoned reservation and Stripe reporting that same
// reservation's checkout window lapsed are the same underlying fact
// (this hold never turned into a payment), just observed from two
// different places. status = 'CANCELLED' immediately and correctly
// releases the reservation's held capacity, via the exact same
// capacity aggregate predicate every other release path already uses
// (`status <> 'CANCELLED'`) — no new capacity logic needed.
//
// No hard delete anywhere: the order, its item, and its attendee rows
// (name/email only, never issued a ticket_token — see the checkout
// route's own §14 comment) all persist exactly as they are, simply
// re-labelled CANCELLED/EXPIRED — full financial/order history is
// preserved (§A.1's explicit requirement).
export async function POST(_req: Request, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId } = await params;

  const eventRows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${session.organisationId} LIMIT 1`;
  if (!eventRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const orderRows = await sql`SELECT id, payment_status FROM event_orders WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId} LIMIT 1`;
  const order = orderRows[0] as { id: string; payment_status: string } | undefined;
  if (!order) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  if (order.payment_status !== 'PENDING') {
    return NextResponse.json({ error: 'Only a pending payment can be cancelled this way.' }, { status: 409 });
  }

  const updated = await sql`
    UPDATE event_orders
    SET status = 'CANCELLED', payment_status = 'EXPIRED'
    WHERE id = ${orderId} AND organisation_id = ${session.organisationId} AND payment_status = 'PENDING'
    RETURNING id
  `;
  if (!updated.length) {
    // Already resolved by a concurrent request (webhook expiry, another
    // manager) between the read above and this UPDATE — not an error.
    return NextResponse.json({ ok: true, note: 'Order was already resolved by a concurrent update.' });
  }

  // Events -> CRM sync (Phase 5) — best-effort, never throws (see
  // lib/crm/eventSync.ts). Updates the order's existing booking
  // activity, if one exists, to reflect CANCELLED/EXPIRED — never
  // deletes the CRM contact itself, and no-ops silently if CRM is
  // disabled or the order was never linked to a contact.
  const detailRows = await sql`
    SELECT eo.total_cents, eo.currency, e.name AS event_name,
      (SELECT COALESCE(SUM(oi.quantity), 0)::int FROM event_order_items oi WHERE oi.order_id = eo.id) AS quantity
    FROM event_orders eo
    JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
    WHERE eo.id = ${orderId} AND eo.organisation_id = ${session.organisationId}
  `;
  const detail = detailRows[0] as { total_cents: number; currency: string; event_name: string; quantity: number } | undefined;
  if (detail) {
    await recordEventBookingActivity({
      organisationId: session.organisationId,
      orderId,
      eventName: detail.event_name,
      quantity: detail.quantity,
      totalCents: detail.total_cents,
      currency: detail.currency,
      paymentStatus: 'EXPIRED',
    });
  }

  return NextResponse.json({ ok: true });
}
