import sql from '@/lib/db';
import type { ValidatedCartItem } from '@/lib/events/publicValidation';

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

export type LoadCartResult =
  | { ok: true; lines: CartLine[]; pricing: CartPricing; currency: string }
  | {
      ok: false;
      code: 'TICKET_TYPE_NOT_FOUND' | 'TICKET_TYPE_INACTIVE' | 'MIXED_FREE_AND_PAID' | 'CURRENCY_MISMATCH';
    };

// Loads every cart line's ticket type in ONE tenant-scoped query and
// applies the cart-level business rules, all re-derived server-side
// (price and currency are never accepted from the request):
//
//   - every ticket type must exist, belong to THIS organisation AND
//     this event (a type from another event or organisation simply
//     isn't returned, so the row count no longer matches)
//   - every ticket type must be active
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
export async function loadCartTicketTypes(
  organisationId: string,
  eventId: string,
  items: ValidatedCartItem[],
): Promise<LoadCartResult> {
  const ids = items.map(it => it.ticket_type_id);
  const rows = await sql`
    SELECT id, active, price_cents, currency, name FROM event_ticket_types
    WHERE organisation_id = ${organisationId} AND event_id = ${eventId} AND id = ANY(${ids}::text[])
  `;
  const byId = new Map(
    (rows as { id: string; active: boolean; price_cents: number; currency: string; name: string }[]).map(r => [r.id, r]),
  );
  if (byId.size !== items.length || items.some(it => !byId.has(it.ticket_type_id))) {
    return { ok: false, code: 'TICKET_TYPE_NOT_FOUND' };
  }
  const types = items.map(it => byId.get(it.ticket_type_id)!);
  if (types.some(t => !t.active)) return { ok: false, code: 'TICKET_TYPE_INACTIVE' };

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
  return { ok: true, lines, pricing, currency };
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
// statement per ticket type (ascending id), then the session (if any).
// Each is its own statement inside the caller's sql.transaction([...]),
// exactly like the single-type R1 design: the capacity-gated statement
// that follows them gets its own fresh READ COMMITTED snapshot taken
// only after every lock has been granted.
export function buildCartLockStatements(organisationId: string, ticketTypeIds: string[], eventSessionId: string | null) {
  const statements = cartLockOrder(ticketTypeIds).map(
    id => sql`SELECT capacity FROM event_ticket_types WHERE id = ${id} AND organisation_id = ${organisationId} FOR UPDATE`,
  );
  if (eventSessionId) {
    statements.push(sql`SELECT capacity FROM event_sessions WHERE id = ${eventSessionId} AND organisation_id = ${organisationId} FOR UPDATE`);
  }
  return statements;
}

// Integer-cents order total: the exact sum of every line's
// unit_price_cents × quantity — the same figures written to
// event_order_items and sent to Stripe as line items, so the stored
// order total and the amount Stripe charges cannot diverge.
export function computeCartTotalCents(lines: { unit_price_cents: number; quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + l.unit_price_cents * l.quantity, 0);
}
