-- Events & Ticketing — Phase 5A: commercial fee + GST/invoice FOUNDATION.
-- Run once, manually, against the target database, AFTER
-- scripts/create-events.sql, scripts/create-events-phase2.sql,
-- scripts/add-events-payments.sql, scripts/add-events-payment-connect.sql
-- and scripts/create-events-promotions-presales-sale-windows.sql (the
-- order snapshot columns below sit beside Phase 4's discount snapshot and
-- the fee-coherence CHECK references total_cents). NOT run automatically —
-- same manual-authorization discipline as every schema script in this
-- repository. NOT executed against Production by this phase; the
-- Production migration remains separately gated.
--
-- ── What this adds, and why ─────────────────────────────────────────────
--
-- 1. ticketing_fee_policies — a NEUTRAL platform/booking-fee configuration,
--    one row per scope: organisation-level (event_id IS NULL) or event-level
--    (event_id set). Resolution order in lib/events/services/fees.ts is
--    event row > organisation row > PLATFORM DEFAULT, and the platform
--    default is a code constant that resolves to NO FEE. No row anywhere
--    (the state of every BrainBase organisation after this migration)
--    therefore means every checkout behaves exactly as today: no fee line,
--    no application_fee_amount, payment total = ticket total. There is no
--    environment variable or global switch that can enable a fee; only an
--    explicit row for a specific organisation or event can.
--
--    Components (all optional, all integer, combined additively):
--      percent_bps            basis points (1/100 of a percent) of the NET
--                             ticket subtotal (after discounts); 0..10000
--      fixed_per_order_cents  once per order
--      fixed_per_ticket_cents once per ticket (Σ quantity)
--      min_fee_cents / max_fee_cents  optional clamp applied after the sum
--    fee_mode:
--      PASS_THROUGH  the customer pays ticket net + fee; the fee is one extra
--                    Stripe line item (label) and is also the connected
--                    account charge's application_fee_amount
--      ABSORB        the customer pays ticket net only; the fee is deducted
--                    from the organiser's proceeds via application_fee_amount
--    currency must equal the cart's currency (fail closed otherwise).
--    label is the customer-facing line name ('Booking fee' by default — no
--    product branding). tax_treatment is a METADATA SEAM ONLY
--    ('UNSPECIFIED' | 'GST_INCLUSIVE' | 'GST_EXCLUSIVE' | 'GST_FREE'):
--    nothing computes tax from it in this phase (see
--    docs/architecture/decisions/0004-ticketing-fees-and-gst-foundation.md
--    for the accounting decisions still required). version increments on
--    every policy change (application code: SET version = version + 1) and
--    is snapshotted onto orders so a historical order names the exact
--    policy revision it was priced under.
--
-- 2. event_orders gains the IMMUTABLE FEE SNAPSHOT. total_cents keeps its
--    exact current meaning — the NET TICKET amount (gross − discount; what
--    the organiser's tickets sold for) — and is never overloaded. New:
--      platform_fee_cents   the calculated fee (0 when no policy applied)
--      fee_mode             NULL when no fee policy was applied, else the mode
--      payment_total_cents  what the CUSTOMER pays Stripe. NULL only on rows
--                           that pre-date this migration (their payment total
--                           is total_cents by construction; readers use
--                           COALESCE(payment_total_cents, total_cents)).
--                           Every order created after this migration writes
--                           it, fee or not.
--      fee_policy_id / fee_policy_version   which policy revision applied
--      fee_percent_bps, fee_fixed_per_order_cents, fee_fixed_per_ticket_cents,
--      fee_min_cents, fee_max_cents, fee_tax_treatment, fee_label   the policy
--                           INPUTS and customer-facing label as applied, so
--                           the fee (and Retry's Stripe line item) can be
--                           reconstructed without the (mutable) policy row
--      refunded_cents / platform_fee_refunded_cents   set at refund time:
--                           what Stripe returned to the customer and how much
--                           of the platform fee was reversed
--    Gross is still DERIVED (total_cents + discount_cents) exactly as Phase 4
--    established, so no existing row needs a backfill.
--
--    event_orders_fee_snapshot_check enforces the arithmetic by mode:
--      no fee:        fee_mode IS NULL, platform_fee_cents = 0, no policy id,
--                     payment_total_cents IS NULL (historical) or = total_cents
--      PASS_THROUGH:  payment_total_cents = total_cents + platform_fee_cents
--      ABSORB:        payment_total_cents = total_cents AND
--                     platform_fee_cents <= total_cents
--    so a row whose Stripe charge could not reconcile with its own snapshot
--    is unrepresentable.
--
-- Retry rebuilds the Stripe Checkout Session from THIS snapshot only (never
-- the current policy); refunds reverse the application fee recorded here
-- (never the current policy). Changing or disabling a policy afterwards
-- never touches an order.
--
-- ADDITIVE ONLY. Every new column has a default (0 / NULL) that satisfies
-- every new CHECK, so every existing event_orders row is valid as-is and
-- byte-for-byte unchanged in every pre-existing column. No UPDATE, no
-- backfill, no reinterpretation of total_cents, discount_cents or
-- unit_price_cents.
--
-- ── Rollback (manual; dependents first) ────────────────────────────────
--   ALTER TABLE event_orders
--     DROP CONSTRAINT IF EXISTS event_orders_fee_policy_fkey,
--     DROP CONSTRAINT IF EXISTS event_orders_fee_snapshot_check,
--     DROP CONSTRAINT IF EXISTS event_orders_fee_mode_check,
--     DROP CONSTRAINT IF EXISTS event_orders_platform_fee_cents_check,
--     DROP CONSTRAINT IF EXISTS event_orders_payment_total_cents_check,
--     DROP CONSTRAINT IF EXISTS event_orders_refunded_cents_check,
--     DROP CONSTRAINT IF EXISTS event_orders_fee_tax_treatment_check;
--   DROP INDEX IF EXISTS idx_event_orders_fee_policy_id;
--   ALTER TABLE event_orders
--     DROP COLUMN IF EXISTS platform_fee_cents, DROP COLUMN IF EXISTS fee_mode,
--     DROP COLUMN IF EXISTS payment_total_cents, DROP COLUMN IF EXISTS fee_policy_id,
--     DROP COLUMN IF EXISTS fee_policy_version, DROP COLUMN IF EXISTS fee_percent_bps,
--     DROP COLUMN IF EXISTS fee_fixed_per_order_cents, DROP COLUMN IF EXISTS fee_fixed_per_ticket_cents,
--     DROP COLUMN IF EXISTS fee_min_cents, DROP COLUMN IF EXISTS fee_max_cents,
--     DROP COLUMN IF EXISTS fee_tax_treatment, DROP COLUMN IF EXISTS fee_label,
--     DROP COLUMN IF EXISTS refunded_cents, DROP COLUMN IF EXISTS platform_fee_refunded_cents;
--   DROP TABLE IF EXISTS ticketing_fee_policies;

CREATE TABLE IF NOT EXISTS ticketing_fee_policies (
  id                     TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id        TEXT        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  event_id               TEXT,
  enabled                BOOLEAN     NOT NULL DEFAULT false,
  fee_mode               TEXT        NOT NULL,
  percent_bps            INTEGER     NOT NULL DEFAULT 0,
  fixed_per_order_cents  INTEGER     NOT NULL DEFAULT 0,
  fixed_per_ticket_cents INTEGER     NOT NULL DEFAULT 0,
  min_fee_cents          INTEGER,
  max_fee_cents          INTEGER,
  currency               TEXT        NOT NULL DEFAULT 'AUD',
  label                  TEXT        NOT NULL DEFAULT 'Booking fee',
  tax_treatment          TEXT        NOT NULL DEFAULT 'UNSPECIFIED',
  version                INTEGER     NOT NULL DEFAULT 1,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ticketing_fee_policies_fee_mode_check
    CHECK (fee_mode IN ('PASS_THROUGH', 'ABSORB')),
  CONSTRAINT ticketing_fee_policies_percent_bps_check
    CHECK (percent_bps BETWEEN 0 AND 10000),
  CONSTRAINT ticketing_fee_policies_fixed_per_order_check
    CHECK (fixed_per_order_cents >= 0),
  CONSTRAINT ticketing_fee_policies_fixed_per_ticket_check
    CHECK (fixed_per_ticket_cents >= 0),
  CONSTRAINT ticketing_fee_policies_min_fee_check
    CHECK (min_fee_cents IS NULL OR min_fee_cents >= 0),
  CONSTRAINT ticketing_fee_policies_max_fee_check
    CHECK (max_fee_cents IS NULL OR max_fee_cents >= 0),
  CONSTRAINT ticketing_fee_policies_min_max_check
    CHECK (min_fee_cents IS NULL OR max_fee_cents IS NULL OR max_fee_cents >= min_fee_cents),
  CONSTRAINT ticketing_fee_policies_label_check
    CHECK (btrim(label) <> '' AND length(label) <= 60),
  CONSTRAINT ticketing_fee_policies_tax_treatment_check
    CHECK (tax_treatment IN ('UNSPECIFIED', 'GST_INCLUSIVE', 'GST_EXCLUSIVE', 'GST_FREE')),
  CONSTRAINT ticketing_fee_policies_version_check
    CHECK (version >= 1),
  CONSTRAINT ticketing_fee_policies_id_org_key UNIQUE (id, organisation_id),
  CONSTRAINT ticketing_fee_policies_event_org_fkey FOREIGN KEY (event_id, organisation_id)
    REFERENCES events (id, organisation_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticketing_fee_policies_org_default
  ON ticketing_fee_policies(organisation_id) WHERE event_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticketing_fee_policies_org_event
  ON ticketing_fee_policies(organisation_id, event_id) WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ticketing_fee_policies_organisation_id ON ticketing_fee_policies(organisation_id);

CREATE INDEX IF NOT EXISTS idx_ticketing_fee_policies_event_id ON ticketing_fee_policies(event_id);

ALTER TABLE event_orders
  ADD COLUMN IF NOT EXISTS platform_fee_cents          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_mode                    TEXT,
  ADD COLUMN IF NOT EXISTS payment_total_cents         INTEGER,
  ADD COLUMN IF NOT EXISTS fee_policy_id               TEXT,
  ADD COLUMN IF NOT EXISTS fee_policy_version          INTEGER,
  ADD COLUMN IF NOT EXISTS fee_percent_bps             INTEGER,
  ADD COLUMN IF NOT EXISTS fee_fixed_per_order_cents   INTEGER,
  ADD COLUMN IF NOT EXISTS fee_fixed_per_ticket_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS fee_min_cents               INTEGER,
  ADD COLUMN IF NOT EXISTS fee_max_cents               INTEGER,
  ADD COLUMN IF NOT EXISTS fee_tax_treatment           TEXT,
  ADD COLUMN IF NOT EXISTS fee_label                   TEXT,
  ADD COLUMN IF NOT EXISTS refunded_cents              INTEGER,
  ADD COLUMN IF NOT EXISTS platform_fee_refunded_cents INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_platform_fee_cents_check') THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_platform_fee_cents_check CHECK (platform_fee_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_fee_mode_check') THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_fee_mode_check CHECK (fee_mode IS NULL OR fee_mode IN ('PASS_THROUGH', 'ABSORB'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_payment_total_cents_check') THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_payment_total_cents_check CHECK (payment_total_cents IS NULL OR payment_total_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_fee_tax_treatment_check') THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_fee_tax_treatment_check
      CHECK (fee_tax_treatment IS NULL OR fee_tax_treatment IN ('UNSPECIFIED', 'GST_INCLUSIVE', 'GST_EXCLUSIVE', 'GST_FREE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_refunded_cents_check') THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_refunded_cents_check
      CHECK ((refunded_cents IS NULL OR refunded_cents >= 0)
         AND (platform_fee_refunded_cents IS NULL OR (platform_fee_refunded_cents >= 0 AND platform_fee_refunded_cents <= platform_fee_cents)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_fee_snapshot_check') THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_fee_snapshot_check
      CHECK (
        (fee_mode IS NULL AND platform_fee_cents = 0 AND fee_policy_id IS NULL
          AND (payment_total_cents IS NULL OR payment_total_cents = total_cents))
        OR (fee_mode = 'PASS_THROUGH' AND fee_policy_id IS NOT NULL AND fee_policy_version IS NOT NULL
          AND payment_total_cents = total_cents + platform_fee_cents)
        OR (fee_mode = 'ABSORB' AND fee_policy_id IS NOT NULL AND fee_policy_version IS NOT NULL
          AND payment_total_cents = total_cents AND platform_fee_cents <= total_cents)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_fee_policy_fkey') THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_fee_policy_fkey
      FOREIGN KEY (fee_policy_id, organisation_id)
      REFERENCES ticketing_fee_policies (id, organisation_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_orders_fee_policy_id ON event_orders(fee_policy_id) WHERE fee_policy_id IS NOT NULL;
