-- Events & Ticketing — Phase 2 schema foundation (public free
-- registration). Run once, manually, against the target database, AFTER
-- scripts/create-events.sql (this script's foreign keys require events/
-- event_sessions/event_ticket_types to already exist). NOT run
-- automatically by this task — follows the same manual-authorization
-- discipline as every schema-creation script in this repository.
--
-- Purpose: adds exactly the order/attendee data a public, free-only
-- registration flow needs — three new tables (event_orders,
-- event_order_items, event_attendees) — plus two small, additive
-- constraint additions to the existing event_sessions/
-- event_ticket_types tables (see PHASE 1 TABLE CHANGE below). No
-- attendee ticket-token/QR/check-in column, no payment/gateway column,
-- no email-send bookkeeping — those are Phase 3+.
--
-- Id / type conventions: unchanged from Phase 1 — every id is TEXT via
-- gen_random_uuid()::text, organisation_id is TEXT NOT NULL throughout,
-- never cast to ::uuid, timestamps are TIMESTAMPTZ.
--
-- Tenant-integrity design (extends Phase 1's pattern, does not replace
-- it): the composite-FK chain events(id, organisation_id) already
-- anchors event_sessions/event_ticket_types. Phase 2 extends the SAME
-- chain one and two levels deeper:
--   events(id, organisation_id)
--     -> event_orders(id, organisation_id)
--       -> event_order_items(id, organisation_id)
--         -> event_attendees
-- event_order_items ALSO composite-FKs onto event_ticket_types(id,
-- organisation_id) and (when session-bound) event_sessions(id,
-- organisation_id) — so a registration physically cannot select a
-- ticket type or session belonging to a different organisation, even if
-- application code has a bug. Every composite FK in this file follows
-- Phase 1's own established column-order convention: (foreign_id,
-- organisation_id) referencing (id, organisation_id).
--
-- Scope boundary the composite-FK chain does NOT cover (matching Phase
-- 1's own precedent of not over-enforcing every denormalized column):
-- event_order_items.event_id and event_attendees.event_id/order_id are
-- denormalized convenience columns, not separately composite-FK'd —
-- exactly as Phase 1 never additionally enforced "this session's
-- event_id matches this ticket type's event_id" beyond each
-- individually composite-FKing onto events. These columns are always
-- derived server-side from an already-tenant-verified resolution chain,
-- never accepted from client input.
--
-- ══ PHASE 1 TABLE CHANGE (the one necessary touch) ══
-- Adds UNIQUE(id, organisation_id) to event_sessions and
-- event_ticket_types. This is required — and only this — because Phase
-- 2's event_order_items needs to composite-FK onto both tables the same
-- way event_sessions/event_ticket_types themselves already composite-FK
-- onto events. It is purely additive: no column added, removed, or
-- renamed; no existing row can violate it (id is already the primary
-- key, hence already globally unique, and organisation_id is already
-- NOT NULL); no existing query, index, or application behaviour changes.
-- Rollback for this piece alone: DROP CONSTRAINT the two new unique
-- constraints (see ROLLBACK below) — safe at any time before Phase 2's
-- own FKs are created, and safe after only if those FKs are dropped
-- first (Postgres will refuse otherwise).
--
-- status vocabulary (event_orders.status): 'PENDING' | 'CONFIRMED' |
-- 'CANCELLED' — TEXT + CHECK, not a native Postgres enum, matching
-- events.status's own precedent (see scripts/create-events.sql's
-- comment). The Phase 2 public flow always writes 'CONFIRMED' directly
-- (a free order has no payment-pending stage); PENDING/CANCELLED are
-- reserved vocabulary for later phases, validated now so the contract
-- doesn't need a later migration.
--
-- Pricing: unit_price_cents/total_cents default to 0 and are NEVER
-- constrained to exactly 0 at the database level — that would require a
-- future migration to relax once paid orders exist. "Always 0 in Phase
-- 2" is an application-level invariant (the public registration route
-- only ever inserts a ticket type's server-side price_cents, and Phase
-- 2 only accepts ticket types whose price_cents = 0), not a schema-
-- level one. Both columns keep Phase 1's >= 0 CHECK convention.
--
-- Idempotency: every statement uses IF NOT EXISTS / ADD CONSTRAINT IF
-- NOT EXISTS guards where Postgres supports them; the two ALTER TABLE
-- additions use a DO block with a catalog existence check since
-- Postgres (as of the versions this repository targets) has no native
-- `ADD CONSTRAINT IF NOT EXISTS`. Safe to re-run; a second execution
-- changes nothing. No row is inserted by this script.
--
-- Additive only: two additive ALTER TABLE ADD CONSTRAINT statements
-- against existing Phase 1 tables (explained above), plus three new
-- tables referencing events/event_sessions/event_ticket_types. Does not
-- touch organisations, users, modules, organisation_modules, sessions,
-- bookings, contacts, tennis_leads, bin_maintenance_jobs, crm_*, or any
-- other existing table or row.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS event_attendees;
--   DROP TABLE IF EXISTS event_order_items;
--   DROP TABLE IF EXISTS event_orders;
--   ALTER TABLE event_ticket_types DROP CONSTRAINT IF EXISTS event_ticket_types_id_organisation_id_key;
--   ALTER TABLE event_sessions DROP CONSTRAINT IF EXISTS event_sessions_id_organisation_id_key;
-- (children first, since they hold the FKs; the two Phase 1 constraint
-- drops last, since Phase 2's own FKs must be gone first). Not executed
-- by this script — recorded here for the record only.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_sessions_id_organisation_id_key'
  ) THEN
    ALTER TABLE event_sessions
      ADD CONSTRAINT event_sessions_id_organisation_id_key UNIQUE (id, organisation_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_ticket_types_id_organisation_id_key'
  ) THEN
    ALTER TABLE event_ticket_types
      ADD CONSTRAINT event_ticket_types_id_organisation_id_key UNIQUE (id, organisation_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS event_orders (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id TEXT        NOT NULL,
  event_id        TEXT        NOT NULL,
  purchaser_name  TEXT        NOT NULL,
  purchaser_email TEXT        NOT NULL,
  purchaser_phone TEXT,
  status          TEXT        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED')),
  total_cents     INTEGER     NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_orders_id_organisation_id_key UNIQUE (id, organisation_id),
  -- Composite tenant-integrity FK — see this file's header comment.
  CONSTRAINT event_orders_event_org_fkey FOREIGN KEY (event_id, organisation_id)
    REFERENCES events (id, organisation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_orders_organisation_id ON event_orders(organisation_id);
CREATE INDEX IF NOT EXISTS idx_event_orders_event_id ON event_orders(event_id);

CREATE TABLE IF NOT EXISTS event_order_items (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id   TEXT        NOT NULL,
  order_id          TEXT        NOT NULL,
  event_id          TEXT        NOT NULL,
  event_session_id  TEXT,
  ticket_type_id    TEXT        NOT NULL,
  quantity          INTEGER     NOT NULL CHECK (quantity > 0),
  unit_price_cents  INTEGER     NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_order_items_id_organisation_id_key UNIQUE (id, organisation_id),
  -- Composite tenant-integrity FKs — see this file's header comment.
  CONSTRAINT event_order_items_order_org_fkey FOREIGN KEY (order_id, organisation_id)
    REFERENCES event_orders (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_order_items_ticket_type_org_fkey FOREIGN KEY (ticket_type_id, organisation_id)
    REFERENCES event_ticket_types (id, organisation_id) ON DELETE RESTRICT,
  CONSTRAINT event_order_items_session_org_fkey FOREIGN KEY (event_session_id, organisation_id)
    REFERENCES event_sessions (id, organisation_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_event_order_items_organisation_id ON event_order_items(organisation_id);
CREATE INDEX IF NOT EXISTS idx_event_order_items_order_id ON event_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_event_order_items_ticket_type_id ON event_order_items(ticket_type_id);
CREATE INDEX IF NOT EXISTS idx_event_order_items_event_session_id ON event_order_items(event_session_id);

CREATE TABLE IF NOT EXISTS event_attendees (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id TEXT        NOT NULL,
  event_id        TEXT        NOT NULL,
  order_id        TEXT        NOT NULL,
  order_item_id   TEXT        NOT NULL,
  attendee_name   TEXT        NOT NULL,
  attendee_email  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite tenant-integrity FK — see this file's header comment.
  CONSTRAINT event_attendees_order_item_org_fkey FOREIGN KEY (order_item_id, organisation_id)
    REFERENCES event_order_items (id, organisation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_attendees_organisation_id ON event_attendees(organisation_id);
CREATE INDEX IF NOT EXISTS idx_event_attendees_event_id ON event_attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_event_attendees_order_id ON event_attendees(order_id);
CREATE INDEX IF NOT EXISTS idx_event_attendees_order_item_id ON event_attendees(order_item_id);
