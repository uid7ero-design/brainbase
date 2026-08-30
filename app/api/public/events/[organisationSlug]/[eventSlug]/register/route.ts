import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { resolvePublicEvent } from '@/lib/events/publicResolve';
import { validatePublicRegistrationInput, type PublicRegistrationInput } from '@/lib/events/publicValidation';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';
import { generateTicketToken } from '@/lib/events/ticketToken';

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
  // this route is the free-registration path only (see this file's own
  // header). A paid ticket type is rejected outright rather than the
  // route ever proceeding with (or trusting) a non-zero price; the
  // public UI never calls this route for a paid ticket type — see
  // app/api/public/events/[organisationSlug]/[eventSlug]/checkout/
  // route.ts (Phase 4) for the Stripe-backed paid path. This check
  // remains as defense in depth against a bypassed/direct API call.
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
    return NextResponse.json({ error: 'This ticket type requires payment. Use the checkout flow instead.' }, { status: 400 });
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
  // One token per attendee, generated once here and passed through as
  // a third parallel array to the same UNNEST(...) the names/emails
  // already use below — never derived from (or influenced by) any
  // client-supplied value.
  const ticketTokens = validated.attendees.map(() => generateTicketToken());

  // ── Concurrency-safe order creation (R1 remediation) ─────────────────
  //
  // R1 CONTEXT: the original Phase 2 design ran ONE compound statement
  // containing the FOR UPDATE lock, the sold-quantity aggregate, and the
  // guarded inserts all together. Independent review proved against
  // real PostgreSQL 16 that this oversells: under READ COMMITTED, a
  // single SQL statement takes ONE snapshot at statement start. FOR
  // UPDATE's EvalPlanQual mechanism re-fetches only the SPECIFIC locked
  // row once the lock is granted — it does NOT advance the snapshot for
  // the REST of that same statement, including an aggregate subquery
  // over a different table (event_order_items/event_orders). A second
  // registrant's statement could therefore correctly wait for the first
  // registrant's lock, correctly see the ticket type's current capacity
  // value once unblocked, and STILL compute a stale (pre-commit) sold
  // quantity from its own original snapshot — oversell.
  //
  // THE FIX: split the lock acquisition and the capacity-gated insert
  // into GENUINELY SEPARATE SQL statements, submitted together via
  // sql.transaction() (see lib/db.ts's own comment and CONFIG.md for why
  // this driver's transaction() is the right primitive here). Per
  // PostgreSQL's own per-STATEMENT (not per-transaction) READ COMMITTED
  // snapshot rule, each element of a sql.transaction([...]) array is a
  // distinct statement that gets its OWN fresh snapshot when it begins
  // — so the capacity-gated insert statement, submitted after the lock
  // statement(s), correctly observes any commit that happened while we
  // were blocked waiting for the lock (which by definition is every
  // commit that could possibly conflict with us, since FOR UPDATE
  // cannot unblock until the prior holder's transaction has committed
  // or rolled back). Verified empirically against real Postgres 16 via
  // scripts/tests/verify-events-phase2-concurrency.sh — see that file
  // for the reproducible harness this fix was proven against, including
  // the specific forced-blocking scenario that reproduced the original
  // defect 4/4 times and no longer reproduces it after this change.
  //
  // Statement sequence (fixed, deterministic order — see LOCK ORDER
  // below):
  //   1. Lock the ticket type row (FOR UPDATE).
  //   2. (session-bound only) Lock the session row (FOR UPDATE) —
  //      always AFTER the ticket-type lock, in every code path, so two
  //      concurrent registrations selecting the same pair of rows can
  //      never deadlock by acquiring them in opposite orders.
  //   3. A standalone, fresh sold-ticket-type-quantity read. This
  //      statement begins only after step 1 has completed, so under
  //      READ COMMITTED it gets its own snapshot taken at that later
  //      point — it exists purely to build a precise "N remaining"
  //      conflict message; it does not itself gate anything (that would
  //      still be non-interactive — see below).
  //   4. (session-bound only) The same, for the session.
  //   5. The actual capacity gate: a WITH-chain INSERT (order -> item ->
  //      attendees) whose own embedded aggregate subqueries are
  //      evaluated as part of THIS statement — which, being submitted
  //      after the lock statement(s), also gets a fresh, post-lock
  //      snapshot. This is what actually prevents the oversell; step 3
  //      is diagnostic only. Every insert downstream of the capacity
  //      WHERE clause still SELECTs FROM the previous step's own result
  //      set (never an unconditional INSERT), so an empty capacity
  //      check still propagates all the way through with zero orphan
  //      rows, exactly as before.
  //
  // sql.transaction() is "non-interactive": every statement in the
  // array is built and submitted up front, in one HTTP request, with no
  // opportunity for application code to branch on one statement's
  // result before constructing the next. That is why step 5 must still
  // carry its own embedded capacity check (a fixed, unconditional
  // statement whose OWN WHERE clause decides whether it inserts
  // anything) rather than JS code deciding, after reading step 3's
  // result, whether to submit step 5 at all.
  let transactionResults: unknown[];
  try {
    transactionResults = validated.event_session_id
      ? await sql.transaction([
          sql`SELECT capacity FROM event_ticket_types WHERE id = ${validated.ticket_type_id} AND organisation_id = ${organisationId} FOR UPDATE`,
          sql`SELECT capacity FROM event_sessions WHERE id = ${validated.event_session_id} AND organisation_id = ${organisationId} FOR UPDATE`,
          sql`
            SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty
            FROM event_order_items oi
            JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
            WHERE oi.ticket_type_id = ${validated.ticket_type_id} AND oi.organisation_id = ${organisationId} AND eo.status <> 'CANCELLED'
          `,
          sql`
            SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty
            FROM event_order_items oi
            JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
            WHERE oi.event_session_id = ${validated.event_session_id} AND oi.organisation_id = ${organisationId} AND eo.status <> 'CANCELLED'
          `,
          sql`
            WITH sold_tt AS (
              SELECT COALESCE(SUM(oi.quantity), 0) AS qty
              FROM event_order_items oi
              JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
              WHERE oi.ticket_type_id = ${validated.ticket_type_id} AND oi.organisation_id = ${organisationId} AND eo.status <> 'CANCELLED'
            ),
            sold_sess AS (
              SELECT COALESCE(SUM(oi.quantity), 0) AS qty
              FROM event_order_items oi
              JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
              WHERE oi.event_session_id = ${validated.event_session_id} AND oi.organisation_id = ${organisationId} AND eo.status <> 'CANCELLED'
            ),
            ins_order AS (
              -- No FOR UPDATE needed here: the ticket-type/session rows
              -- are already locked by this transaction's own earlier
              -- statements above, and that lock is held for the whole
              -- transaction — a plain read of their current capacity is
              -- already guaranteed exclusive and fresh.
              INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
              SELECT ${organisationId}, ${event.id}, ${validated.purchaser_name}, ${validated.purchaser_email}, ${validated.purchaser_phone}, 'CONFIRMED', 0
              FROM sold_tt, sold_sess
              WHERE sold_tt.qty + ${validated.quantity} <= (SELECT capacity FROM event_ticket_types WHERE id = ${validated.ticket_type_id} AND organisation_id = ${organisationId})
                AND sold_sess.qty + ${validated.quantity} <= (SELECT capacity FROM event_sessions WHERE id = ${validated.event_session_id} AND organisation_id = ${organisationId})
              RETURNING id
            ),
            ins_item AS (
              INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
              SELECT ${organisationId}, ins_order.id, ${event.id}, ${validated.ticket_type_id}, ${validated.event_session_id}, ${validated.quantity}, 0
              FROM ins_order
              RETURNING id, order_id
            )
            INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email, ticket_token)
            SELECT ${organisationId}, ${event.id}, ins_item.order_id, ins_item.id, a.name, NULLIF(a.email, ''), a.token
            FROM ins_item, UNNEST(${attendeeNames}::text[], ${attendeeEmails}::text[], ${ticketTokens}::text[]) AS a(name, email, token)
            RETURNING order_id, attendee_name, ticket_token
          `,
        ])
      : await sql.transaction([
          sql`SELECT capacity FROM event_ticket_types WHERE id = ${validated.ticket_type_id} AND organisation_id = ${organisationId} FOR UPDATE`,
          sql`
            SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty
            FROM event_order_items oi
            JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
            WHERE oi.ticket_type_id = ${validated.ticket_type_id} AND oi.organisation_id = ${organisationId} AND eo.status <> 'CANCELLED'
          `,
          sql`
            WITH sold_tt AS (
              SELECT COALESCE(SUM(oi.quantity), 0) AS qty
              FROM event_order_items oi
              JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
              WHERE oi.ticket_type_id = ${validated.ticket_type_id} AND oi.organisation_id = ${organisationId} AND eo.status <> 'CANCELLED'
            ),
            ins_order AS (
              -- No FOR UPDATE needed here — see the session-bound branch's
              -- identical comment above.
              INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
              SELECT ${organisationId}, ${event.id}, ${validated.purchaser_name}, ${validated.purchaser_email}, ${validated.purchaser_phone}, 'CONFIRMED', 0
              FROM sold_tt
              WHERE sold_tt.qty + ${validated.quantity} <= (SELECT capacity FROM event_ticket_types WHERE id = ${validated.ticket_type_id} AND organisation_id = ${organisationId})
              RETURNING id
            ),
            ins_item AS (
              INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
              SELECT ${organisationId}, ins_order.id, ${event.id}, ${validated.ticket_type_id}, NULL, ${validated.quantity}, 0
              FROM ins_order
              RETURNING id, order_id
            )
            INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email, ticket_token)
            SELECT ${organisationId}, ${event.id}, ins_item.order_id, ins_item.id, a.name, NULLIF(a.email, ''), a.token
            FROM ins_item, UNNEST(${attendeeNames}::text[], ${attendeeEmails}::text[], ${ticketTokens}::text[]) AS a(name, email, token)
            RETURNING order_id, attendee_name, ticket_token
          `,
        ]);
  } catch (err) {
    // A DB/transaction failure (lock timeout, connection error, an
    // actual constraint violation) must fail safely — never leak SQL,
    // lock state, organisation ids, or capability internals to an
    // anonymous caller.
    console.error('[public register] transaction failed', err);
    return NextResponse.json(
      { error: 'Registration could not be completed. Please try again.' },
      { status: 500 },
    );
  }

  const insertResult = transactionResults[transactionResults.length - 1] as { order_id: string; attendee_name: string; ticket_token: string }[];
  if (!insertResult.length) {
    return NextResponse.json(
      { error: 'This ticket type is no longer available in the requested quantity.' },
      { status: 409 },
    );
  }

  const orderId = insertResult[0].order_id;
  // One ticket per attendee row actually inserted — the client builds
  // each link as /t/${ticket_token} (see app/t/[token]/page.tsx); no
  // absolute URL is constructed server-side here, avoiding a dependency
  // on knowing this deployment's own public origin.
  const tickets = insertResult.map(row => ({ attendee_name: row.attendee_name, ticket_token: row.ticket_token }));
  return NextResponse.json(
    { confirmation_reference: orderId, quantity: validated.quantity, tickets },
    { status: 201 },
  );
}
