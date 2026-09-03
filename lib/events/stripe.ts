import 'server-only';
import Stripe from 'stripe';
import sql from '@/lib/db';
import { generateTicketToken } from './ticketToken';
import { recordEventBookingActivityForOrder } from '@/lib/crm/eventSync';

// ── Architecture ─────────────────────────────────────────────────────
//
// Hosted Stripe Checkout (redirect flow), not Stripe.js/Elements embed.
// This is the reason NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is never read
// anywhere in this codebase: a hosted Checkout Session is created
// server-side and the purchaser is redirected to a Stripe-owned URL —
// no client-side Stripe.js is loaded, so no publishable key is needed.
// Only two secrets are required: STRIPE_SECRET_KEY (server-side API
// calls) and STRIPE_WEBHOOK_SECRET (verifying webhook signatures).
// "Only add variables actually required by the chosen architecture" —
// this is that minimum.
//
// Lazily instantiated (not a module-level `new Stripe(...)` at import
// time) so a route can detect a missing STRIPE_SECRET_KEY and return a
// clean 503 rather than crashing the whole module graph at cold start
// — the same reason every other external-service client in this
// codebase (e.g. lib/events/blobStorage.ts's `put`/`del` from
// @vercel/blob) only touches its credential inside a request path.
let client: Stripe | null = null;
export function getStripeClient(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();
  client = new Stripe(key);
  return client;
}

export class StripeNotConfiguredError extends Error {
  constructor() {
    super('STRIPE_SECRET_KEY is not configured.');
    this.name = 'StripeNotConfiguredError';
  }
}

// Reservation hold window — see scripts/add-events-payments.sql's
// `expires_at` comment. Stripe Checkout's own documented MINIMUM
// allowed `expires_at` is exactly 30 minutes from Checkout SESSION
// CREATION (30 min to 24h) — not from whenever THIS server computed
// the timestamp it sends. Those two moments are never quite the same
// instant: by the time Stripe's own servers actually create the
// session, the DB reservation transaction and network round trip
// have already used up some of that budget, so a value computed as
// exactly `now + 30 minutes` reliably arrives at Stripe already a
// little short of its own floor — confirmed empirically in live
// Stripe test mode (`The 'expires_at' timestamp must be at least 30
// minutes from Checkout Session creation.`, reproducible on every
// attempt). One extra minute of buffer is generously more than that
// latency ever needs, while still being "30 minutes" in every
// product/UX sense the brief's §8 cares about; the internal DB
// reservation's own `expires_at` uses this exact same constant, so
// the two stay aligned as designed.
export const RESERVATION_WINDOW_SECONDS = 31 * 60;

export type CreateCheckoutSessionInput = {
  organisationId: string;
  eventId: string;
  orderId: string;
  ticketTypeName: string;
  unitAmountCents: number;
  currency: string;
  quantity: number;
  purchaserEmail: string;
  successUrl: string;
  cancelUrl: string;
  // Phase 4A — the organisation's connected Stripe account (§11/§13).
  // Required, never optional: this route is only ever reached once
  // lib/events/stripeConnect.ts's checkPaidTicketingEligibility() has
  // already confirmed one exists, so a caller passing an empty value
  // here would be a genuine bug, not a legitimate "no Connect" case.
  connectedAccountId: string;
};

// Server-calculated price/quantity/currency only — every value passed
// in here is already re-derived from the database by the caller (see
// the checkout route), never trusted from the client request body.
// Metadata carries only opaque internal ids needed to reconcile the
// webhook back to the correct order — no attendee name, no purchaser
// phone, nothing beyond what §10's "no unnecessary PII in Stripe
// metadata" allows. purchaser_email is passed to Stripe as the
// Checkout Session's own `customer_email` (which Stripe needs for its
// own receipt/UX), not smuggled into metadata.
//
// Phase 4A: `{ stripeAccount: input.connectedAccountId }` as the
// SECOND argument (a request OPTION, not a body field) is Stripe's
// documented direct-charge pattern (see this file's own §12 comment
// on the charge-model decision) — Brainbase's platform key acts AS
// the connected account for this one call, so the resulting Checkout
// Session, its PaymentIntent, and the eventual charge all belong to
// the CLIENT's own Stripe account, not Brainbase's platform account.
export async function createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      customer_email: input.purchaserEmail,
      line_items: [
        {
          price_data: {
            currency: input.currency.toLowerCase(),
            product_data: { name: input.ticketTypeName },
            unit_amount: input.unitAmountCents,
          },
          quantity: input.quantity,
        },
      ],
      metadata: {
        event_order_id: input.orderId,
        organisation_id: input.organisationId,
        event_id: input.eventId,
      },
      expires_at: Math.floor(Date.now() / 1000) + RESERVATION_WINDOW_SECONDS,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    },
    { stripeAccount: input.connectedAccountId },
  );
  if (!session.url) throw new Error('Stripe did not return a Checkout Session URL.');
  return { sessionId: session.id, url: session.url };
}

// Verifies the raw request body against STRIPE_WEBHOOK_SECRET. Throws
// on any signature mismatch — callers must reject the request (400)
// rather than process an unverified event. `rawBody` MUST be the exact
// bytes/string Stripe sent, read before any JSON parsing (see the
// webhook route) — Stripe's signature covers the raw body, not a
// re-serialized parse of it.
export function constructWebhookEvent(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new StripeNotConfiguredError();
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

// Issues a fresh ticket_token for every attendee on `orderId` that
// doesn't already have one — but ONLY if that order is genuinely
// payment_status = 'PAID' right now, re-checked in this function's OWN
// query rather than trusted from the caller. Called unconditionally
// after the order-flip UPDATE regardless of whether THAT UPDATE
// reported a row, for crash-recovery (a crash between the flip and
// this call, followed by a webhook retry, must still issue tokens
// exactly once, even though the flip's own idempotency guard would by
// then already show 0 rows on the retry — because the order is
// already correctly PAID). The payment_status re-check here is what
// keeps that safe now that this function can also be reached when the
// flip legitimately did NOT apply — e.g. a Phase 4A Connect-account
// mismatch (§15/§16): without this guard, a wrong-account event could
// still cause tokens to be issued for an order that was never actually
// paid, silently defeating the account-match guard on the UPDATE
// above. One UNNEST-based multi-row UPDATE, matching the register
// route's own parallel-array convention — not a loop of per-row
// UPDATEs, so token issuance for an order with several attendees is
// one round trip, not N.
async function issueTicketTokensForPaidOrder(orderId: string): Promise<void> {
  const rows = await sql`
    SELECT ea.id FROM event_attendees ea
    JOIN event_orders eo ON eo.id = ea.order_id AND eo.organisation_id = ea.organisation_id
    WHERE ea.order_id = ${orderId} AND ea.ticket_token IS NULL AND eo.payment_status = 'PAID'
  `;
  if (!rows.length) return;
  const ids = rows.map(r => (r as { id: string }).id);
  const tokens = ids.map(() => generateTicketToken());
  await sql`
    UPDATE event_attendees ea
    SET ticket_token = a.token
    FROM UNNEST(${ids}::text[], ${tokens}::text[]) AS a(id, token)
    WHERE ea.id = a.id
  `;
}

export type WebhookProcessResult = { handled: boolean; type: string };

// Central webhook dispatcher — called once per verified Stripe event
// by the webhook route. Every branch below is idempotent on its own
// terms (a conditional UPDATE gated on the order's CURRENT
// payment_status, or on ticket_token IS NULL), never on "did the
// caller already see this Stripe event id" — so redelivery of the same
// event, redelivery of a DIFFERENT event for an already-terminal order,
// and a retry after a mid-processing crash are all safe without a
// separate processed-event-ids table. See this file's own module
// comment and lib/events/checkIn.ts's confirmCheckIn() for the
// identical pattern this reuses.
//
// Phase 4A tenant reconciliation (§15/§16): `event.account` is Stripe
// Connect's own field identifying WHICH connected account produced
// this event — present whenever the platform receives an event scoped
// to a connected account (as every event this system now cares about
// is, since every paid order is Connect-attributed). Every handler
// below requires the target order's OWN stored stripe_account_id
// (set once, at reservation time — see the checkout route) to equal
// this value, folded into the SAME atomic UPDATE as every other guard
// — not a separate check-then-write. A webhook event genuinely signed
// by Stripe but scoped to connected account A can therefore never
// mutate an order whose payment was actually processed under a
// DIFFERENT connected account B, even if both orders happen to share
// the same stripe_checkout_session_id lookup path (they cannot in
// practice, since session ids are globally unique to one account, but
// the account-match guard makes this true by construction rather than
// by that coincidence alone). An event with no `event.account` at all
// (a genuine platform-level event) never matches any real paid order,
// since every Phase 4A paid order always has a non-NULL
// stripe_account_id — `stripe_account_id = NULL` is never true in SQL.
export async function processStripeWebhookEvent(event: Stripe.Event): Promise<WebhookProcessResult> {
  const eventAccount = event.account ?? null;
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutSessionCompleted(session, eventAccount);
      return { handled: true, type: event.type };
    }
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutSessionExpired(session, eventAccount);
      return { handled: true, type: event.type };
    }
    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      await handlePaymentIntentFailed(intent, eventAccount);
      return { handled: true, type: event.type };
    }
    default:
      // Any other event type is acknowledged (200) but not acted on —
      // Stripe treats a non-2xx response as "please retry", so an
      // event type this system doesn't need must still return success,
      // not be mistaken for a processing failure.
      return { handled: false, type: event.type };
  }
}

// A paid order becomes ACTIVE only here, only from a verified webhook
// — never from the browser's success-page redirect alone (§5, §15).
//
// Checked BEFORE anything else: `session.payment_status === 'paid'`.
// Stripe's own `checkout.session.completed` event type does not, by
// itself, guarantee funds were captured — the Checkout Session object
// carries its own `payment_status` field ('paid' | 'unpaid' |
// 'no_payment_required') specifically because some payment methods
// settle asynchronously; a session can "complete" (the customer
// finished the hosted flow) without yet being 'paid'. Treating the
// event TYPE alone as proof of payment would be exactly the "forged/
// assumed checkout success" failure mode §5 and §26 warn against —
// this is the same principle as never trusting the browser redirect,
// applied to the webhook payload itself. An event that completes with
// a non-'paid' status is intentionally ignored here (not treated as a
// failure either); Stripe will send a further event once the
// asynchronous payment method actually settles, or the session will
// expire on schedule if it never does.
//
// The order-flip UPDATE is gated on `payment_status = 'PENDING'`: a
// redelivered `checkout.session.completed` for an order already PAID
// (or one that raced past FAILED/EXPIRED some other way) correctly
// updates zero rows and does nothing further. Token issuance always
// runs afterward regardless of whether the flip itself matched a row
// this time — see issueTicketTokensForPaidOrder's own comment for why
// that must not be conditioned on the flip's result.
// Phase C1.7: the UPDATE and its audit_logs entry are combined into ONE
// atomic statement via a data-modifying CTE, in all three webhook
// handlers below — deliberately NOT lib/events/auditLog.ts's normal
// separate-statement, best-effort pattern (which is correct for a human
// action that runs strictly after an already-committed mutation, but
// wrong here). Two reasons this needed a different shape:
//   1. Idempotency: Stripe redelivers webhook events, and every handler
//      here already relies on a conditional UPDATE ... WHERE
//      payment_status = 'PENDING' matching ZERO rows on a retry (see each
//      handler's own long-standing comment on this). Routing the audit
//      INSERT through `RETURNING` from that same CTE means a retry
//      produces zero audit rows too, by construction — no separate
//      idempotency check to get wrong, and no risk of the audit trail
//      diverging from what actually happened to event_orders.
//   2. Atomicity: a payment-state transition and the fact that it
//      happened should not be observable as two independent writes that
//      could partially fail — a single statement is atomic by
//      definition, without needing sql.transaction() (whose queries,
//      per lib/tennisSchedule.ts's own precedent, are a flat pre-built
//      array — not well suited to "only insert if the first statement
//      changed something").
// user_id is always NULL (no authenticated actor initiated this — Stripe
// did); after_state's "source": "stripe_webhook" is what makes that
// explicit for anyone reading audit_logs later, distinguishing this row
// from every human-actor entry lib/events/auditLog.ts writes.
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session, eventAccount: string | null): Promise<void> {
  if (session.payment_status !== 'paid') return;
  const orderId = session.metadata?.event_order_id;
  if (!orderId) return;
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;

  await sql`
    WITH updated AS (
      UPDATE event_orders
      SET status = 'CONFIRMED', payment_status = 'PAID', paid_at = now(),
          stripe_payment_intent_id = COALESCE(${paymentIntentId}, stripe_payment_intent_id)
      WHERE id = ${orderId} AND stripe_checkout_session_id = ${session.id} AND payment_status = 'PENDING'
        AND stripe_account_id = ${eventAccount}
      RETURNING id, organisation_id
    )
    INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
    SELECT gen_random_uuid()::text, organisation_id, NULL, 'event_order.payment_succeeded', 'event_order', id,
      '{"payment_status":"PENDING"}'::jsonb,
      '{"source":"stripe_webhook","payment_status":"PAID","status":"CONFIRMED"}'::jsonb
    FROM updated
  `;

  await issueTicketTokensForPaidOrder(orderId);
  // Events -> CRM sync (Phase 5) — best-effort, never throws (see
  // lib/crm/eventSync.ts). Resolves organisationId/event name/quantity/
  // amount/payment state itself from the order's now-updated row and
  // upserts (never duplicates) the one deterministic booking activity
  // for this order. Called unconditionally, regardless of whether the
  // UPDATE above actually matched a row this time — a retried webhook
  // for an order already PAID still re-reads the (unchanged) current
  // state and performs a no-op-shaped upsert, which is correct.
  await recordEventBookingActivityForOrder(orderId);
}

// Releases a reservation's held capacity the moment Stripe reports the
// Checkout Session itself expired — the webhook-driven half of the
// release mechanism; the capacity-query-side time check (see the
// checkout route's own comment) is the half that still protects
// against this webhook being delayed or never arriving at all.
async function handleCheckoutSessionExpired(session: Stripe.Checkout.Session, eventAccount: string | null): Promise<void> {
  const orderId = session.metadata?.event_order_id;
  if (!orderId) return;
  // Phase C1.7: atomic UPDATE+audit CTE — see handleCheckoutSessionCompleted's
  // comment above for the full rationale (idempotency via RETURNING,
  // atomicity, system-actor representation).
  await sql`
    WITH updated AS (
      UPDATE event_orders
      SET status = 'CANCELLED', payment_status = 'EXPIRED'
      WHERE id = ${orderId} AND stripe_checkout_session_id = ${session.id} AND payment_status = 'PENDING'
        AND stripe_account_id = ${eventAccount}
      RETURNING id, organisation_id
    )
    INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
    SELECT gen_random_uuid()::text, organisation_id, NULL, 'event_order.payment_expired', 'event_order', id,
      '{"payment_status":"PENDING"}'::jsonb,
      '{"source":"stripe_webhook","payment_status":"EXPIRED","status":"CANCELLED"}'::jsonb
    FROM updated
  `;
  await recordEventBookingActivityForOrder(orderId);
}

// Best-effort only (see scripts/add-events-payments.sql's comment on
// the FAILED status and §12's "Potential" framing for this event type)
// — `checkout.session.expired` remains the authoritative release path
// regardless of whether this handler ever runs, since a failed payment
// attempt still leaves the Checkout Session itself to expire on
// schedule. Looked up by payment_intent id, which is only present on
// an order once set by handleCheckoutSessionCompleted's own first
// (successful-so-far) pass — for a genuinely failed attempt that never
// reached that point, this UPDATE simply matches no row, which is
// correct: the reservation still releases via expiry as normal.
async function handlePaymentIntentFailed(intent: Stripe.PaymentIntent, eventAccount: string | null): Promise<void> {
  // Phase C1.7: atomic UPDATE+audit CTE — see handleCheckoutSessionCompleted's
  // comment above for the full rationale. This handler already returned
  // `id` from its UPDATE (for recordEventBookingActivityForOrder below);
  // the CTE now also returns organisation_id for the audit INSERT.
  const updated = (await sql`
    WITH updated AS (
      UPDATE event_orders
      SET status = 'CANCELLED', payment_status = 'FAILED'
      WHERE stripe_payment_intent_id = ${intent.id} AND payment_status = 'PENDING'
        AND stripe_account_id = ${eventAccount}
      RETURNING id, organisation_id
    ),
    logged AS (
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      SELECT gen_random_uuid()::text, organisation_id, NULL, 'event_order.payment_failed', 'event_order', id,
        '{"payment_status":"PENDING"}'::jsonb,
        '{"source":"stripe_webhook","payment_status":"FAILED","status":"CANCELLED"}'::jsonb
      FROM updated
    )
    SELECT id FROM updated
  `) as { id: string }[];
  const orderId = updated[0]?.id;
  if (orderId) await recordEventBookingActivityForOrder(orderId);
}

export type CreateRefundResult = { ok: true } | { ok: false; error: string };

// Full refund only (§22). Called by the manager-only refund route
// AFTER that route has already confirmed the order belongs to the
// caller's own organisation/event and is currently PAID — this
// function trusts its caller for tenancy, exactly like
// lib/events/blobStorage.ts's upload/delete functions trust theirs.
// Stripe is the source of truth for whether the refund actually
// succeeded; DB state is only written by the caller after this
// resolves `ok: true` (see the refund route), never before.
//
// Phase 4A (§18): `connectedAccountId` MUST be the order's own
// HISTORICAL stripe_account_id (see EventOrder.stripe_account_id's
// schema comment), never the organisation's current setting — passed
// through as the same `{ stripeAccount: ... }` request option
// createCheckoutSession uses, so the refund is issued against the
// exact account that actually processed the original charge.
export async function createRefund(paymentIntentId: string, connectedAccountId: string): Promise<CreateRefundResult> {
  try {
    const stripe = getStripeClient();
    await stripe.refunds.create({ payment_intent: paymentIntentId }, { stripeAccount: connectedAccountId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Refund failed.' };
  }
}
