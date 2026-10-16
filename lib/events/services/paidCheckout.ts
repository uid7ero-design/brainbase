import { randomUUID } from 'crypto';
import sql from '@/lib/db';
import type { PublicEvent } from '@/lib/events/publicResolve';
import type { ValidatedRegistration } from '@/lib/events/publicValidation';
import { createCheckoutSession, RESERVATION_WINDOW_SECONDS, StripeNotConfiguredError, expireCheckoutSession } from '@/lib/events/stripe';
import { checkPaidTicketingEligibility } from '@/lib/events/stripeConnect';
import { listActiveQuestions, validateSubmittedResponses, writeRegistrationResponses } from '@/lib/events/registrationQuestions';
import { loadCartTicketTypes, buildCartLockStatements, computeCartTotalCents } from '@/lib/events/services/cart';
import { resolveAccessCode, type AccessGrant } from '@/lib/events/services/accessCodes';
import {
  resolvePromotionCode, computeDiscount, buildCheckoutLineItems, assertCheckoutLineItemsTotal, promotionRedemptionAvailable,
  type PromotionRule, type DiscountFailureCode,
} from '@/lib/events/services/promotions';
import { normaliseFeePolicyRow, buildFeeLineItem, type FeePolicyResolution } from '@/lib/events/services/fees';
import { computeOrderFinancials, type FeeComputation } from '@/lib/events/feeCalculation';

// Shared ticketing service — paid public checkout reservation + Stripe
// Checkout Session creation.
//
// Phase 2: one order may contain several paid ticket types for the same
// event (a cart) — one event_order_items row and one Stripe line item
// per type, all reserved atomically in one capacity-gated statement.
// See lib/events/services/cart.ts for the shared cart rules and lock
// order.
//
// Extracted verbatim from
// app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts
// (Eve Phase 1, zero behaviour change). The route remains the HTTP
// adapter: rate limiting, body parsing/shape validation, slug -> event
// resolution, return-URL construction, and translating this function's
// result into the exact same status codes and response bodies it has
// always returned. See that route's header comment for why attendee
// rows are created at reservation time (still true here, unchanged).
//
// Tenant scoping: organisationId must already be resolved by the
// caller from a trusted source (the public slug resolver). The
// connected Stripe account is still resolved here, server-side, from
// the organisation's own Connect state — never supplied by the caller.

export type PaidCheckoutReturnUrls = { successUrl: string; cancelUrl: string };

export type PaidCheckoutInput = {
  organisationId: string;
  event: PublicEvent;
  validated: ValidatedRegistration;
  // Called once, immediately before Stripe Checkout Session creation.
  buildReturnUrls: () => Promise<PaidCheckoutReturnUrls>;
  // Post-reservation, pre-Stripe hook. Must never throw.
  onReserved?: (orderId: string) => Promise<void>;
};

export type PaidCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; code: 'RESPONSES_INVALID'; message: string }
  | {
      ok: false;
      code:
        | 'NOT_ELIGIBLE'
        | 'TICKET_TYPE_NOT_FOUND'
        | 'TICKET_TYPE_INACTIVE'
        | 'TICKET_TYPE_FREE'
        | 'MIXED_FREE_AND_PAID'
        | 'CURRENCY_MISMATCH'
        // Phase 4 — sale windows, presale access and promotion codes.
        | 'SALE_NOT_STARTED'
        | 'SALE_ENDED'
        | 'ACCESS_CODE_REQUIRED'
        | 'ACCESS_CODE_INVALID'
        | 'PROMOTION_INVALID'
        | DiscountFailureCode
        | 'PROMOTION_UNAVAILABLE'
        // Phase 5A — platform/booking fee policy (configuration faults; a
        // BrainBase organisation with no policy row can never hit these).
        | 'FEE_POLICY_INVALID'
        | 'FEE_CURRENCY_MISMATCH'
        | 'FEE_EXCEEDS_TOTAL'
        | 'ORDER_TOTAL_MISMATCH'
        | 'SESSION_NOT_FOUND'
        | 'RESERVATION_FAILED'
        | 'CAPACITY_UNAVAILABLE'
        | 'RESPONSE_WRITE_FAILED'
        | 'WRITE_BACK_RACE_LOST'
        | 'STRIPE_NOT_CONFIGURED'
        | 'STRIPE_FAILED';
    };

export async function startPaidCheckout(input: PaidCheckoutInput): Promise<PaidCheckoutResult> {
  const { organisationId, event, validated } = input;

  // Phase 4 — presale access, resolved server-side exactly as in the
  // free flow (see lib/events/services/freeRegistration.ts): one generic
  // ACCESS_CODE_INVALID for every failure mode, eligibility only.
  let accessGrant: AccessGrant | null = null;
  if (validated.access_code) {
    const access = await resolveAccessCode(organisationId, event.id, validated.access_code);
    if (!access.ok) return { ok: false, code: 'ACCESS_CODE_INVALID' };
    accessGrant = access.grant;
  }

  // Phase 4A paid-ticketing gate (§10): checked before anything else
  // that would consume capacity — an anonymous purchaser gets a clean,
  // generic rejection (never Brainbase's own internal Connect-status
  // wording; that belongs only in the authenticated backend UI) rather
  // than a reservation that could never actually be paid for.
  const eligibility = await checkPaidTicketingEligibility(organisationId);
  if (!eligibility.eligible) {
    return { ok: false, code: 'NOT_ELIGIBLE' };
  }
  const connectedAccountId = eligibility.accountId;

  // This route is the PAID path only — every cart line's price must be
  // > 0. Free ticket types must go through the free-registration route
  // instead, and a cart mixing free and paid types is rejected (an order
  // is all-free or all-paid — see lib/events/services/cart.ts); this is
  // not merely a mirror-image check, it is the thing that keeps free
  // orders from ever touching Stripe at all (§6). Every line must also
  // share one currency (one Checkout Session charges one currency).
  // Ownership (same organisation AND same event), active state, price
  // and currency are all re-derived server-side in one tenant-scoped
  // query — never trusted from the request.
  const cart = await loadCartTicketTypes(organisationId, event.id, validated.items, { accessGrant });
  if (!cart.ok) {
    return { ok: false, code: cart.code };
  }
  if (cart.pricing !== 'PAID') {
    return { ok: false, code: 'TICKET_TYPE_FREE' };
  }
  const lineTypeIds = cart.lines.map(l => l.ticket_type_id);
  const lineQuantities = cart.lines.map(l => l.quantity);
  const lineUnitPrices = cart.lines.map(l => l.unit_price_cents);
  const accessCodeId = accessGrant?.id ?? null;
  const accessCodeSnapshot = accessGrant?.code ?? null;

  // Phase 4 — ONE optional promotion code per order, resolved by
  // (organisation, event, normalised code) and computed server-side in
  // integer cents (see lib/events/services/promotions.ts): the discount
  // is rounded once on the eligible subtotal, allocated across lines by
  // largest remainder, and the payable total must stay at or above the
  // currency's minimum charge — a code that would take this cart below
  // it (including a 100% discount) is rejected for this cart, approval
  // D1. Nothing about the discount is ever read from the request.
  let promotion: PromotionRule | null = null;
  let lineDiscounts = cart.lines.map(() => 0);
  let discountCents = 0;
  if (validated.promotion_code) {
    const resolved = await resolvePromotionCode(organisationId, event.id, validated.promotion_code);
    if (!resolved.ok) return { ok: false, code: 'PROMOTION_INVALID' };
    const computed = computeDiscount(cart.lines, resolved.rule, cart.currency);
    if (!computed.ok) return { ok: false, code: computed.code };
    promotion = resolved.rule;
    lineDiscounts = computed.lineDiscountCents;
    discountCents = computed.discountCents;
  }
  const promotionCodeId = promotion?.id ?? null;
  const promotionCodeSnapshot = promotion?.code ?? null;

  // Phase 5A — platform / booking fee, resolved from the SAME cart query
  // above (event row > organisation row > platform default = none; see
  // lib/events/services/fees.ts) and computed in integer cents on the NET
  // ticket subtotal AFTER the discount (brief §6 order: gross → promotion
  // → net → fee → payment total). Nothing about the fee is ever read from
  // the request. A BrainBase organisation with no policy row resolves to
  // no fee: platform_fee_cents 0, fee_mode NULL, payment total = ticket
  // total, no fee line item, no application_fee_amount — the pre-Phase-5A
  // order exactly. Configuration faults (a malformed row, a policy in
  // another currency, an ABSORB fee larger than the ticket total) fail
  // closed here, before any capacity is reserved.
  let feeResolution: FeePolicyResolution;
  try {
    feeResolution = normaliseFeePolicyRow(cart.feePolicyRow);
  } catch (err) {
    console.error('[public checkout] refusing to reserve: the event\'s fee policy row could not be interpreted', err);
    return { ok: false, code: 'FEE_POLICY_INVALID' };
  }
  const feePolicy = feeResolution.policy;
  if (feePolicy && feePolicy.currency !== cart.currency.toUpperCase()) {
    console.error('[public checkout] refusing to reserve: fee policy currency does not match the cart currency', { policy: feePolicy.id });
    return { ok: false, code: 'FEE_CURRENCY_MISMATCH' };
  }

  if (validated.event_session_id) {
    const sessionRows = await sql`
      SELECT id FROM event_sessions
      WHERE id = ${validated.event_session_id} AND organisation_id = ${organisationId} AND event_id = ${event.id}
      LIMIT 1
    `;
    if (!sessionRows.length) {
      return { ok: false, code: 'SESSION_NOT_FOUND' };
    }
  }

  // Phase 4B §5/§8 — identical server-authoritative validation as the
  // free registration route (see that file's own comment), run before
  // any capacity is reserved for this paid attempt either.
  const activeQuestions = await listActiveQuestions(organisationId, event.id);
  const validatedResponses = validateSubmittedResponses(
    activeQuestions,
    validated.order_responses,
    validated.attendees.map(a => a.responses),
  );
  if (typeof validatedResponses === 'string') {
    return { ok: false, code: 'RESPONSES_INVALID', message: validatedResponses };
  }

  const attendeeNames = validated.attendees.map(a => a.name);
  const attendeeEmails = validated.attendees.map(a => a.email ?? '');
  const attendeeTypeIds = validated.attendees.map(a => a.ticket_type_id);
  // Generated here so each attendee's answers can be written against its
  // own row deterministically (see the transaction comment below).
  const attendeeIds = validated.attendees.map(() => randomUUID());
  // Integer cents only: the order total is exactly the sum of its lines
  // minus the snapshotted discount (0 without a promotion) — the NET
  // TICKET amount, total_cents, whose meaning Phase 5A preserves. The
  // customer's PAYMENT total adds a PASS_THROUGH fee (one extra Stripe
  // line item) or equals the ticket total under ABSORB / no fee; it is
  // exactly what the Stripe line items below charge. Built and asserted
  // BEFORE any capacity is reserved, so a mismatch can never leave a
  // hold behind.
  const totalCents = computeCartTotalCents(cart.lines) - discountCents;
  const financialsResult = computeOrderFinancials(totalCents, validated.quantity, feePolicy);
  if (!financialsResult.ok) {
    console.error('[public checkout] refusing to reserve: the absorbed fee would exceed the ticket total', { policy: feePolicy?.id, totalCents });
    return { ok: false, code: financialsResult.code };
  }
  const financials: FeeComputation = financialsResult.result;
  const feeLabel = feePolicy?.label ?? null;
  const feeLineItem = financials.fee_mode === 'PASS_THROUGH' ? buildFeeLineItem(feeLabel ?? 'Booking fee', financials.platform_fee_cents) : null;
  const stripeLineItems = [
    ...buildCheckoutLineItems(
      cart.lines.map((l, i) => ({ name: l.name, unit_price_cents: l.unit_price_cents, quantity: l.quantity, discount_cents: lineDiscounts[i] })),
      promotionCodeSnapshot,
      cart.currency,
    ),
    ...(feeLineItem ? [feeLineItem] : []),
  ];
  try {
    assertCheckoutLineItemsTotal(stripeLineItems, financials.payment_total_cents);
  } catch (err) {
    console.error('[public checkout] refusing to reserve: Stripe line items do not reconcile with the payment total', err);
    return { ok: false, code: 'ORDER_TOTAL_MISMATCH' };
  }
  // Snapshot columns (NULL throughout, fee 0, payment total = ticket total
  // when no policy applies). The policy INPUTS are copied, not referenced,
  // so the fee is reconstructible from the order row alone and a later
  // policy edit can never alter it.
  const feePolicyId = feePolicy?.id ?? null;
  const feePolicyVersion = feePolicy?.version ?? null;
  const feePercentBps = feePolicy?.percent_bps ?? null;
  const feeFixedPerOrderCents = feePolicy?.fixed_per_order_cents ?? null;
  const feeFixedPerTicketCents = feePolicy?.fixed_per_ticket_cents ?? null;
  const feeMinCents = feePolicy?.min_fee_cents ?? null;
  const feeMaxCents = feePolicy?.max_fee_cents ?? null;
  const feeTaxTreatment = feePolicy?.tax_treatment ?? null;

  // ── Capacity-reserving transaction (§8/§9, multi-line) ──────────────
  //
  // Identical lock order and statement-sequencing discipline as the
  // free registration flow's own R1-fixed transaction (see
  // lib/events/services/freeRegistration.ts's extensive comment — every
  // invariant it documents applies unchanged): lock every cart line's
  // ticket type in ascending ticket_type_id order, then (session-bound
  // only) each line's (ticket type, session) inventory override row in
  // the same order, then the session, each FOR UPDATE as its own
  // statement; only after every lock is
  // granted does the capacity-gated INSERT run as its own statement, so
  // it observes a fresh, post-lock snapshot of sold quantity under READ
  // COMMITTED. The `gate` CTE requires EVERY line to fit its own ticket
  // type's remaining capacity AND the combined cart quantity to fit the
  // session — all lines are reserved together or none are.
  //
  // The "sold" aggregates exclude a PENDING paid reservation whose
  // expires_at has passed — `AND (payment_status <> 'PENDING' OR
  // expires_at > NOW())`. A free/NOT_REQUIRED order (payment_status
  // never 'PENDING') and a currently-valid pending paid reservation both
  // still count; only a STALE pending reservation is excluded, by a
  // plain time comparison evaluated fresh inside this same post-lock
  // statement — not dependent on the `checkout.session.expired` webhook
  // ever having arrived (§17).
  //
  // Attendee rows are inserted with ids generated here, before the
  // statement runs (attendeeIds, aligned 1:1 with validated.attendees),
  // so attendee-scoped registration answers are written against the
  // correct attendee deterministically — never by RETURNING row order,
  // which Postgres does not guarantee (the same reasoning the free flow
  // already applies via ticket_token correlation).
  //
  // Phase 4 additions to the SAME statement (nothing above changes for
  // an order without a promotion or access code):
  //   * `purchasable` in cart_tt re-asserts, inside the locked statement
  //     at the database's NOW(), that every line's ticket type is active,
  //     inside its sale window and (if restricted) unlocked by THIS
  //     order's access code — see freeRegistration.ts's identical CTE;
  //   * the gate also requires the promotion code (if any) to still be
  //     active, inside its window and under its max_redemptions — counted
  //     with the D3 predicate (paid/refunded orders always count; live
  //     holds count; expired/failed/cancelled unpaid holds do not) — and
  //     the lock tier that makes that count race-free is the promotion
  //     row FOR UPDATE that buildCartLockStatements adds AFTER every
  //     inventory lock (lib/events/services/cart.ts). The order row this
  //     statement inserts IS the redemption record; no promotion table is
  //     written, so a webhook replay can never double-count.
  let transactionResults: unknown[];
  try {
    transactionResults = await sql.transaction([
      ...buildCartLockStatements(organisationId, lineTypeIds, validated.event_session_id, promotionCodeId),
      sql`
        WITH cart AS (
          SELECT c.ticket_type_id, c.quantity, c.unit_price_cents, c.discount_cents
          FROM UNNEST(${lineTypeIds}::text[], ${lineQuantities}::int[], ${lineUnitPrices}::int[], ${lineDiscounts}::int[]) AS c(ticket_type_id, quantity, unit_price_cents, discount_cents)
        ),
        cart_tt AS (
          -- Phase 3 (ticket type × session inventory): a (type, session)
          -- override row, when present, replaces the event-wide capacity
          -- and narrows "sold" to this type in THIS session; otherwise
          -- the event-wide figures apply unchanged. See
          -- lib/events/services/freeRegistration.ts's identical CTE.
          SELECT c.ticket_type_id, c.quantity, COALESCE(inv.capacity, tt.capacity) AS capacity,
            (
              tt.active
              AND (tt.sale_starts_at IS NULL OR tt.sale_starts_at <= NOW())
              AND (tt.sale_ends_at IS NULL OR tt.sale_ends_at > NOW())
              AND (
                NOT tt.requires_access_code
                OR EXISTS (
                  SELECT 1 FROM event_access_codes ac
                  WHERE ac.id = ${accessCodeId} AND ac.organisation_id = ${organisationId} AND ac.event_id = ${event.id}
                    AND ac.active = true
                    AND (ac.starts_at IS NULL OR ac.starts_at <= NOW())
                    AND (ac.ends_at IS NULL OR ac.ends_at > NOW())
                    AND (
                      NOT EXISTS (SELECT 1 FROM event_access_code_ticket_types att WHERE att.access_code_id = ac.id AND att.organisation_id = ac.organisation_id)
                      OR EXISTS (SELECT 1 FROM event_access_code_ticket_types att WHERE att.access_code_id = ac.id AND att.organisation_id = ac.organisation_id AND att.ticket_type_id = tt.id)
                    )
                )
              )
            ) AS purchasable,
            (
              SELECT COALESCE(SUM(oi.quantity), 0)
              FROM event_order_items oi
              JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
              WHERE oi.ticket_type_id = c.ticket_type_id AND oi.organisation_id = ${organisationId}
                AND (inv.id IS NULL OR oi.event_session_id = ${validated.event_session_id})
                AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
            ) AS sold
          FROM cart c
          JOIN event_ticket_types tt ON tt.id = c.ticket_type_id AND tt.organisation_id = ${organisationId}
          LEFT JOIN event_ticket_type_session_inventory inv
            ON inv.ticket_type_id = c.ticket_type_id AND inv.event_session_id = ${validated.event_session_id} AND inv.organisation_id = ${organisationId}
        ),
        sold_sess AS (
          SELECT COALESCE(SUM(oi.quantity), 0) AS qty
          FROM event_order_items oi
          JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
          WHERE oi.event_session_id = ${validated.event_session_id} AND oi.organisation_id = ${organisationId}
            AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
        ),
        gate AS (
          SELECT 1 AS ok
          FROM sold_sess
          WHERE (SELECT count(*) FROM cart_tt) = ${lineTypeIds.length}
            AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE NOT cart_tt.purchasable)
            AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)
            AND (
              ${validated.event_session_id}::text IS NULL
              OR sold_sess.qty + ${validated.quantity} <= (SELECT capacity FROM event_sessions WHERE id = ${validated.event_session_id} AND organisation_id = ${organisationId})
            )
            AND (
              ${promotionCodeId}::text IS NULL
              OR EXISTS (
                SELECT 1 FROM event_promotion_codes pc
                WHERE pc.id = ${promotionCodeId} AND pc.organisation_id = ${organisationId} AND pc.event_id = ${event.id}
                  AND pc.active = true
                  AND (pc.starts_at IS NULL OR pc.starts_at <= NOW())
                  AND (pc.ends_at IS NULL OR pc.ends_at > NOW())
                  AND (pc.max_redemptions IS NULL OR (
                    SELECT count(*) FROM event_orders eo
                    WHERE eo.promotion_code_id = pc.id AND eo.organisation_id = pc.organisation_id
                      AND (eo.payment_status IN ('PAID', 'REFUNDED') OR (eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())))
                  ) + 1 <= pc.max_redemptions)
              )
            )
        ),
        ins_order AS (
          INSERT INTO event_orders (
            organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone,
            status, total_cents, payment_status, payment_provider, currency, expires_at, stripe_account_id,
            platform_fee_cents, fee_mode, payment_total_cents, fee_policy_id, fee_policy_version,
            fee_percent_bps, fee_fixed_per_order_cents, fee_fixed_per_ticket_cents, fee_min_cents, fee_max_cents, fee_tax_treatment, fee_label,
            discount_cents, promotion_code_id, promotion_code_snapshot, access_code_id, access_code_snapshot
          )
          SELECT
            ${organisationId}, ${event.id}, ${validated.purchaser_name}, ${validated.purchaser_email}, ${validated.purchaser_phone},
            'PENDING', ${totalCents}, 'PENDING', 'stripe', ${cart.currency}, NOW() + make_interval(secs => ${RESERVATION_WINDOW_SECONDS}), ${connectedAccountId},
            ${financials.platform_fee_cents}, ${financials.fee_mode}, ${financials.payment_total_cents}, ${feePolicyId}, ${feePolicyVersion},
            ${feePercentBps}, ${feeFixedPerOrderCents}, ${feeFixedPerTicketCents}, ${feeMinCents}, ${feeMaxCents}, ${feeTaxTreatment}, ${feeLabel},
            ${discountCents}, ${promotionCodeId}, ${promotionCodeSnapshot}, ${accessCodeId}, ${accessCodeSnapshot}
          FROM gate
          RETURNING id
        ),
        ins_items AS (
          INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents, discount_cents)
          SELECT ${organisationId}, ins_order.id, ${event.id}, cart.ticket_type_id, ${validated.event_session_id}, cart.quantity, cart.unit_price_cents, cart.discount_cents
          FROM ins_order, cart
          RETURNING id, order_id, ticket_type_id
        )
        INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
        SELECT a.id, ${organisationId}, ${event.id}, ii.order_id, ii.id, a.name, NULLIF(a.email, '')
        FROM ins_items ii
        JOIN UNNEST(${attendeeIds}::text[], ${attendeeTypeIds}::text[], ${attendeeNames}::text[], ${attendeeEmails}::text[])
          AS a(id, ticket_type_id, name, email)
          ON a.ticket_type_id = ii.ticket_type_id
        RETURNING id, order_id
      `,
    ]);
  } catch (err) {
    console.error('[public checkout] reservation transaction failed', err);
    return { ok: false, code: 'RESERVATION_FAILED' };
  }

  const insertResult = transactionResults[transactionResults.length - 1] as { id: string; order_id: string }[];
  if (!insertResult.length) {
    // Zero rows: capacity, OR (Phase 4) the promotion code's limit was
    // reached / the code was disabled between the pre-check and the gate.
    // A read-only re-check tells the two apart for the purchaser's
    // message; it reserves nothing and changes nothing.
    if (promotionCodeId && !(await promotionRedemptionAvailable(organisationId, promotionCodeId))) {
      return { ok: false, code: 'PROMOTION_UNAVAILABLE' };
    }
    return { ok: false, code: 'CAPACITY_UNAVAILABLE' };
  }
  const orderId = insertResult[0].order_id;

  // ── Checkout-vs-Retry race closure (PR #231 follow-up) ──────────────
  // Captured as early as practical after the order becomes visible (and
  // therefore already Retry-able by a manager) — this order's own
  // `expires_at`, exactly as the reservation transaction above just set
  // it, acts as a generation/version stamp for the SAME compare-and-set
  // mechanism the retry route uses (see that route's own header
  // comment). It is what makes the guarded write-back below safe: if a
  // manager Retry reacquires this SAME order (and therefore advances
  // its expires_at) before this request's own Stripe call returns, the
  // write-back below will correctly detect that and fail closed rather
  // than overwrite a newer, already-active session.
  //
  // Expiry CAS precision hotfix: the stamp is read and compared INSIDE
  // Postgres as integer epoch-microseconds (expires_at_stamp), never as
  // a JS Date. expires_at is timestamptz (microsecond precision) but the
  // driver parses it into a millisecond Date, so the previous
  // `expires_at IS NOT DISTINCT FROM ${Date}` guard almost never matched
  // a NOW()-derived value — the write-back and both compensating cancels
  // silently matched zero rows. The stamp is the exact same column, at
  // full precision on both sides; the guard semantics are unchanged.
  const [orderGenRow] = await sql`SELECT (extract(epoch FROM expires_at) * 1000000)::bigint::text AS expires_at_stamp FROM event_orders WHERE id = ${orderId}`;
  const capturedExpiresAtStamp = (orderGenRow as { expires_at_stamp: string | null } | undefined)?.expires_at_stamp ?? null;

  // Phase 4B §8 — responses MUST be persisted before the Stripe
  // redirect: they need to survive the browser leaving and coming back,
  // and retry payment (which never re-touches attendees/responses, see
  // that route) must never need to recreate them. Unlike the free
  // route, a write failure here is treated as fatal — the reservation
  // is released with the exact same compensating-cancellation pattern
  // already used below for a Stripe Checkout Session creation failure,
  // rather than sending an anonymous purchaser into a paid checkout
  // whose attendee-requirement answers are already lost.
  try {
    await writeRegistrationResponses(organisationId, event.id, orderId, attendeeIds, validatedResponses);
  } catch (err) {
    console.error('[public checkout] response write failed, releasing reservation', err, { orderId });
    // Guarded the same way as the Stripe-creation write-back below
    // (PR #231 follow-up): if a manager Retry has already reacquired
    // this order (advancing expires_at) in the time this request took
    // to fail, that generation is no longer this request's to cancel —
    // the guard makes this a safe no-op instead of destroying Retry's
    // already-active reservation out from under it.
    await sql`UPDATE event_orders SET status = 'CANCELLED', payment_status = 'FAILED' WHERE id = ${orderId} AND payment_status = 'PENDING' AND (extract(epoch FROM expires_at) * 1000000)::bigint IS NOT DISTINCT FROM ${capturedExpiresAtStamp}::bigint`;
    return { ok: false, code: 'RESPONSE_WRITE_FAILED' };
  }

  // Caller-supplied post-reservation side effects (BrainBase: Events ->
  // CRM sync) run here — after the order + responses have committed,
  // BEFORE the Stripe redirect, the exact position they have always
  // occupied. Owned by the caller so this shared service carries no
  // product-specific CRM dependency; see the checkout route for the
  // BrainBase hook and its own rationale comment. Must never throw.
  if (input.onReserved) await input.onReserved(orderId);

  // ── Stripe Checkout Session creation ────────────────────────────────
  //
  // If this fails (network error, misconfiguration), the reservation
  // just created must not be left as an indefinite hold — release it
  // immediately rather than waiting 30 minutes for expiry.
  // Return URLs are the caller's concern (each product surface owns its
  // own public origin and paths) — resolved at this same point in the
  // flow as before, immediately ahead of Stripe Checkout Session creation.
  const { successUrl, cancelUrl } = await input.buildReturnUrls();

  try {
    const { sessionId, url } = await createCheckoutSession({
      organisationId,
      eventId: event.id,
      orderId,
      // One Stripe line item per cart line, in purchase order, priced
      // from the same server-derived unit prices (and, Phase 4, the same
      // per-line discounts) written to event_order_items above — so
      // Stripe's total is exactly event_orders.total_cents. Built and
      // asserted against the payment total before the reservation ran
      // (see stripeLineItems above); a discounted line is one net line
      // item with the quantity and discount spelled out (approval D2);
      // Phase 5A: a PASS_THROUGH fee is one extra labelled line.
      lineItems: stripeLineItems,
      currency: cart.currency,
      purchaserEmail: validated.purchaser_email,
      successUrl,
      cancelUrl,
      connectedAccountId,
      // Phase 5A — the committed snapshot's application fee (0 = none
      // sent); identical in both fee modes. See CreateCheckoutSessionInput.
      applicationFeeCents: financials.application_fee_cents,
    });

    // ── Checkout-vs-Retry race closure (PR #231 follow-up) ────────────
    // No longer unconditional: a manager Retry could have reacquired
    // this SAME order (advancing its expires_at) while the Stripe call
    // above was in flight. The guard requires BOTH the column still
    // being NULL and expires_at still matching exactly what this
    // request captured before calling Stripe — either condition failing
    // means someone else has already claimed this order's active
    // session, and the session just created here (`sessionId`) must be
    // treated as an orphan: never written to the DB, never returned to
    // this purchaser, best-effort expired in Stripe immediately (see
    // expireCheckoutSession's own comment for why best-effort is safe
    // even on failure).
    const writeBack = await sql`
      UPDATE event_orders SET stripe_checkout_session_id = ${sessionId}
      WHERE id = ${orderId} AND stripe_checkout_session_id IS NULL
        AND (extract(epoch FROM expires_at) * 1000000)::bigint IS NOT DISTINCT FROM ${capturedExpiresAtStamp}::bigint
      RETURNING id
    `;
    if (!writeBack.length) {
      console.error('[public checkout] lost the write-back race to a concurrent Retry — expiring orphaned Checkout Session', { orderId, sessionId });
      await expireCheckoutSession(sessionId, connectedAccountId);
      return { ok: false, code: 'WRITE_BACK_RACE_LOST' };
    }
    return { ok: true, checkoutUrl: url };
  } catch (err) {
    // Guarded the same way as the write-back above and the
    // writeRegistrationResponses failure branch further up (PR #231
    // follow-up) — see that branch's own comment for why.
    await sql`UPDATE event_orders SET status = 'CANCELLED', payment_status = 'FAILED' WHERE id = ${orderId} AND payment_status = 'PENDING' AND (extract(epoch FROM expires_at) * 1000000)::bigint IS NOT DISTINCT FROM ${capturedExpiresAtStamp}::bigint`;
    if (err instanceof StripeNotConfiguredError) {
      console.error('[public checkout] Stripe is not configured', err);
      return { ok: false, code: 'STRIPE_NOT_CONFIGURED' };
    }
    console.error('[public checkout] Stripe Checkout Session creation failed', err);
    return { ok: false, code: 'STRIPE_FAILED' };
  }
}
