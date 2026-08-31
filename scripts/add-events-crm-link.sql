-- Events & Ticketing — Phase 5: link an event order to a CRM contact.
-- Run once, manually, against the target database, AFTER
-- scripts/create-events-phase2.sql (event_orders must already exist) and
-- scripts/crm-migrate.mjs (crm_contacts must already exist). NOT run
-- automatically — same manual-authorization discipline as every schema
-- script in this repository.
--
-- Purpose: the smallest schema addition that lets an event_orders row
-- reference the purchaser's CRM contact, so a manager can navigate from
-- a booking to "View CRM Contact" and so Events -> CRM sync has
-- somewhere to record the link it resolves. No new table: this is a
-- 1:1-from-the-order-side pointer onto an already-existing row, not a
-- new domain concept.
--
-- ── Why this column is UUID, not this table's usual TEXT id convention ──
--
-- Every other column on event_orders, and every id in the Events &
-- Ticketing schema generally, is TEXT via gen_random_uuid()::text (see
-- scripts/create-events.sql's own header comment). crm_contacts.id is
-- instead a NATIVE Postgres UUID (see scripts/crm-migrate.mjs) — a
-- deliberate, test-locked exception documented in
-- tests/containment/crmMigrationSchema.test.ts (that test explicitly
-- asserts CRM's primary keys stay native UUID and are never given a
-- ::text cast). A FOREIGN KEY constraint requires the referencing and
-- referenced columns to be the SAME type — there is no way to point a
-- TEXT column directly at a UUID primary key without either casting
-- (which would silently defeat the FK's own type-safety at insert time)
-- or declaring this one column UUID. event_orders.crm_contact_id is
-- therefore UUID: a narrow, single-column exception that lets this FK
-- exist honestly, not a change to event_orders' own id convention —
-- every other column on this table remains exactly as it was.
--
-- ── Tenant isolation ──────────────────────────────────────────────────
--
-- crm_contacts today has no (id, organisation_id) uniqueness — nothing
-- prevents, at the database level, a naive single-column
-- `crm_contact_id UUID REFERENCES crm_contacts(id)` FK from being set to
-- a contact belonging to a DIFFERENT organisation than the order itself.
-- This migration closes that gap the same way this schema already
-- closes it everywhere else it composite-FKs across a tenant boundary
-- (events -> event_sessions/event_ticket_types, event_orders -> events,
-- etc. — see scripts/create-events.sql / create-events-phase2.sql):
--   1. Add crm_contacts_id_organisation_id_key UNIQUE (id, organisation_id)
--      to crm_contacts — purely additive (id is already globally unique
--      as the primary key; organisation_id is already NOT NULL), and
--      required only so crm_contacts becomes a valid composite-FK
--      TARGET, the same prerequisite step create-events-phase2.sql
--      already used for event_sessions/event_ticket_types before Phase 2
--      needed to composite-FK onto them.
--   2. FK event_orders(crm_contact_id, organisation_id) against
--      crm_contacts(id, organisation_id) — an event_orders row can now
--      physically never reference a crm_contacts row in a different
--      organisation, enforced by Postgres itself, independent of
--      whatever application code does or forgets to do. This is
--      deliberately STRONGER than crm_contacts' own existing internal
--      FKs (crm_contacts.company_id -> crm_companies(id) has no such
--      composite protection today) — justified because this link must
--      never let one organisation's booking point at another
--      organisation's CRM contact under any circumstance.
--
-- ON DELETE SET NULL (crm_contact_id) — column-scoped, not CASCADE, not
-- RESTRICT, and deliberately NOT a plain (whole-FK) SET NULL: deleting a
-- CRM contact must never delete, or block deleting, an event order —
-- Events remains the booking/order source of truth independently of CRM
-- contact lifecycle. A booking whose linked contact was later deleted
-- simply reverts to "not linked to any CRM contact" (crm_contact_id =
-- NULL), exactly like an order that was never synced at all.
--
-- The column-scoped form (`ON DELETE SET NULL (crm_contact_id)`,
-- PostgreSQL 15+) is required, not optional, for a COMPOSITE foreign
-- key: a plain `ON DELETE SET NULL` on a multi-column FK nulls EVERY
-- column in that FK, not just the "optional" one — which here would
-- also try to null event_orders.organisation_id, a NOT NULL column,
-- causing the delete itself to fail with a constraint violation. This
-- was caught empirically against a real Postgres 16 instance during
-- this migration's own verification (deleting a linked CRM contact
-- raised `null value in column "organisation_id" violates not-null
-- constraint` under a plain, non-column-scoped SET NULL) — the
-- column-scoped form is the actual fix, not a stylistic preference.
--
-- Nullable, no default: every existing event_orders row (every
-- Production order, and everything created before this migration is
-- applied) becomes crm_contact_id = NULL automatically. There is no
-- historical CRM-link data to backfill — this relationship has never
-- existed before this migration. An organisation with the CRM
-- capability disabled, or any order predating this column, is
-- completely unaffected: crm_contact_id simply stays NULL forever for
-- those rows, and no existing query anywhere in the codebase references
-- this column, so nothing existing changes behaviour.
--
-- Idempotency: the ADD COLUMN uses IF NOT EXISTS; the two ADD
-- CONSTRAINT statements are guarded by a DO block with a catalog
-- existence check, since Postgres (as of the versions this repository
-- targets) has no native `ADD CONSTRAINT IF NOT EXISTS` — the same
-- technique already used in scripts/create-events-phase2.sql for its
-- own two prerequisite UNIQUE constraints. Safe to re-run; a second
-- execution changes nothing. No row is inserted or updated by this
-- script.
--
-- Additive only: one UNIQUE constraint added to the existing
-- crm_contacts table (no column added, removed, or renamed there), one
-- new nullable column + one composite FK + one index added to the
-- existing event_orders table. Does not touch organisations, users,
-- modules, organisation_modules, crm_companies, crm_deals,
-- crm_activities, or any other existing table or row.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_contacts_id_organisation_id_key'
  ) THEN
    ALTER TABLE crm_contacts
      ADD CONSTRAINT crm_contacts_id_organisation_id_key UNIQUE (id, organisation_id);
  END IF;
END $$;

ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS crm_contact_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_crm_contact_org_fkey'
  ) THEN
    ALTER TABLE event_orders
      ADD CONSTRAINT event_orders_crm_contact_org_fkey
      FOREIGN KEY (crm_contact_id, organisation_id)
      REFERENCES crm_contacts (id, organisation_id)
      ON DELETE SET NULL (crm_contact_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_orders_crm_contact_id ON event_orders(crm_contact_id);

-- ─── Verification (run manually, read-only, after applying the above)
-- ─────────────────────────────────────────────────────────────────────
-- Confirms the column, constraints, and index landed exactly as
-- declared. Not executed by this script — paste into the same SQL
-- editor session after the statements above.
--
--   SELECT column_name, data_type, is_nullable, udt_name
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'event_orders' AND column_name = 'crm_contact_id';
--   -- Expect: data_type = 'uuid', is_nullable = 'YES'.
--
--   SELECT conname, contype, pg_get_constraintdef(oid) AS definition
--   FROM pg_constraint
--   WHERE conrelid = 'event_orders'::regclass AND conname = 'event_orders_crm_contact_org_fkey';
--   -- Expect one row: a 'f' (foreign key) definition referencing
--   -- crm_contacts(id, organisation_id) whose text ends with
--   -- "ON DELETE SET NULL (crm_contact_id)" — the column-scoped form,
--   -- NOT a plain, whole-FK "ON DELETE SET NULL" with no column list
--   -- (see this file's own header comment for why the column-scoped
--   -- form is required, not stylistic).
--
--   SELECT conname, contype FROM pg_constraint
--   WHERE conrelid = 'crm_contacts'::regclass AND conname = 'crm_contacts_id_organisation_id_key';
--   -- Expect one row, contype = 'u' (unique).
--
--   SELECT indexname FROM pg_indexes WHERE tablename = 'event_orders' AND indexname = 'idx_event_orders_crm_contact_id';
--   -- Expect one row.
--
--   SELECT count(*) FROM event_orders WHERE crm_contact_id IS NOT NULL;
--   -- Expect 0 immediately after applying this migration — no backfill
--   -- is performed; every existing row stays NULL until the
--   -- application-level Events -> CRM sync populates it going forward.
--
-- ─── Rollback (not run automatically — keep for reference if this
-- needs to be reverted) ─────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_event_orders_crm_contact_id;
--   ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_crm_contact_org_fkey;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS crm_contact_id;
--   ALTER TABLE crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_id_organisation_id_key;
-- Safe at any time: nothing else references
-- crm_contacts_id_organisation_id_key or event_orders.crm_contact_id
-- except the objects this same script created.
