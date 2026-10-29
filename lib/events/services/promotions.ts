import sql from '@/lib/db';
import type { CheckoutLineItem } from '@/lib/events/stripe';

// Shared ticketing service — promotional (discount) codes, Phase 4.
//
// Everything money-related here is INTEGER CENTS with explicit rounding;
// no floating-point arithmetic touches a price, a discount or a total at
// any point. BrainBase computes and SNAPSHOTS the discount server-side
// (event_orders.discount_cents / promotion_code_snapshot and one
// event_order_items.discount_cents per line) and sends Stripe the final,
// authoritative net amounts — Stripe's own coupon/promotion objects are
// deliberately not used (approval D2), so there is exactly one source of
// truth for what a purchaser pays: event_orders.total_cents.
//
// A promotion code is a PRICE reduction only. Purchase ELIGIBILITY for a
// restricted ticket type is a different concept with a different entity
// — see lib/events/services/accessCodes.ts (approval D9).
//
// Rules (brief §2/§4, approval D1/D6/D7):
//   * one promotion code per order, no stacking;
//   * codes are scoped to one organisation AND one event, matched
//     case-insensitively (stored normalised — see normaliseCode);
//   * PERCENT is a whole number 1..100; FIXED is integer cents >= 1;
//   * the discount is computed ONCE on the eligible subtotal (lines whose
//     ticket type is in the code's set — or every paid line when the set
//     is empty), rounded half-up, then allocated across the eligible
//     lines by largest remainder so Σ line discounts == order discount
//     exactly and no line ever goes negative;
//   * min_cart_cents (optional) is compared against the GROSS subtotal;
//   * the payable total must stay at or above Stripe's minimum charge for
//     the order's currency, otherwise the code is rejected for THIS cart
//     (D1 — a 100% discount is therefore rejected too; no new payment
//     state is introduced; an organiser who wants free entry creates a
//     free ticket type);
//   * a promotion code on an all-free cart is not applicable (nothing to
//     discount); the all-free/all-paid order rule is untouched.

// Code text normalisation — shared by promotion AND access codes, and
// identical to what the database CHECK constraints require of a stored
// value (code = upper(btrim(code))). Returns null for anything that is
// not a non-empty string. Format (length/alphabet) is validated
// separately against the two patterns below.
export function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalised = raw.trim().toUpperCase();
  return normalised.length ? normalised : null;
}
// Mirrors event_promotion_codes_code_format_check.
export const PROMOTION_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;
// Mirrors event_access_codes_code_format_check — minimum 8 (approval §3).
export const ACCESS_CODE_PATTERN = /^[A-Z0-9_-]{8,32}$/;

// ── Currency-aware minimum charge (approval §4) ──────────────────────
//
// event_ticket_types.currency / event_orders.currency are TEXT DEFAULT
// 'AUD' with no currency-selection UI (see scripts/add-events-payments.sql),
// so AUD is the only value this system writes today — but the column CAN
// hold another ISO code, so the minimum is looked up per currency rather
// than hardcoded. Values are Stripe's published minimum charge amounts
// for two-decimal currencies, in minor units. A currency NOT in this
// table makes a DISCOUNTED checkout fail closed
// (PROMOTION_CURRENCY_UNSUPPORTED) — undiscounted checkout is unchanged.
export const MINIMUM_CHARGE_CENTS: Readonly<Record<string, number>> = Object.freeze({
  AUD: 50, USD: 50, CAD: 50, NZD: 50, SGD: 50, EUR: 50, CHF: 50, GBP: 30,
});
export function minimumChargeCents(currency: string): number | null {
  const m = MINIMUM_CHARGE_CENTS[currency.toUpperCase()];
  return typeof m === 'number' ? m : null;
}

export type DiscountType = 'PERCENT' | 'FIXED';

// A promotion as resolved from the database for ONE (organisation,
// event, code) — see resolvePromotionCode().
export type PromotionRule = {
  id: string;
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  min_cart_cents: number | null;
  max_redemptions: number | null;
  // Empty = applies to every paid line of the cart.
  ticket_type_ids: string[];
};

export type DiscountLine = { ticket_type_id: string; unit_price_cents: number; quantity: number };

export type DiscountFailureCode =
  | 'PROMOTION_NOT_APPLICABLE'
  | 'PROMOTION_MIN_CART'
  | 'PROMOTION_TOTAL_TOO_LOW'
  | 'PROMOTION_CURRENCY_UNSUPPORTED';

export type DiscountComputation =
  | {
      ok: true;
      subtotalCents: number;
      eligibleSubtotalCents: number;
      discountCents: number;
      // Aligned 1:1 with the input lines; 0 for an ineligible line.
      lineDiscountCents: number[];
      totalCents: number;
    }
  | { ok: false; code: DiscountFailureCode };

function assertCents(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${what} must be a non-negative safe integer (got ${value}).`);
}

// Pure, deterministic, integer-only. See the file header for the rules.
export function computeDiscount(lines: DiscountLine[], rule: PromotionRule, currency: string): DiscountComputation {
  const gross = lines.map(l => {
    assertCents(l.unit_price_cents, 'unit_price_cents');
    assertCents(l.quantity, 'quantity');
    return l.unit_price_cents * l.quantity;
  });
  const subtotalCents = gross.reduce((s, g) => s + g, 0);
  if (subtotalCents === 0) return { ok: false, code: 'PROMOTION_NOT_APPLICABLE' };

  const restricted = rule.ticket_type_ids.length > 0;
  const eligibleSet = new Set(rule.ticket_type_ids);
  const eligible = lines.map((l, i) => gross[i] > 0 && (!restricted || eligibleSet.has(l.ticket_type_id)));
  const eligibleSubtotalCents = gross.reduce((s, g, i) => (eligible[i] ? s + g : s), 0);
  if (eligibleSubtotalCents === 0) return { ok: false, code: 'PROMOTION_NOT_APPLICABLE' };

  if (rule.min_cart_cents !== null && subtotalCents < rule.min_cart_cents) {
    return { ok: false, code: 'PROMOTION_MIN_CART' };
  }

  let discountCents: number;
  if (rule.discount_type === 'PERCENT') {
    if (!Number.isInteger(rule.discount_value) || rule.discount_value < 1 || rule.discount_value > 100) {
      throw new Error('PERCENT discount_value must be a whole number 1..100.');
    }
    // Round half-up, exactly once, on the eligible subtotal.
    discountCents = Math.floor((eligibleSubtotalCents * rule.discount_value + 50) / 100);
  } else {
    assertCents(rule.discount_value, 'FIXED discount_value');
    discountCents = Math.min(rule.discount_value, eligibleSubtotalCents);
  }
  if (discountCents <= 0) return { ok: false, code: 'PROMOTION_NOT_APPLICABLE' };

  // Minimum-charge rule BEFORE allocation (nothing to allocate if the
  // cart is rejected). Fail closed on an unknown currency.
  const minimum = minimumChargeCents(currency);
  if (minimum === null) return { ok: false, code: 'PROMOTION_CURRENCY_UNSUPPORTED' };
  const totalCents = subtotalCents - discountCents;
  if (totalCents < minimum) return { ok: false, code: 'PROMOTION_TOTAL_TOO_LOW' };

  // Largest-remainder allocation across eligible lines: integer floor
  // share first, then one extra cent to the lines with the largest
  // remainders (ties broken by cart position) until the sum is exact.
  const lineDiscountCents = lines.map(() => 0);
  const remainders: { index: number; remainder: number }[] = [];
  let allocated = 0;
  lines.forEach((_, i) => {
    if (!eligible[i]) return;
    const scaled = discountCents * gross[i];
    const base = Math.floor(scaled / eligibleSubtotalCents);
    lineDiscountCents[i] = base;
    allocated += base;
    remainders.push({ index: i, remainder: scaled % eligibleSubtotalCents });
  });
  remainders.sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));
  let leftover = discountCents - allocated;
  for (const r of remainders) {
    if (leftover <= 0) break;
    lineDiscountCents[r.index] += 1;
    leftover -= 1;
  }

  // Invariants, asserted rather than assumed: exact sum, no negative line.
  const sum = lineDiscountCents.reduce((s, d) => s + d, 0);
  if (sum !== discountCents) throw new Error(`Discount allocation mismatch: ${sum} != ${discountCents}.`);
  lines.forEach((_, i) => {
    if (lineDiscountCents[i] > gross[i]) throw new Error('A line discount exceeded its gross.');
  });

  return { ok: true, subtotalCents, eligibleSubtotalCents, discountCents, lineDiscountCents, totalCents };
}

// ── Resolution (database) ───────────────────────────────────────────
//
// Resolved by (organisation_id, event_id, normalised code) ONLY — a code
// belonging to another organisation or another event is simply not
// found, and every failure mode (unknown, inactive, outside its window)
// collapses to the same PROMOTION_INVALID so an anonymous caller cannot
// enumerate which codes exist elsewhere. Redemption availability is NOT
// decided here (that happens inside the locked reservation gate — see
// paidCheckout.ts) but can be previewed read-only for the quote via
// promotionRedemptionAvailable() below.
export type ResolvePromotionResult =
  | { ok: true; rule: PromotionRule }
  | { ok: false; code: 'PROMOTION_INVALID' };

type PromotionRow = {
  id: string; code: string; discount_type: DiscountType; discount_value: number;
  min_cart_cents: number | null; max_redemptions: number | null; ticket_type_ids: string[] | null;
};

export async function resolvePromotionCode(organisationId: string, eventId: string, rawCode: string): Promise<ResolvePromotionResult> {
  const code = normaliseCode(rawCode);
  if (!code || !PROMOTION_CODE_PATTERN.test(code)) return { ok: false, code: 'PROMOTION_INVALID' };
  const rows = await sql`
    SELECT pc.id, pc.code, pc.discount_type, pc.discount_value, pc.min_cart_cents, pc.max_redemptions,
      (SELECT array_agg(ptt.ticket_type_id ORDER BY ptt.ticket_type_id)
         FROM event_promotion_code_ticket_types ptt
         WHERE ptt.promotion_code_id = pc.id AND ptt.organisation_id = pc.organisation_id) AS ticket_type_ids
    FROM event_promotion_codes pc
    WHERE pc.organisation_id = ${organisationId} AND pc.event_id = ${eventId} AND pc.code = ${code}
      AND pc.active = true
      AND (pc.starts_at IS NULL OR pc.starts_at <= NOW())
      AND (pc.ends_at IS NULL OR pc.ends_at > NOW())
    LIMIT 1
  `;
  const row = rows[0] as PromotionRow | undefined;
  if (!row) return { ok: false, code: 'PROMOTION_INVALID' };
  return {
    ok: true,
    rule: {
      id: row.id, code: row.code, discount_type: row.discount_type, discount_value: row.discount_value,
      min_cart_cents: row.min_cart_cents, max_redemptions: row.max_redemptions, ticket_type_ids: row.ticket_type_ids ?? [],
    },
  };
}

// Organiser-side helper shared by the promotion and access-code routes:
// every ticket type assigned to a code must be one of THIS event's (same
// organisation). Returns the ids that are not — the database's composite
// FKs would refuse them anyway; this gives the organiser a readable 400.
export async function findForeignTicketTypeIds(eventId: string, organisationId: string, ticketTypeIds: string[]): Promise<string[]> {
  if (!ticketTypeIds.length) return [];
  const rows = await sql`
    SELECT id FROM event_ticket_types
    WHERE id = ANY(${ticketTypeIds}::text[]) AND event_id = ${eventId} AND organisation_id = ${organisationId}
  `;
  const owned = new Set((rows as { id: string }[]).map(r => r.id));
  return ticketTypeIds.filter(ttId => !owned.has(ttId));
}

// ── Redemption accounting (approval D3, as modified) ────────────────
//
// There is no redemption table — the order row IS the redemption. An
// order with promotion_code_id = X counts against X's max_redemptions
// when it is:
//   * successfully PAID — permanently, even if later REFUNDED or
//     cancelled (payment_status IN ('PAID','REFUNDED')); or
//   * any other non-cancelled order whose hold is live: a CONFIRMED free
//     order, or a PENDING paid reservation whose expires_at is still in
//     the future (status <> 'CANCELLED' AND (payment_status <> 'PENDING'
//     OR expires_at > NOW())).
// So an abandoned/expired hold and a FAILED/EXPIRED payment release the
// redemption (by time, or by the webhook flipping the row to CANCELLED),
// a webhook replay changes nothing (the webhook only UPDATEs the same
// row), and Retry excludes its own order (`eo.id <> order`) so it is
// never a second redemption. The reservation gates in paidCheckout.ts
// and retryCheckout.ts embed this exact predicate after locking the
// promotion row FOR UPDATE; this text is exported so the containment
// suite can assert the three copies stay identical.
export const REDEMPTION_COUNTS_PREDICATE_SQL =
  "(eo.payment_status IN ('PAID', 'REFUNDED') OR (eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())))";

export type PromotionRedemptionCounts = { redeemed: number; pending: number; max_redemptions: number | null; remaining: number | null };

// Read-only redemption figures for one code (organiser list + public
// quote preview). NOT a reservation decision — the gate decides that
// under its own lock.
export async function promotionRedemptionCounts(organisationId: string, promotionCodeId: string): Promise<PromotionRedemptionCounts | null> {
  const rows = await sql`
    SELECT pc.max_redemptions,
      (SELECT count(*) FROM event_orders eo
         WHERE eo.promotion_code_id = pc.id AND eo.organisation_id = pc.organisation_id
           AND (eo.payment_status IN ('PAID', 'REFUNDED') OR (eo.status <> 'CANCELLED' AND eo.payment_status = 'NOT_REQUIRED')))::int AS redeemed,
      (SELECT count(*) FROM event_orders eo
         WHERE eo.promotion_code_id = pc.id AND eo.organisation_id = pc.organisation_id
           AND eo.status <> 'CANCELLED' AND eo.payment_status = 'PENDING' AND eo.expires_at > NOW())::int AS pending
    FROM event_promotion_codes pc
    WHERE pc.id = ${promotionCodeId} AND pc.organisation_id = ${organisationId}
    LIMIT 1
  `;
  const row = rows[0] as { max_redemptions: number | null; redeemed: number; pending: number } | undefined;
  if (!row) return null;
  const remaining = row.max_redemptions === null ? null : Math.max(0, row.max_redemptions - row.redeemed - row.pending);
  return { redeemed: row.redeemed, pending: row.pending, max_redemptions: row.max_redemptions, remaining };
}

// Whether ONE more redemption of this code would currently fit its limit
// (read-only preview for the quote, and the post-gate diagnosis that
// tells a zero-row reservation apart as "code exhausted" vs "capacity
// exhausted"). `excludeOrderId` mirrors Retry's own self-exclusion.
export async function promotionRedemptionAvailable(organisationId: string, promotionCodeId: string, excludeOrderId: string | null = null): Promise<boolean> {
  const rows = await sql`
    SELECT 1 AS ok FROM event_promotion_codes pc
    WHERE pc.id = ${promotionCodeId} AND pc.organisation_id = ${organisationId}
      AND pc.active = true
      AND (pc.starts_at IS NULL OR pc.starts_at <= NOW())
      AND (pc.ends_at IS NULL OR pc.ends_at > NOW())
      AND (pc.max_redemptions IS NULL OR (
        SELECT count(*) FROM event_orders eo
        WHERE eo.promotion_code_id = pc.id AND eo.organisation_id = pc.organisation_id
          AND (${excludeOrderId}::text IS NULL OR eo.id <> ${excludeOrderId})
          AND (eo.payment_status IN ('PAID', 'REFUNDED') OR (eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())))
      ) + 1 <= pc.max_redemptions)
    LIMIT 1
  `;
  return rows.length > 0;
}

// ── Stripe line items (approval D2) ─────────────────────────────────
//
// Undiscounted lines are sent exactly as before (unit × quantity).
// A discounted line is sent as ONE net line item (quantity 1) whose
// unit_amount is the line's gross minus its allocated discount, with the
// original quantity and the discount spelled out in the name and
// description so the receipt stays clear. Σ unit_amount × quantity across
// the result equals the order's total_cents exactly — asserted by
// assertCheckoutLineItemsTotal() before any Stripe call, which fails
// closed on a mismatch rather than ever charging a different amount.
// BrainBase's own order records keep the accurate per-line quantities
// regardless (event_order_items.quantity is untouched by this).
export type DiscountedCheckoutLine = { name: string; unit_price_cents: number; quantity: number; discount_cents: number };

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function buildCheckoutLineItems(lines: DiscountedCheckoutLine[], promotionCode: string | null, currency: string): CheckoutLineItem[] {
  return lines.map(l => {
    assertCents(l.unit_price_cents, 'unit_price_cents');
    assertCents(l.quantity, 'quantity');
    assertCents(l.discount_cents, 'discount_cents');
    if (l.discount_cents === 0) return { name: l.name, unitAmountCents: l.unit_price_cents, quantity: l.quantity };
    const gross = l.unit_price_cents * l.quantity;
    if (l.discount_cents > gross) throw new Error('A line discount exceeded its gross.');
    const codeLabel = promotionCode ? ` (${promotionCode})` : '';
    return {
      name: `${l.name} × ${l.quantity}`,
      description: `${l.quantity} × ${formatMoney(l.unit_price_cents, currency)}, less ${formatMoney(l.discount_cents, currency)} discount${codeLabel}`,
      unitAmountCents: gross - l.discount_cents,
      quantity: 1,
    };
  });
}

export class OrderTotalMismatchError extends Error {
  constructor(public readonly expectedCents: number, public readonly actualCents: number) {
    super(`Checkout line items total ${actualCents} does not equal the order total ${expectedCents}.`);
    this.name = 'OrderTotalMismatchError';
  }
}

export function checkoutLineItemsTotalCents(items: CheckoutLineItem[]): number {
  return items.reduce((sum, it) => sum + it.unitAmountCents * it.quantity, 0);
}

export function assertCheckoutLineItemsTotal(items: CheckoutLineItem[], expectedTotalCents: number): void {
  const actual = checkoutLineItemsTotalCents(items);
  if (actual !== expectedTotalCents) throw new OrderTotalMismatchError(expectedTotalCents, actual);
}
