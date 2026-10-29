import sql from '@/lib/db';
import { createRefund, expireCheckoutSessionForCancellation } from '@/lib/events/stripe';
import { logRefunded, logCancelled } from '@/lib/events/auditLog';
import { dispatchScheduledOrderNotification } from '@/lib/events/notificationDelivery';

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
    SELECT id, payment_status, stripe_payment_intent_id, stripe_account_id, platform_fee_cents
    FROM event_orders
    WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${organisationId}
    LIMIT 1
  `;
  const order = orderRows[0] as {
    id: string; payment_status: string; stripe_payment_intent_id: string | null; stripe_account_id: string | null;
    // Phase 5A — the committed fee snapshot; absent/0 on every pre-Phase-5A
    // and every zero-fee order.
    platform_fee_cents?: number | null;
  } | undefined;
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
  //
  // Phase 5A full-refund policy (brief §7): the customer always receives
  // the FULL amount they paid (Stripe refunds the whole PaymentIntent),
  // and when the order carried a platform fee, that application fee is
  // reversed in the same refund (refund_application_fee) so the
  // connected account is made whole rather than bearing the platform's
  // fee on a sale that did not stand — decided from the ORDER's own
  // snapshot, never the current policy. A zero-fee order's call is
  // byte-identical to before this phase (no options argument).
  const platformFeeCents = order.platform_fee_cents ?? 0;
  const refundResult = platformFeeCents > 0
    ? await createRefund(order.stripe_payment_intent_id, order.stripe_account_id, { refundApplicationFee: true })
    : await createRefund(order.stripe_payment_intent_id, order.stripe_account_id);
  if (!refundResult.ok) {
    return { ok: false, code: 'STRIPE_REFUND_FAILED', error: refundResult.error };
  }
  const refundedCents = refundResult.refundedCents ?? null;

  // Gated on payment_status = 'PAID' — a concurrent duplicate refund
  // click/request updates zero rows on its second attempt rather than
  // calling Stripe's refund API twice for the same payment intent
  // through this route. (Stripe's own API is itself idempotent per
  // charge, but this guard means the second request never gets far
  // enough to try.)
  // Phase 5A: the same statement records what was returned —
  // refunded_cents (Stripe's reported amount, else the stored payment
  // total) and platform_fee_refunded_cents (the whole fee, per the policy
  // above) — so the refund is reconstructible from the row alone.
  // Phase 5B: the SAME statement also schedules the purchaser's refund
  // notification (ORDER_REFUNDED), derived from the UPDATE's own RETURNING
  // — so a notification can only ever exist for a transition that really
  // committed, and a transition that matched zero rows schedules nothing
  // (ADR-0003 §3). ON CONFLICT (idempotency_key) DO NOTHING makes a
  // replayed/duplicate request a scheduling no-op; the LEFT JOIN keeps the
  // order row visible either way so the alreadyResolved logic below is
  // unchanged. notification_id is non-null only when THIS call scheduled
  // the row.
  const updated = await sql`
    WITH updated AS (
    UPDATE event_orders
    SET payment_status = 'REFUNDED', refunded_at = now(), status = 'CANCELLED',
        refunded_cents = COALESCE(${refundedCents}::int, payment_total_cents, total_cents),
        platform_fee_refunded_cents = platform_fee_cents
    WHERE id = ${orderId} AND organisation_id = ${organisationId} AND payment_status = 'PAID'
    RETURNING id, organisation_id, event_id, purchaser_email
    ),
    scheduled AS (
      INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key)
      SELECT organisation_id, event_id, id, 'ORDER_REFUNDED', purchaser_email, 'event-notification:ORDER_REFUNDED:' || id
      FROM updated
      WHERE purchaser_email IS NOT NULL AND btrim(purchaser_email) <> ''
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    )
    SELECT updated.id, scheduled.id AS notification_id FROM updated LEFT JOIN scheduled ON TRUE
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

  // Phase 5B — purchaser refund email: audit the scheduling and make one
  // inline delivery attempt for the row the statement above scheduled.
  // Never throws; the refund is already committed and reported either way.
  const refundNotificationId = (updated[0] as { notification_id?: string | null }).notification_id ?? null;
  if (refundNotificationId) {
    await dispatchScheduledOrderNotification({
      organisationId, userId, orderId, notificationId: refundNotificationId, notificationType: 'ORDER_REFUNDED', source: 'order_refunded',
    });
  }

  return { ok: true, alreadyResolved: false };
}

export type CancelOrderResult =
  | { ok: true; alreadyResolved: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_CANCELLABLE' }
  // A PENDING order's Checkout Session was completed (paid, or an asynchronous
  // payment is settling): cancelling now could strand a payment. Nothing changed.
  | { ok: false; code: 'PAYMENT_IN_PROGRESS' }
  // The still-payable Checkout Session could not be made unpayable (Stripe error,
  // identity mismatch, missing account). Nothing changed; the manager can retry.
  | { ok: false; code: 'STRIPE_EXPIRE_FAILED'; error: string }
  // The order's session changed (e.g. a Retry) between the read and the update.
  | { ok: false; code: 'CHANGED_CONCURRENTLY' };

// Cancel a PENDING paid reservation or a CONFIRMED free order. See the
// cancel route's header comment.
export async function cancelOrder(input: OrderTransitionInput): Promise<CancelOrderResult> {
  const { organisationId, userId, eventId, orderId } = input;

  const eventRows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  if (!eventRows.length) return { ok: false, code: 'NOT_FOUND' };

  const orderRows = await sql`SELECT id, status, payment_status, stripe_checkout_session_id, stripe_account_id FROM event_orders WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  const order = orderRows[0] as {
    id: string; status: string; payment_status: string;
    stripe_checkout_session_id?: string | null; stripe_account_id?: string | null;
  } | undefined;
  if (!order) return { ok: false, code: 'NOT_FOUND' };

  const isPendingPaidReservation = order.payment_status === 'PENDING';
  const isConfirmedFreeOrder = order.status === 'CONFIRMED' && order.payment_status === 'NOT_REQUIRED';

  if (!isPendingPaidReservation && !isConfirmedFreeOrder) {
    return { ok: false, code: 'NOT_CANCELLABLE' };
  }

  // A PENDING reservation has not been charged — but if it has a Checkout
  // Session that is still OPEN, the buyer can still pay it. Cancelling the order
  // while leaving that session payable would let money be taken for an order that
  // is already CANCELLED (no ticket, nothing to reconcile it). So the order's own
  // stored session is made unpayable BEFORE the order is cancelled, using the
  // order's own stored connected account (never the organisation's current one).
  // Fail closed: if we cannot be sure the session is dead, nothing is cancelled and
  // the manager is told why; a manager can simply try again.
  //   expired / already expired / not found  -> proceed to cancel
  //   completed (paid or settling)           -> refuse (PAYMENT_IN_PROGRESS)
  //   anything else (Stripe error, wrong order identity, no account) -> refuse
  // An order with no stored session id has nothing to expire here: its session (if
  // one is being created right now) is expired by the creating request, which can no
  // longer write the id back to a non-PENDING order (see paidCheckout's write-back).
  // A free order never reaches this block.
  const sessionIdAtRead = isPendingPaidReservation ? (order.stripe_checkout_session_id ?? null) : null;
  if (sessionIdAtRead) {
    if (!order.stripe_account_id) {
      return { ok: false, code: 'STRIPE_EXPIRE_FAILED', error: 'The order has a Checkout Session but no recorded Stripe account.' };
    }
    const expiry = await expireCheckoutSessionForCancellation({
      sessionId: sessionIdAtRead, connectedAccountId: order.stripe_account_id, orderId,
    });
    if (expiry.outcome === 'complete') return { ok: false, code: 'PAYMENT_IN_PROGRESS' };
    if (expiry.outcome === 'failed') return { ok: false, code: 'STRIPE_EXPIRE_FAILED', error: expiry.error };
  }

  // The only Stripe interaction in this function is the session expiry above (never
  // a charge, never a refund) — a PENDING reservation was never charged (that's what
  // makes it cancellable here rather than refundable), and a free order was never a
  // Stripe concern at all.
  // Phase 5B: each conditional UPDATE also schedules the purchaser's
  // ORDER_CANCELLED notification in the SAME statement (see the refund
  // path's identical comment) — a repeat cancel that updates zero rows
  // schedules nothing, and a replay against an already-scheduled order is
  // an ON CONFLICT no-op.
  const updated = isPendingPaidReservation
    ? await sql`
        WITH updated AS (
        UPDATE event_orders
        SET status = 'CANCELLED', payment_status = 'EXPIRED'
        WHERE id = ${orderId} AND organisation_id = ${organisationId} AND payment_status = 'PENDING'
          AND stripe_checkout_session_id IS NOT DISTINCT FROM ${sessionIdAtRead}
        RETURNING id, organisation_id, event_id, purchaser_email
        ),
        scheduled AS (
          INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key)
          SELECT organisation_id, event_id, id, 'ORDER_CANCELLED', purchaser_email, 'event-notification:ORDER_CANCELLED:' || id
          FROM updated
          WHERE purchaser_email IS NOT NULL AND btrim(purchaser_email) <> ''
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        )
        SELECT updated.id, scheduled.id AS notification_id FROM updated LEFT JOIN scheduled ON TRUE
      `
    : await sql`
        WITH updated AS (
        UPDATE event_orders
        SET status = 'CANCELLED'
        WHERE id = ${orderId} AND organisation_id = ${organisationId} AND status = 'CONFIRMED' AND payment_status = 'NOT_REQUIRED'
        RETURNING id, organisation_id, event_id, purchaser_email
        ),
        scheduled AS (
          INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key)
          SELECT organisation_id, event_id, id, 'ORDER_CANCELLED', purchaser_email, 'event-notification:ORDER_CANCELLED:' || id
          FROM updated
          WHERE purchaser_email IS NOT NULL AND btrim(purchaser_email) <> ''
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        )
        SELECT updated.id, scheduled.id AS notification_id FROM updated LEFT JOIN scheduled ON TRUE
      `;
  if (!updated.length) {
    // The UPDATE is also tied to the exact session id this request inspected
    // (and expired). If the order is STILL pending, zero rows means its session
    // changed under us (a Retry replaced it): that new session was never
    // expired here, so this is not "already resolved" — report it, change nothing.
    if (isPendingPaidReservation) {
      const recheck = await sql`SELECT payment_status FROM event_orders WHERE id = ${orderId} AND organisation_id = ${organisationId} LIMIT 1`;
      if ((recheck[0] as { payment_status?: string } | undefined)?.payment_status === 'PENDING') {
        return { ok: false, code: 'CHANGED_CONCURRENTLY' };
      }
    }
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

  // Phase 5B — purchaser cancellation email (free order: "registration
  // cancelled, no payment taken"; unpaid reservation: "cancelled before
  // payment, nothing owed" — wording is chosen at send time from the
  // order's own committed state, see lib/events/lifecycleEmail.ts).
  const cancelNotificationId = (updated[0] as { notification_id?: string | null }).notification_id ?? null;
  if (cancelNotificationId) {
    await dispatchScheduledOrderNotification({
      organisationId, userId, orderId, notificationId: cancelNotificationId, notificationType: 'ORDER_CANCELLED', source: 'order_cancelled',
    });
  }

  return { ok: true, alreadyResolved: false };
}
