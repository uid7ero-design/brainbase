-- Events & Ticketing — Eve Phase 3.1: ORDER PRODUCT IDENTITY.
-- Run once, manually, against the target database, AFTER
-- scripts/create-events.sql, scripts/create-events-phase2.sql and the
-- other event_orders migrations (it only adds one column and one CHECK to
-- event_orders and references nothing else). NOT run automatically — same
-- manual-authorization discipline as every schema script in this
-- repository. NOT executed against Production by this phase; the Production
-- migration remains separately gated, and (as with every additive Events
-- migration) is applied BEFORE the application code that writes the column
-- is deployed.
--
-- ── What this adds, and why ─────────────────────────────────────────────
--
-- event_orders.product_surface — which product surface the buyer used to
-- create the order:
--
--   'BRAINBASE'  BrainBase's own public routes (/api/public/events/*)
--   'EVE'        the Eve server-to-server API (/api/ticketing/public/*)
--
-- It lives on the ORDER, not the event or organisation: the same published
-- event page is reachable on both products, so only the order records which
-- one the buyer actually used. It is stamped once, in the same INSERT as the
-- order (lib/events/services/paidCheckout.ts and freeRegistration.ts), from
-- the trusted server-side entry point — never from a request body, query
-- string or header — and nothing ever UPDATEs it afterwards (Retry, the
-- Stripe webhook and its replays, refunds and email recovery all READ it).
-- See docs/architecture/decisions/0008-order-product-identity.md.
--
-- Historical orders: NOT NULL DEFAULT 'BRAINBASE'. On PostgreSQL 11+ a
-- constant default is a catalog-only change (no table rewrite), and every
-- existing row reads 'BRAINBASE' immediately — which is exactly what they
-- are. There is NO backfill statement and no row is updated. Old application
-- code that does not name the column keeps working (the default applies).
--
-- Vocabulary is a TEXT column with a CHECK, not a Postgres enum, matching
-- every other status/mode column in this schema (a value is added later by
-- replacing the CHECK, with no ALTER TYPE).
--
-- The CHECK is added NOT VALID then VALIDATEd: the brief ACCESS EXCLUSIVE
-- lock is only the metadata change, and the validation scan runs under a
-- weaker lock that does not block reads or writes.
--
-- No index: nothing filters orders by product in this phase. Add one with
-- the first query that needs it.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the constraint is added only
-- when absent. Re-running changes nothing.
--
-- ── Rollback (manual; safe at any time — nothing references the column) ──
--   ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_product_surface_check;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS product_surface;
-- Dropping it loses only the product stamp: after a rollback every order is
-- treated as a BrainBase order. Roll back the application first (older code
-- does not write the column, so it is unaffected either way).

ALTER TABLE event_orders
  ADD COLUMN IF NOT EXISTS product_surface TEXT NOT NULL DEFAULT 'BRAINBASE';

DO $$
BEGIN
  -- Scoped to event_orders itself: a same-named constraint on any other
  -- table or schema must not cause this one to be skipped.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_orders_product_surface_check'
      AND conrelid = 'event_orders'::regclass
  ) THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_product_surface_check
      CHECK (product_surface IN ('BRAINBASE', 'EVE')) NOT VALID;
  END IF;
END $$;

ALTER TABLE event_orders VALIDATE CONSTRAINT event_orders_product_surface_check;
