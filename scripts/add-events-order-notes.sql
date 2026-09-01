-- Events & Ticketing — Phase 6: internal staff notes on an order.
-- Run once, manually, against the target database, AFTER
-- scripts/create-events-phase2.sql (event_orders must already exist).
-- NOT run automatically — same manual-authorization discipline as every
-- schema script in this repository.
--
-- Purpose: a new table, event_order_notes, letting an authorised manager
-- attach free-text internal notes to a booking (e.g. "attendee called to
-- confirm dietary requirements"). This is a NEW domain concept, not a
-- reuse of any existing table:
--   - audit_logs (see lib/events/auditLog.ts) is a system-generated,
--     structured record of WHAT changed — never manager-authored prose,
--     and this migration does not touch it.
--   - contact_journal (see app/api/admin/migrate/route.ts step 29) is
--     scoped to the separate tennis-vertical `contacts` table, is
--     structurally append-only (no author column, no edit/delete
--     support), and reusing it would conflate the tennis and Events/CRM
--     domains this schema has deliberately kept apart everywhere else
--     (see add-events-crm-link.sql's own header comment on the CRM
--     boundary).
--   - crm_activities is Events -> CRM sync's own append-only booking
--     timeline (lib/crm/eventSync.ts) — a manager's internal note about
--     a registration must NEVER appear there; see this file's own
--     "CRM boundary" note below.
--
-- ── Tenant + relationship isolation ────────────────────────────────────
--
-- A note belongs to exactly one order, and that order belongs to exactly
-- one event. The schema must make it IMPOSSIBLE — not just conventional
-- — for a note to reference an order/event pair that doesn't actually
-- match, and impossible for a note to reference another organisation's
-- order at all.
--
-- The first design considered here (two independent composite FKs:
-- order_id+organisation_id -> event_orders, and separately
-- event_id+organisation_id -> events) enforces tenant isolation on each
-- reference individually, but does NOT structurally guarantee that the
-- note's event_id is the SAME event the order_id actually belongs to —
-- both FKs would individually validate a note whose order_id points at
-- Event A's order but whose event_id names Event B, as long as both are
-- real rows in the same organisation. That is a real, provable gap, not
-- a hypothetical one (proven by check 8 in
-- scripts/tests/verify-events-order-notes.sh).
--
-- Note this is NOT a new problem this table invented: event_order_items
-- and event_attendees already carry their own denormalized event_id
-- columns alongside order_id/order_item_id with exactly the same
-- non-enforcement (see scripts/create-events-phase2.sql — neither table
-- composite-FKs its event_id back through its order relationship; only
-- organisation_id is enforced). This migration deliberately does NOT
-- match that looser precedent: unlike those tables, this one has a
-- small, single-purpose blast radius, and the fix is cheap enough that
-- there is no reason to leave a preventable class of application-bug
-- possible.
--
-- The fix used here: give event_orders a THREE-column uniqueness
-- constraint on (id, event_id, organisation_id) — purely additive
-- (id is already globally unique via the primary key; this is a
-- superset constraint, not a replacement for
-- event_orders_id_organisation_id_key, which stays exactly as it is)
-- — and give event_order_notes a SINGLE three-column composite FK
-- against it: (order_id, event_id, organisation_id) REFERENCES
-- event_orders (id, event_id, organisation_id). This makes "this note's
-- event_id is the order's real event_id, and both belong to this note's
-- organisation_id" a fact enforced by Postgres itself on every INSERT
-- and UPDATE — not an application-level convention that can be
-- forgotten. A separate FK to `events` is intentionally NOT added: it
-- would be redundant (event_orders.event_id is already FK'd to
-- events(id, organisation_id) via event_orders_event_org_fkey) and would
-- not add any guarantee this single three-column FK doesn't already
-- provide.
--
-- ── Author ──────────────────────────────────────────────────────────
--
-- author_user_id is nullable with ON DELETE SET NULL — matching
-- event_attendees.checked_in_by_user_id's existing convention (see
-- scripts/add-events-ticketing.sql) — so a later-deleted user account
-- never blocks or cascades a note's deletion. author_name_snapshot is
-- captured once, at write time, and is NOT NULL: a note's visible
-- authorship never disappears even if the author's account is deleted or
-- renamed afterward, the same "snapshot" principle already used for
-- event_registration_responses.question_label_snapshot (see
-- add-events-registration-questions.sql).
--
-- ── Soft delete ─────────────────────────────────────────────────────
--
-- deleted_at (nullable) rather than a hard DELETE — matching this
-- module's established non-destructive-history convention (the cancel
-- and refund routes never hard-delete an order either; see
-- app/api/events/[id]/orders/[orderId]/cancel/route.ts's own header
-- comment). A "deleted" note disappears from the normal manager-facing
-- API response but remains forensically recoverable. edited_at
-- (nullable, separate from updated_at) lets the API/UI show an "edited"
-- indicator only when a note has genuinely been edited after creation,
-- rather than inferring it by comparing created_at/updated_at (which
-- would also be true for the soft-delete's own updated_at bump).
--
-- ── CASCADE ───────────────────────────────────────────────────────────
--
-- ON DELETE CASCADE on the order relationship (unlike the CRM link's
-- deliberate SET NULL): a note has no meaning independent of the order
-- it was written about. If an event_orders row is ever hard-deleted
-- (which no current application code path does — orders are only ever
-- cancelled/refunded, never removed), its notes should not become
-- orphaned rows referencing a nonexistent order.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS; the prerequisite UNIQUE
-- constraint on event_orders is guarded by a DO block with a catalog
-- existence check, matching every other prerequisite-constraint
-- migration in this repository (see add-events-crm-link.sql,
-- create-events-phase2.sql). Safe to re-run; a second execution changes
-- nothing.
--
-- Additive only: one new UNIQUE constraint on the existing event_orders
-- table (no column added, removed, or renamed there), one new table.
-- Does not touch organisations, users, events, event_order_items,
-- event_attendees, event_registration_responses, crm_contacts,
-- crm_activities, audit_logs, or any other existing table or row.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_id_event_org_key'
  ) THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_id_event_org_key UNIQUE (id, event_id, organisation_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS event_order_notes (
  id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id       TEXT        NOT NULL,
  event_id              TEXT        NOT NULL,
  order_id              TEXT        NOT NULL,
  body                  TEXT        NOT NULL,

  author_user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name_snapshot  TEXT        NOT NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at             TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ,

  -- Single composite FK proving order_id/event_id/organisation_id are
  -- mutually consistent with a real event_orders row — see this file's
  -- header comment for why this replaces the originally proposed
  -- two-separate-FKs design.
  CONSTRAINT event_order_notes_order_event_org_fkey
    FOREIGN KEY (order_id, event_id, organisation_id)
    REFERENCES event_orders (id, event_id, organisation_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_order_notes_order ON event_order_notes (order_id, organisation_id);
CREATE INDEX IF NOT EXISTS idx_event_order_notes_event ON event_order_notes (event_id, organisation_id);

-- ─── Verification (run manually, read-only, after applying the above)
-- ─────────────────────────────────────────────────────────────────────
--
--   SELECT conname, contype FROM pg_constraint
--   WHERE conrelid = 'event_orders'::regclass AND conname = 'event_orders_id_event_org_key';
--   -- Expect one row, contype = 'u' (unique).
--
--   SELECT conname, contype, pg_get_constraintdef(oid) AS definition
--   FROM pg_constraint
--   WHERE conrelid = 'event_order_notes'::regclass AND conname = 'event_order_notes_order_event_org_fkey';
--   -- Expect one row: a 'f' (foreign key) definition referencing
--   -- event_orders(id, event_id, organisation_id) with "ON DELETE CASCADE".
--
--   SELECT indexname FROM pg_indexes WHERE tablename = 'event_order_notes';
--   -- Expect idx_event_order_notes_order and idx_event_order_notes_event
--   -- (plus the implicit primary key index).
--
--   SELECT count(*) FROM event_order_notes;
--   -- Expect 0 immediately after applying this migration — this is a
--   -- new table with nothing to backfill.
--
-- ─── Rollback (not run automatically — keep for reference if this
-- needs to be reverted) ─────────────────────────────────────────────
--   DROP TABLE IF EXISTS event_order_notes;
--   ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_id_event_org_key;
-- Safe at any time: nothing else references event_order_notes or
-- event_orders_id_event_org_key except the objects this same script
-- created (event_orders_id_organisation_id_key, the two-column
-- constraint every existing FK onto event_orders already uses, is
-- untouched and remains in place either way).
