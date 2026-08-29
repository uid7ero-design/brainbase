import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { resolvePublicEvent } from '@/lib/events/publicResolve';
import { validatePublicRegistrationInput, type PublicRegistrationInput } from '@/lib/events/publicValidation';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';

type Ctx = { params: Promise<{ organisationSlug: string; eventSlug: string }> };

// Fully anonymous — never calls requireSession()/requireRole()/
// getSession() or reads any cookie. organisationId is resolved exactly
// once, by resolvePublicEvent() from the URL's slug pair, and used for
// every subsequent query; the request body is never read for an
// organisation id, a price, a capability, or a role, and none would be
// trusted if present (see validatePublicRegistrationInput — those keys
// don't even exist in its accepted shape).
export async function POST(req: NextRequest, { params }: Ctx) {
  const { organisationSlug, eventSlug } = await params;

  // Rate limit before any DB read/write — keyed by route + both slugs +
  // IP, so sustained abuse against one event cannot exhaust the
  // limiter's shared in-memory budget for every other event on the
  // platform. Uses the existing lib/rateLimit.ts (in-memory, resets on
  // cold start — the same accepted MVP limitation as every other public
  // endpoint in this repo; see that file's own header comment).
  const ip = getClientIp(req);
  const rateLimitKey = `public-events-register:${organisationSlug}:${eventSlug}:${ip}`;
  if (!checkRateLimit(rateLimitKey, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many registration attempts. Please try again later.' }, { status: 429 });
  }

  // Validate the request body's shape before touching the database at
  // all — structurally invalid input (bad quantity, malformed email, a
  // mismatched attendee count) can never depend on which event was
  // selected, so there is no reason to spend a DB round-trip resolving
  // one before rejecting garbage input.
  let rawBody: PublicRegistrationInput;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const validated = validatePublicRegistrationInput(rawBody);
  if (typeof validated === 'string') {
    return NextResponse.json({ error: validated }, { status: 400 });
  }

  const resolved = await resolvePublicEvent(organisationSlug, eventSlug);
  if (!resolved.ok) return NextResponse.json({ error: 'Event not available.' }, { status: 404 });
  const { organisationId, event } = resolved;

  // Ownership + business-rule checks, all re-derived server-side —
  // never trusted from the request. The ticket type (and session, if
  // selected) must belong to THIS resolved event and organisation; the
  // ticket type must be active; and its price must be exactly zero —
  // Phase 2 is free-only, so a paid ticket type is rejected outright
  // rather than the route ever proceeding with (or trusting) a
  // non-zero price.
  const ticketTypeRows = await sql`
    SELECT id, active, price_cents FROM event_ticket_types
    WHERE id = ${validated.ticket_type_id} AND organisation_id = ${organisationId} AND event_id = ${event.id}
    LIMIT 1
  `;
  const ticketType = ticketTypeRows[0] as { id: string; active: boolean; price_cents: number } | undefined;
  if (!ticketType) {
    return NextResponse.json({ error: 'Selected ticket type is not available for this event.' }, { status: 400 });
  }
  if (!ticketType.active) {
    return NextResponse.json({ error: 'Selected ticket type is not currently available.' }, { status: 400 });
  }
  if (ticketType.price_cents !== 0) {
    return NextResponse.json({ error: 'This ticket type requires payment, which is not yet supported.' }, { status: 400 });
  }

  if (validated.event_session_id) {
    const sessionRows = await sql`
      SELECT id FROM event_sessions
      WHERE id = ${validated.event_session_id} AND organisation_id = ${organisationId} AND event_id = ${event.id}
      LIMIT 1
    `;
    if (!sessionRows.length) {
      return NextResponse.json({ error: 'Selected session is not available for this event.' }, { status: 400 });
    }
  }

  // Attendee names/emails are passed as parallel arrays and expanded
  // server-side via UNNEST — empty string (not SQL NULL) represents "no
  // attendee email", converted back to NULL via NULLIF in the SELECT, to
  // avoid depending on how the driver serialises a NULL element inside a
  // JS array parameter (empty-string round-tripping through ::text[] is
  // unambiguous; NULL-element array serialisation is a less certain
  // driver behaviour this code does not want to depend on).
  const attendeeNames = validated.attendees.map(a => a.name);
  const attendeeEmails = validated.attendees.map(a => a.email ?? '');

  // ── Atomic, concurrency-safe order creation ──────────────────────────
  // A single compound SQL statement (Postgres executes one INSERT/CTE
  // chain like this as one atomic unit — no `sql.transaction()` wrapper
  // is needed or used here, since this genuinely is one statement, not
  // several):
  //   1. `locked_tt` takes a FOR UPDATE row lock on the ticket type,
  //      serialising concurrent registration attempts for the SAME
  //      ticket type — a second concurrent request blocks here until
  //      the first's statement commits or rolls back, then re-reads
  //      committed state, closing the classic check-then-insert race a
  //      plain "SELECT count, compare, INSERT" would have.
  //   2. `sold_tt` sums quantities already committed against that
  //      ticket type (excluding cancelled orders).
  //   3. `ins_order` inserts the order — but its INSERT...SELECT is
  //      itself gated by the capacity WHERE clause, so if capacity is
  //      exceeded, ins_order inserts ZERO rows (no orphan order).
  //   4. `ins_item` inserts the order item by selecting FROM ins_order —
  //      if ins_order produced no row, ins_item produces no row either
  //      (no orphan item).
  //   5. The final INSERT into event_attendees selects FROM ins_item —
  //      if ins_item produced no row, this produces no rows either (no
  //      orphan attendees).
  // Because every step downstream of the capacity check is a SELECT
  // FROM the previous step's own result set (never an unconditional
  // INSERT), an empty capacity check propagates all the way through:
  // either everything is created, or nothing is — there is no
  // intermediate state where an order exists without its item(s), or an
  // item exists without its attendee(s). If the WHERE clause result is
  // empty, `rows.length` below is 0 and the whole statement still
  // committed successfully (an empty result set is not a SQL error) —
  // exactly zero rows were ever written.
  const rows = validated.event_session_id
    ? await sql`
        WITH locked_tt AS (
          SELECT capacity FROM event_ticket_types WHERE id = ${validated.ticket_type_id} AND organisation_id = ${organisationId} FOR UPDATE
        ),
        sold_tt AS (
          SELECT COALESCE(SUM(oi.quantity), 0) AS qty
          FROM event_order_items oi
          JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
          WHERE oi.ticket_type_id = ${validated.ticket_type_id} AND oi.organisation_id = ${organisationId} AND eo.status <> 'CANCELLED'
        ),
        locked_sess AS (
          SELECT capacity FROM event_sessions WHERE id = ${validated.event_session_id} AND organisation_id = ${organisationId} FOR UPDATE
        ),
        sold_sess AS (
          SELECT COALESCE(SUM(oi.quantity), 0) AS qty
          FROM event_order_items oi
          JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
          WHERE oi.event_session_id = ${validated.event_session_id} AND oi.organisation_id = ${organisationId} AND eo.status <> 'CANCELLED'
        ),
        ins_order AS (
          INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
          SELECT ${organisationId}, ${event.id}, ${validated.purchaser_name}, ${validated.purchaser_email}, ${validated.purchaser_phone}, 'CONFIRMED', 0
          FROM locked_tt, sold_tt, locked_sess, sold_sess
          WHERE sold_tt.qty + ${validated.quantity} <= locked_tt.capacity
            AND sold_sess.qty + ${validated.quantity} <= locked_sess.capacity
          RETURNING id
        ),
        ins_item AS (
          INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
          SELECT ${organisationId}, ins_order.id, ${event.id}, ${validated.ticket_type_id}, ${validated.event_session_id}, ${validated.quantity}, 0
          FROM ins_order
          RETURNING id, order_id
        )
        INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
        SELECT ${organisationId}, ${event.id}, ins_item.order_id, ins_item.id, a.name, NULLIF(a.email, '')
        FROM ins_item, UNNEST(${attendeeNames}::text[], ${attendeeEmails}::text[]) AS a(name, email)
        RETURNING order_id
      `
    : await sql`
        WITH locked_tt AS (
          SELECT capacity FROM event_ticket_types WHERE id = ${validated.ticket_type_id} AND organisation_id = ${organisationId} FOR UPDATE
        ),
        sold_tt AS (
          SELECT COALESCE(SUM(oi.quantity), 0) AS qty
          FROM event_order_items oi
          JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
          WHERE oi.ticket_type_id = ${validated.ticket_type_id} AND oi.organisation_id = ${organisationId} AND eo.status <> 'CANCELLED'
        ),
        ins_order AS (
          INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
          SELECT ${organisationId}, ${event.id}, ${validated.purchaser_name}, ${validated.purchaser_email}, ${validated.purchaser_phone}, 'CONFIRMED', 0
          FROM locked_tt, sold_tt
          WHERE sold_tt.qty + ${validated.quantity} <= locked_tt.capacity
          RETURNING id
        ),
        ins_item AS (
          INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
          SELECT ${organisationId}, ins_order.id, ${event.id}, ${validated.ticket_type_id}, NULL, ${validated.quantity}, 0
          FROM ins_order
          RETURNING id, order_id
        )
        INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
        SELECT ${organisationId}, ${event.id}, ins_item.order_id, ins_item.id, a.name, NULLIF(a.email, '')
        FROM ins_item, UNNEST(${attendeeNames}::text[], ${attendeeEmails}::text[]) AS a(name, email)
        RETURNING order_id
      `;

  if (!rows.length) {
    return NextResponse.json(
      { error: 'This ticket type is no longer available in the requested quantity.' },
      { status: 409 },
    );
  }

  const orderId = rows[0].order_id as string;
  return NextResponse.json(
    { confirmation_reference: orderId, quantity: validated.quantity },
    { status: 201 },
  );
}
