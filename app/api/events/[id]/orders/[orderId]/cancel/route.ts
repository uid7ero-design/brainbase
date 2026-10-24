import { NextResponse } from 'next/server';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { cancelOrder } from '@/lib/events/services/orderTransitions';
import { recordEventBookingActivityForOrder } from '@/lib/crm/eventSync';

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
//
// HTTP adapter only — both conditional UPDATEs and the audit entry live
// in lib/events/services/orderTransitions.ts's cancelOrder (extracted
// unchanged — Eve Phase 1).
export async function POST(_req: Request, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId } = await params;

  const result = await cancelOrder({
    organisationId: session.organisationId,
    userId: session.userId,
    eventId,
    orderId,
    // Events -> CRM sync (Phase 5) — best-effort, never throws (see
    // lib/crm/eventSync.ts, wrapped in its own try/catch). Reads the
    // order's own now-updated row and updates its existing booking
    // activity, if one exists, to reflect that — never deletes the CRM
    // contact itself, and no-ops silently if CRM is disabled or the
    // order was never linked to a contact. Called by the service AFTER
    // the order UPDATE has already committed, so a CRM failure can never
    // roll back or block the cancellation itself.
    onTransitioned: recordEventBookingActivityForOrder,
  });

  if (result.ok) {
    if (result.alreadyResolved) {
      // Already resolved by a concurrent request (webhook expiry, another
      // manager double-clicking) — not an error, and exactly what makes a
      // repeat cancel click on an already-cancelled free order idempotent
      // too (Phase L1).
      return NextResponse.json({ ok: true, note: 'Order was already resolved by a concurrent update.' });
    }
    return NextResponse.json({ ok: true });
  }
  switch (result.code) {
    case 'NOT_FOUND':
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    case 'NOT_CANCELLABLE':
      return NextResponse.json({ error: 'Only a pending payment or a confirmed free order can be cancelled this way.' }, { status: 409 });
    case 'PAYMENT_IN_PROGRESS':
      // The buyer has completed (or is completing) payment. Nothing was changed.
      return NextResponse.json({ error: 'A payment for this reservation has been completed or is being processed, so it cannot be cancelled. Wait for it to be confirmed, then refund it if needed.' }, { status: 409 });
    case 'CHANGED_CONCURRENTLY':
      return NextResponse.json({ error: 'This order changed while it was being cancelled. Reload and try again.' }, { status: 409 });
    case 'STRIPE_EXPIRE_FAILED':
      // The payable Checkout Session could not be closed, so the order was NOT cancelled.
      console.error('[events order cancel] could not expire the order\'s Checkout Session; order left PENDING', result.error);
      return NextResponse.json({ error: 'The order was not cancelled because its payment session could not be closed. Please try again.' }, { status: 502 });
  }
}
