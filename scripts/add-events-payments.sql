-- Events & Ticketing — Phase 4 paid ticketing + Stripe Checkout. Run
-- once, manually, against the target database, AFTER
-- scripts/create-events.sql, scripts/create-events-phase2.sql, and
-- scripts/add-events-ticketing.sql (this script's ALTER TABLEs require
-- event_ticket_types and event_orders to already exist). NOT run
-- automatically by this task — same manual-authorization discipline as
-- every schema script in this repository.
--
-- Purpose: the smallest schema addition that lets a ticket type carry a
-- non-zero price and an order carry Stripe-backed payment state,
-- without over-modeling a generic finance subsystem.
--
-- Why no new tables: EventOrder and EventOrderItem already exist and
-- already carry total_cents/unit_price_cents (added in Phase 1/2
-- specifically anticipating this phase — see create-events-phase2.sql's
-- own comment on those columns). Payment status is a property of an
-- existing order, not a new domain concept requiring its own table.
--
-- ── event_ticket_types.currency ──────────────────────────────────────
-- price_cents already exists (Phase 1). currency is added alongside it
-- so a ticket type's price is fully self-describing without a global,
-- implicit single-currency assumption baked into application code.
-- Defaults 'AUD' — this system has exactly one currency in practice
-- (see Contract.currency's identical default elsewhere in this schema)
-- and this migration does not add any currency-selection UI; the
-- column exists for data correctness (Stripe Checkout needs an
-- explicit currency per line item), not to introduce multi-currency
-- support.
--
-- ── event_orders payment columns ─────────────────────────────────────
--
-- payment_status: TEXT + CHECK, matching status's own existing
-- vocabulary-constraint convention (see create-events-phase2.sql).
-- Deliberately separate from the existing `status` column (order
-- lifecycle: PENDING/CONFIRMED/CANCELLED) rather than folding payment
-- state into it — a free order and a paid order can both reach
-- `status = 'CONFIRMED'`, but only a paid order has a meaningful
-- payment_status other than NOT_REQUIRED. This mirrors the brief's own
-- "keep this simple" conceptual separation between order lifecycle and
-- payment state.
--   NOT_REQUIRED — free order (Phase 2 path, and any Phase 4 order for
--                  a price_cents = 0 ticket type). Default for every
--                  existing row.
--   PENDING      — paid order awaiting Stripe Checkout completion.
--   PAID         — checkout.session.completed confirmed by webhook.
--   FAILED       — payment_intent.payment_failed (best-effort; see
--                  lib/events/stripe.ts's webhook handler comment).
--   EXPIRED      — checkout.session.expired.
--   REFUNDED     — manager-initiated full refund confirmed by Stripe.
-- No PARTIALLY_REFUNDED: Phase 4 supports full refund only (see the
-- brief's own §22 preference), so a partial-refund state would be
-- unreachable dead vocabulary.
--
-- payment_provider: nullable TEXT, 'stripe' for every Phase 4 paid
-- order. Exists so a NOT_REQUIRED (free) order's provider is
-- meaningfully NULL rather than an empty string, and so a second
-- provider could be added later without a schema change — not because
-- Phase 4 itself introduces one (it explicitly does not).
--
-- stripe_checkout_session_id / stripe_payment_intent_id: Stripe's own
-- object ids, opaque strings, never secrets. stripe_checkout_session_id
-- carries a partial UNIQUE index (WHERE NOT NULL) — it is both this
-- system's idempotency key for webhook processing (see
-- lib/events/stripe.ts) and the only trusted lookup key a webhook event
-- uses to find its order; never derived from client input.
--
-- currency: same rationale as event_ticket_types.currency above,
-- recorded on the order at reservation time (copied from the ticket
-- type actually purchased) so total_cents is never ambiguous even if a
-- ticket type's own currency were edited later.
--
-- expires_at: NULL for every free/NOT_REQUIRED order and for any PAID/
-- REFUNDED order. Set only while payment_status = 'PENDING', to the
-- same moment Stripe's own Checkout Session `expires_at` is configured
-- for (see lib/events/stripe.ts) — the reservation-hold mechanism the
-- brief's §8/§17 describe. A pending order's reserved quantity stops
-- counting against capacity once `expires_at` has passed, enforced
-- directly in the capacity aggregate query (see the paid reservation
-- route's own comment) — a purely time-based release that does not
-- depend on the expiry webhook ever arriving, so a delayed or missed
-- `checkout.session.expired` event can never permanently strand
-- capacity.
--
-- paid_at / refunded_at: set exactly once each, by the atomic
-- conditional UPDATE that performs the corresponding state transition
-- (see lib/events/stripe.ts and the refund route) — never touched by
-- application code outside those two guarded writes.
--
-- Nullable throughout (no NOT NULL besides payment_status/currency,
-- which both carry safe defaults): every existing Phase 1-3 order row
-- becomes payment_status='NOT_REQUIRED', currency='AUD', and every
-- other new column NULL, with zero backfill required — this migration
-- changes no existing row's behaviour anywhere it is read (every
-- capacity/validity predicate this migration touches explicitly
-- excludes NOT_REQUIRED from any new gating condition; see
-- lib/events/checkIn.ts's and lib/events/publicTicket.ts's Phase 4
-- updates).
--
-- Idempotency: IF NOT EXISTS / idempotent guards throughout. Safe to
-- re-run.
--
-- ROLLBACK: none of these columns carry an inbound reference from any
-- other table — safe to drop at any time:
--
--   DROP INDEX IF EXISTS idx_event_orders_stripe_checkout_session_id;
--   DROP INDEX IF EXISTS idx_event_orders_payment_status;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS payment_status;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS payment_provider;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS stripe_checkout_session_id;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS stripe_payment_intent_id;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS currency;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS expires_at;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS paid_at;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS refunded_at;
--   ALTER TABLE event_ticket_types DROP COLUMN IF EXISTS currency;
--
-- (Not executed by this script — recorded here for the record only.)

ALTER TABLE event_ticket_types ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'AUD';

ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS payment_provider TEXT;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'AUD';
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

-- Constraint added separately (not inline) so the ALTER TABLE ADD
-- COLUMN above stays a single fast metadata-only change even on a
-- populated table (Postgres 11+ can add a column with a constant
-- DEFAULT without rewriting existing rows; validating a CHECK constraint
-- added at the same time as the column would not carry that guarantee
-- on some Postgres versions). NOT VALID would be the standard technique
-- for a large pre-populated table; omitted here since this constraint
-- can only ever be violated by a value written by NEW application code
-- (the default itself always satisfies it), so immediate validation
-- against the current, already-conformant data is cheap and safe.
ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_payment_status_check;
ALTER TABLE event_orders ADD CONSTRAINT event_orders_payment_status_check
  CHECK (payment_status IN ('NOT_REQUIRED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_orders_stripe_checkout_session_id
  ON event_orders(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_orders_payment_status
  ON event_orders(payment_status);
