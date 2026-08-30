import 'server-only';
import sql from '@/lib/db';

export type CheckInAttendeeSummary = {
  id: string;
  attendee_name: string;
  ticket_type_name: string | null;
  session_name: string | null;
  checked_in_at: string | null;
};

type AttendeeRow = {
  id: string; attendee_name: string; checked_in_at: Date | string | null; order_status: string;
  ticket_type_name: string | null; session_name: string | null;
};

function toSummary(row: AttendeeRow): CheckInAttendeeSummary {
  return {
    id: row.id,
    attendee_name: row.attendee_name,
    ticket_type_name: row.ticket_type_name,
    session_name: row.session_name,
    checked_in_at: row.checked_in_at ? new Date(row.checked_in_at).toISOString() : null,
  };
}

// Identifies one attendee either by their ticket's scanned token (the
// QR/scanner path) or by their row id (the manual-search-and-select
// path, section 15) — every function below accepts either, so the same
// atomic check-in mechanism serves both UIs identically.
export type AttendeeIdentifier = { ticket_token: string } | { attendee_id: string };

// Every function below is deliberately scoped by BOTH organisationId
// AND eventId on every query — organisationId always comes from the
// caller's own authenticated session (see authorizeEventsRequest), and
// eventId from an already-ownership-checked event row (see
// loadOwnedEvent in the check-in route files) — never from anything
// client-supplied and untrusted. An identifier that resolves to a
// different event or organisation behaves identically to one that does
// not exist at all: 'not_found', with no distinguishing detail.

export type ResolveAttendeeResult =
  | { ok: true; attendee: CheckInAttendeeSummary }
  | { ok: false; reason: 'not_found' | 'cancelled' };

// Read-only — never mutates. Used as the scanner/manual-select's "show
// me who this is before I commit to checking them in" preview step, and
// internally by confirmCheckIn()/undoCheckIn() to build a full summary
// after their own atomic UPDATE has already decided the outcome.
export async function resolveAttendee(
  organisationId: string, eventId: string, identifier: AttendeeIdentifier,
): Promise<ResolveAttendeeResult> {
  const rows = 'ticket_token' in identifier
    ? await sql`
        SELECT ea.id, ea.attendee_name, ea.checked_in_at, eo.status AS order_status,
          tt.name AS ticket_type_name, es.name AS session_name
        FROM event_attendees ea
        JOIN event_order_items oi ON oi.id = ea.order_item_id AND oi.organisation_id = ea.organisation_id
        JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
        LEFT JOIN event_ticket_types tt ON tt.id = oi.ticket_type_id AND tt.organisation_id = oi.organisation_id
        LEFT JOIN event_sessions es ON es.id = oi.event_session_id AND es.organisation_id = oi.organisation_id
        WHERE ea.ticket_token = ${identifier.ticket_token} AND ea.organisation_id = ${organisationId} AND ea.event_id = ${eventId}
        LIMIT 1
      `
    : await sql`
        SELECT ea.id, ea.attendee_name, ea.checked_in_at, eo.status AS order_status,
          tt.name AS ticket_type_name, es.name AS session_name
        FROM event_attendees ea
        JOIN event_order_items oi ON oi.id = ea.order_item_id AND oi.organisation_id = ea.organisation_id
        JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
        LEFT JOIN event_ticket_types tt ON tt.id = oi.ticket_type_id AND tt.organisation_id = oi.organisation_id
        LEFT JOIN event_sessions es ON es.id = oi.event_session_id AND es.organisation_id = oi.organisation_id
        WHERE ea.id = ${identifier.attendee_id} AND ea.organisation_id = ${organisationId} AND ea.event_id = ${eventId}
        LIMIT 1
      `;
  const row = rows[0] as AttendeeRow | undefined;
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.order_status === 'CANCELLED') return { ok: false, reason: 'cancelled' };
  return { ok: true, attendee: toSummary(row) };
}

export type ConfirmCheckInResult =
  | { ok: true; first: boolean; attendee: CheckInAttendeeSummary }
  | { ok: false; reason: 'not_found' | 'cancelled' };

// THE atomic duplicate-scan-prevention mechanism (section 10/24 of the
// Phase 3 brief). Modeled directly on lib/tokens.ts's consumeToken(): a
// single UPDATE ... WHERE checked_in_at IS NULL ... RETURNING id.
//
// Why one plain UPDATE is sufficient here, unlike the Phase 2 R1
// capacity fix (which needed a lock statement split from a separate
// capacity-gated insert statement): the R1 defect was specifically
// about an AGGREGATE READ OVER A DIFFERENT TABLE (event_order_items)
// going stale relative to a FOR UPDATE lock taken on event_ticket_types
// within the same compound statement. Here, the condition
// (checked_in_at IS NULL) and the write (SET checked_in_at = now())
// target the EXACT SAME ROW in the EXACT SAME statement — this is
// exactly what Postgres's ordinary row-level locking for UPDATE
// already guarantees atomically: a second concurrent UPDATE targeting
// the same row blocks on the row lock, and once the first commits, the
// second re-evaluates its WHERE clause against the now-committed row
// before deciding whether to apply — so it correctly sees
// checked_in_at as no-longer-NULL and updates zero rows. No FOR UPDATE,
// no multi-statement transaction, no lock-then-recount split is needed
// — proven against real PostgreSQL 16 in
// scripts/tests/verify-events-phase3-checkin-concurrency.sh.
// The UPDATE's own WHERE clause also joins to event_orders and
// requires status <> 'CANCELLED' — a cancelled order's attendee can
// NEVER be marked checked in, atomically, in the same statement that
// decides first-vs-duplicate. This is deliberate: an earlier version of
// this function checked cancellation only via a resolveAttendee() call
// AFTER the UPDATE, which meant a cancelled ticket with
// checked_in_at IS NULL would already have been (incorrectly) marked
// checked in by the UPDATE before the cancellation was ever noticed —
// mutating state first and validating second. Gating cancellation in
// the UPDATE itself closes that gap the same way the checked_in_at
// guard closes the duplicate-scan gap: one atomic decision, not a
// write followed by a check.
export async function confirmCheckIn(
  organisationId: string, eventId: string, identifier: AttendeeIdentifier, staffUserId: string,
): Promise<ConfirmCheckInResult> {
  const updated = 'ticket_token' in identifier
    ? await sql`
        UPDATE event_attendees ea
        SET checked_in_at = now(), checked_in_by_user_id = ${staffUserId}
        FROM event_order_items oi, event_orders eo
        WHERE ea.order_item_id = oi.id AND oi.organisation_id = ea.organisation_id
          AND eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
          AND ea.ticket_token = ${identifier.ticket_token} AND ea.organisation_id = ${organisationId} AND ea.event_id = ${eventId}
          AND ea.checked_in_at IS NULL
          AND eo.status <> 'CANCELLED'
        RETURNING ea.id
      `
    : await sql`
        UPDATE event_attendees ea
        SET checked_in_at = now(), checked_in_by_user_id = ${staffUserId}
        FROM event_order_items oi, event_orders eo
        WHERE ea.order_item_id = oi.id AND oi.organisation_id = ea.organisation_id
          AND eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
          AND ea.id = ${identifier.attendee_id} AND ea.organisation_id = ${organisationId} AND ea.event_id = ${eventId}
          AND ea.checked_in_at IS NULL
          AND eo.status <> 'CANCELLED'
        RETURNING ea.id
      `;
  const first = updated.length > 0;

  // Re-resolve regardless of which branch — gives a single consistent
  // return shape (id/name/ticket type/session/timestamp) whether this
  // call just performed the first check-in or found it already done.
  // Not a race: if `first` is true the state this reads back is exactly
  // what this same call just committed; if false, nothing here changes
  // outcome, it only explains why (cancelled vs. already checked in).
  const resolved = await resolveAttendee(organisationId, eventId, identifier);
  if (!resolved.ok) return resolved;
  return { ok: true, first, attendee: resolved.attendee };
}

export type UndoCheckInResult =
  | { ok: true; attendee: CheckInAttendeeSummary }
  | { ok: false; reason: 'not_found' | 'not_checked_in' };

// The exact mirror-image conditional UPDATE, gated the opposite way
// (checked_in_at IS NOT NULL) — a manager+-only explicit reversal, not
// a toggle a repeated scan can ever reach (confirmCheckIn() never calls
// this; a second scan of an already-checked-in ticket is reported as
// "already checked in", not silently undone).
export async function undoCheckIn(
  organisationId: string, eventId: string, attendeeId: string,
): Promise<UndoCheckInResult> {
  const updated = await sql`
    UPDATE event_attendees
    SET checked_in_at = NULL, checked_in_by_user_id = NULL
    WHERE id = ${attendeeId} AND organisation_id = ${organisationId} AND event_id = ${eventId}
      AND checked_in_at IS NOT NULL
    RETURNING id
  `;
  if (updated.length) {
    const resolved = await resolveAttendee(organisationId, eventId, { attendee_id: attendeeId });
    if (resolved.ok) return { ok: true, attendee: resolved.attendee };
  }

  const existsRows = await sql`
    SELECT id FROM event_attendees WHERE id = ${attendeeId} AND organisation_id = ${organisationId} AND event_id = ${eventId} LIMIT 1
  `;
  return { ok: false, reason: existsRows.length ? 'not_checked_in' : 'not_found' };
}

// Manual fallback search (section 15) — always scoped to the caller's
// own organisation AND the current event; never a global/cross-tenant
// search. Simple ILIKE name match, capped at 20 results — this is a
// staff-facing convenience lookup for a single event's attendee list,
// not a general search feature.
export async function searchAttendees(organisationId: string, eventId: string, query: string): Promise<CheckInAttendeeSummary[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const rows = await sql`
    SELECT ea.id, ea.attendee_name, ea.checked_in_at, eo.status AS order_status,
      tt.name AS ticket_type_name, es.name AS session_name
    FROM event_attendees ea
    JOIN event_order_items oi ON oi.id = ea.order_item_id AND oi.organisation_id = ea.organisation_id
    JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
    LEFT JOIN event_ticket_types tt ON tt.id = oi.ticket_type_id AND tt.organisation_id = oi.organisation_id
    LEFT JOIN event_sessions es ON es.id = oi.event_session_id AND es.organisation_id = oi.organisation_id
    WHERE ea.organisation_id = ${organisationId} AND ea.event_id = ${eventId}
      AND eo.status <> 'CANCELLED'
      AND ea.attendee_name ILIKE ${'%' + trimmed + '%'}
    ORDER BY ea.attendee_name
    LIMIT 20
  `;
  return (rows as AttendeeRow[]).map(toSummary);
}
