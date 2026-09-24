import 'server-only';
import sql from '@/lib/db';

// Resend delivery-status visibility — the data-model half (DB reads/
// writes). See scripts/create-events-ticket-email-deliveries.sql's
// header for the full schema rationale and lib/events/resendWebhook.ts
// for the signature-verification half this file never touches.
//
// event_ticket_email_deliveries is DELIBERATELY separate from
// event_orders.ticket_email_status (unchanged by this file): that
// column is BrainBase's OWN send/recovery lifecycle (did WE hand the
// email to Resend), this table is what Resend LATER reports about a
// message it already accepted. Names below match Resend's own
// `email.*` webhook vocabulary (node_modules/resend/dist/index.d.mts's
// WebhookEvent union) — 'accepted' is this file's own initial value
// (Resend has no "accepted" webhook event; it is simply the fact that
// POST /emails returned a message id), everything else is a literal
// Resend event type with '.' replaced by nothing (e.g. 'email.delivered'
// -> 'delivered').

export type TicketEmailSendSource = 'automatic' | 'manual';

// Called immediately after a send this codebase already knows succeeded
// (a non-null provider message id) — from
// lib/events/ticketEmailDelivery.ts's attemptAutomaticTicketEmail right
// after markTicketEmailSent, and from the manual resend route right
// after its own successful send. Best-effort and NEVER throws: this is
// a secondary record-keeping write, not the send/claim state machine
// itself (§ core safety rule — "do not redesign ticket-email retry/
// recovery"), so a failure here must never be allowed to look like, or
// cause, a send failure. ON CONFLICT (provider_message_id) DO NOTHING —
// Resend generates a fresh id per send (see
// lib/events/ticketEmail.ts's sendTicketEmail, never reused across two
// distinct calls), so a genuine conflict should never happen; the
// clause exists only so an unexpected duplicate call for the exact same
// message can never crash a caller instead of being safely ignored.
export async function recordTicketEmailDeliveryAccepted(params: {
  organisationId: string;
  orderId: string;
  sendSource: TicketEmailSendSource;
  providerMessageId: string;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO event_ticket_email_deliveries (id, organisation_id, order_id, send_source, provider_message_id, delivery_status)
      VALUES (${crypto.randomUUID()}, ${params.organisationId}, ${params.orderId}, ${params.sendSource}, ${params.providerMessageId}, 'accepted')
      ON CONFLICT (provider_message_id) DO NOTHING
    `;
  } catch (err) {
    console.error('[events] ticket-email delivery tracking insert failed (ignored — the send itself already succeeded)', err, { orderId: params.orderId });
  }
}

// The 5 outcomes this feature surfaces, and the exactly-one-terminal-
// timestamp-column each corresponds to. 'delivered' is deliberately NOT
// treated as terminal-locked in applyResendDeliveryWebhookEvent below —
// see that function's own comment.
export type ResendDeliveryOutcome = 'delivered' | 'bounced' | 'suppressed' | 'complained' | 'failed';

const AUDIT_ACTION_BY_OUTCOME: Record<ResendDeliveryOutcome, string> = {
  delivered: 'event_order.ticket_email_delivered',
  bounced: 'event_order.ticket_email_bounced',
  suppressed: 'event_order.ticket_email_suppressed',
  complained: 'event_order.ticket_email_complained',
  // Deliberately distinct from the EXISTING 'event_order.ticket_email_failed'
  // (lib/events/auditLog.ts's logAutomaticTicketEmailFailed) — that action
  // means "our attempt to hand the email to Resend failed"; this one means
  // "Resend accepted it, but the provider later reported permanent
  // delivery failure" — a genuinely distinct operational state per the
  // task's own explicit instruction, never conflated.
  failed: 'event_order.ticket_email_delivery_failed',
};

export type ApplyResendDeliveryEventResult = { applied: boolean };

// Applies ONE verified Resend webhook event. Idempotent and safe to call
// with a replayed or out-of-order event — see the guarded UPDATE's own
// WHERE clause below. Returns { applied: false } for every kind of
// no-op (unknown provider_message_id, already-terminal row, exact
// replay, out-of-order/stale event) — callers must treat all of these
// identically: a safe 200 OK, no further action, never an error.
//
// Deliberately never calls, schedules, or otherwise interacts with
// anything in lib/events/ticketEmailDelivery.ts (claim/retry/recovery)
// — a provider-reported bounce/suppression/complaint/failure here NEVER
// requeues event_orders.ticket_email_status or triggers another send.
// Manual resend remains a deliberate, human-only action (§ CRITICAL
// retry/recovery rule).
//
// Atomic UPDATE+audit-INSERT CTE, matching lib/events/stripe.ts's own
// webhook-handler pattern (e.g. handleCheckoutSessionCompleted) exactly
// — per this repo's ADR-0003 §3, a system-initiated, redelivery-prone
// transition (Svix, like Stripe, retries webhook delivery) gets the
// atomic CTE form rather than lib/events/auditLog.ts's best-effort
// separate-statement form, which is reserved for human-initiated
// actions with no redelivery risk.
export async function applyResendDeliveryWebhookEvent(params: {
  providerMessageId: string;
  outcome: ResendDeliveryOutcome;
  eventId: string;
  eventType: string;
  eventCreatedAt: string;
}): Promise<ApplyResendDeliveryEventResult> {
  const { providerMessageId, outcome, eventId, eventType, eventCreatedAt } = params;
  const auditAction = AUDIT_ACTION_BY_OUTCOME[outcome];

  const rows = (await sql`
    WITH updated AS (
      UPDATE event_ticket_email_deliveries
      SET
        delivery_status = ${outcome},
        latest_event_id = ${eventId},
        latest_event_at = ${eventCreatedAt},
        latest_event_type = ${eventType},
        delivered_at = CASE WHEN ${outcome} = 'delivered' THEN COALESCE(delivered_at, ${eventCreatedAt}::timestamptz) ELSE delivered_at END,
        bounced_at = CASE WHEN ${outcome} = 'bounced' THEN COALESCE(bounced_at, ${eventCreatedAt}::timestamptz) ELSE bounced_at END,
        suppressed_at = CASE WHEN ${outcome} = 'suppressed' THEN COALESCE(suppressed_at, ${eventCreatedAt}::timestamptz) ELSE suppressed_at END,
        complained_at = CASE WHEN ${outcome} = 'complained' THEN COALESCE(complained_at, ${eventCreatedAt}::timestamptz) ELSE complained_at END,
        failed_at = CASE WHEN ${outcome} = 'failed' THEN COALESCE(failed_at, ${eventCreatedAt}::timestamptz) ELSE failed_at END,
        updated_at = NOW()
      WHERE provider_message_id = ${providerMessageId}
        -- Terminal lock: once bounced/suppressed/complained/failed, this
        -- row never changes again — no later event can regress a known
        -- outcome. 'delivered' is not in this set on purpose: it is the
        -- ordinary happy-path event and the two guards below already
        -- make re-applying it a safe no-op.
        -- Hardcoded literal list, matching this codebase's own IN-clause
        -- convention elsewhere in lib/events (a payment_status IN
        -- ('NOT_REQUIRED', 'PAID') condition, for one) — the neon()
        -- tagged-template client has no array-binding helper for a
        -- dynamic IN list.
        AND delivery_status NOT IN ('bounced', 'suppressed', 'complained', 'failed')
        -- Exact-replay guard: the same Svix delivery (same svix-id)
        -- must never re-apply.
        AND latest_event_id IS DISTINCT FROM ${eventId}
        -- Ordering guard: an out-of-order OLDER event (delayed retry,
        -- different svix-id) must never overwrite newer state.
        AND (latest_event_at IS NULL OR ${eventCreatedAt}::timestamptz >= latest_event_at)
      RETURNING organisation_id, order_id, send_source
    )
    INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
    SELECT gen_random_uuid()::text, organisation_id, NULL, ${auditAction}, 'event_order', order_id,
      NULL,
      -- Every value argument here needs an explicit ::text cast.
      -- jsonb_build_object is VARIADIC "any" — a bound parameter whose
      -- ONLY appearance in the statement is as an argument to a
      -- polymorphic/"any"-typed function gives Postgres nothing to
      -- infer its type from, which is a hard parse-time error under
      -- the extended query protocol (42P18 "could not determine data
      -- type of parameter"), not a soft runtime issue — confirmed via
      -- a real-Postgres reproduction, since a plain EXPLAIN against
      -- literal-substituted SQL text never exercises real parameter
      -- binding and cannot catch this class of bug. outcome already
      -- gets a concrete type from its OTHER, unambiguous appearances
      -- earlier in this same statement (e.g. the SET delivery_status
      -- assignment against a text column) — that has no bearing on
      -- this separate occurrence, since each interpolation is its own
      -- independent parameter placeholder.
      jsonb_build_object(
        'source', 'resend_webhook',
        'delivery_status', ${outcome}::text,
        'provider_message_id', ${providerMessageId}::text,
        'send_source', send_source,
        'event_type', ${eventType}::text,
        'event_at', ${eventCreatedAt}::text
      )
    FROM updated
    RETURNING resource_id
  `) as { resource_id: string }[];

  return { applied: rows.length > 0 };
}
