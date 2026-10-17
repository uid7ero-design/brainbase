# 0006 — General-Admission Inventory Layer: ticket type × session (Phase 6)

Status: Accepted (Phase 6, shared ticketing core — BrainBase Events and
the future standalone Eve product). Records and hardens the model that
PR #432 (Phase 3) introduced and that every reservation path has used
since; adds the read-side twin, the cross-session read path and the
seating seam. No schema change in this phase.

## 1. Context — the limitation before Phase 3

Capacity was split between two independent, non-intersecting numbers:

- `event_ticket_types.capacity` — one figure per ticket type, counted
  **event-wide** (every session plus no-session orders);
- `event_sessions.capacity` — one figure per session, shared across
  **all** ticket types booked into it.

Nothing could express "Adult: 100 Friday, 60 Saturday; VIP: 20 Friday,
10 Saturday". A festival with day-specific allocations had to pick one
of two wrong approximations.

Read-only trace of the current core (`main` at `df8dc729`) confirms:

- `event_order_items` carries `ticket_type_id` **and** `event_session_id`
  per line (one session per order, every line shares it), so orders
  already carry everything session-scoped inventory needs — no order
  schema change was or is required.
- The only writer of capacity decisions is the post-lock `gate` CTE
  shared (as byte-identical SQL) by `freeRegistration.ts`,
  `paidCheckout.ts` and `retryCheckout.ts`. The public detail, the
  organiser session-inventory endpoint and the new read paths below
  use the same aggregate predicate for display only.

## 2. Model (unchanged from Phase 3, now the documented contract)

```
Event
  └── Session                      event_sessions.capacity  = shared hard cap
       └── Ticket Type Inventory   event_ticket_type_session_inventory
            - capacity            one OPTIONAL override row per (type, session)
```

Table `event_ticket_type_session_inventory` (migration
`scripts/create-events-ticket-type-session-inventory.sql`, Production
since 2026-10-15): `id`, `organisation_id`, `event_id`, `ticket_type_id`,
`event_session_id`, `capacity INTEGER NOT NULL CHECK (>= 0)`,
`created_at`, `updated_at`; UNIQUE `(ticket_type_id, event_session_id,
organisation_id)`; composite tenant/event FKs onto `events (id,
organisation_id)`, `event_ticket_types (id, event_id, organisation_id)`
and `event_sessions (id, event_id, organisation_id)` — so a pair row can
never join a type and a session from different events or organisations.
Clearing an override is a row DELETE; there is no nullable capacity and
no "unlimited" sentinel. Price stays a ticket-type concern; no
allocation/hold columns exist (see §9).

## 3. Backward-compatibility rule (chosen: fallback, not backfill)

- A `(type, session)` row exists → that row's capacity applies to that
  type **within that session**, and "sold" counts that type's tickets in
  **that session only**.
- No row → the type's **event-wide** capacity applies, counted
  event-wide, exactly as before Phase 3.
- `event_sessions.capacity` is **always** the shared upper bound on the
  combined quantity booked into the session.
- A no-session order is never affected by any override row.

Why fallback rather than backfilling a row per existing pair: a backfill
would have to invent a per-session number for every type (there is no
correct one — the event-wide figure is not a per-session figure), would
silently change the meaning of every existing event's sales count from
event-wide to per-session, and would make the override table mandatory.
With fallback, an event with no rows behaves byte-for-byte as it did
(proof section Z), no existing event can become unsaleable, and an
organiser opts a single pair in at a time.

`event_ticket_types.capacity` therefore remains the **fallback** (and the
organiser's "default capacity" for a type). It is not deprecated in this
phase; it is still the only capacity for no-session events and for any
pair without an override.

## 4. Effective-capacity rule (per cart)

For every line of a cart bound to session S:

```
effective_capacity(T, S) = pair(T, S).capacity           if a pair row exists
                         = event_ticket_types(T).capacity otherwise
sold(T, S)               = Σ live quantity of T in S        if a pair row exists
                         = Σ live quantity of T anywhere     otherwise
line admitted            ⇔ sold(T, S) + qty(T) <= effective_capacity(T, S)
cart admitted            ⇔ every line admitted
                           AND Σ live quantity in S + Σ qty <= event_sessions(S).capacity
```

"Live" = order not CANCELLED, and a PENDING paid reservation only while
`expires_at > NOW()` (stale holds are excluded by the same predicate in
every aggregate — gate, retry, public detail, organiser reads, quote).
Which statuses count is unchanged by this phase.

## 5. Lock order and deadlock analysis

`buildCartLockStatements` (lib/events/services/cart.ts) is the single
builder every flow uses. For a cart it emits, as separate FOR UPDATE
statements, in this total order:

1. every ticket type row, ascending `ticket_type_id` (JS code-unit order,
   never a collation);
2. (session-bound only) each line's `(type, session)` override row, same
   ascending order — a statement that matches nothing when no override
   exists is harmless;
3. (session-bound only) the session row;
4. (promotion only) the promotion-code row.

Each tier is strictly later than the previous and rows inside a tier are
ordered identically for every request, so the order is a total order
over all lockable rows and no two carts can wait on each other in a
cycle. Cases analysed: two overlapping multi-type carts in one session
(same relative order); a session-bound cart against a no-session cart on
the same types (the latter stops after tier 1); two carts in different
sessions on the same type (they serialise on the tier-1 type row even
when both pairs have overrides — a serialisation, never a deadlock; see
§10); two carts sharing a limited promotion code (both reach tier 4 last);
Retry reacquisition (identical builder, identical order); the organiser's
override upsert (a single-row UPDATE that waits for any in-flight gate on
that pair, never holds another tier); fee policy rows are **read** inside
the cart query and never locked. No lock is ever held across a Stripe
call — the reservation transaction commits before Stripe is contacted.
Proven on real PostgreSQL by proof section J, including a mutation proof
that locking in submitted-cart order deadlocks.

The capacity-gated INSERT/UPDATE is its **own** statement after the lock
statements (READ COMMITTED takes a fresh snapshot per statement), which
is the R1 correction every flow carries.

## 6. Free registration, paid checkout, retry

- **Free**: same gate, same lock builder; an order is CONFIRMED /
  NOT_REQUIRED immediately. All-or-nothing: a cart with one sold-out
  line, or one that breaches the session cap, inserts nothing (proof D,
  E). No second inventory implementation exists.
- **Paid**: same gate; the PENDING hold carries `expires_at = NOW() +
  RESERVATION_WINDOW_SECONDS`; compensating cancels and the
  expires_at-stamp CAS write-back are unchanged; fee and promotion
  snapshots are written in the same statement.
- **Retry**: reloads every line, resolves the pair for every line against
  the **current** override table, locks in the same order, and reacquires
  the whole order in one UPDATE that excludes the order's own quantity
  from every aggregate. Decision: Retry uses **current available
  capacity** (inventory is operational state — an organiser who lowers a
  pair after a hold lapsed must be able to stop it being re-held), while
  every money figure (unit prices, discounts, fee snapshot, payment total)
  stays the committed snapshot. The #431 microsecond `expires_at` stamp
  and the `stripe_checkout_session_id` guard are untouched (proof I).

## 7. Read side — single rule, three readers

- Public detail (`lib/events/publicEventDetail.ts`): event-wide
  `remaining` per type and per session, plus `session_inventory` rows for
  override pairs; the page resolves "pair if present, else event-wide"
  when a session is selected and re-clamps quantities on session change.
- Organiser per-session inventory (`GET .../sessions/[sessionId]/
  inventory`) and, from this phase, the whole-event matrix
  (`GET /api/events/[id]/inventory`, viewer+): every (type, session) cell
  with override, effective capacity, sold and remaining, plus session and
  type totals.
- Public quote (`POST .../quote`), from this phase: `assessCartAvailability`
  in cart.ts copies the gate's `cart_tt` / `sold_sess` CTEs verbatim
  (pinned by tests) and reports `availability { ok,
  unavailable_ticket_type_ids, session_full }`; a selection the gate would
  refuse is a `cart_error`, so a quote cannot price a cart checkout is
  about to reject except through a genuine concurrent race. The quote
  remains read-only and advisory; the gate remains the authority. The
  quote also now refuses a session that is not this event's.

## 8. Reporting

The registrations CSV already carries `session_name` and
`ticket_type_name` per line. The matrix endpoint is the smallest
type × session read path; no analytics redesign.

## 9. Seating seam (not built)

`event_ticket_type_session_inventory` is the **general-admission
inventory layer**: it already models "performance-specific inventory"
(one row per type per session) and can host GA zones later by treating
a zone as a ticket type (or a type attribute) with its own pair rows.
Holds/allocations (box office, promoter, waitlist) would be additive
columns or a sibling table keyed by the same pair, consumed by the same
gate predicate as "live sold". Reserved seating would live in a separate
per-seat inventory (seat rows with their own locks), referenced from
`event_order_items`, with the pair row acting as the GA fallback for
unreserved sections. Nothing in the current table has to change for any
of these; none of them is implemented.

## 10. Known deferrals

- Two carts in different sessions for the same ticket type serialise on
  the type's tier-1 lock even when both sessions have overrides. Safe
  (short lock, no deadlock) but not maximally concurrent; removing the
  tier-1 lock when an override exists would require the lock set to
  depend on a read inside the same non-interactive transaction.
- The public page quotes only while a promotion/access code is applied
  (rate-limited endpoint), so the read-side availability verdict reaches
  the page in that case; otherwise the page relies on the detail payload
  and the 409 refresh.
- No organiser UI for the matrix endpoint in this phase (the per-session
  Inventory disclosure remains the management surface).
