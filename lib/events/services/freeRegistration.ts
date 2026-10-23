import sql from '@/lib/db';
import type { PublicEvent } from '@/lib/events/publicResolve';
import type { ValidatedRegistration } from '@/lib/events/publicValidation';
import { generateTicketToken, generateBookingToken } from '@/lib/events/ticketToken';
import { listActiveQuestions, validateSubmittedResponses, flattenOrderAnswers, flattenAttendeeAnswers, applySurfaceAnswerPolicy } from '@/lib/events/registrationQuestions';
import { attemptAutomaticTicketEmail } from '@/lib/events/ticketEmailDelivery';
import { loadCartTicketTypes, buildCartLockStatements } from '@/lib/events/services/cart';
import { resolveAccessCode, type AccessGrant } from '@/lib/events/services/accessCodes';
import { isProductSurface, type ProductSurface } from '@/lib/events/productSurface';

// Shared ticketing service — free (price 0) public registration.
//
// Phase 2: one registration may contain several free ticket types for
// the same event (a cart) — one event_order_items row per type, all
// reserved atomically in one capacity-gated statement. See
// lib/events/services/cart.ts for the shared cart rules and lock order.
//
// Extracted verbatim from
// app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts
// (Eve Phase 1, zero behaviour change). The route remains the HTTP
// adapter: rate limiting, body parsing/shape validation, slug -> event
// resolution, and translating this function's result into the exact
// same status codes and response bodies it has always returned. Every
// business rule, the capacity-gated transaction, and the automatic
// ticket-email attempt live here, unchanged, so a second product
// surface can reuse them without copying SQL.
//
// Tenant scoping: organisationId must already be resolved by the
// caller from a trusted source (the public slug resolver) — it is
// never read from a request body, exactly as before.

export type FreeRegistrationTicket = { attendee_name: string; ticket_token: string };

export type FreeRegistrationInput = {
  organisationId: string;
  event: PublicEvent;
  validated: ValidatedRegistration;
  // Phase 3.1 — product identity from the trusted server-side entry point
  // (BrainBase public route => 'BRAINBASE'; Eve S2S API after the gate =>
  // 'EVE'). Required, never browser-supplied; persisted in the same INSERT
  // as the order.
  productSurface: ProductSurface;
  // Post-commit, pre-ticket-email hook. Must never throw.
  onCommitted?: (orderId: string) => Promise<void>;
};

export type FreeRegistrationResult =
  | { ok: true; orderId: string; quantity: number; tickets: FreeRegistrationTicket[]; bookingToken: string }
  | { ok: false; code: 'RESPONSES_INVALID'; message: string }
  | {
      ok: false;
      code:
        | 'TICKET_TYPE_NOT_FOUND'
        | 'TICKET_TYPE_INACTIVE'
        | 'TICKET_TYPE_REQUIRES_PAYMENT'
        | 'MIXED_FREE_AND_PAID'
        // Phase 4 — sale windows, presale access, and "a promotion code
        // has nothing to discount on a free cart".
        | 'SALE_NOT_STARTED'
        | 'SALE_ENDED'
        | 'ACCESS_CODE_REQUIRED'
        | 'ACCESS_CODE_INVALID'
        | 'PROMOTION_NOT_APPLICABLE'
        | 'SESSION_NOT_FOUND'
        | 'TRANSACTION_FAILED'
        | 'CAPACITY_UNAVAILABLE';
    };

export async function registerFreeOrder(input: FreeRegistrationInput): Promise<FreeRegistrationResult> {
  const { organisationId, event, validated } = input;
  // Fail closed: the value goes into a CHECK-constrained column.
  if (!isProductSurface(input.productSurface)) throw new Error('registerFreeOrder requires a valid productSurface.');
  const productSurface = input.productSurface;

  // Phase 4 — presale access. Resolved server-side by (organisation,
  // event, normalised code); every failure (unknown / inactive / outside
  // its window / another event's or organisation's code) is the one
  // generic ACCESS_CODE_INVALID. The grant only unlocks eligibility for
  // requires_access_code ticket types — never extra capacity.
  let accessGrant: AccessGrant | null = null;
  if (validated.access_code) {
    const access = await resolveAccessCode(organisationId, event.id, validated.access_code);
    if (!access.ok) return { ok: false, code: 'ACCESS_CODE_INVALID' };
    accessGrant = access.grant;
  }

  // Ownership + business-rule checks, all re-derived server-side —
  // never trusted from the request. Every cart line's ticket type (and
  // the session, if selected) must belong to THIS resolved event and
  // organisation; every ticket type must be active; and every line's
  // price must be exactly zero — this route is the free-registration
  // path only (see this file's own header). A paid ticket type is
  // rejected outright rather than the route ever proceeding with (or
  // trusting) a non-zero price, and a cart mixing free and paid types is
  // rejected too (an order is all-free or all-paid — see
  // lib/events/services/cart.ts). The public UI never calls this route
  // for paid tickets — see lib/events/services/paidCheckout.ts for the
  // Stripe-backed paid path. This check remains as defense in depth
  // against a bypassed/direct API call.
  const cart = await loadCartTicketTypes(organisationId, event.id, validated.items, { accessGrant });
  if (!cart.ok) {
    // Currency is never compared for a free order (nothing is charged),
    // so loadCartTicketTypes cannot report CURRENCY_MISMATCH here; the
    // mapping below only exists to keep the result type exhaustive.
    return { ok: false, code: cart.code === 'CURRENCY_MISMATCH' ? 'TICKET_TYPE_REQUIRES_PAYMENT' : cart.code };
  }
  if (cart.pricing !== 'FREE') {
    return { ok: false, code: 'TICKET_TYPE_REQUIRES_PAYMENT' };
  }
  // Phase 4 — a promotion code reduces a price; a free cart has none, so
  // the code is "not applicable" rather than silently ignored (the
  // purchaser typed it expecting an effect). Free orders never carry a
  // promotion snapshot and never count as a redemption.
  if (validated.promotion_code) {
    return { ok: false, code: 'PROMOTION_NOT_APPLICABLE' };
  }
  const lineTypeIds = cart.lines.map(l => l.ticket_type_id);
  const lineQuantities = cart.lines.map(l => l.quantity);
  const accessCodeId = accessGrant?.id ?? null;
  const accessCodeSnapshot = accessGrant?.code ?? null;

  if (validated.event_session_id) {
    const sessionRows = await sql`
      SELECT id FROM event_sessions
      WHERE id = ${validated.event_session_id} AND organisation_id = ${organisationId} AND event_id = ${event.id}
      LIMIT 1
    `;
    if (!sessionRows.length) {
      return { ok: false, code: 'SESSION_NOT_FOUND' };
    }
  }

  // Phase 4B §5/§8 — server-side authoritative response validation,
  // against the event's own CURRENT active question list, BEFORE the
  // capacity-gated transaction runs. A rejected response (missing
  // required answer, unknown question_id, wrong shape) must never
  // reserve capacity or create an order — this check happens strictly
  // before any DB write.
  const activeQuestions = await listActiveQuestions(organisationId, event.id);
  const validatedResponses = validateSubmittedResponses(
    activeQuestions,
    validated.order_responses,
    validated.attendees.map(a => a.responses),
  );
  if (typeof validatedResponses === 'string') {
    return { ok: false, code: 'RESPONSES_INVALID', message: validatedResponses };
  }
  // Product-surface answer rules (ADR 0013 §4a: Eve's per-event opt-in and
  // sensitive-answer acknowledgement) — still strictly before any DB write.
  const answerPolicy = applySurfaceAnswerPolicy({
    productSurface,
    eveQuestionsEnabled: event.eve_questions_enabled,
    agreeSensitive: validated.agree_sensitive,
    confirmThirdParty: validated.confirm_third_party,
    submitted: { orderResponses: validated.order_responses, attendeeResponses: validated.attendees.map(a => a.responses) },
    validated: validatedResponses,
  });
  if (!answerPolicy.ok) return { ok: false, code: 'RESPONSES_INVALID', message: answerPolicy.error };
  // Recorded only on rows whose question is sensitive (see the INSERT).
  const acknowledgedAt = answerPolicy.acknowledgedAt;

  // Attendee names/emails are passed as parallel arrays and expanded
  // server-side via UNNEST — empty string (not SQL NULL) represents "no
  // attendee email", converted back to NULL via NULLIF in the SELECT, to
  // avoid depending on how the driver serialises a NULL element inside a
  // JS array parameter (empty-string round-tripping through ::text[] is
  // unambiguous; NULL-element array serialisation is a less certain
  // driver behaviour this code does not want to depend on).
  const attendeeNames = validated.attendees.map(a => a.name);
  const attendeeEmails = validated.attendees.map(a => a.email ?? '');
  // Which cart line each attendee belongs to — joined against the
  // inserted order items by ticket_type_id (unique within a cart).
  const attendeeTypeIds = validated.attendees.map(a => a.ticket_type_id);
  // One token per attendee, generated once here and passed through as
  // a third parallel array to the same UNNEST(...) the names/emails
  // already use below — never derived from (or influenced by) any
  // client-supplied value. These tokens are NOT "issued" yet in any
  // meaningful sense: they exist only as in-memory JS strings until
  // the same atomic statement below actually inserts the attendee rows
  // that carry them. If that statement's transaction rolls back (for
  // ANY reason, including a response-insert failure — see below), none
  // of these strings were ever written anywhere, so no token is ever
  // exposed to the caller or becomes look-up-able at /t/[token].
  const ticketTokens = validated.attendees.map(() => generateTicketToken());
  // One booking_token for the whole order (event_orders), generated the
  // same "not issued until the same atomic statement actually inserts
  // the row" way as ticketTokens above — this route always creates
  // status='CONFIRMED' with payment_status defaulting to
  // 'NOT_REQUIRED' (the free-registration path), and only ever writes
  // this value if the capacity-gated ins_order CTE below actually
  // inserts a row (which by construction also always inserts at least
  // one attendee token) — so generating it unconditionally here already
  // matches the "mint only when the order is genuinely eligible" rule
  // without any extra branching.
  const bookingToken = generateBookingToken();

  // Phase 4B correctness remediation — response persistence is folded
  // into the SAME atomic capacity-gated statement below, rather than a
  // separate write after the transaction commits. Flattened here (pure
  // array-building, no DB access) so the values are ready to interpolate
  // into the transaction's own SQL. Attendee-scoped answers are
  // correlated to their attendee by ticket_token — a value already
  // known here, before any row exists — NOT by the row's own generated
  // id (which doesn't exist until the INSERT runs) and NOT by RETURNING
  // row order (which Postgres does not guarantee matches SELECT input
  // order). See the transaction's own comment for the full reasoning.
  const orderResponseFlat = flattenOrderAnswers(validatedResponses.orderAnswers);
  const attendeeResponseFlat = flattenAttendeeAnswers(validatedResponses.attendeeAnswers, ticketTokens);

  // ── Concurrency-safe order creation (R1 remediation, multi-line) ─────
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
  // scripts/tests/verify-events-phase2-concurrency.sh and, for
  // multi-ticket-type carts, scripts/tests/verify-events-cart-concurrency.sh.
  //
  // Statement sequence (fixed, deterministic order):
  //   1. Lock every cart line's ticket type row (FOR UPDATE), one
  //      statement each, in ascending ticket_type_id order (see
  //      lib/events/services/cart.ts's cartLockOrder) — so two carts
  //      overlapping on any subset of ticket types always request their
  //      shared rows in the same relative order and cannot deadlock.
  //   2. (session-bound only) Lock each cart line's (ticket type,
  //      session) inventory override row (FOR UPDATE, same ascending
  //      ticket_type_id order; matches nothing when no override exists),
  //      then the session row (FOR UPDATE) — always AFTER every
  //      ticket-type lock, in every code path (Phase 3; see
  //      buildCartLockStatements).
  //   3. The actual capacity gate: ONE WITH-chain INSERT (order ->
  //      items -> attendees -> responses) whose embedded aggregates are
  //      evaluated as part of THIS statement — submitted after the lock
  //      statements, so it gets a fresh, post-lock snapshot. The `gate`
  //      CTE yields a row only when EVERY line fits its own ticket
  //      type's remaining capacity AND the combined cart quantity fits
  //      the session's remaining capacity; every insert downstream
  //      SELECTs FROM that gate (never an unconditional INSERT), so a
  //      cart that fails ANY check inserts nothing at all — no partial
  //      reservation, no orphan rows.
  //
  // sql.transaction() is "non-interactive": every statement in the
  // array is built and submitted up front, in one HTTP request, with no
  // opportunity for application code to branch on one statement's
  // result before constructing the next. That is why step 3 carries its
  // own embedded capacity check (a fixed, unconditional statement whose
  // OWN WHERE clause decides whether it inserts anything).
  //
  // Stale-reservation parity with the paid checkout flow — every "sold"
  // aggregate below excludes a PENDING paid reservation whose
  // expires_at has passed: `AND (payment_status <> 'PENDING' OR
  // expires_at > NOW())`, exactly mirroring
  // lib/events/services/paidCheckout.ts's own capacity-gated
  // transaction. A CONFIRMED free order (payment_status='NOT_REQUIRED')
  // and a currently-valid pending paid reservation both still count;
  // only a STALE pending reservation is excluded.
  let transactionResults: unknown[];
  try {
    transactionResults = await sql.transaction([
      ...buildCartLockStatements(organisationId, lineTypeIds, validated.event_session_id),
      sql`
        WITH cart AS (
          SELECT c.ticket_type_id, c.quantity
          FROM UNNEST(${lineTypeIds}::text[], ${lineQuantities}::int[]) AS c(ticket_type_id, quantity)
        ),
        cart_tt AS (
          -- Phase 3 (ticket type × session inventory): when this order's
          -- session has an override row for the line's ticket type, that
          -- row's capacity applies and "sold" counts only this type's
          -- tickets in THIS session; otherwise the event-wide ticket-type
          -- capacity applies, counted event-wide exactly as before. For a
          -- no-session order the LEFT JOIN never matches (NULL session),
          -- so behaviour is unchanged.
          --
          -- Phase 4 "purchasable": the ticket type must be active, inside
          -- its sale window at the database's NOW(), and — when it
          -- requires an access code — unlocked by THIS order's access
          -- code, re-resolved here against the live event_access_codes
          -- row (active, in window, same organisation AND event, and
          -- either assigned to this type or assigned to no specific type).
          -- Re-asserted inside this locked statement so a boundary crossed
          -- or a code disabled between the pre-check and the commit still
          -- refuses the whole cart; a type without restrictions is always
          -- purchasable, so pre-Phase-4 events behave exactly as before.
          SELECT c.ticket_type_id, c.quantity, COALESCE(inv.capacity, tt.capacity) AS capacity,
            (
              tt.active
              AND (tt.sale_starts_at IS NULL OR tt.sale_starts_at <= NOW())
              AND (tt.sale_ends_at IS NULL OR tt.sale_ends_at > NOW())
              AND (
                NOT tt.requires_access_code
                OR EXISTS (
                  SELECT 1 FROM event_access_codes ac
                  WHERE ac.id = ${accessCodeId} AND ac.organisation_id = ${organisationId} AND ac.event_id = ${event.id}
                    AND ac.active = true
                    AND (ac.starts_at IS NULL OR ac.starts_at <= NOW())
                    AND (ac.ends_at IS NULL OR ac.ends_at > NOW())
                    AND (
                      NOT EXISTS (SELECT 1 FROM event_access_code_ticket_types att WHERE att.access_code_id = ac.id AND att.organisation_id = ac.organisation_id)
                      OR EXISTS (SELECT 1 FROM event_access_code_ticket_types att WHERE att.access_code_id = ac.id AND att.organisation_id = ac.organisation_id AND att.ticket_type_id = tt.id)
                    )
                )
              )
            ) AS purchasable,
            (
              SELECT COALESCE(SUM(oi.quantity), 0)
              FROM event_order_items oi
              JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
              WHERE oi.ticket_type_id = c.ticket_type_id AND oi.organisation_id = ${organisationId}
                AND (inv.id IS NULL OR oi.event_session_id = ${validated.event_session_id})
                AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
            ) AS sold
          FROM cart c
          JOIN event_ticket_types tt ON tt.id = c.ticket_type_id AND tt.organisation_id = ${organisationId}
          LEFT JOIN event_ticket_type_session_inventory inv
            ON inv.ticket_type_id = c.ticket_type_id AND inv.event_session_id = ${validated.event_session_id} AND inv.organisation_id = ${organisationId}
        ),
        sold_sess AS (
          SELECT COALESCE(SUM(oi.quantity), 0) AS qty
          FROM event_order_items oi
          JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
          WHERE oi.event_session_id = ${validated.event_session_id} AND oi.organisation_id = ${organisationId} AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
        ),
        gate AS (
          -- No FOR UPDATE needed here: every ticket-type/session row is
          -- already locked by this transaction's own earlier statements,
          -- and those locks are held for the whole transaction — a plain
          -- read of their current capacity is already exclusive and fresh.
          SELECT 1 AS ok
          FROM sold_sess
          WHERE (SELECT count(*) FROM cart_tt) = ${lineTypeIds.length}
            AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE NOT cart_tt.purchasable)
            AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)
            AND (
              ${validated.event_session_id}::text IS NULL
              OR sold_sess.qty + ${validated.quantity} <= (SELECT capacity FROM event_sessions WHERE id = ${validated.event_session_id} AND organisation_id = ${organisationId})
            )
        ),
        ins_order AS (
          -- Phase 4: the access-code snapshot (id + code text as used) is
          -- written with the order; a free order never carries a
          -- promotion (discount_cents stays at its default 0).
          INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents, booking_token, ticket_email_status, access_code_id, access_code_snapshot, product_surface)
          SELECT ${organisationId}, ${event.id}, ${validated.purchaser_name}, ${validated.purchaser_email}, ${validated.purchaser_phone}, 'CONFIRMED', 0, ${bookingToken}, 'pending', ${accessCodeId}, ${accessCodeSnapshot}, ${productSurface}
          FROM gate
          RETURNING id
        ),
        ins_items AS (
          -- One event_order_items row per cart line, all sharing the
          -- order's single session (one session per order).
          INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
          SELECT ${organisationId}, ins_order.id, ${event.id}, cart.ticket_type_id, ${validated.event_session_id}, cart.quantity, 0
          FROM ins_order, cart
          RETURNING id, order_id, ticket_type_id
        ),
        ins_attendees AS (
          -- Each attendee is attached to the order item for its own
          -- ticket type (ticket_type_id is unique within a cart).
          INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email, ticket_token)
          SELECT ${organisationId}, ${event.id}, ii.order_id, ii.id, a.name, NULLIF(a.email, ''), a.token
          FROM ins_items ii
          JOIN UNNEST(${attendeeTypeIds}::text[], ${attendeeNames}::text[], ${attendeeEmails}::text[], ${ticketTokens}::text[])
            AS a(ticket_type_id, name, email, token)
            ON a.ticket_type_id = ii.ticket_type_id
          RETURNING id, order_id, attendee_name, ticket_token
        ),
        -- Phase 4B correctness remediation — response persistence is
        -- folded into THIS SAME statement rather than a separate
        -- post-transaction write. Both CTEs below are driven FROM
        -- ins_order / ins_attendees, so if the capacity gate above
        -- rejected the reservation, these also naturally produce zero
        -- rows. If either INSERT below hits a genuine error (e.g. an FK
        -- violation on question_id), Postgres aborts the WHOLE
        -- statement — everything "inserted" earlier in this same
        -- statement is rolled back too. Attendee-scoped answers are
        -- correlated by ticket_token (known before any row exists),
        -- never by the attendee row's own generated id or by RETURNING
        -- row order.
        ins_order_responses AS (
          INSERT INTO event_registration_responses
            (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot,
             question_help_text_snapshot, data_category_snapshot, buyer_acknowledged_at, answer)
          SELECT ${organisationId}, ${event.id}, r.question_id, io.id, NULL, r.label, r.field_type,
            NULLIF(r.help_text, ''), r.category,
            CASE WHEN r.category IN ('SENSITIVE', 'THIRD_PARTY') THEN ${acknowledgedAt}::timestamptz END, r.answer_json::jsonb
          FROM ins_order io, UNNEST(${orderResponseFlat.questionIds}::text[], ${orderResponseFlat.labels}::text[], ${orderResponseFlat.fieldTypes}::text[], ${orderResponseFlat.helpTexts}::text[], ${orderResponseFlat.categories}::text[], ${orderResponseFlat.answersJson}::text[])
            AS r(question_id, label, field_type, help_text, category, answer_json)
          RETURNING id
        ),
        ins_attendee_responses AS (
          INSERT INTO event_registration_responses
            (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot,
             question_help_text_snapshot, data_category_snapshot, buyer_acknowledged_at, answer)
          SELECT ${organisationId}, ${event.id}, r.question_id, ia.order_id, ia.id, r.label, r.field_type,
            NULLIF(r.help_text, ''), r.category,
            CASE WHEN r.category IN ('SENSITIVE', 'THIRD_PARTY') THEN ${acknowledgedAt}::timestamptz END, r.answer_json::jsonb
          FROM ins_attendees ia
          JOIN UNNEST(${attendeeResponseFlat.correlationKeys}::text[], ${attendeeResponseFlat.questionIds}::text[], ${attendeeResponseFlat.labels}::text[], ${attendeeResponseFlat.fieldTypes}::text[], ${attendeeResponseFlat.helpTexts}::text[], ${attendeeResponseFlat.categories}::text[], ${attendeeResponseFlat.answersJson}::text[])
            AS r(ticket_token, question_id, label, field_type, help_text, category, answer_json)
            ON r.ticket_token = ia.ticket_token
          RETURNING id
        )
        -- Returned in the purchaser's own attendee order (by token
        -- position), never in whatever order RETURNING happened to emit.
        SELECT ia.id, ia.order_id, ia.attendee_name, ia.ticket_token
        FROM ins_attendees ia
        JOIN UNNEST(${ticketTokens}::text[]) WITH ORDINALITY AS t(token, ord) ON t.token = ia.ticket_token
        WHERE (SELECT count(*) FROM ins_order_responses) >= 0
          AND (SELECT count(*) FROM ins_attendee_responses) >= 0
        ORDER BY t.ord
      `,
    ]);
  } catch (err) {
    // A DB/transaction failure (lock timeout, connection error, an
    // actual constraint violation) must fail safely — never leak SQL,
    // lock state, organisation ids, or capability internals to an
    // anonymous caller.
    console.error('[public register] transaction failed', err);
    return { ok: false, code: 'TRANSACTION_FAILED' };
  }

  const insertResult = transactionResults[transactionResults.length - 1] as { id: string; order_id: string; attendee_name: string; ticket_token: string }[];
  if (!insertResult.length) {
    return { ok: false, code: 'CAPACITY_UNAVAILABLE' };
  }

  const orderId = insertResult[0].order_id;
  // Responses were already written INSIDE the transaction above (see
  // its own comment) — by the time this code runs, the transaction has
  // either fully committed (order + items + attendees + responses all
  // together) or the whole thing was rolled back and the catch block
  // above already returned a 500. There is no remaining window where a
  // registration succeeds with responses silently missing.

  // Caller-supplied post-commit side effects (BrainBase: Events -> CRM
  // sync) run here — strictly AFTER the booking transaction above has
  // committed and strictly BEFORE the automatic ticket-email attempt
  // below, the exact position they have always occupied. The hook is
  // owned by the caller so this shared ticketing service carries no
  // dependency on any one product's CRM; see the register route for the
  // BrainBase hook and its own rationale comment.
  if (input.onCommitted) await input.onCommitted(orderId);

  // Phase 3E.2 — automatic initial ticket-email delivery, strictly
  // AFTER the booking transaction above has already committed (this
  // order's ticket_email_status was written as 'pending' by that same
  // INSERT — see its own comment) and after the CRM side effects above,
  // never inside the capacity-gated transaction itself: no provider
  // call may ever occur before commit. attemptAutomaticTicketEmail()
  // internally claims this exact order, re-checks full current
  // eligibility, sends via the existing branded template, and records
  // the outcome — it never throws (see its own try/catch), so this
  // call is AWAITED (a fire-and-forget/unawaited promise would very
  // likely be killed mid-flight by the serverless runtime once this
  // function returns its response, leaving the claim stuck in
  // 'sending' with no completion write) and wrapped in its own try/
  // catch purely as defense in depth. Registration success is
  // unconditional either way: the 201 response below is built and
  // returned regardless of the outcome, and nothing here can roll back
  // or otherwise affect the order/tickets/booking_token already
  // committed above.
  try {
    await attemptAutomaticTicketEmail(orderId);
  } catch (err) {
    console.error('[public register] automatic ticket-email attempt failed unexpectedly', err, { orderId });
  }

  // One ticket per attendee row actually inserted — the client builds
  // each link as /t/${ticket_token} (see app/t/[token]/page.tsx); no
  // absolute URL is constructed server-side here, avoiding a dependency
  // on knowing this deployment's own public origin.
  const tickets = insertResult.map(row => ({ attendee_name: row.attendee_name, ticket_token: row.ticket_token }));
  return { ok: true, orderId, quantity: validated.quantity, tickets, bookingToken };
}
