import sql from '@/lib/db';
import type { ValidatedCartItem } from '@/lib/events/publicValidation';
import { grantUnlocks, type AccessGrant } from '@/lib/events/services/accessCodes';

// Shared ticketing service — multi-ticket-type cart helpers (Phase 2).
//
// One order may contain several ticket types for the same event, each
// as its own event_order_items row. Everything here is shared by the
// free-registration, paid-checkout and retry flows so the three can
// never drift on what a valid cart is or on the order locks are taken.

export type CartLine = {
  ticket_type_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  currency: string;
};

export type CartPricing = 'FREE' | 'PAID';

export type LoadCartFailureCode =
  | 'TICKET_TYPE_NOT_FOUND'
  | 'TICKET_TYPE_INACTIVE'
  | 'MIXED_FREE_AND_PAID'
  | 'CURRENCY_MISMATCH'
  // Phase 4 — sale windows and presale access, see loadCartTicketTypes.
  | 'SALE_NOT_STARTED'
  | 'SALE_ENDED'
  | 'ACCESS_CODE_REQUIRED';

export type LoadCartResult =
  | {
      ok: true; lines: CartLine[]; pricing: CartPricing; currency: string;
      // Phase 5A — the fee policy that applies to THIS event, as the raw
      // row the single query below resolved (event row > organisation row;
      // null = none, the platform default). Passed through UNINTERPRETED:
      // only the paid checkout reads it (via
      // lib/events/services/fees.ts's normaliseFeePolicyRow); the free flow
      // and every pre-Phase-5A caller/fixture whose rows carry no
      // fee_policy column see null here and behave exactly as before.
      feePolicyRow: unknown;
    }
  | { ok: false; code: LoadCartFailureCode };

export type LoadCartOptions = {
  // Phase 4 — the access grant resolved from the purchaser's access code
  // (lib/events/services/accessCodes.ts), or null when none was supplied.
  // Every cart line whose ticket type requires an access code must be
  // unlocked by it; otherwise ACCESS_CODE_REQUIRED.
  accessGrant?: AccessGrant | null;
};

type TicketTypeRow = {
  id: string; active: boolean; price_cents: number; currency: string; name: string;
  sale_started: boolean; sale_ended: boolean; requires_access_code: boolean;
  fee_policy?: unknown;
};

// Loads every cart line's ticket type in ONE tenant-scoped query and
// applies the cart-level business rules, all re-derived server-side
// (price and currency are never accepted from the request):
//
//   - every ticket type must exist, belong to THIS organisation AND
//     this event (a type from another event or organisation simply
//     isn't returned, so the row count no longer matches)
//   - every ticket type must be active
//   - Phase 4: every ticket type must be ON SALE right now — evaluated
//     against the DATABASE's NOW() in the same query, never the client's
//     clock (sale_starts_at IS NULL OR <= NOW(); sale_ends_at IS NULL OR
//     > NOW()) — otherwise SALE_NOT_STARTED / SALE_ENDED. A buyer who
//     kept the page open across a boundary is refused here, and the
//     reservation gate re-asserts the same condition inside its own
//     locked statement.
//   - Phase 4: every ticket type flagged requires_access_code must be
//     unlocked by the supplied access grant (an eligibility check only —
//     never extra capacity), otherwise ACCESS_CODE_REQUIRED. Hiding or
//     disabling a restricted type in the UI is never the enforcement.
//   - an order is either all-free or all-paid — free and paid lines
//     follow different order state machines (CONFIRMED immediately vs
//     a PENDING Stripe reservation), so a mixed cart is rejected rather
//     than invented as a hybrid
//   - every line in an order shares one currency (one Stripe Checkout
//     Session can only charge one currency)
//
// Lines are returned in the caller's item order (the order the
// purchaser submitted), which is the order Stripe line items are shown
// in. Lock order is a separate concern — see cartLockOrder().
//
// Phase 5A: the same single query also resolves the event's fee policy
// as one scalar JSON column (identical on every row) — the cart's whole
// pricing context in one tenant-scoped round trip. The subquery text is
// pinned to lib/events/services/fees.ts's FEE_POLICY_RESOLUTION_SQL by
// the containment suite; the paid checkout is its only consumer.
export async function loadCartTicketTypes(
  organisationId: string,
  eventId: string,
  items: ValidatedCartItem[],
  options: LoadCartOptions = {},
): Promise<LoadCartResult> {
  const ids = items.map(it => it.ticket_type_id);
  const rows = await sql`
    SELECT id, active, price_cents, currency, name,
      (sale_starts_at IS NULL OR sale_starts_at <= NOW()) AS sale_started,
      (sale_ends_at IS NOT NULL AND sale_ends_at <= NOW()) AS sale_ended,
      requires_access_code,
      (SELECT to_jsonb(p) FROM ticketing_fee_policies p WHERE p.organisation_id = ${organisationId} AND (p.event_id = ${eventId} OR p.event_id IS NULL) ORDER BY (p.event_id IS NOT NULL) DESC LIMIT 1) AS fee_policy
    FROM event_ticket_types
    WHERE organisation_id = ${organisationId} AND event_id = ${eventId} AND id = ANY(${ids}::text[])
  `;
  const byId = new Map((rows as TicketTypeRow[]).map(r => [r.id, r]));
  if (byId.size !== items.length || items.some(it => !byId.has(it.ticket_type_id))) {
    return { ok: false, code: 'TICKET_TYPE_NOT_FOUND' };
  }
  const types = items.map(it => byId.get(it.ticket_type_id)!);
  if (types.some(t => !t.active)) return { ok: false, code: 'TICKET_TYPE_INACTIVE' };
  // Strict boolean comparisons on purpose: the query above always yields
  // real booleans, and a row that carries none of the Phase 4 columns
  // (the shape every pre-Phase-4 fixture and caller produced) therefore
  // reads as "no restriction" — which is exactly what the database
  // defaults (NULL window, requires_access_code false) mean.
  if (types.some(t => t.sale_started === false)) return { ok: false, code: 'SALE_NOT_STARTED' };
  if (types.some(t => t.sale_ended === true)) return { ok: false, code: 'SALE_ENDED' };
  const grant = options.accessGrant ?? null;
  if (types.some(t => t.requires_access_code === true && !grantUnlocks(grant, t.id))) return { ok: false, code: 'ACCESS_CODE_REQUIRED' };

  const freeCount = types.filter(t => t.price_cents === 0).length;
  if (freeCount !== 0 && freeCount !== types.length) return { ok: false, code: 'MIXED_FREE_AND_PAID' };
  const pricing: CartPricing = freeCount === types.length ? 'FREE' : 'PAID';

  const currency = types[0].currency;
  if (pricing === 'PAID' && types.some(t => t.currency !== currency)) return { ok: false, code: 'CURRENCY_MISMATCH' };

  const lines = items.map((it, i) => ({
    ticket_type_id: it.ticket_type_id,
    name: types[i].name,
    quantity: it.quantity,
    unit_price_cents: types[i].price_cents,
    currency: types[i].currency,
  }));
  return { ok: true, lines, pricing, currency, feePolicyRow: types[0].fee_policy ?? null };
}

// Deterministic lock order (deadlock avoidance): every flow that locks
// more than one ticket type locks them in ascending ticket_type_id
// order, compared by plain code-unit order in JS — never by the
// database's collation, so the order is identical for every request
// regardless of locale settings — and always BEFORE the session row.
// Two carts that overlap on any subset of ticket types therefore always
// request their shared rows in the same relative order, so neither can
// hold one row while waiting on a row the other holds.
export function cartLockOrder(ticketTypeIds: string[]): string[] {
  return [...ticketTypeIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// The FOR UPDATE lock statements for a cart, in lock order: one
// statement per ticket type (ascending id), then — for a session-bound
// cart only — one statement per ticket type's (ticket type, session)
// inventory override row (same ascending id order; a statement simply
// matches nothing when that pair has no override), then the session,
// then — Phase 4, for an order carrying a promotion code only — the
// promotion code row. Each is its own statement inside the caller's
// sql.transaction([...]), exactly like the single-type R1 design: the
// capacity-gated statement that follows them gets its own fresh READ
// COMMITTED snapshot taken only after every lock has been granted.
//
// Lock order, in full: every ticket type (asc) < every pair override row
// (asc by ticket type) < the session < the promotion code. Each tier is
// strictly later than the one before, requested by every flow only after
// all earlier tiers, and within a tier rows follow the same id order, so
// the total order stays acyclic for any two overlapping carts —
// including a session-bound cart racing a no-session cart on the same
// ticket type (the latter stops after the ticket-type tier) and two
// carts sharing a limited promotion code (both reach the code only after
// every inventory lock they need). Locking the code row is what makes a
// max_redemptions check inside the following gate statement safe: a
// concurrent order on the same code waits here, then re-reads the
// redemption count fresh. An organiser's PATCH on the code is a plain
// single-row UPDATE that simply waits its turn. No lock is ever held
// across a Stripe call — the transaction commits before Stripe is
// contacted (see paidCheckout.ts).
export function buildCartLockStatements(
  organisationId: string,
  ticketTypeIds: string[],
  eventSessionId: string | null,
  promotionCodeId: string | null = null,
) {
  const ordered = cartLockOrder(ticketTypeIds);
  const statements = ordered.map(
    id => sql`SELECT capacity FROM event_ticket_types WHERE id = ${id} AND organisation_id = ${organisationId} FOR UPDATE`,
  );
  if (eventSessionId) {
    for (const id of ordered) {
      statements.push(
        sql`SELECT capacity FROM event_ticket_type_session_inventory WHERE ticket_type_id = ${id} AND event_session_id = ${eventSessionId} AND organisation_id = ${organisationId} FOR UPDATE`,
      );
    }
    statements.push(sql`SELECT capacity FROM event_sessions WHERE id = ${eventSessionId} AND organisation_id = ${organisationId} FOR UPDATE`);
  }
  if (promotionCodeId) {
    statements.push(sql`SELECT max_redemptions FROM event_promotion_codes WHERE id = ${promotionCodeId} AND organisation_id = ${organisationId} FOR UPDATE`);
  }
  return statements;
}

// Integer-cents order total: the exact sum of every line's
// unit_price_cents × quantity — the same figures written to
// event_order_items and sent to Stripe as line items, so the stored
// order total and the amount Stripe charges cannot diverge. Phase 4: this
// is the GROSS subtotal; an order carrying a promotion code stores
// total_cents = this − discount_cents (see
// lib/events/services/promotions.ts), and that discounted figure is what
// Stripe is sent.
export function computeCartTotalCents(lines: { unit_price_cents: number; quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + l.unit_price_cents * l.quantity, 0);
}
