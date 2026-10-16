import { createHash } from 'crypto';
import sql from '@/lib/db';
import { normaliseCode, ACCESS_CODE_PATTERN } from '@/lib/events/services/promotions';

// Shared ticketing service — presale ACCESS codes, Phase 4.
//
// An access code grants purchase ELIGIBILITY for ticket types flagged
// requires_access_code — never a price change, never extra capacity
// (presale allocations and separately reserved pools are out of scope).
// A separate entity from promotion codes (approval D9), see
// lib/events/services/promotions.ts.
//
// Security contract (brief §6, approval §3):
//   * resolved by (organisation_id, event_id, normalised code) ONLY;
//   * unknown, inactive, not-yet-started, ended, other-event and
//     other-organisation codes all collapse to the same ACCESS_CODE_INVALID
//     — nothing in the response distinguishes them, so the public API
//     leaks no information about other events or organisations;
//   * minimum 8 characters from a 36-symbol alphabet;
//   * the UNLOCKED set returned here is re-checked server-side on every
//     submit (lib/events/services/cart.ts's loadCartTicketTypes AND the
//     reservation gate itself) — the UI's hiding/disabling of restricted
//     types is never the enforcement.
// Rate limiting is the route's concern (quote/register/checkout). The
// repository's limiter is per-instance in-memory (lib/rateLimit.ts) —
// that is an outstanding platform-hardening limitation, not distributed
// protection, and is reported as such.

export type AccessGrant = {
  id: string;
  code: string;
  // Ticket types this code unlocks. Empty = every requires_access_code
  // type of the event (the organiser assigned no specific types).
  ticket_type_ids: string[];
};

export type ResolveAccessCodeResult =
  | { ok: true; grant: AccessGrant }
  | { ok: false; code: 'ACCESS_CODE_INVALID' };

export async function resolveAccessCode(organisationId: string, eventId: string, rawCode: string): Promise<ResolveAccessCodeResult> {
  const code = normaliseCode(rawCode);
  if (!code || !ACCESS_CODE_PATTERN.test(code)) return { ok: false, code: 'ACCESS_CODE_INVALID' };
  const rows = await sql`
    SELECT ac.id, ac.code,
      (SELECT array_agg(att.ticket_type_id ORDER BY att.ticket_type_id)
         FROM event_access_code_ticket_types att
         WHERE att.access_code_id = ac.id AND att.organisation_id = ac.organisation_id) AS ticket_type_ids
    FROM event_access_codes ac
    WHERE ac.organisation_id = ${organisationId} AND ac.event_id = ${eventId} AND ac.code = ${code}
      AND ac.active = true
      AND (ac.starts_at IS NULL OR ac.starts_at <= NOW())
      AND (ac.ends_at IS NULL OR ac.ends_at > NOW())
    LIMIT 1
  `;
  const row = rows[0] as { id: string; code: string; ticket_type_ids: string[] | null } | undefined;
  if (!row) return { ok: false, code: 'ACCESS_CODE_INVALID' };
  return { ok: true, grant: { id: row.id, code: row.code, ticket_type_ids: row.ticket_type_ids ?? [] } };
}

// Does this grant unlock the given restricted ticket type? An empty set
// unlocks every restricted type of the (already organisation/event-
// scoped) code's event.
export function grantUnlocks(grant: AccessGrant | null, ticketTypeId: string): boolean {
  if (!grant) return false;
  return grant.ticket_type_ids.length === 0 || grant.ticket_type_ids.includes(ticketTypeId);
}

// Masked representation for audit rows (approval D8): never the full
// code text. The first two characters plus a short, non-reversible
// SHA-256 fingerprint — enough to tell two codes (or a renamed code)
// apart in the audit trail without the trail ever being usable to
// recover the code.
export function maskAccessCode(code: string): string {
  const fingerprint = createHash('sha256').update(code).digest('hex').slice(0, 6);
  const visible = code.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(3, code.length - visible.length))}#${fingerprint}`;
}
