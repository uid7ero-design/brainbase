// Single shared derivation of "is this ticket currently valid" — used
// by the public ticket page (lib/events/publicTicket.ts), the booking
// wallet (lib/events/publicBooking.ts), and read-only staff check-in
// lookups (lib/events/checkIn.ts's resolveAttendee). Three independent
// re-implementations of this same three-field predicate is exactly the
// kind of drift this module exists to prevent, and matches this
// codebase's own established preference for deriving validity from
// existing order/payment/event state rather than introducing a second,
// independently-mutable status column (see scripts/add-events-
// ticketing.sql's own comment on why event_attendees has no separate
// ticket-status column).
//
// Not used by the atomic check-in *mutation* (confirmCheckIn's UPDATE
// in lib/events/checkIn.ts) — that statement embeds the equivalent
// condition directly in its own SQL WHERE clause, by design (see that
// function's own comment on why the guard must be part of the single
// atomic UPDATE, not a separate fetch-then-check in JS). This module
// and that WHERE clause express the exact same rule in two different
// places because they run in two different contexts, not because the
// rule itself differs — any change here should be mirrored there.
//
// A ticket is valid only when ALL three hold:
//   - the event itself has not been cancelled — the gap this module
//     closes: previously only order-level cancellation was checked by
//     the public ticket page and check-in, never event-level.
//   - the order has not been cancelled (covers both manual
//     cancellation and refund, which sets status='CANCELLED' — see the
//     refund route)
//   - payment has genuinely succeeded or was never required
//     (NOT_REQUIRED | PAID) — PENDING/FAILED/EXPIRED never qualify. In
//     practice no attendee ever holds a ticket_token while payment is
//     still pending (tokens are only issued once payment_status='PAID'
//     — see lib/events/stripe.ts's issueTicketTokensForPaidOrder), so
//     this condition is defence in depth, not the only thing standing
//     between an unpaid order and a resolvable token.
export type TicketValidityInput = {
  eventStatus: string;
  orderStatus: string;
  paymentStatus: string;
};

export type TicketValidityReason = 'event_cancelled' | 'order_cancelled' | 'payment_invalid';

export type TicketValidityResult =
  | { valid: true }
  | { valid: false; reason: TicketValidityReason };

export function evaluateTicketValidity(input: TicketValidityInput): TicketValidityResult {
  if (input.eventStatus === 'CANCELLED') return { valid: false, reason: 'event_cancelled' };
  if (input.orderStatus === 'CANCELLED') return { valid: false, reason: 'order_cancelled' };
  if (input.paymentStatus !== 'NOT_REQUIRED' && input.paymentStatus !== 'PAID') return { valid: false, reason: 'payment_invalid' };
  return { valid: true };
}

// Public-facing status vocabulary shared by /t/[token] and the booking
// wallet. Deliberately collapses the three internal reasons into two
// purchaser-facing states plus a distinct "event cancelled" message —
// 'payment_invalid' collapses into 'CANCELLED' rather than getting its
// own public copy: exposing "payment failed/expired" detail to whoever
// holds the bearer link is not more useful to a purchaser than a plain
// cancelled state, and in practice this branch is defence-in-depth
// rather than a state a real token can reach (see this file's own
// comment above).
export type PublicTicketStatus = 'VALID' | 'CANCELLED' | 'EVENT_CANCELLED';

export function toPublicTicketStatus(result: TicketValidityResult): PublicTicketStatus {
  if (result.valid) return 'VALID';
  if (result.reason === 'event_cancelled') return 'EVENT_CANCELLED';
  return 'CANCELLED';
}
