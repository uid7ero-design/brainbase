// Neutral ticketing vocabulary shared by every product built on the core.
// These unions mirror the database CHECK constraints that already govern
// the ticketing tables (scripts/add-events-ticketing.sql and
// scripts/create-events-phase2.sql in the BrainBase repository). They are
// the single TypeScript spelling of those values — add a value here only
// together with the matching constraint change, never on its own.

// EVENT_STATUSES / EventStatus live in ./validation (organiser input
// validation already owned them); they are re-exported by the package
// entry point alongside the order and payment vocabulary below.
import { EVENT_STATUSES, type EventStatus } from './validation';

export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['NOT_REQUIRED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// The concepts a ticketing product reasons about, in the order a buyer
// meets them. Purely nominal: a stable list for navigation, documentation
// and tests — not a schema.
export const TICKETING_CONCEPTS = [
  'organiser',
  'venue',
  'event',
  'session',
  'ticket_type',
  'inventory',
  'order',
  'attendee',
  'ticket',
  'payment',
] as const;
export type TicketingConcept = (typeof TICKETING_CONCEPTS)[number];

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === 'string' && (EVENT_STATUSES as readonly string[]).includes(value);
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

// "Live" in the sense every capacity aggregate uses: the order is not
// cancelled, and a pending paid reservation only counts while its hold
// has not lapsed. This is the TypeScript twin of the SQL predicate
//   eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
// and exists for display/derivation only — the database predicate inside
// the locked reservation statement remains the authority.
export function isLiveOrder(
  order: { status: OrderStatus; payment_status: PaymentStatus; expires_at: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (order.status === 'CANCELLED') return false;
  if (order.payment_status !== 'PENDING') return true;
  if (!order.expires_at) return false;
  const expires = order.expires_at instanceof Date ? order.expires_at : new Date(order.expires_at);
  return expires.getTime() > now.getTime();
}
