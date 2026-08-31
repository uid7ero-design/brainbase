-- Events & Ticketing — Phase 4A remediation: Stripe Connect per
-- organisation. Run once, manually, against the target database,
-- AFTER scripts/add-events-payments.sql (this script's ALTER TABLE
-- event_orders requires that column set to already exist). NOT run
-- automatically — same manual-authorization discipline as every
-- schema script in this repository.
--
-- Purpose: replace the single platform-owned Stripe Checkout model
-- with the correct multi-tenant one — each Brainbase organisation
-- connects its own Stripe account and receives its own ticket
-- revenue directly. Brainbase never becomes the holder of a client's
-- ticket proceeds and never stores bank details, identity documents,
-- card data, or a client's own Stripe secret credentials — only the
-- provider-issued connected account id and the account-state flags
-- Stripe itself reports back.
--
-- ── organisations.stripe_* ────────────────────────────────────────
--
-- Added directly on Organisation, not a new dedicated table: this is
-- a strict 1:1 relationship (one connected account per organisation,
-- ever), and the eligibility check these columns exist for
-- (stripe_account_id IS NOT NULL AND stripe_charges_enabled) runs on
-- every paid-checkout attempt — a plain column read, no JOIN, is the
-- simplest and fastest shape for that hot path. Organisation already
-- carries a generic `settings JSONB` column, but it is essentially
-- unused elsewhere in this codebase (one unrelated TTS-settings read
-- site) and every other piece of structured Events business data in
-- this schema (ticket types, orders, attendees) already uses plain
-- typed columns, never a JSON blob — this follows that same
-- established convention rather than introducing a new one.
--
-- stripe_account_id: the Express connected account id Stripe returns
-- (acct_...), nullable (NOT_CONNECTED has none), globally unique.
--
-- stripe_account_status: Brainbase's own DERIVED status — TEXT+CHECK,
-- matching every other status-vocabulary column's existing convention
-- in this schema (event_orders.status, event_orders.payment_status).
-- Stripe's own account object remains the source of truth; this
-- column is a locally-cached projection of it, refreshed by
-- lib/events/stripeConnect.ts's refreshConnectedAccountStatus() — see
-- that function's own comment for the exact derivation rules. Never
-- trusted as authoritative for anything money-moving (the paid-
-- ticketing eligibility gate re-checks charges_enabled itself, not
-- just this label).
--
-- stripe_charges_enabled / stripe_payouts_enabled /
-- stripe_details_submitted: mirror the three boolean flags Stripe's
-- own Account object exposes directly — kept as separate columns
-- (not folded into the status enum alone) because the paid-ticketing
-- eligibility gate specifically needs stripe_charges_enabled in its
-- own right (§10's stated minimum bar), independent of how the
-- broader status label is computed.
--
-- stripe_connected_at: set once, the first time an account reaches
-- CONNECTED. stripe_last_synced_at: updated every time
-- refreshConnectedAccountStatus() runs, regardless of outcome — lets
-- the UI show "last checked" and lets calling code decide "is this
-- stale enough to refresh before letting a checkout proceed" (§9).
--
-- ── event_orders.stripe_account_id ────────────────────────────────
--
-- Historical provider attribution (§14): which connected account
-- actually processed THIS order's payment, recorded at reservation
-- time and never changed afterward — independent of whatever the
-- organisation's CURRENT stripe_account_id happens to be by the time
-- anyone looks at this order again. This is what makes a later
-- refund (or any reconciliation) target the account that actually
-- holds the money, not whatever account is connected today, and it
-- is also half of the webhook tenant-reconciliation check (§15/§16):
-- an incoming Stripe Connect event carries its own `event.account`
-- field, which must match THIS column before the event is allowed to
-- mutate the order at all.
--
-- Nullable: every pre-Phase-4A order (free, or Phase 4's own
-- single-platform-account paid orders) has none, and reads exactly
-- like "not a Connect-attributed order" rather than requiring a
-- backfill.
--
-- Idempotency: IF NOT EXISTS / idempotent guards throughout. Safe to
-- re-run.
--
-- ROLLBACK: none of these columns carry an inbound reference from any
-- other table — safe to drop at any time:
--
--   DROP INDEX IF EXISTS idx_organisations_stripe_account_id;
--   ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_stripe_account_status_check;
--   ALTER TABLE organisations DROP COLUMN IF EXISTS stripe_account_id;
--   ALTER TABLE organisations DROP COLUMN IF EXISTS stripe_account_status;
--   ALTER TABLE organisations DROP COLUMN IF EXISTS stripe_charges_enabled;
--   ALTER TABLE organisations DROP COLUMN IF EXISTS stripe_payouts_enabled;
--   ALTER TABLE organisations DROP COLUMN IF EXISTS stripe_details_submitted;
--   ALTER TABLE organisations DROP COLUMN IF EXISTS stripe_connected_at;
--   ALTER TABLE organisations DROP COLUMN IF EXISTS stripe_last_synced_at;
--   DROP INDEX IF EXISTS idx_event_orders_stripe_account_id;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS stripe_account_id;
--
-- (Not executed by this script — recorded here for the record only.)

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS stripe_account_status TEXT NOT NULL DEFAULT 'NOT_CONNECTED';
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS stripe_details_submitted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS stripe_connected_at TIMESTAMPTZ;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS stripe_last_synced_at TIMESTAMPTZ;

ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_stripe_account_status_check;
ALTER TABLE organisations ADD CONSTRAINT organisations_stripe_account_status_check
  CHECK (stripe_account_status IN ('NOT_CONNECTED', 'ONBOARDING', 'ACTION_REQUIRED', 'CONNECTED', 'RESTRICTED'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_organisations_stripe_account_id
  ON organisations(stripe_account_id) WHERE stripe_account_id IS NOT NULL;

ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_event_orders_stripe_account_id
  ON event_orders(stripe_account_id);
