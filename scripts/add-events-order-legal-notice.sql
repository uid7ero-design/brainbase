-- Events & Ticketing — Eve launch compliance: FREE-REGISTRATION LEGAL NOTICE
-- VERSION on event_orders.
-- Run once, manually, against the target database, AFTER
-- add-events-order-product-surface.sql and add-events-order-legal-acceptance.sql
-- (the CHECK below references product_surface and terms_accepted_at). NOT run
-- automatically. Applied to Production BEFORE the application code that writes
-- the column is deployed (the free-order INSERT names it).
--
-- ── What this adds, and why ─────────────────────────────────────────────
--
--   legal_notice_version  TEXT NULL
--
-- An Eve free registration has no checkbox. It shows a linked notice instead
-- ("By registering you agree to the Terms and acknowledge the Privacy
-- Policy."). This column records which Eve legal-document version (the one
-- version that covers Terms and Privacy) was in force for that notice flow
-- when the order was created. The time is the order's own created_at (same
-- INSERT, database clock), so there is no separate timestamp column.
--
-- It is NOT explicit acceptance (that is the paid-only terms_accepted_at /
-- terms_version / refunds_version snapshot), and it does NOT mean the buyer
-- read the notice. Refunds is not part of the free notice and is not recorded.
--
--   * stamped once, in the order INSERT, only by the gated Eve free
--     registration path, from a trusted server constant — never a browser
--     value;
--   * NULL when the version is a draft on Production (the registration still
--     succeeds);
--   * nothing ever UPDATEs it afterwards.
--
-- Historical orders, BrainBase orders and paid orders carry NULL. There is NO
-- backfill and NO index (nothing filters on it).
--
-- The CHECK makes the meaning structural: a notice version may only sit on an
-- EVE order with a zero total that carries no explicit paid acceptance. It is
-- added NOT VALID then VALIDATEd: every existing row is NULL and so passes.
--
-- One transaction with a short lock timeout: ADD COLUMN (nullable, no
-- default) and ADD CONSTRAINT ... NOT VALID are metadata-only; VALIDATE scans
-- event_orders under a SHARE UPDATE EXCLUSIVE lock, which does not block
-- reads or writes. If the lock is not obtained within 5s the whole script
-- rolls back and can simply be re-run.
--
-- Idempotent and table-scoped: ADD COLUMN IF NOT EXISTS, and the constraint is
-- looked up on event_orders itself. Re-running changes nothing.
--
-- ── Rollback (manual; safe while no deployed code writes the column) ─────
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_legal_notice_check;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS legal_notice_version;
--   COMMIT;
-- Roll the application back FIRST if code that names the column is deployed
-- (its free-order INSERT would fail without the column). Dropping it loses
-- only the notice-version evidence.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE event_orders
  ADD COLUMN IF NOT EXISTS legal_notice_version TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_orders_legal_notice_check'
      AND conrelid = 'event_orders'::regclass
  ) THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_legal_notice_check
      CHECK (
        legal_notice_version IS NULL
        OR (terms_accepted_at IS NULL AND product_surface = 'EVE' AND total_cents = 0)
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE event_orders VALIDATE CONSTRAINT event_orders_legal_notice_check;

COMMIT;
