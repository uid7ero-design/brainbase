// How long a PENDING paid order holds its seat in the database.
//
// Stripe stops accepting payment for a Checkout Session when its own
// `expires_at` passes (RESERVATION_WINDOW_SECONDS after creation). The seat hold
// in event_orders.expires_at used to end at about the same instant, so a payment
// completed near the end of the session could be finalised by a DELAYED webhook
// AFTER the hold had lapsed and the seat had been resold — a paid order with no
// capacity. The hold now outlasts the payable window by this grace, so a webhook
// that arrives within it always finds the seat still held.
//
// Abandoned sessions are not held longer in practice: Stripe sends
// checkout.session.expired at the end of the window and the order is cancelled
// (seat released) then. The grace only applies if that webhook is itself lost, in
// which case the seat stays held for at most this much longer than before.
//
// A webhook delayed beyond the grace (an outage of over an hour) is a residual
// risk, as is a payment method that settles asynchronously (days) — see ADR 0013.
export const RESERVATION_HOLD_GRACE_SECONDS = 60 * 60;

export function reservationHoldSeconds(paymentWindowSeconds: number): number {
  return paymentWindowSeconds + RESERVATION_HOLD_GRACE_SECONDS;
}
