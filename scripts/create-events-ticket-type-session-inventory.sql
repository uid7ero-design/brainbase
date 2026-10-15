-- Events & Ticketing — Phase 3: ticket type × session inventory. Run
-- once, manually, against the target database, AFTER
-- scripts/create-events.sql and scripts/create-events-phase2.sql (the
-- composite foreign keys below require events, event_sessions and
-- event_ticket_types — and Phase 2's UNIQUE (id, organisation_id) on the
-- latter two — to already exist). NOT run automatically — same
-- manual-authorization discipline as every schema script in this
-- repository. NOT executed against Production by this phase; the
-- Production migration remains separately gated.
--
-- ── What this adds, and why ─────────────────────────────────────────────
--
-- Today a ticket type has ONE event-wide capacity (event_ticket_types.
-- capacity, counted across every session and every no-session order) and
-- a session has ONE shared capacity across all ticket types
-- (event_sessions.capacity). There is no way to say "Adult: 4 on Friday,
-- 6 on Saturday". This script adds exactly that: one OPTIONAL override
-- row per (ticket type, session) pair.
--
-- Semantics (enforced by the reservation gate in
-- lib/events/services/{freeRegistration,paidCheckout,retryCheckout}.ts):
--   * a row for (T, S) exists  -> T's capacity within S is that row's
--     capacity, counted against orders for T in S only;
--   * no row for (T, S)        -> unchanged behaviour: T's event-wide
--     capacity, counted event-wide (every session + no-session orders);
--   * event_sessions.capacity ALWAYS remains the shared upper bound on
--     the combined quantity of every ticket type booked into S.
-- A no-session order is never affected by any row here.
--
-- ADDITIVE ONLY. No existing column, row, constraint or index is altered
-- or reinterpreted: event_ticket_types.capacity and event_sessions.
-- capacity keep their exact current meaning, and an event with no rows
-- in the new table behaves exactly as it does today (the gate's LEFT
-- JOIN finds nothing and COALESCEs back to the event-wide capacity).
--
-- Clearing an override is DELETE of its row — there is deliberately no
-- nullable capacity and no second "unlimited" sentinel; capacity is
-- INTEGER NOT NULL CHECK (capacity >= 0), the same convention as every
-- other Events capacity column (0 = nothing bookable for that pair).
--
-- ── Tenant / event integrity, enforced by PostgreSQL ────────────────────
--
-- The pair table must never be able to reference a ticket type or a
-- session from another organisation, nor a ticket type and a session
-- that belong to DIFFERENT events of the same organisation. Phase 2's
-- (id, organisation_id) composite FKs would cover the first but not the
-- second, so this script adds one further additive UNIQUE on each parent
-- — (id, event_id, organisation_id) — and composite-FKs the pair row's
-- own (ticket_type_id | event_session_id, event_id, organisation_id) onto
-- it. Because the pair row carries a SINGLE event_id and a SINGLE
-- organisation_id, both parents are forced to agree on both. The same
-- 3-column UNIQUE precedent already exists on event_orders
-- (event_orders_id_event_org_key, scripts/add-events-order-notes.sql).
-- Both new parent UNIQUEs are purely additive: id is already the primary
-- key, so no existing row can violate them, and no existing query, index
-- or application behaviour changes.
--
-- ON DELETE CASCADE throughout: an override is meaningless without its
-- ticket type, its session or its event, and holds no sales data of its
-- own (sold quantities live on event_order_items), so it simply goes
-- with its parent — matching event_sessions/event_ticket_types' own
-- CASCADE from events.
--
-- Id / type conventions: unchanged — TEXT ids via gen_random_uuid()::text,
-- organisation_id TEXT NOT NULL, never cast to ::uuid, TIMESTAMPTZ.
--
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS; the ALTER TABLE
-- constraint additions use a DO block with a pg_constraint existence
-- check (Postgres has no ADD CONSTRAINT IF NOT EXISTS). Safe to re-run;
-- a second execution changes nothing.
--
-- ROLLBACK (manual, in this order — children first, since they hold the
-- FKs onto the two new parent UNIQUEs; Postgres refuses the reverse):
--   DROP TABLE IF EXISTS event_ticket_type_session_inventory;
--   ALTER TABLE event_ticket_types DROP CONSTRAINT IF EXISTS event_ticket_types_id_event_org_key;
--   ALTER TABLE event_sessions     DROP CONSTRAINT IF EXISTS event_sessions_id_event_org_key;
-- Dropping the table discards every override; existing ticket-type and
-- session capacities are untouched by both the migration and its
-- rollback. Not executed by this script — recorded here for the record.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_ticket_types_id_event_org_key'
  ) THEN
    ALTER TABLE event_ticket_types
      ADD CONSTRAINT event_ticket_types_id_event_org_key UNIQUE (id, event_id, organisation_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_sessions_id_event_org_key'
  ) THEN
    ALTER TABLE event_sessions
      ADD CONSTRAINT event_sessions_id_event_org_key UNIQUE (id, event_id, organisation_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS event_ticket_type_session_inventory (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id  TEXT        NOT NULL,
  event_id         TEXT        NOT NULL,
  ticket_type_id   TEXT        NOT NULL,
  event_session_id TEXT        NOT NULL,
  capacity         INTEGER     NOT NULL CHECK (capacity >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_tt_session_inventory_id_org_key UNIQUE (id, organisation_id),
  -- One override per (ticket type, session) pair within an organisation.
  CONSTRAINT event_tt_session_inventory_pair_key UNIQUE (ticket_type_id, event_session_id, organisation_id),
  -- Composite tenant/event-integrity FKs — see this file's header comment.
  CONSTRAINT event_tt_session_inventory_event_org_fkey FOREIGN KEY (event_id, organisation_id)
    REFERENCES events (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_tt_session_inventory_ticket_type_fkey FOREIGN KEY (ticket_type_id, event_id, organisation_id)
    REFERENCES event_ticket_types (id, event_id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_tt_session_inventory_session_fkey FOREIGN KEY (event_session_id, event_id, organisation_id)
    REFERENCES event_sessions (id, event_id, organisation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_tt_session_inventory_organisation_id ON event_ticket_type_session_inventory(organisation_id);
CREATE INDEX IF NOT EXISTS idx_event_tt_session_inventory_event_id ON event_ticket_type_session_inventory(event_id);
CREATE INDEX IF NOT EXISTS idx_event_tt_session_inventory_session_id ON event_ticket_type_session_inventory(event_session_id);
-- (ticket_type_id, event_session_id) lookups are served by the pair
-- UNIQUE constraint's own index.

-- ── Verification (run manually after applying; not executed here) ───────
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'event_ticket_type_session_inventory' ORDER BY ordinal_position;
--   -- expect 8 rows: id, organisation_id, event_id, ticket_type_id,
--   --                event_session_id, capacity, created_at, updated_at — all NOT NULL
-- SELECT conname, contype FROM pg_constraint
--   WHERE conrelid = 'event_ticket_type_session_inventory'::regclass ORDER BY conname;
--   -- expect: event_tt_session_inventory_capacity_check (c),
--   --         event_tt_session_inventory_event_org_fkey (f),
--   --         event_tt_session_inventory_id_org_key (u),
--   --         event_tt_session_inventory_pair_key (u),
--   --         event_tt_session_inventory_pkey (p),
--   --         event_tt_session_inventory_session_fkey (f),
--   --         event_tt_session_inventory_ticket_type_fkey (f)
-- SELECT conname FROM pg_constraint
--   WHERE conname IN ('event_ticket_types_id_event_org_key', 'event_sessions_id_event_org_key');
--   -- expect both
-- SELECT indexname FROM pg_indexes WHERE tablename = 'event_ticket_type_session_inventory' ORDER BY indexname;
--   -- expect the pkey, the two unique indexes and the three idx_event_tt_session_inventory_* indexes
