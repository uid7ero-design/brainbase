// Phase 7 §4 — "Resend ticket email" eligibility rule.
//
// Deliberately has NO imports at all (not even 'server-only'): this is
// the one piece of the ticket-email feature that must be callable from
// BOTH the resend route (server) and RegistrationDetail.tsx (a 'use
// client' component, to decide whether the action is even shown) — a
// module reachable from a client component can never import
// lib/email.ts or lib/events/qr.ts, since both pull in 'server-only'
// and poison the whole import chain. lib/events/ticketEmail.ts
// re-exports this function rather than redefining it, so there is
// exactly one copy of the eligibility rule for the server route to
// re-derive fresh at send time and for the UI to decide what to show.
//
// Eligible only when: order.status = 'CONFIRMED', payment_status IN
// ('NOT_REQUIRED', 'PAID'), purchaser_email exists/non-empty, and at
// least one attendee already has a ticket_token. Never mints a token —
// callers must never call generateTicketToken() as part of this
// feature; an ineligible order (PENDING/FAILED/EXPIRED/REFUNDED
// payment, CANCELLED order, no purchaser email, no issued tokens) is
// simply not offered a resend at all.
export type TicketEmailEligibilityOrder = {
  status: string;
  payment_status: string;
  purchaser_email: string | null | undefined;
  attendees: { ticket_token: string | null }[];
};

export function isOrderEligibleForTicketEmail(order: TicketEmailEligibilityOrder): boolean {
  if (order.status !== 'CONFIRMED') return false;
  if (order.payment_status !== 'NOT_REQUIRED' && order.payment_status !== 'PAID') return false;
  if (!order.purchaser_email || !order.purchaser_email.trim()) return false;
  if (!order.attendees.some(a => !!a.ticket_token)) return false;
  return true;
}
