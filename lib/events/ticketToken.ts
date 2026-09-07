import 'server-only';
import { randomBytes } from 'crypto';

// Same generation contract as lib/tokens.ts's own createToken() — 256
// bits of entropy, server-side only, never client-supplied. Not
// imported from lib/tokens.ts directly: that module writes to the
// separate email_tokens table (its own user_id/type/expires_at/used_at
// shape); ticket_token is a plain column on event_attendees.
//
// Extracted here (Phase 4) so both the free-registration route and the
// Stripe webhook's paid-order token issuance (see lib/events/stripe.ts)
// generate tokens through the exact same function — a single source of
// truth for the entropy/encoding contract, rather than two independent
// implementations that could silently drift.
//
// Booking wallet — the underlying primitive is content-agnostic (a bare
// 256-bit hex string), so it is factored out here rather than
// duplicated for event_orders.booking_token. generateTicketToken() and
// generateBookingToken() below are deliberately kept as two distinctly
// named exports (not one generic function callers pass a label to) so
// every call site reads unambiguously which kind of token it is
// minting — the two token families must never be interchangeable, only
// their generation contract is shared.
function generateSecureToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateTicketToken(): string {
  return generateSecureToken();
}

// event_orders.booking_token — see scripts/add-events-booking-wallet.sql
// for the full rationale on why this is a separate token rather than a
// derivation of any attendee's own ticket_token or of event_orders.id.
export function generateBookingToken(): string {
  return generateSecureToken();
}
