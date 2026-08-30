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
export function generateTicketToken(): string {
  return randomBytes(32).toString('hex');
}
