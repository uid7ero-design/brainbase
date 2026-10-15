-- Events & Ticketing — Phase 4: promotional codes, presale access codes
-- and per-ticket-type sale windows. Run once, manually, against the
-- target database, AFTER scripts/create-events.sql,
-- scripts/create-events-phase2.sql, scripts/add-events-payments.sql and
-- scripts/create-events-ticket-type-session-inventory.sql (the join
-- tables below composite-FK onto Phase 3's
-- event_ticket_types_id_event_org_key, and the order snapshot columns
-- sit beside Phase 4A's payment columns). NOT run automatically — same
-- manual-authorization discipline as every schema script in this
-- repository. NOT executed against Production by this phase; the
-- Production migration remains separately gated.
--
-- ── What this adds, and why ─────────────────────────────────────────────
--
-- 1. event_ticket_types gains an OPTIONAL sale window (sale_starts_at /
--    sale_ends_at, NULL = unbounded, half-open: on sale when
--    NOW() >= sale_starts_at AND NOW() < sale_ends_at) and a
--    requires_access_code flag. Both default to "no restriction", so every
--    existing ticket type is on sale exactly as it is today.
--
-- 2. event_promotion_codes — a PRICE reduction only (PERCENT 1..100 whole
--    percent, or FIXED integer cents), scoped to ONE organisation AND ONE
--    event, optionally windowed, optionally capped (max_redemptions),
--    optionally requiring a minimum gross cart (min_cart_cents), optionally
--    restricted to a set of ticket types (join table; empty set = every
--    paid line). The code text is stored NORMALISED (upper(btrim)) and the
--    CHECK below enforces that, so matching is case-insensitive by
--    construction and "the same code in two organisations" is simply two
--    rows under UNIQUE (organisation_id, event_id, code).
--
-- 3. event_access_codes — an ELIGIBILITY grant only (never a price):
--    unlocks ticket types flagged requires_access_code, scoped the same
--    way, optionally windowed, no redemption counter (D5). A deliberately
--    SEPARATE entity from promotion codes (D9): one order may legitimately
--    carry one of each, and conflating them would need nullable discount
--    columns plus a discriminator in every query. Minimum length 8 (vs 3
--    for marketing codes) because an access code is a secret-ish gate.
--
-- 4. event_orders / event_order_items gain the discount SNAPSHOT:
--    discount_cents, promotion_code_id + promotion_code_snapshot (the code
--    text as applied), access_code_id + access_code_snapshot, and a
--    per-line discount_cents. total_cents keeps its exact current meaning
--    — the authoritative PAYABLE amount (what Stripe charges) — and
--    unit_price_cents stays GROSS. The gross subtotal is DERIVED
--    (total_cents + discount_cents), so no existing row needs a backfill.
--    A later change to, or disabling of, a code never touches an order:
--    the order carries its own snapshot and is never recomputed.
--
-- Redemption tracking model (D3, as modified at approval): there is NO
-- separate redemption table — the order row IS the redemption record.
-- A code's redemption count is the number of event_orders with
-- promotion_code_id = <code> that are either
--   * successfully paid (payment_status IN ('PAID','REFUNDED') — a paid
--     order consumes a redemption for the lifetime limit PERMANENTLY, even
--     if later refunded or cancelled), or
--   * a live, unexpired PENDING hold (status <> 'CANCELLED' AND
--     payment_status = 'PENDING' AND expires_at > NOW()), or
--   * any other non-cancelled order (a CONFIRMED free order).
-- An abandoned/expired hold or a FAILED/EXPIRED payment therefore releases
-- availability by time or by webhook, exactly like capacity; the webhook
-- never inserts anything promotion-related, so a replayed webhook cannot
-- double-count; and Retry excludes its own order from the count, so a
-- retry can never be a second redemption. The gated reservation statement
-- in lib/events/services/{paidCheckout,retryCheckout}.ts evaluates this
-- predicate after locking the promotion row FOR UPDATE (the LAST tier of
-- the Phase 3 lock order: ticket types asc < pair rows asc < session <
-- promotion code), so concurrent limited-redemption purchases cannot
-- oversubscribe the limit.
--
-- ADDITIVE ONLY. Every new column has a default (0 / NULL / false) that
-- satisfies every new CHECK, so every existing event_ticket_types,
-- event_orders and event_order_items row is valid as-is and byte-for-byte
-- unchanged in every pre-existing column. No UPDATE, no backfill, no
-- reinterpretation of price_cents, capacity, total_cents or
-- unit_price_cents. Application code before this phase never references
-- any new column, so the migration can be applied ahead of the code
-- deploy (and MUST be: the new loadCartTicketTypes selects the new
-- ticket-type columns).
--
-- ── Tenant / event integrity, enforced by PostgreSQL ────────────────────
--
-- Every child row carries its own event_id AND organisation_id and
-- composite-FKs onto a parent UNIQUE that includes both, so:
--   * a join row cannot attach a code to a ticket type of another
--     organisation OR of another event in the same organisation (both
--     FKs force agreement on the single (event_id, organisation_id) pair
--     the join row carries — the Phase 3 technique);
--   * an ORDER cannot reference a code of another organisation OR of
--     another event in the same organisation: the order FKs are
--     (promotion_code_id, event_id, organisation_id) ->
--     event_promotion_codes (id, event_id, organisation_id) and likewise
--     for access codes (approval refinement §2 — an (id, organisation_id)
--     FK alone would have allowed a same-organisation, cross-event
--     reference).
-- The order FKs are default NO ACTION (not RESTRICT): deleting an EVENT
-- cascades to its orders and its codes in the same statement, and NO
-- ACTION is checked at statement end so the cascade completes; RESTRICT
-- would fire mid-cascade. Codes themselves have no DELETE endpoint — a
-- code with orders is disabled (active = false), never deleted.
--
-- Id / type conventions: unchanged — TEXT ids via gen_random_uuid()::text,
-- organisation_id TEXT NOT NULL, never cast to ::uuid, TIMESTAMPTZ.
--
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS; every ADD CONSTRAINT is inside a DO block with a pg_constraint
-- existence check (Postgres has no ADD CONSTRAINT IF NOT EXISTS). Safe to
-- re-run; a second execution changes nothing.
--
-- ROLLBACK (manual, in this order — children/dependents first; Postgres
-- refuses the reverse). Not executed by this script; recorded for the
-- record. Dropping the snapshot columns discards the discount history of
-- Phase 4 orders only — total_cents (the amount actually paid) is
-- untouched by both the migration and its rollback.
--   ALTER TABLE event_orders
--     DROP CONSTRAINT IF EXISTS event_orders_promotion_code_fkey,
--     DROP CONSTRAINT IF EXISTS event_orders_access_code_fkey,
--     DROP CONSTRAINT IF EXISTS event_orders_promotion_snapshot_check,
--     DROP CONSTRAINT IF EXISTS event_orders_access_snapshot_check,
--     DROP CONSTRAINT IF EXISTS event_orders_discount_cents_check;
--   DROP INDEX IF EXISTS idx_event_orders_promotion_code_id;
--   DROP INDEX IF EXISTS idx_event_orders_access_code_id;
--   ALTER TABLE event_orders
--     DROP COLUMN IF EXISTS discount_cents,
--     DROP COLUMN IF EXISTS promotion_code_id,
--     DROP COLUMN IF EXISTS promotion_code_snapshot,
--     DROP COLUMN IF EXISTS access_code_id,
--     DROP COLUMN IF EXISTS access_code_snapshot;
--   ALTER TABLE event_order_items
--     DROP CONSTRAINT IF EXISTS event_order_items_discount_cents_check,
--     DROP COLUMN IF EXISTS discount_cents;
--   DROP TABLE IF EXISTS event_promotion_code_ticket_types;
--   DROP TABLE IF EXISTS event_access_code_ticket_types;
--   DROP TABLE IF EXISTS event_promotion_codes;
--   DROP TABLE IF EXISTS event_access_codes;
--   ALTER TABLE event_ticket_types
--     DROP CONSTRAINT IF EXISTS event_ticket_types_sale_window_check,
--     DROP COLUMN IF EXISTS sale_starts_at,
--     DROP COLUMN IF EXISTS sale_ends_at,
--     DROP COLUMN IF EXISTS requires_access_code;

-- ── 1. Ticket types: sale window + access flag ───────────────────────────

ALTER TABLE event_ticket_types
  ADD COLUMN IF NOT EXISTS sale_starts_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sale_ends_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requires_access_code BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_ticket_types_sale_window_check') THEN
    ALTER TABLE event_ticket_types
      ADD CONSTRAINT event_ticket_types_sale_window_check
      CHECK (sale_starts_at IS NULL OR sale_ends_at IS NULL OR sale_ends_at > sale_starts_at);
  END IF;
END $$;

-- ── 2. Promotion codes ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_promotion_codes (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id TEXT        NOT NULL,
  event_id        TEXT        NOT NULL,
  code            TEXT        NOT NULL,
  discount_type   TEXT        NOT NULL,
  discount_value  INTEGER     NOT NULL,
  active          BOOLEAN     NOT NULL DEFAULT true,
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  max_redemptions INTEGER,
  min_cart_cents  INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Stored normalised: upper-cased, trimmed, 3..32 of [A-Z0-9_-]. The
  -- application normalises the same way before every lookup, so matching
  -- is case-insensitive by construction.
  CONSTRAINT event_promotion_codes_code_format_check
    CHECK (code = upper(btrim(code)) AND code ~ '^[A-Z0-9_-]{3,32}$'),
  CONSTRAINT event_promotion_codes_discount_type_check
    CHECK (discount_type IN ('PERCENT', 'FIXED')),
  -- Whole percent 1..100, or a fixed amount of at least one cent (D6).
  CONSTRAINT event_promotion_codes_discount_value_check
    CHECK ((discount_type = 'PERCENT' AND discount_value BETWEEN 1 AND 100)
        OR (discount_type = 'FIXED'   AND discount_value >= 1)),
  CONSTRAINT event_promotion_codes_window_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT event_promotion_codes_max_redemptions_check
    CHECK (max_redemptions IS NULL OR max_redemptions >= 1),
  CONSTRAINT event_promotion_codes_min_cart_check
    CHECK (min_cart_cents IS NULL OR min_cart_cents >= 1),
  -- One code text per (organisation, event); the same text may exist in
  -- other organisations and other events without conflict.
  CONSTRAINT event_promotion_codes_org_event_code_key UNIQUE (organisation_id, event_id, code),
  CONSTRAINT event_promotion_codes_id_org_key       UNIQUE (id, organisation_id),
  CONSTRAINT event_promotion_codes_id_event_org_key UNIQUE (id, event_id, organisation_id),
  CONSTRAINT event_promotion_codes_event_org_fkey FOREIGN KEY (event_id, organisation_id)
    REFERENCES events (id, organisation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_promotion_codes_organisation_id ON event_promotion_codes(organisation_id);
CREATE INDEX IF NOT EXISTS idx_event_promotion_codes_event_id        ON event_promotion_codes(event_id);

-- Optional ticket-type restriction. No rows for a code = the code applies
-- to every paid line of the cart.
CREATE TABLE IF NOT EXISTS event_promotion_code_ticket_types (
  promotion_code_id TEXT        NOT NULL,
  ticket_type_id    TEXT        NOT NULL,
  event_id          TEXT        NOT NULL,
  organisation_id   TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_promotion_code_ticket_types_pkey PRIMARY KEY (promotion_code_id, ticket_type_id),
  -- Composite tenant/event-integrity FKs — see this file's header comment.
  CONSTRAINT event_promo_tt_code_fkey FOREIGN KEY (promotion_code_id, event_id, organisation_id)
    REFERENCES event_promotion_codes (id, event_id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_promo_tt_ticket_type_fkey FOREIGN KEY (ticket_type_id, event_id, organisation_id)
    REFERENCES event_ticket_types (id, event_id, organisation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_promo_tt_ticket_type_id  ON event_promotion_code_ticket_types(ticket_type_id);
CREATE INDEX IF NOT EXISTS idx_event_promo_tt_organisation_id ON event_promotion_code_ticket_types(organisation_id);

-- ── 3. Access codes (eligibility only — no discount, no counter) ────────

CREATE TABLE IF NOT EXISTS event_access_codes (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id TEXT        NOT NULL,
  event_id        TEXT        NOT NULL,
  code            TEXT        NOT NULL,
  active          BOOLEAN     NOT NULL DEFAULT true,
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Minimum 8 characters (approval refinement §3) — an access code gates
  -- restricted inventory and must not be guessable; same normalised
  -- alphabet as promotion codes.
  CONSTRAINT event_access_codes_code_format_check
    CHECK (code = upper(btrim(code)) AND code ~ '^[A-Z0-9_-]{8,32}$'),
  CONSTRAINT event_access_codes_window_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT event_access_codes_org_event_code_key UNIQUE (organisation_id, event_id, code),
  CONSTRAINT event_access_codes_id_org_key       UNIQUE (id, organisation_id),
  CONSTRAINT event_access_codes_id_event_org_key UNIQUE (id, event_id, organisation_id),
  CONSTRAINT event_access_codes_event_org_fkey FOREIGN KEY (event_id, organisation_id)
    REFERENCES events (id, organisation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_access_codes_organisation_id ON event_access_codes(organisation_id);
CREATE INDEX IF NOT EXISTS idx_event_access_codes_event_id        ON event_access_codes(event_id);

-- Which restricted ticket types the code unlocks. No rows for a code =
-- the code unlocks every requires_access_code type of its event.
CREATE TABLE IF NOT EXISTS event_access_code_ticket_types (
  access_code_id  TEXT        NOT NULL,
  ticket_type_id  TEXT        NOT NULL,
  event_id        TEXT        NOT NULL,
  organisation_id TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_access_code_ticket_types_pkey PRIMARY KEY (access_code_id, ticket_type_id),
  CONSTRAINT event_access_tt_code_fkey FOREIGN KEY (access_code_id, event_id, organisation_id)
    REFERENCES event_access_codes (id, event_id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_access_tt_ticket_type_fkey FOREIGN KEY (ticket_type_id, event_id, organisation_id)
    REFERENCES event_ticket_types (id, event_id, organisation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_access_tt_ticket_type_id  ON event_access_code_ticket_types(ticket_type_id);
CREATE INDEX IF NOT EXISTS idx_event_access_tt_organisation_id ON event_access_code_ticket_types(organisation_id);

-- ── 4. Order discount snapshot ──────────────────────────────────────────

ALTER TABLE event_orders
  ADD COLUMN IF NOT EXISTS discount_cents          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promotion_code_id       TEXT,
  ADD COLUMN IF NOT EXISTS promotion_code_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS access_code_id          TEXT,
  ADD COLUMN IF NOT EXISTS access_code_snapshot    TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_discount_cents_check') THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_discount_cents_check CHECK (discount_cents >= 0);
  END IF;
  -- A discount exists only together with the code that produced it, and
  -- an order without a code carries no discount at all.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_promotion_snapshot_check') THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_promotion_snapshot_check
      CHECK ((promotion_code_id IS NULL AND promotion_code_snapshot IS NULL AND discount_cents = 0)
          OR (promotion_code_id IS NOT NULL AND promotion_code_snapshot IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_access_snapshot_check') THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_access_snapshot_check
      CHECK ((access_code_id IS NULL) = (access_code_snapshot IS NULL));
  END IF;
  -- Event-scoped composite FKs (approval refinement §2): an order can only
  -- ever reference a code of its OWN event and organisation.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_promotion_code_fkey') THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_promotion_code_fkey
      FOREIGN KEY (promotion_code_id, event_id, organisation_id)
      REFERENCES event_promotion_codes (id, event_id, organisation_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_access_code_fkey') THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_access_code_fkey
      FOREIGN KEY (access_code_id, event_id, organisation_id)
      REFERENCES event_access_codes (id, event_id, organisation_id);
  END IF;
END $$;

-- Partial indexes: the redemption count is "orders carrying THIS code",
-- and almost every order carries none.
CREATE INDEX IF NOT EXISTS idx_event_orders_promotion_code_id ON event_orders(promotion_code_id) WHERE promotion_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_orders_access_code_id    ON event_orders(access_code_id)    WHERE access_code_id IS NOT NULL;

ALTER TABLE event_order_items
  ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  -- A line's discount can never exceed its own gross (no negative line).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_order_items_discount_cents_check') THEN
    ALTER TABLE event_order_items
      ADD CONSTRAINT event_order_items_discount_cents_check
      CHECK (discount_cents >= 0 AND discount_cents <= unit_price_cents * quantity);
  END IF;
END $$;

-- ── Verification (run manually after applying; not executed here) ───────
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'event_ticket_types'
--     AND column_name IN ('sale_starts_at','sale_ends_at','requires_access_code');
--   -- expect 3 rows; requires_access_code NOT NULL DEFAULT false
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'event_orders'
--     AND column_name IN ('discount_cents','promotion_code_id','promotion_code_snapshot','access_code_id','access_code_snapshot');
--   -- expect 5 rows
-- SELECT conname, contype FROM pg_constraint
--   WHERE conname IN ('event_orders_promotion_code_fkey','event_orders_access_code_fkey',
--                     'event_orders_promotion_snapshot_check','event_orders_access_snapshot_check',
--                     'event_orders_discount_cents_check','event_order_items_discount_cents_check',
--                     'event_ticket_types_sale_window_check');
--   -- expect 7 rows
-- SELECT count(*) FROM event_promotion_codes;  -- 0 immediately after migration
-- SELECT count(*) FROM event_access_codes;     -- 0 immediately after migration
-- SELECT count(*) FROM event_orders WHERE discount_cents <> 0 OR promotion_code_id IS NOT NULL;  -- 0
