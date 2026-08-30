-- Events & Ticketing — Phase 3 ticket identity + check-in. Run once,
-- manually, against the target database, AFTER scripts/create-events.sql
-- and scripts/create-events-phase2.sql (this script's ALTER TABLE
-- requires event_attendees to already exist). NOT run automatically by
-- this task — follows the same manual-authorization discipline as
-- every schema-creation script in this repository.
--
-- Purpose: gives each event_attendees row a distinct, scannable ticket
-- identity (ticket_token) and a check-in state (checked_in_at,
-- checked_in_by_user_id). No new tables — this is the smallest schema
-- addition that satisfies the Phase 3 brief's own "avoid over-modeling"
-- instruction.
--
-- Why no separate ticket status column: a ticket's validity is already
-- fully determined by its parent event_orders.status (PENDING/
-- CONFIRMED/CANCELLED, from Phase 2) — a cancelled ticket is simply an
-- attendee whose order is CANCELLED. Adding a second, independently
-- mutable status column on event_attendees would create two sources of
-- truth for the same concept with no behavioural need for one — see
-- lib/events/checkIn.ts and lib/events/publicTicket.ts, which both
-- derive "is this ticket valid" from the existing order status.
--
-- ticket_token: TEXT, matching lib/tokens.ts's own convention exactly
-- (randomBytes(32).toString('hex') — 256 bits of entropy, 64 hex
-- chars), generated server-side only, in the same INSERT statement
-- that already creates the attendee row inside the R1 concurrency-safe
-- registration transaction (app/api/public/events/.../register/
-- route.ts) — never client-supplied, never a sequential/predictable
-- value. A partial UNIQUE index (WHERE ticket_token IS NOT NULL) is the
-- structural collision guard; 256-bit entropy makes an actual collision
-- practically impossible, but the constraint means one would fail loud
-- (an INSERT error) rather than silently issuing an ambiguous token.
--
-- Nullable, not NOT NULL: existing (pre-Phase-3) attendee rows have no
-- token yet. Making the column NOT NULL here would require this single
-- migration script to also carry a data backfill, coupling schema
-- change to data migration and forcing a specific run order. Instead:
-- this script only adds the (nullable) column + partial unique index;
-- scripts/backfill-event-ticket-tokens.mjs (a separate, explicit,
-- report-as-you-go script — see its own header) fills in existing
-- rows; and every INSERT into event_attendees going forward (there is
-- exactly one call site, the public registration route) already
-- populates ticket_token unconditionally, so in practice every row
-- created from this point on has one regardless of the DB-level
-- constraint being soft.
--
-- checked_in_by_user_id: nullable FK to users, ON DELETE SET NULL —
-- matching events.created_by's own existing precedent exactly (losing
-- the staff account that performed a check-in must never delete or
-- corrupt the check-in record itself, just the "who" attribution).
--
-- Idempotency: IF NOT EXISTS / idempotent guards throughout. Safe to
-- re-run; a second execution changes nothing.
--
-- Additive only: three new columns + two new indexes on the existing
-- event_attendees table. Does not touch events, event_sessions,
-- event_ticket_types, event_orders, event_order_items, organisations,
-- users, modules, organisation_modules, or any other existing table or
-- row.
--
-- ROLLBACK: none of these columns carry an inbound reference from any
-- other table — safe to drop at any time:
--
--   DROP INDEX IF EXISTS idx_event_attendees_ticket_token;
--   DROP INDEX IF EXISTS idx_event_attendees_checked_in_by_user_id;
--   ALTER TABLE event_attendees DROP COLUMN IF EXISTS ticket_token;
--   ALTER TABLE event_attendees DROP COLUMN IF EXISTS checked_in_at;
--   ALTER TABLE event_attendees DROP COLUMN IF EXISTS checked_in_by_user_id;
--
-- (Not executed by this script — recorded here for the record only.)

ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS ticket_token TEXT;
ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS checked_in_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_attendees_ticket_token
  ON event_attendees(ticket_token) WHERE ticket_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_attendees_checked_in_by_user_id
  ON event_attendees(checked_in_by_user_id);
