import 'server-only';
import sql from '@/lib/db';
import { sendEmail, EmailSendError } from '@/lib/email';
import { normaliseLifecycleEmailBranding } from '@/lib/organisations/branding';
import { maskEmailForAudit } from './ticketEmail';
import { LEASE_TIMEOUT_MINUTES, MAX_ATTEMPTS, RETRY_BACKOFF_MINUTES, type TicketEmailFailureReason } from './ticketEmailDelivery';
import { resolveBuyerProduct, type BuyerProductContext } from './buyerProduct';
import { buildLifecycleEmail, parseEventUpdatedPayload, type LifecycleEmailData } from './lifecycleEmail';
import { logNotificationScheduled, logNotificationSent, logNotificationFailed } from './auditLog';
import type { NotificationType } from './notifications';

// Phase 5B — durable, lease-based delivery for event_notifications: the
// same claim / trusted-read / send / mark primitives
// lib/events/ticketEmailDelivery.ts established for automatic ticket
// delivery, applied to a lifecycle-notification ROW instead of an order.
// The constants are IMPORTED from that module (lease length, attempt
// cap, backoff schedule) — one retry policy, not two — and that module
// is otherwise untouched: nothing here reads or writes any
// ticket_email_* column.
//
// State machine (full rationale in scripts/create-events-notifications.sql):
//
//   pending -> sending -> sent                      (happy path)
//                 |
//                 +-> failed -> sending (retry, if attempts remain and
//                 |            next_attempt_at has elapsed)
//                 +-> failed (terminal: MAX_ATTEMPTS reached, or an
//                             idempotency payload mismatch)
//
// Every completion write is guarded on BOTH status = 'sending' AND an
// exact claim_id match; an empty RETURNING means the claim was already
// superseded (expected, benign — see markTicketEmailSent's comment).

export type NotificationDeliveryClaim = {
  notificationId: string;
  claimId: string;
  attemptCount: number;
  notificationType: NotificationType;
};

// The single atomic claim. Claimable states mirror the ticket-email
// claim exactly (pending / due failed / stale sending), gated on
// scheduled_for having passed. An EVENT_REMINDER (and an EVENT_UPDATED, which
// needs a live booking and a still-published event) is additionally
// re-checked against the live order + event state at claim time: a
// reminder must never go out for a cancelled/unpublished event, an event
// that already started, or an order that is no longer a confirmed
// free/paid booking. The other three types state historical facts and
// are claimable regardless of current order state.
export async function claimNotificationDelivery(notificationId: string): Promise<NotificationDeliveryClaim | null> {
  const claimId = crypto.randomUUID();
  const rows = await sql`
    UPDATE event_notifications
    SET
      status = 'sending',
      claim_id = ${claimId},
      claimed_at = NOW(),
      last_attempt_at = NOW(),
      attempt_count = attempt_count + 1,
      next_attempt_at = NULL,
      updated_at = NOW()
    WHERE id = ${notificationId}
      AND scheduled_for <= NOW()
      AND (
        status = 'pending'
        OR (
          status = 'failed'
          AND attempt_count < ${MAX_ATTEMPTS}
          AND next_attempt_at <= NOW()
        )
        OR (
          status = 'sending'
          AND claimed_at < NOW() - make_interval(mins => ${LEASE_TIMEOUT_MINUTES})
          AND attempt_count < ${MAX_ATTEMPTS}
        )
      )
      AND (
        notification_type <> 'EVENT_REMINDER'
        OR EXISTS (
          SELECT 1 FROM event_orders eo
          JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
          WHERE eo.id = event_notifications.order_id AND eo.organisation_id = event_notifications.organisation_id
            AND eo.status = 'CONFIRMED' AND eo.payment_status IN ('NOT_REQUIRED', 'PAID')
            AND e.status = 'PUBLISHED' AND e.reminder_enabled = true AND e.starts_at > NOW()
        )
      )
      AND (
        notification_type <> 'EVENT_UPDATED'
        OR EXISTS (
          SELECT 1 FROM event_orders eo
          JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
          WHERE eo.id = event_notifications.order_id AND eo.organisation_id = event_notifications.organisation_id
            AND eo.status = 'CONFIRMED' AND eo.payment_status IN ('NOT_REQUIRED', 'PAID')
            AND e.status = 'PUBLISHED'
        )
      )
    RETURNING id, claim_id, attempt_count, notification_type
  `;
  if (!rows.length) return null;
  const row = rows[0] as { id: string; claim_id: string; attempt_count: number; notification_type: NotificationType };
  return { notificationId: row.id, claimId: row.claim_id, attemptCount: row.attempt_count, notificationType: row.notification_type };
}

export type ClaimedNotificationForDelivery = {
  notificationId: string;
  organisationId: string;
  orderId: string;
  recipientEmail: string;
  idempotencyKey: string;
  data: LifecycleEmailData;
  // event_orders.product_surface of the underlying order (authoritative).
  productSurface: string;
};

type ClaimedNotificationRow = {
  id: string; organisation_id: string; notification_type: NotificationType; recipient_email: string; idempotency_key: string;
  order_id: string; purchaser_name: string; order_status: string; payment_status: string; currency: string;
  total_cents: number; platform_fee_cents: number | null; fee_mode: string | null; fee_label: string | null;
  payment_total_cents: number | null; paid_at: string | Date | null; refunded_cents: number | null;
  platform_fee_refunded_cents: number | null; refunded_at: string | Date | null; booking_token: string | null; product_surface: string | null;
  event_name: string; starts_at: string | Date; ends_at: string | Date; timezone: string; venue: string | null; description: string | null;
  organisation_name: string; organisation_settings: unknown;
  attendees: { name: string; ticket_token: string | null; session_name: string | null }[];
  payload: unknown;
  organisation_slug: string | null; event_slug: string;
};

function iso(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Trusted server-side read AFTER winning the claim — re-asserts
// status = 'sending' AND the exact claim id, so only the worker that
// just won this claim can ever read the purchaser's data. One statement:
// notification + order financial snapshot + event + organisation
// branding + attendee names/tokens/sessions. Nothing here is ever
// returned to a route or client.
export async function readClaimedNotificationForDelivery(notificationId: string, claimId: string): Promise<ClaimedNotificationForDelivery | null> {
  const rows = await sql`
    SELECT
      n.id, n.organisation_id, n.notification_type, n.recipient_email, n.idempotency_key, n.payload,
      eo.id AS order_id, eo.purchaser_name, eo.status AS order_status, eo.payment_status, eo.currency,
      eo.total_cents, eo.platform_fee_cents, eo.fee_mode, eo.fee_label, eo.payment_total_cents, eo.paid_at,
      eo.refunded_cents, eo.platform_fee_refunded_cents, eo.refunded_at, eo.booking_token, eo.product_surface,
      e.name AS event_name, e.slug AS event_slug, o.slug AS organisation_slug, e.starts_at, e.ends_at, e.timezone, e.venue, e.description,
      o.name AS organisation_name, o.settings AS organisation_settings,
      COALESCE((
        SELECT json_agg(json_build_object('name', ea.attendee_name, 'ticket_token', ea.ticket_token, 'session_name', es.name) ORDER BY ea.created_at, ea.id)
        FROM event_attendees ea
        JOIN event_order_items oi ON oi.id = ea.order_item_id AND oi.organisation_id = ea.organisation_id
        LEFT JOIN event_sessions es ON es.id = oi.event_session_id AND es.organisation_id = oi.organisation_id
        WHERE ea.order_id = eo.id AND ea.organisation_id = eo.organisation_id
      ), '[]') AS attendees
    FROM event_notifications n
    JOIN event_orders eo ON eo.id = n.order_id AND eo.organisation_id = n.organisation_id
    JOIN events e ON e.id = n.event_id AND e.organisation_id = n.organisation_id
    JOIN organisations o ON o.id = n.organisation_id
    WHERE n.id = ${notificationId} AND n.status = 'sending' AND n.claim_id = ${claimId}
    LIMIT 1
  `;
  if (!rows.length) return null;
  const row = rows[0] as ClaimedNotificationRow;
  const totalCents = row.total_cents ?? 0;
  const data: LifecycleEmailData = {
    type: row.notification_type,
    orderReference: row.order_id,
    purchaserName: row.purchaser_name,
    eventName: row.event_name,
    eventStartsAt: iso(row.starts_at) ?? '',
    eventEndsAt: iso(row.ends_at) ?? '',
    eventTimezone: row.timezone,
    venue: row.venue,
    description: row.description,
    orderStatus: row.order_status,
    paymentStatus: row.payment_status,
    currency: row.currency ?? 'AUD',
    totalCents,
    // COALESCE(payment_total_cents, total_cents) — the Phase 5A reader
    // rule for rows that pre-date the fee snapshot.
    paymentTotalCents: row.payment_total_cents ?? totalCents,
    platformFeeCents: row.platform_fee_cents ?? 0,
    feeMode: row.fee_mode,
    feeLabel: row.fee_label,
    refundedCents: row.refunded_cents,
    platformFeeRefundedCents: row.platform_fee_refunded_cents,
    paidAt: iso(row.paid_at),
    refundedAt: iso(row.refunded_at),
    attendees: (row.attendees ?? []).map(a => ({ name: a.name, ticketToken: a.ticket_token, sessionName: a.session_name })),
    bookingToken: row.booking_token,
    branding: normaliseLifecycleEmailBranding(row.organisation_settings, row.organisation_name),
    organisationName: row.organisation_name,
    eventSlug: row.event_slug,
    organisationSlug: row.organisation_slug,
    change: parseEventUpdatedPayload(row.payload),
  };
  return {
    notificationId: row.id,
    organisationId: row.organisation_id,
    orderId: row.order_id,
    recipientEmail: row.recipient_email,
    idempotencyKey: row.idempotency_key,
    data,
    productSurface: row.product_surface ?? 'BRAINBASE',
  };
}

// Guarded success transition — also records the provider acceptance
// (provider_message_id + delivery_status = 'accepted') in the SAME write,
// so the row is immediately resolvable by the Resend webhook. Returns
// false when the claim was already superseded.
export async function markNotificationSent(notificationId: string, claimId: string, providerMessageId: string | null): Promise<boolean> {
  const rows = await sql`
    UPDATE event_notifications
    SET
      status = 'sent',
      claim_id = NULL,
      claimed_at = NULL,
      sent_at = NOW(),
      failed_at = NULL,
      next_attempt_at = NULL,
      last_error = NULL,
      provider_message_id = COALESCE(${providerMessageId}::text, provider_message_id),
      delivery_status = CASE WHEN ${providerMessageId}::text IS NOT NULL THEN 'accepted' ELSE delivery_status END,
      updated_at = NOW()
    WHERE id = ${notificationId}
      AND status = 'sending'
      AND claim_id = ${claimId}
    RETURNING id
  `;
  return rows.length > 0;
}

export type NotificationFailureReason = TicketEmailFailureReason;

// Guarded failure transition with the SAME backoff CASE expression as
// markTicketEmailFailed (5 min after attempt 1, 30 min after attempt 2,
// terminal at MAX_ATTEMPTS or on a payload mismatch). attempt_count is
// never incremented here — the claim already did that.
export async function markNotificationFailed(
  notificationId: string,
  claimId: string,
  reason: NotificationFailureReason,
  errorMessage: string,
): Promise<boolean> {
  const boundedError = errorMessage.slice(0, 300);
  const forceTerminal = reason === 'idempotency_payload_mismatch';
  const rows = await sql`
    UPDATE event_notifications
    SET
      status = 'failed',
      claim_id = NULL,
      claimed_at = NULL,
      failed_at = NOW(),
      last_error = ${boundedError},
      next_attempt_at = CASE
        WHEN ${forceTerminal} THEN NULL
        WHEN attempt_count >= ${MAX_ATTEMPTS} THEN NULL
        WHEN attempt_count = 1 THEN NOW() + make_interval(mins => ${RETRY_BACKOFF_MINUTES[1]})
        WHEN attempt_count = 2 THEN NOW() + make_interval(mins => ${RETRY_BACKOFF_MINUTES[2]})
        ELSE NULL
      END,
      updated_at = NOW()
    WHERE id = ${notificationId}
      AND status = 'sending'
      AND claim_id = ${claimId}
    RETURNING id
  `;
  return rows.length > 0;
}

// Non-claiming terminal sweep for a worker that died on its FINAL
// attempt — same gap, same remedy as sweepStaleExhaustedTicketEmailLeases.
export async function sweepStaleExhaustedNotificationLeases(limit: number = 20): Promise<number> {
  const rows = await sql`
    UPDATE event_notifications
    SET
      status = 'failed',
      claim_id = NULL,
      claimed_at = NULL,
      failed_at = NOW(),
      last_error = 'Lease expired after maximum attempts; delivery outcome unknown.',
      next_attempt_at = NULL,
      updated_at = NOW()
    WHERE id IN (
      SELECT id FROM event_notifications
      WHERE status = 'sending'
        AND claimed_at < NOW() - make_interval(mins => ${LEASE_TIMEOUT_MINUTES})
        AND attempt_count >= ${MAX_ATTEMPTS}
      LIMIT ${limit}
    )
    RETURNING id
  `;
  return rows.length;
}

export type NotificationDeliveryOutcome =
  | { outcome: 'not_claimed' }
  | { outcome: 'sent'; providerMessageId: string | null }
  | { outcome: 'failed'; reason: NotificationFailureReason; terminal: boolean };

function isTerminalFailure(reason: NotificationFailureReason, attemptCount: number): boolean {
  return reason === 'idempotency_payload_mismatch' || attemptCount >= MAX_ATTEMPTS;
}

type SendOutcome =
  | { result: 'sent'; providerMessageId: string | null }
  | { result: 'failed'; error: string; idempotencyPayloadMismatch?: true }
  | { result: 'unknown'; error: string }
  | { result: 'not_configured' };

// Provider side effect with the exact outcome classification
// lib/events/ticketEmail.ts's sendTicketEmail uses (definite rejection /
// payload mismatch / ambiguous / not configured) — the HTML and the
// plain-text alternative are sent together, under the row's own
// deterministic idempotency key.
async function sendLifecycleEmail(to: string, email: { subject: string; html: string; text: string }, idempotencyKey: string, product: BuyerProductContext): Promise<SendOutcome> {
  try {
    const sent = await sendEmail({
      to, subject: email.subject, html: email.html, text: email.text, idempotencyKey,
      ...(product.from ? { from: product.from } : {}),
      ...(product.replyTo ? { replyTo: product.replyTo } : {}),
    });
    if (sent.status === 'not_configured') return { result: 'not_configured' };
    return { result: 'sent', providerMessageId: sent.id };
  } catch (err) {
    if (err instanceof EmailSendError && err.providerErrorCode === 'invalid_idempotent_request') {
      return { result: 'failed', error: 'The email provider reported this request no longer matches a previous attempt.', idempotencyPayloadMismatch: true };
    }
    if (err instanceof Error && err.message === 'Email send failed') {
      return { result: 'failed', error: 'The email provider rejected the request.' };
    }
    console.error('[events] lifecycle email: ambiguous provider outcome', err);
    return { result: 'unknown', error: 'The email provider did not return a definite result.' };
  }
}

// The orchestration wrapper for ONE notification row: claim -> trusted
// read -> build template -> send -> mark -> audit. Never throws; every
// failure is converted into a safe outcome (and a best-effort lease
// release) exactly as attemptAutomaticTicketEmail does. Called inline
// right after a transition schedules a row (orderTransitions.ts, the
// event PATCH route) and by the periodic recovery run.
export async function attemptNotificationDelivery(notificationId: string): Promise<NotificationDeliveryOutcome> {
  let claim: NotificationDeliveryClaim | null = null;
  try {
    claim = await claimNotificationDelivery(notificationId);
    if (!claim) return { outcome: 'not_claimed' };

    const claimed = await readClaimedNotificationForDelivery(notificationId, claim.claimId);
    if (!claimed) {
      await markNotificationFailed(notificationId, claim.claimId, 'ambiguous_outcome', 'Notification data unavailable immediately after claim.');
      return { outcome: 'failed', reason: 'ambiguous_outcome', terminal: isTerminalFailure('ambiguous_outcome', claim.attemptCount) };
    }

    // Eve Phase 3.2 — identity from the underlying COMMITTED order, resolved
    // fresh on every attempt (inline, retry and recovery alike). Eve with
    // missing links/sender fails closed: no email, no BrainBase fallback, the
    // ordinary retryable schedule.
    const buyer = resolveBuyerProduct(claimed.productSurface);
    if (!buyer.ok) {
      await markNotificationFailed(notificationId, claim.claimId, 'not_configured', buyer.message);
      const terminal = isTerminalFailure('not_configured', claim.attemptCount);
      await logNotificationFailed({
        organisationId: claimed.organisationId, orderId: claimed.orderId, notificationId, notificationType: claim.notificationType,
        attemptCount: claim.attemptCount, terminal, reason: 'not_configured',
      }).catch(err => console.error('[events] notification audit write failed (product identity unavailable)', err, { notificationId }));
      return { outcome: 'failed', reason: 'not_configured', terminal };
    }
    const email = buildLifecycleEmail({ ...claimed.data, product: buyer.context });
    const recipientMasked = maskEmailForAudit(claimed.recipientEmail);
    const sendResult = await sendLifecycleEmail(claimed.recipientEmail, email, claimed.idempotencyKey, buyer.context);

    if (sendResult.result === 'sent') {
      await markNotificationSent(notificationId, claim.claimId, sendResult.providerMessageId);
      await logNotificationSent({
        organisationId: claimed.organisationId, orderId: claimed.orderId, notificationId, notificationType: claim.notificationType,
        attemptCount: claim.attemptCount, providerMessageId: sendResult.providerMessageId, recipientMasked,
      }).catch(err => console.error('[events] notification audit write failed after send', err, { notificationId }));
      return { outcome: 'sent', providerMessageId: sendResult.providerMessageId };
    }

    let reason: NotificationFailureReason;
    let errorMessage: string;
    if (sendResult.result === 'not_configured') {
      reason = 'not_configured';
      errorMessage = 'Email sending is not configured for this environment.';
    } else if (sendResult.result === 'unknown') {
      reason = 'ambiguous_outcome';
      errorMessage = sendResult.error;
    } else {
      reason = sendResult.idempotencyPayloadMismatch ? 'idempotency_payload_mismatch' : 'provider_rejected';
      errorMessage = sendResult.error;
    }
    await markNotificationFailed(notificationId, claim.claimId, reason, errorMessage);
    const terminal = isTerminalFailure(reason, claim.attemptCount);
    await logNotificationFailed({
      organisationId: claimed.organisationId, orderId: claimed.orderId, notificationId, notificationType: claim.notificationType,
      attemptCount: claim.attemptCount, terminal, reason,
    }).catch(err => console.error('[events] notification audit write failed after failure', err, { notificationId }));
    return { outcome: 'failed', reason, terminal };
  } catch (err) {
    console.error('[events] attemptNotificationDelivery: unexpected error', err, { notificationId });
    if (claim) {
      await markNotificationFailed(notificationId, claim.claimId, 'ambiguous_outcome', 'Unexpected internal error during delivery.').catch(() => {});
      return { outcome: 'failed', reason: 'ambiguous_outcome', terminal: isTerminalFailure('ambiguous_outcome', claim.attemptCount) };
    }
    return { outcome: 'failed', reason: 'ambiguous_outcome', terminal: false };
  }
}

// Post-transition helper for the two order transitions: records the
// scheduling audit entry (best-effort, human actor) and makes ONE inline
// delivery attempt for the row the transition's own statement just
// scheduled. Only ever called with an id that statement actually
// returned — a repeat transition that scheduled nothing (ON CONFLICT)
// never reaches here. Never throws: the transition has already committed
// and must never be reported as failed because of email.
export async function dispatchScheduledOrderNotification(params: {
  organisationId: string;
  userId: string | null;
  orderId: string;
  notificationId: string;
  notificationType: NotificationType;
  source: string;
}): Promise<void> {
  try {
    await logNotificationScheduled({
      organisationId: params.organisationId, userId: params.userId, orderId: params.orderId,
      notificationId: params.notificationId, notificationType: params.notificationType, source: params.source,
    });
  } catch (err) {
    console.error('[events] notification scheduled audit write failed', err, { notificationId: params.notificationId });
  }
  try {
    await attemptNotificationDelivery(params.notificationId);
  } catch (err) {
    console.error('[events] inline notification delivery failed unexpectedly', err, { notificationId: params.notificationId });
  }
}
