import 'server-only';
import Stripe from 'stripe';
import sql from '@/lib/db';
import { generateTicketToken } from './ticketToken';

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
// `expires_at` comment. 30 minutes is also Stripe Checkout's own
// documented MINIMUM allowed `expires_at` (30 min to 24h from
// creation), so this is the shortest window achievable while still
// keeping the internal DB reservation and Stripe's own session expiry
// exactly aligned, per the brief's explicit §8 preference.
export const RESERVATION_WINDOW_SECONDS = 30 * 60;

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
export async function createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
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
  });
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
// doesn't already have one. Guarded entirely by its OWN condition
// (`ticket_token IS NULL`), never by whether the caller's preceding
// order-status UPDATE reported a row — see this function's call sites'
// comments for why: a crash between the order-flip UPDATE and this
// call, followed by a Stripe webhook retry, must still correctly issue
// tokens exactly once, even though the order-flip UPDATE's own
// idempotency guard (`payment_status = 'PENDING'`) would by then
// already show 0 rows affected on the retry. One UNNEST-based
// multi-row UPDATE, matching the register route's own parallel-array
// convention — not a loop of per-row UPDATEs, so token issuance for an
// order with several attendees is one round trip, not N.
async function issueTicketTokensForPaidOrder(orderId: string): Promise<void> {
  const rows = await sql`SELECT id FROM event_attendees WHERE order_id = ${orderId} AND ticket_token IS NULL`;
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
export async function processStripeWebhookEvent(event: Stripe.Event): Promise<WebhookProcessResult> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutSessionCompleted(session);
      return { handled: true, type: event.type };
    }
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutSessionExpired(session);
      return { handled: true, type: event.type };
    }
    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      await handlePaymentIntentFailed(intent);
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
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status !== 'paid') return;
  const orderId = session.metadata?.event_order_id;
  if (!orderId) return;
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;

  await sql`
    UPDATE event_orders
    SET status = 'CONFIRMED', payment_status = 'PAID', paid_at = now(),
        stripe_payment_intent_id = COALESCE(${paymentIntentId}, stripe_payment_intent_id)
    WHERE id = ${orderId} AND stripe_checkout_session_id = ${session.id} AND payment_status = 'PENDING'
  `;

  await issueTicketTokensForPaidOrder(orderId);
}

// Releases a reservation's held capacity the moment Stripe reports the
// Checkout Session itself expired — the webhook-driven half of the
// release mechanism; the capacity-query-side time check (see the
// checkout route's own comment) is the half that still protects
// against this webhook being delayed or never arriving at all.
async function handleCheckoutSessionExpired(session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata?.event_order_id;
  if (!orderId) return;
  await sql`
    UPDATE event_orders
    SET status = 'CANCELLED', payment_status = 'EXPIRED'
    WHERE id = ${orderId} AND stripe_checkout_session_id = ${session.id} AND payment_status = 'PENDING'
  `;
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
async function handlePaymentIntentFailed(intent: Stripe.PaymentIntent): Promise<void> {
  await sql`
    UPDATE event_orders
    SET status = 'CANCELLED', payment_status = 'FAILED'
    WHERE stripe_payment_intent_id = ${intent.id} AND payment_status = 'PENDING'
  `;
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
export async function createRefund(paymentIntentId: string): Promise<CreateRefundResult> {
  try {
    const stripe = getStripeClient();
    await stripe.refunds.create({ payment_intent: paymentIntentId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Refund failed.' };
  }
}
