import sql from '@/lib/db';
import { createRefund } from '@/lib/events/stripe';
import { logRefunded, logCancelled } from '@/lib/events/auditLog';

// Shared ticketing service — staff-initiated order state transitions
// (full refund, cancellation).
//
// Extracted verbatim from app/api/events/[id]/orders/[orderId]/refund/route.ts
// and .../cancel/route.ts (Eve Phase 1, zero behaviour change). Those
// routes remain the HTTP adapters: authorisation (manager+) and
// translating these results into the exact same status codes and
// response bodies they have always returned. Their header comments
// still document the product rules (refund also cancels; cancel only
// covers PENDING paid reservations and CONFIRMED free orders) that
// these functions implement.
//
// Tenant scoping: organisationId/userId must come from the caller's
// verified session — never from a request body, exactly as before.

export type OrderTransitionActor = { organisationId: string; userId: string };

export type OrderTransitionInput = OrderTransitionActor & {
  eventId: string;
  orderId: string;
  // Post-transition, pre-audit hook. Must never throw.
  onTransitioned?: (orderId: string) => Promise<void>;
};

export type RefundOrderResult =
  | { ok: true; alreadyResolved: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_REFUNDABLE' }
  | { ok: false; code: 'STRIPE_REFUND_FAILED'; error: string };

// Full refund only (§22). See the refund route's header comment.
export async function refundPaidOrder(input: OrderTransitionInput): Promise<RefundOrderResult> {
  const { organisationId, userId, eventId, orderId } = input;

  const eventRows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  if (!eventRows.length) return { ok: false, code: 'NOT_FOUND' };

  const orderRows = await sql`
    SELECT id, payment_status, stripe_payment_intent_id, stripe_account_id
    FROM event_orders
    WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${organisationId}
    LIMIT 1
  `;
  const order = orderRows[0] as { id: string; payment_status: string; stripe_payment_intent_id: string | null; stripe_account_id: string | null } | undefined;
  if (!order) return { ok: false, code: 'NOT_FOUND' };

  if (order.payment_status !== 'PAID' || !order.stripe_payment_intent_id || !order.stripe_account_id) {
    return { ok: false, code: 'NOT_REFUNDABLE' };
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
    return { ok: false, code: 'STRIPE_REFUND_FAILED', error: refundResult.error };
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
    WHERE id = ${orderId} AND organisation_id = ${organisationId} AND payment_status = 'PAID'
    RETURNING id
  `;
  if (!updated.length) {
    // Stripe confirmed the refund, but this order was no longer PAID
    // by the time we tried to record it (a genuine race between two
    // manager requests). The money-side refund already succeeded and
    // is not reversed; report success rather than a misleading error.
    return { ok: true, alreadyResolved: true };
  }

  // Caller-supplied post-transition side effects (BrainBase: Events ->
  // CRM sync) — same position as before: after the state UPDATE commits,
  // before the audit entry. Must never throw.
  if (input.onTransitioned) await input.onTransitioned(orderId);

  // Phase 6 §11 — best-effort audit entry, only on this request's OWN
  // successful transition (not on the "already resolved concurrently"
  // early-return above, which changed nothing here — matching the
  // cancel route's identical rationale).
  await logRefunded({ organisationId: organisationId, userId: userId, orderId });

  return { ok: true, alreadyResolved: false };
}

export type CancelOrderResult =
  | { ok: true; alreadyResolved: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_CANCELLABLE' };

// Cancel a PENDING paid reservation or a CONFIRMED free order. See the
// cancel route's header comment.
export async function cancelOrder(input: OrderTransitionInput): Promise<CancelOrderResult> {
  const { organisationId, userId, eventId, orderId } = input;

  const eventRows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  if (!eventRows.length) return { ok: false, code: 'NOT_FOUND' };

  const orderRows = await sql`SELECT id, status, payment_status FROM event_orders WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  const order = orderRows[0] as { id: string; status: string; payment_status: string } | undefined;
  if (!order) return { ok: false, code: 'NOT_FOUND' };

  const isPendingPaidReservation = order.payment_status === 'PENDING';
  const isConfirmedFreeOrder = order.status === 'CONFIRMED' && order.payment_status === 'NOT_REQUIRED';

  if (!isPendingPaidReservation && !isConfirmedFreeOrder) {
    return { ok: false, code: 'NOT_CANCELLABLE' };
  }

  // No Stripe call in either branch — a PENDING reservation was never
  // charged (that's what makes it cancellable here rather than
  // refundable), and a free order was never a Stripe concern at all.
  const updated = isPendingPaidReservation
    ? await sql`
        UPDATE event_orders
        SET status = 'CANCELLED', payment_status = 'EXPIRED'
        WHERE id = ${orderId} AND organisation_id = ${organisationId} AND payment_status = 'PENDING'
        RETURNING id
      `
    : await sql`
        UPDATE event_orders
        SET status = 'CANCELLED'
        WHERE id = ${orderId} AND organisation_id = ${organisationId} AND status = 'CONFIRMED' AND payment_status = 'NOT_REQUIRED'
        RETURNING id
      `;
  if (!updated.length) {
    // Already resolved by a concurrent request (webhook expiry, another
    // manager double-clicking) between the read above and this UPDATE
    // — not an error, and exactly what makes a repeat cancel click on
    // an already-cancelled free order idempotent too (Phase L1).
    return { ok: true, alreadyResolved: true };
  }

  // Caller-supplied post-transition side effects (BrainBase: Events ->
  // CRM sync) — same position as before: after the state UPDATE commits,
  // before the audit entry. Must never throw.
  if (input.onTransitioned) await input.onTransitioned(orderId);

  // Phase 6 §11 / Phase L1 — best-effort audit entry, only on this
  // request's OWN successful transition (not on the "already resolved
  // concurrently" early-return above, which changed nothing here).
  // Identifies the actor (userId), the order (resourceId), the event
  // (eventId, carried in both before/after state), and the exact
  // previous/resulting order+payment status pair.
  await logCancelled({
    organisationId: organisationId,
    userId: userId,
    orderId,
    eventId,
    before: { status: order.status, payment_status: order.payment_status },
    after: isPendingPaidReservation
      ? { status: 'CANCELLED', payment_status: 'EXPIRED' }
      : { status: 'CANCELLED', payment_status: order.payment_status },
  });

  return { ok: true, alreadyResolved: false };
}
