-- Events & Ticketing — Phase 1 schema foundation.
-- Run once, manually, against the target database. NOT run automatically
-- by this task — follows the same manual-authorization discipline as
-- every other schema-creation script in this repository (see
-- scripts/create-modules.sql, scripts/create-organisation-modules.sql,
-- scripts/create-implementations.sql).
--
-- Purpose: staff-authenticated foundation for a new, deliberately
-- independent Events & Ticketing domain — three tables (events,
-- event_sessions, event_ticket_types) covering event/session/ticket-type
-- management only. Phase 1 explicitly does NOT create any attendee,
-- order, payment, check-in, or audit table — see the Phase 1
-- implementation report for the full scope boundary and the deferred
-- items list.
--
-- Why not built on the existing sessions/session_instances/bookings
-- tables (see scripts/add-session-schedule-and-types.sql and friends):
-- those model a recurring weekly coaching-class calendar for a single
-- tenant's tennis vertical, not a ticketed one-off/multi-date event with
-- per-ticket-type capacity and pricing. Grafting Events onto those
-- tables would entangle two unrelated products and inherit that
-- vertical's own in-flight schema drift (several of its columns are
-- still "NOT YET APPLIED to the production database"). Events is a new,
-- standalone vertical, following the same isolation precedent already
-- established by bin_maintenance_jobs.
--
-- Id / type conventions (matching the modern, non-crm_* convention used
-- by implementations, web_service_leads, modules, organisation_modules):
--   - Every id is TEXT, generated via gen_random_uuid()::text — never a
--     native UUID column, and organisation_id is never cast to ::uuid.
--   - organisation_id is TEXT NOT NULL on every table, referencing
--     organisations(id) either directly (events) or transitively via the
--     composite tenant-integrity FK described below (event_sessions,
--     event_ticket_types).
--   - Timestamps use TIMESTAMPTZ, matching every other standalone
--     table-creation script in this repository.
--
-- Tenant-integrity design (the key governance decision in this script):
-- event_sessions and event_ticket_types are NOT protected only by
-- "remember to filter by organisation_id in every query" application
-- discipline. events carries an explicit UNIQUE(id, organisation_id)
-- constraint (in addition to its own primary key), and each child
-- table's foreign key to events is a COMPOSITE key on
-- (event_id, organisation_id) referencing that unique constraint —
-- not a plain event_id-only FK. This means a row in event_sessions or
-- event_ticket_types whose organisation_id does not match its parent
-- event's organisation_id is physically impossible to insert or update;
-- Postgres rejects it at the constraint level, regardless of what any
-- calling code does or forgets to do. Each child table still stores its
-- own organisation_id column directly (rather than requiring a join to
-- events for every tenant-scoped query) — the composite FK is what keeps
-- that duplicated column honest.
--
-- Cascade behaviour: organisation -> event is ON DELETE CASCADE
-- (matching the existing convention for business-data tables, e.g.
-- sessions, bookings, contacts) — deleting an organisation removes its
-- events. event -> {event_sessions, event_ticket_types} is also ON
-- DELETE CASCADE — deleting an event is expected to remove its child
-- rows outright in Phase 1, since no attendee/order data can yet exist
-- to be orphaned by that (there is no registration/ticketing surface
-- yet). This must be re-examined before any later phase that introduces
-- EventAttendee/EventOrder rows referencing event_sessions or
-- event_ticket_types, at which point CASCADE deletes of those tables may
-- no longer be safe.
--
-- created_by references users(id) ON DELETE SET NULL — losing the
-- creating user's account must never delete the event itself.
--
-- Idempotency: every statement uses IF NOT EXISTS / standard CREATE
-- TABLE guards. Safe to re-run; a second execution changes nothing. No
-- row is inserted by this script — see scripts/seed-events-capability.sql
-- (also not run automatically) for capability-registry seeding, which is
-- deliberately a separate, later, explicitly authorized step.
--
-- Additive only: creates three new tables, referencing the already-
-- created organisations and users tables. Does not touch organisations,
-- users, modules, organisation_modules, sessions, bookings, contacts,
-- tennis_leads, bin_maintenance_jobs, crm_*, or any other existing table
-- or row.
--
-- ROLLBACK: this script creates no data, only empty tables with no
-- inbound references from any other table (nothing in this repository
-- references events/event_sessions/event_ticket_types yet). Rollback is
-- therefore a plain drop, safe to run at any point before any dependent
-- feature (application code, a later migration) is deployed against it:
--
--   DROP TABLE IF EXISTS event_ticket_types;
--   DROP TABLE IF EXISTS event_sessions;
--   DROP TABLE IF EXISTS events;
--
-- (child tables first, since they hold the FKs). Not executed by this
-- script — recorded here for the record only.

CREATE TABLE IF NOT EXISTS events (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id TEXT        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  slug            TEXT        NOT NULL,
  description     TEXT,
  venue           TEXT,
  status          TEXT        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'CANCELLED')),
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  timezone        TEXT        NOT NULL,
  created_by      TEXT        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT events_id_organisation_id_key UNIQUE (id, organisation_id),
  CONSTRAINT events_organisation_id_slug_key UNIQUE (organisation_id, slug),
  CONSTRAINT events_time_order_check CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_events_organisation_id ON events(organisation_id);
CREATE INDEX IF NOT EXISTS idx_events_organisation_id_status ON events(organisation_id, status);

CREATE TABLE IF NOT EXISTS event_sessions (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id        TEXT        NOT NULL,
  organisation_id TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  capacity        INTEGER     NOT NULL CHECK (capacity >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_sessions_time_order_check CHECK (ends_at > starts_at),
  -- Composite tenant-integrity FK — see this file's header comment.
  CONSTRAINT event_sessions_event_org_fkey FOREIGN KEY (event_id, organisation_id)
    REFERENCES events (id, organisation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_sessions_event_id ON event_sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_event_sessions_organisation_id ON event_sessions(organisation_id);

CREATE TABLE IF NOT EXISTS event_ticket_types (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id        TEXT        NOT NULL,
  organisation_id TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  description     TEXT,
  price_cents     INTEGER     NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  capacity        INTEGER     NOT NULL CHECK (capacity >= 0),
  active          BOOLEAN     NOT NULL DEFAULT true,
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite tenant-integrity FK — see this file's header comment.
  CONSTRAINT event_ticket_types_event_org_fkey FOREIGN KEY (event_id, organisation_id)
    REFERENCES events (id, organisation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_ticket_types_event_id ON event_ticket_types(event_id);
CREATE INDEX IF NOT EXISTS idx_event_ticket_types_organisation_id ON event_ticket_types(organisation_id);
