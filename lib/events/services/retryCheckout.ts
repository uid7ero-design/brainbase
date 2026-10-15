import sql from '@/lib/db';
import {
  createCheckoutSession, RESERVATION_WINDOW_SECONDS, StripeNotConfiguredError,
  retrieveExistingCheckoutAttempt, classifyRetrySafety, expireCheckoutSession,
  type RetrySafetyDecision,
} from '@/lib/events/stripe';
import { buildCartLockStatements } from '@/lib/events/services/cart';

type OrderRow = {
  id: string; payment_status: string; purchaser_email: string; total_cents: number; currency: string; stripe_account_id: string | null;
  stripe_checkout_session_id: string | null; expires_at: string | null;
  // expires_at as integer epoch-microseconds (text) — the generation
  // stamp the compare-and-set guards below compare against, at full
  // timestamptz precision (see the expiry CAS precision note below).
  expires_at_stamp: string | null;
};
type ItemRow = { ticket_type_id: string; event_session_id: string | null; quantity: number; unit_price_cents: number };
type TicketTypeRow = { id: string; name: string; active: boolean; price_cents: number; currency: string };

// Shared ticketing service — retry payment for a PENDING order.
//
// Extracted verbatim from app/api/events/[id]/orders/[orderId]/retry/route.ts
// (Eve Phase 1, zero behaviour change). The route remains the HTTP
// adapter: authorisation (manager+), return-URL construction, and
// translating this function's result into the exact same status codes
// and response bodies (including the RETRY_BLOCKED user-facing copy) it
// has always returned. The original route-level design notes are
// preserved below, unchanged, since every invariant they describe now
// lives in this function.
//
// Tenant scoping: organisationId must come from the caller's verified
// session — never from a request body, exactly as before.
//
// Retry payment for a PENDING order (§A.2). Route: manager+.
//
// Reuses the SAME order/order_item/attendee rows throughout — never
// inserts a new order or new attendees, so "do not create duplicate
// attendees/ticket entitlements" holds by construction: this route
// contains no INSERT into event_orders, event_order_items, or
// event_attendees anywhere. Ticket tokens remain untouched (still
// exclusively issued by lib/events/stripe.ts's
// issueTicketTokensForPaidOrder, gated on payment_status = 'PAID') —
// a retried-then-paid order becomes usable through the EXACT same
// webhook path a first-attempt payment already uses.
//
// Capacity is re-validated and the hold extended via a SINGLE atomic
// UPDATE, reusing the R1 lock-order technique (FOR UPDATE on
// ticket_type, then session if bound, then a fresh-snapshot capacity
// check) the checkout/register routes established — see this route's
// own SQL comment below for why one code path safely covers both "the
// old hold technically hadn't expired yet" and "the old hold had
// already lapsed and this reacquires it": the aggregate always
// excludes THIS order's own existing quantity (it is not new demand,
// it is the same demand being re-confirmed), so a fresh capacity
// check against everyone ELSE's current holdings is always correct
// regardless of which case applies.
//
// Connected-account attribution is PRESERVED (§14/§A.2): the retry
// uses the order's own already-stored stripe_account_id, never
// re-derived from the organisation's current Connect settings — the
// identical principle the refund route already applies.
//
// ── Double-charge guard (events-stripe-retry-double-charge) ─────────
// BrainBase's own payment_status can lag behind Stripe's true state for
// as long as the success webhook is delayed, failed, or hasn't arrived
// yet — a locally-PENDING order may already be PAID on Stripe's side.
// Before ANY mutation, this route now retrieves the order's prior
// Checkout Session (if any) directly from Stripe — in the order's own
// historical connected-account context, expanding its PaymentIntent in
// the same call — and classifies it via lib/events/stripe.ts's
// classifyRetrySafety(). A brand-new Checkout Session is created ONLY
// when that classification is SAFE_TO_RETRY (no prior attempt exists)
// or SAFE_PREVIOUS_ATTEMPT_DEAD (the prior attempt conclusively cannot
// still become paid) — every other outcome fails closed with a 409 and
// creates nothing, no default-to-allow branch exists. See
// lib/events/stripe.ts's own comment for the full decision matrix.
//
// This check is deliberately READ-ONLY and runs before the capacity-
// reacquisition step below, which is the step that actually NULLs the
// order's stored stripe_checkout_session_id — the prior value must be
// captured and inspected before that happens, or it is unrecoverable.
// The captured value (`verifiedSessionId`) is then reused as a guard
// on that same reacquisition UPDATE (`stripe_checkout_session_id IS
// NOT DISTINCT FROM ...`), closing a related concurrency gap: two
// simultaneous Retry requests that both read the same prior session id
// and both independently reach a SAFE conclusion can no longer both
// succeed — only the first to commit can still match that exact prior
// value; the second finds it already changed and fails the existing
// "capacity no longer available" 409 path.
//
// ── NULL-session concurrency closure (PR #231 follow-up) ────────────
// The stripe_checkout_session_id guard above is NULL-blind by
// construction: an order can genuinely have NO prior session id yet —
// e.g. the brief in-flight window on the public checkout route between
// its capacity-reserving INSERT committing (order becomes visible,
// column NULL) and its own follow-up UPDATE writing the new session id
// back, or that same window recurring inside a retry itself, or either
// window never completing at all (a crashed/timed-out request), which
// leaves the order genuinely PENDING with a permanently-NULL session
// id. Two concurrent Retry requests hitting that exact state both read
// stripe_checkout_session_id = NULL, both skip the Stripe pre-flight
// check entirely (there is nothing to verify yet), and — before this
// fix — both satisfied `IS NOT DISTINCT FROM NULL` on the reacquisition
// UPDATE below, since that UPDATE unconditionally re-sets the column to
// NULL, so the second request's guard value (also NULL) still matched
// even after the first had already committed. NULL cannot serve as its
// own version token.
//
// Fixed with a second, independent compare-and-set guard on the SAME
// UPDATE, reusing `expires_at` — a column that already exists purely
// for reservation-window bookkeeping — as a generation/version stamp:
// `verifiedExpiresAtStamp` captures the order's expires_at at the exact
// same moment as `verifiedSessionId` above, and the guarded UPDATE
// requires the row's current expires_at to equal it, in addition to the
// session guard. (Expiry CAS precision hotfix: the stamp is expires_at
// as integer epoch-microseconds, read and compared inside Postgres —
// `(extract(epoch FROM eo.expires_at) * 1000000)::bigint IS NOT
// DISTINCT FROM ${verifiedExpiresAtStamp}::bigint` — because a JS Date
// only keeps milliseconds and the original Date-valued comparison
// almost never matched a microsecond timestamptz.) Critically, every successful reacquisition
// (including a first-ever one on a NULL-session order) sets expires_at
// to a brand-new `NOW() + RESERVATION_WINDOW_SECONDS` — so it changes
// on every winning retry regardless of whether the session guard was
// discriminating or not, and the loser's captured (stale) value can no
// longer match once the winner has committed. No schema change, no new
// column, no distributed lock, no Stripe idempotency key: just an
// existing timestamp column doing double duty as the row's own version
// counter, exactly the same `IS NOT DISTINCT FROM` idiom already in use
// one line above it. A later, genuinely sequential retry (not racing
// anyone) always re-reads the CURRENT expires_at fresh at the top of
// its own request, so this never blocks a legitimate future retry —
// only two requests racing on the exact same stale snapshot.

export type RetryCheckoutBlockedDecision = Exclude<RetrySafetyDecision, 'SAFE_TO_RETRY' | 'SAFE_PREVIOUS_ATTEMPT_DEAD'>;

export type RetryCheckoutInput = {
  organisationId: string;
  eventId: string;
  orderId: string;
  // Called once, after capacity reacquisition succeeds and immediately
  // before Stripe Checkout Session creation, with the tenant-scoped
  // organisation/event slugs read from the database.
  buildReturnUrls: (orgSlug: string, eventSlug: string) => Promise<{ successUrl: string; cancelUrl: string }>;
};

export type RetryCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; code: 'RETRY_BLOCKED'; decision: RetryCheckoutBlockedDecision }
  | {
      ok: false;
      code:
        | 'EVENT_NOT_FOUND'
        | 'EVENT_CANCELLED'
        | 'ORDER_NOT_FOUND'
        | 'NOT_PENDING'
        | 'NO_STRIPE_ACCOUNT'
        | 'NO_LINE_ITEM'
        | 'TICKET_TYPE_UNAVAILABLE'
        | 'REACQUISITION_FAILED'
        | 'CAPACITY_UNAVAILABLE'
        | 'WRITE_BACK_RACE_LOST'
        | 'STRIPE_NOT_CONFIGURED'
        | 'STRIPE_FAILED';
    };

export async function retryPendingOrderCheckout(input: RetryCheckoutInput): Promise<RetryCheckoutResult> {
  const { organisationId, eventId, orderId } = input;

  // Step 7 remediation: organisation/event slugs for the branded
  // return URLs below are resolved HERE, server-side, from the same
  // tenant-scoped query that already verifies event ownership —
  // never from the request body. There is deliberately no slug input
  // read anywhere in this route at all, so there is nothing for a
  // hostile/mismatched client value to override: the only slugs that
  // can ever reach createCheckoutSession()'s success/cancel URLs are
  // the ones this organisation's own database rows actually have.
  const eventRows = await sql`
    SELECT e.id, e.status, e.slug AS event_slug, o.slug AS org_slug
    FROM events e JOIN organisations o ON o.id = e.organisation_id
    WHERE e.id = ${eventId} AND e.organisation_id = ${organisationId}
    LIMIT 1
  `;
  const event = eventRows[0] as { id: string; status: string; event_slug: string; org_slug: string } | undefined;
  if (!event) return { ok: false, code: 'EVENT_NOT_FOUND' };
  if (event.status === 'CANCELLED') {
    return { ok: false, code: 'EVENT_CANCELLED' };
  }

  const orderRows = await sql`
    SELECT id, payment_status, purchaser_email, total_cents, currency, stripe_account_id, stripe_checkout_session_id, expires_at,
      (extract(epoch FROM expires_at) * 1000000)::bigint::text AS expires_at_stamp
    FROM event_orders WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1
  `;
  const order = orderRows[0] as OrderRow | undefined;
  if (!order) return { ok: false, code: 'ORDER_NOT_FOUND' };
  if (order.payment_status !== 'PENDING') {
    return { ok: false, code: 'NOT_PENDING' };
  }
  if (!order.stripe_account_id) {
    return { ok: false, code: 'NO_STRIPE_ACCOUNT' };
  }

  // Phase 2 — an order may hold several line items (one per ticket
  // type). Retry re-confirms and re-charges the WHOLE order: every line
  // is read here, in a stable order (creation order, then id), and every
  // line is re-validated, capacity-checked and sent to Stripe below. A
  // retry can never collapse a cart to one line.
  const itemRows = await sql`
    SELECT ticket_type_id, event_session_id, quantity, unit_price_cents FROM event_order_items
    WHERE order_id = ${orderId} AND organisation_id = ${organisationId}
    ORDER BY created_at, id
  `;
  const items = itemRows as ItemRow[];
  if (!items.length) return { ok: false, code: 'NO_LINE_ITEM' };
  // One session per order: every line shares it. A mixed-session order
  // cannot be created by this system, so seeing one means the data is
  // not what this flow understands — fail closed rather than guess.
  const eventSessionId = items[0].event_session_id;
  if (items.some(it => it.event_session_id !== eventSessionId)) return { ok: false, code: 'NO_LINE_ITEM' };

  const itemTypeIds = items.map(it => it.ticket_type_id);
  const ttRows = await sql`
    SELECT id, name, active, price_cents, currency FROM event_ticket_types
    WHERE id = ANY(${itemTypeIds}::text[]) AND organisation_id = ${organisationId}
  `;
  const ticketTypesById = new Map((ttRows as TicketTypeRow[]).map(t => [t.id, t]));
  if (items.some(it => !ticketTypesById.get(it.ticket_type_id)?.active)) {
    return { ok: false, code: 'TICKET_TYPE_UNAVAILABLE' };
  }
  const itemQuantities = items.map(it => it.quantity);
  const totalQuantity = itemQuantities.reduce((sum, q) => sum + q, 0);

  // ── Double-charge guard (read BEFORE any mutation) ──────────────────
  // Read here, before the capacity-reacquisition step below ever runs —
  // that step nulls stripe_checkout_session_id as part of preparing for
  // a replacement session, so the CURRENT value must be captured now or
  // it is gone. `verifiedSessionId` is also reused below as a
  // concurrency guard on the reacquisition UPDATE itself (§ concurrency
  // analysis in this PR): it ties that UPDATE to the exact prior value
  // this request actually inspected, so a second concurrent Retry
  // request — which read the same prior value and may have reached the
  // same SAFE conclusion — cannot also succeed once the first has
  // already transitioned it.
  const verifiedSessionId = order.stripe_checkout_session_id ?? null;
  // Captured unconditionally (not just when verifiedSessionId exists) —
  // this is the generation/version stamp for the NULL-session
  // concurrency guard below, and a NULL-session order needs it just as
  // much as a session-bearing one does. See the header comment's
  // "NULL-session concurrency closure" section.
  //
  // Expiry CAS precision hotfix: captured as the database-normalised
  // epoch-microsecond stamp, never as a JS Date. expires_at is
  // timestamptz (microseconds); the driver parses it into a millisecond
  // Date, so comparing `expires_at IS NOT DISTINCT FROM ${Date}` almost
  // never matched a NOW()-derived value and every reacquisition silently
  // failed. Same column, same guard semantics, exact precision.
  const verifiedExpiresAtStamp = order.expires_at_stamp ?? null;
  if (verifiedSessionId) {
    let attempt;
    try {
      attempt = await retrieveExistingCheckoutAttempt(verifiedSessionId, order.stripe_account_id);
    } catch (err) {
      console.error('[events order retry] Stripe retrieval failed, blocking retry for safety', err);
      return { ok: false, code: 'RETRY_BLOCKED', decision: 'UNSAFE_AMBIGUOUS' };
    }
    const decision = classifyRetrySafety(attempt);
    if (decision !== 'SAFE_TO_RETRY' && decision !== 'SAFE_PREVIOUS_ATTEMPT_DEAD') {
      return { ok: false, code: 'RETRY_BLOCKED', decision };
    }
  }

  // ── Atomic capacity reacquisition (whole order) ─────────────────────
  // Excludes THIS order (`eo.id <> ${orderId}`) from every "sold" count
  // on both ticket-type and session aggregates — see this file's own
  // header comment for why that single exclusion makes one code path
  // correct whether the old hold had lapsed or not. Locks every line's
  // ticket type in ascending ticket_type_id order, then each line's
  // (ticket type, session) inventory override row, then the session —
  // the same deterministic order as every other reservation path (see
  // lib/events/services/cart.ts) — and then extends expires_at to a
  // fresh RESERVATION_WINDOW_SECONDS from now and clears the stale
  // stripe_checkout_session_id (a new one is about to be created below),
  // only if EVERY line still fits its own ticket type AND the order's
  // combined quantity still fits the session.
  let transactionResults: unknown[];
  try {
    transactionResults = await sql.transaction([
      ...buildCartLockStatements(organisationId, itemTypeIds, eventSessionId),
      sql`
        WITH cart AS (
          SELECT c.ticket_type_id, c.quantity
          FROM UNNEST(${itemTypeIds}::text[], ${itemQuantities}::int[]) AS c(ticket_type_id, quantity)
        ),
        cart_tt AS (
          -- Phase 3 (ticket type × session inventory): same pair-override
          -- rule as the two reservation flows (see freeRegistration.ts),
          -- still excluding THIS order from every "sold" aggregate.
          SELECT c.ticket_type_id, c.quantity, COALESCE(inv.capacity, tt.capacity) AS capacity,
            (
              SELECT COALESCE(SUM(oi.quantity), 0) FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
              WHERE oi.ticket_type_id = c.ticket_type_id AND oi.organisation_id = ${organisationId} AND eo.id <> ${orderId}
                AND (inv.id IS NULL OR oi.event_session_id = ${eventSessionId})
                AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
            ) AS sold
          FROM cart c
          JOIN event_ticket_types tt ON tt.id = c.ticket_type_id AND tt.organisation_id = ${organisationId}
          LEFT JOIN event_ticket_type_session_inventory inv
            ON inv.ticket_type_id = c.ticket_type_id AND inv.event_session_id = ${eventSessionId} AND inv.organisation_id = ${organisationId}
        ),
        sold_sess AS (
          SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
          WHERE oi.event_session_id = ${eventSessionId} AND oi.organisation_id = ${organisationId} AND eo.id <> ${orderId}
            AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
        )
        UPDATE event_orders eo
        SET expires_at = NOW() + make_interval(secs => ${RESERVATION_WINDOW_SECONDS}), stripe_checkout_session_id = NULL
        FROM sold_sess
        WHERE eo.id = ${orderId} AND eo.organisation_id = ${organisationId} AND eo.payment_status = 'PENDING'
          AND eo.stripe_checkout_session_id IS NOT DISTINCT FROM ${verifiedSessionId}
          AND (extract(epoch FROM eo.expires_at) * 1000000)::bigint IS NOT DISTINCT FROM ${verifiedExpiresAtStamp}::bigint
          AND (SELECT count(*) FROM cart_tt) = ${itemTypeIds.length}
          AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)
          AND (
            ${eventSessionId}::text IS NULL
            OR sold_sess.qty + ${totalQuantity} <= (SELECT capacity FROM event_sessions WHERE id = ${eventSessionId} AND organisation_id = ${organisationId})
          )
        RETURNING eo.id, eo.expires_at, (extract(epoch FROM eo.expires_at) * 1000000)::bigint::text AS expires_at_stamp
      `,
    ]);
  } catch (err) {
    console.error('[events order retry] capacity reacquisition failed', err);
    return { ok: false, code: 'REACQUISITION_FAILED' };
  }

  const reacquired = transactionResults[transactionResults.length - 1] as { id: string; expires_at: string; expires_at_stamp: string }[];
  if (!reacquired.length) {
    // Zero rows now has three possible causes, all correctly reported
    // with the same message: genuine capacity exhaustion (the
    // pre-existing meaning), OR this request lost the concurrency race
    // against another Retry request for the SAME order — via either
    // the stripe_checkout_session_id guard (a prior session existed) or
    // the expires_at guard (no prior session id existed for either
    // racer — see the header comment's "NULL-session concurrency
    // closure" section) — in either race-loss case the winning request
    // is already creating (or has already created) the one replacement
    // session this order gets, so reporting the same "try again" 409
    // here is correct: a manager who retries again will simply see
    // whatever the winner's attempt produced.
    return { ok: false, code: 'CAPACITY_UNAVAILABLE' };
  }
  // Checkout-vs-Retry race closure (PR #231 follow-up) — the fresh
  // expires_at THIS request's own reacquisition just set, straight from
  // its own RETURNING clause (no extra round trip). Guards the write-
  // back below the exact same way the public checkout route's own
  // write-back is guarded (see that route's header comment): if yet
  // another concurrent request reacquires this SAME order again before
  // this request's own Stripe call returns, the write-back will
  // correctly detect that and fail closed rather than overwrite a
  // newer, already-active session.
  const reacquiredExpiresAtStamp = reacquired[0].expires_at_stamp;


  // Always the branded public return flow (§7) — event.org_slug/
  // event.event_slug came from the tenant-scoped query above, never
  // from client input, so there is no generic manager-route fallback
  // to fall back to: an authoritative slug pair is available on every
  // request that reaches this point (an event with no slug cannot
  // exist — slug is NOT NULL in this schema).
  // Return-URL construction itself is the caller's concern (each product
  // surface owns its own public origin and paths); the slugs it is given
  // are still exclusively the tenant-scoped database values above.
  const { successUrl, cancelUrl } = await input.buildReturnUrls(event.org_slug, event.event_slug);

  try {
    const { sessionId, url } = await createCheckoutSession({
      organisationId,
      eventId,
      orderId,
      // Every line of the order, priced from the unit price stored on
      // each event_order_items row at reservation time — so the retried
      // Checkout Session charges exactly event_orders.total_cents, even
      // if an organiser has since edited a ticket type's price.
      lineItems: items.map(it => ({
        name: ticketTypesById.get(it.ticket_type_id)!.name,
        unitAmountCents: it.unit_price_cents,
        quantity: it.quantity,
      })),
      currency: order.currency,
      purchaserEmail: order.purchaser_email,
      successUrl,
      cancelUrl,
      connectedAccountId: order.stripe_account_id,
    });
    // No longer unconditional (PR #231 follow-up) — same guard shape as
    // the public checkout route's own write-back: requires BOTH the
    // column still being NULL (this request's own reacquisition just
    // set it, so it should still be exactly that) and expires_at still
    // matching what this request's reacquisition returned. Either
    // failing means another concurrent request has already claimed this
    // order's active session; the session just created here must be
    // treated as an orphan — never written to the DB, never returned to
    // this manager, best-effort expired in Stripe immediately.
    const writeBack = await sql`
      UPDATE event_orders SET stripe_checkout_session_id = ${sessionId}
      WHERE id = ${orderId} AND organisation_id = ${organisationId}
        AND stripe_checkout_session_id IS NULL AND (extract(epoch FROM expires_at) * 1000000)::bigint IS NOT DISTINCT FROM ${reacquiredExpiresAtStamp}::bigint
      RETURNING id
    `;
    if (!writeBack.length) {
      console.error('[events order retry] lost the write-back race to a concurrent request — expiring orphaned Checkout Session', { orderId, sessionId });
      await expireCheckoutSession(sessionId, order.stripe_account_id);
      return { ok: false, code: 'WRITE_BACK_RACE_LOST' };
    }
    return { ok: true, checkoutUrl: url };
  } catch (err) {
    // Capacity has already been re-extended above (a real, live hold —
    // not left dangling) — a manager can simply retry again. Unlike a
    // brand-new checkout attempt, there is no "just-created, otherwise
    // orphaned" reservation to roll back here: this order already
    // existed for a legitimate reason before this request began.
    if (err instanceof StripeNotConfiguredError) {
      console.error('[events order retry] Stripe is not configured', err);
      return { ok: false, code: 'STRIPE_NOT_CONFIGURED' };
    }
    console.error('[events order retry] Stripe Checkout Session creation failed', err);
    return { ok: false, code: 'STRIPE_FAILED' };
  }
}
