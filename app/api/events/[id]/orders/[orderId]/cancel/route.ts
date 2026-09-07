import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { recordEventBookingActivityForOrder } from '@/lib/crm/eventSync';
import { logCancelled } from '@/lib/events/auditLog';

type Ctx = { params: Promise<{ id: string; orderId: string }> };

// POST — cancel a PENDING (unpaid) paid-order reservation (§A.1), OR a
// CONFIRMED free (payment_status = 'NOT_REQUIRED') order (Phase L1).
// manager+, matching every other Events mutation's role convention.
//
// A PAID order is never touched by this route at all (it isn't even
// looked up by a query that could match one without one of these two
// exact states), so "PAID orders must not expose delete/remove" (§A.3)
// holds structurally: there is no code path here that can reach a PAID
// row. Reversing a PAID order continues to mean refund (see the refund
// route), never this one.
//
// Phase L1 rationale for extending THIS route rather than adding a
// parallel one: a manager cancelling an abandoned paid reservation and
// a manager cancelling a confirmed free booking are the same underlying
// staff action — "this order should no longer hold a seat or admit
// anyone" — just observed from two different starting states, exactly
// the same reasoning this route's own pre-existing comment already
// applied to unifying a manager-initiated PENDING cancel with a
// Stripe-reported checkout expiry under one payment_status value
// (EXPIRED). Two atomic conditional UPDATEs (one per starting state,
// each gated on its own exact pre-state) rather than one combined
// statement — the SET clause genuinely differs (a PENDING reservation
// also flips payment_status to EXPIRED; a free order's payment_status
// was never pending anything and stays NOT_REQUIRED, only order status
// moves to CANCELLED) — but both are the same idempotent-conditional-
// UPDATE shape this module already uses everywhere (check-in,
// payment webhooks, the refund route): a duplicate/repeated cancel
// click updates zero rows rather than erroring.
//
// status = 'CANCELLED' immediately and correctly releases the order's
// held capacity in EITHER case, via the exact same capacity aggregate
// predicate (`status <> 'CANCELLED'`) every other release/consumption
// path already uses (register route, checkout route,
// getPublicEventDetail's remaining-capacity calc) — no new capacity
// logic needed, proven by inspection, not merely assumed. The same
// `eo.status <> 'CANCELLED'` guard already embedded in
// lib/events/checkIn.ts's resolveAttendee/confirmCheckIn/searchAttendees
// and in lib/events/publicTicket.ts's `order_status === 'CANCELLED'`
// derivation means a cancelled free order's ticket_token immediately
// (a) resolves as CANCELLED on /t/[token], and (b) can never be
// checked in — again, zero changes needed in either of those files.
// The ticket_token itself is deliberately left in place (not cleared/
// regenerated) — "historically stored" per Phase L1's own requirement
// — only its resolved validity changes, driven entirely by the order's
// own status.
//
// No hard delete anywhere, in either branch: the order, its item, and
// its attendee rows (including, for a free order, any already-checked-
// in attendee's checked_in_at/checked_in_by_user_id) all persist
// exactly as they are, simply re-labelled — full financial/order and
// check-in history is preserved (§A.1's explicit requirement, and
// Phase L1's own explicit "preserve historical attendee/check-in
// data").
export async function POST(_req: Request, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId } = await params;

  const eventRows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${session.organisationId} LIMIT 1`;
  if (!eventRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const orderRows = await sql`SELECT id, status, payment_status FROM event_orders WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId} LIMIT 1`;
  const order = orderRows[0] as { id: string; status: string; payment_status: string } | undefined;
  if (!order) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const isPendingPaidReservation = order.payment_status === 'PENDING';
  const isConfirmedFreeOrder = order.status === 'CONFIRMED' && order.payment_status === 'NOT_REQUIRED';

  if (!isPendingPaidReservation && !isConfirmedFreeOrder) {
    return NextResponse.json({ error: 'Only a pending payment or a confirmed free order can be cancelled this way.' }, { status: 409 });
  }

  // No Stripe call in either branch — a PENDING reservation was never
  // charged (that's what makes it cancellable here rather than
  // refundable), and a free order was never a Stripe concern at all.
  const updated = isPendingPaidReservation
    ? await sql`
        UPDATE event_orders
        SET status = 'CANCELLED', payment_status = 'EXPIRED'
        WHERE id = ${orderId} AND organisation_id = ${session.organisationId} AND payment_status = 'PENDING'
        RETURNING id
      `
    : await sql`
        UPDATE event_orders
        SET status = 'CANCELLED'
        WHERE id = ${orderId} AND organisation_id = ${session.organisationId} AND status = 'CONFIRMED' AND payment_status = 'NOT_REQUIRED'
        RETURNING id
      `;
  if (!updated.length) {
    // Already resolved by a concurrent request (webhook expiry, another
    // manager double-clicking) between the read above and this UPDATE
    // — not an error, and exactly what makes a repeat cancel click on
    // an already-cancelled free order idempotent too (Phase L1).
    return NextResponse.json({ ok: true, note: 'Order was already resolved by a concurrent update.' });
  }

  // Events -> CRM sync (Phase 5) — best-effort, never throws (see
  // lib/crm/eventSync.ts, wrapped in its own try/catch). Reads the
  // order's own now-updated row and updates its existing booking
  // activity, if one exists, to reflect that — never deletes the CRM
  // contact itself, and no-ops silently if CRM is disabled or the
  // order was never linked to a contact. Every CRM-related sql call
  // this phase introduces lives behind lib/crm/eventSync.ts's own
  // boundary — this route does not run its own separate lookup query.
  // Called AFTER the order UPDATE has already committed, so a CRM
  // failure can never roll back or block the cancellation itself.
  await recordEventBookingActivityForOrder(orderId);

  // Phase 6 §11 / Phase L1 — best-effort audit entry, only on this
  // request's OWN successful transition (not on the "already resolved
  // concurrently" early-return above, which changed nothing here).
  // Identifies the actor (userId), the order (resourceId), the event
  // (eventId, carried in both before/after state), and the exact
  // previous/resulting order+payment status pair.
  await logCancelled({
    organisationId: session.organisationId,
    userId: session.userId,
    orderId,
    eventId,
    before: { status: order.status, payment_status: order.payment_status },
    after: isPendingPaidReservation
      ? { status: 'CANCELLED', payment_status: 'EXPIRED' }
      : { status: 'CANCELLED', payment_status: order.payment_status },
  });

  return NextResponse.json({ ok: true });
}
