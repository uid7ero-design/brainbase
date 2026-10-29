-- Events & Ticketing — Eve launch compliance: PAID-PURCHASE LEGAL ACCEPTANCE
-- SNAPSHOT on event_orders.
-- Run once, manually, against the target database, AFTER the event_orders
-- migrations (it only adds three columns and one CHECK to event_orders and
-- references nothing else). NOT run automatically. NOT applied to Production
-- by the phase that adds it: the Production migration is a separate, explicitly
-- approved gate, and (as with every additive Events migration) is applied
-- BEFORE the application code that writes the columns is deployed.
--
-- ── What this adds, and why ─────────────────────────────────────────────
--
--   terms_accepted_at  TIMESTAMPTZ  when the buyer's acceptance was recorded
--   terms_version      TEXT         the Terms version they accepted
--   refunds_version    TEXT         the Refunds & cancellations version
--
-- Evidence that a PAID Eve purchase was made on identified legal text. Stamped
-- once, in the same INSERT as the order, only by the gated Eve paid-checkout
-- path after it has validated accept_terms === true server-side:
--   * the timestamp is the database's own NOW() — never supplied by a browser;
--   * both versions are trusted server constants — never supplied by a browser;
--   * nothing ever UPDATEs these columns afterwards (retry, the Stripe webhook
--     and refunds read the order but do not touch them);
--   * Stripe metadata is not an authority for acceptance.
-- Acceptance does not waive any consumer right; this is evidence of what was
-- shown, nothing more.
--
-- Historical orders, free orders and every BrainBase order carry NULL in all
-- three columns and keep working unchanged. There is NO backfill and NO index.
--
-- The CHECK requires the three columns to be NULL together or populated
-- together, so a half-stamped row is unrepresentable. It is added NOT VALID then
-- VALIDATEd: every existing row is all-NULL and so passes.
--
-- Idempotent and table-scoped: ADD COLUMN IF NOT EXISTS, and the constraint is
-- looked up on event_orders itself (a same-named constraint on another table or
-- schema cannot cause it to be skipped). Re-running changes nothing.
--
-- ── Rollback (manual; safe at any time — nothing reads the columns) ─────
--   ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_legal_acceptance_check;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS terms_accepted_at;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS terms_version;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS refunds_version;
-- Dropping them loses only the acceptance evidence. Roll the application back
-- first (older code does not write the columns, so it is unaffected either way).

ALTER TABLE event_orders
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS terms_version     TEXT        NULL,
  ADD COLUMN IF NOT EXISTS refunds_version   TEXT        NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_orders_legal_acceptance_check'
      AND conrelid = 'event_orders'::regclass
  ) THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_legal_acceptance_check
      CHECK (
        (terms_accepted_at IS NULL AND terms_version IS NULL AND refunds_version IS NULL)
        OR
        (terms_accepted_at IS NOT NULL AND terms_version IS NOT NULL AND refunds_version IS NOT NULL)
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE event_orders VALIDATE CONSTRAINT event_orders_legal_acceptance_check;
