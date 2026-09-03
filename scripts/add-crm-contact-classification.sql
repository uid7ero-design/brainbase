-- CRM contact classification. Additive only: one nullable column, one
-- CHECK constraint, one tenant-scoped index on the existing crm_contacts
-- table (scripts/crm-migrate.mjs). No new table, no FK, no forced
-- backfill — every existing row becomes classification = NULL
-- ("unclassified"), a valid, expected, common state, not an error
-- condition.
--
-- ── Why TEXT + CHECK, not a native ENUM or a lookup table ──────────────
--
-- This mirrors the ONLY existing precedent in this schema for exactly
-- this shape of problem: crm_deals.stage (also scripts/crm-migrate.mjs)
-- is a TEXT column with an inline CHECK (... IN (...)) constraint, not a
-- native Postgres ENUM type and not a reference table. A native ENUM
-- would need ALTER TYPE ... ADD VALUE ceremony for future extension,
-- with no precedent anywhere in this repo. A lookup table is
-- unjustified overhead for a fixed, rarely-changing, six-value
-- vocabulary with no per-value metadata (icons, ordering, tenant
-- customisation) — nothing in this schema uses that pattern either.
--
-- ── Classification is not identity, and not source ──────────────────────
--
-- One crm_contacts row remains one person/contact identity regardless of
-- classification. This column records "what kind of CRM relationship
-- this contact currently represents" — it is NOT where a contact
-- originated from. Source stays exactly where it already lives today:
-- the informal `notes` marker ('Events / Event Booking', 'Events /
-- Historical Backfill') that lib/crm/eventSync.ts and
-- lib/crm/eventBackfill.ts already write on contact creation. This
-- migration does not touch, read, or depend on that marker in any way.
-- No dedicated `source` column is added in this phase (see this phase's
-- own audit report §C) — deferred as a separate, later concern.
--
-- ── Non-destructive by construction ────────────────────────────────────
--
-- No DEFAULT: every existing row (every Production/DEV contact, and
-- everything created before this migration is applied) becomes
-- classification = NULL automatically. This migration performs no
-- UPDATE of any kind — it does not, and structurally cannot, touch any
-- existing row's data. The application-level Events sync/backfill code
-- (lib/crm/eventSync.ts, lib/crm/eventBackfill.ts) sets classification
-- = 'EVENT_CONTACT' only in the branch that INSERTs a brand-new
-- crm_contacts row; a contact matched by email/phone to an existing row
-- is never written to at all (that invariant predates this migration
-- and is unchanged by it) — so an existing CLIENT/LEAD/SUPPLIER/
-- PARTNER/OTHER/NULL contact can never be reclassified by an Events
-- booking or backfill run, by construction, not by an extra runtime
-- check.
--
-- ── Idempotency ─────────────────────────────────────────────────────────
--
-- ADD COLUMN uses IF NOT EXISTS; the CHECK constraint is guarded by a DO
-- block with a catalog existence check, the same technique already used
-- in scripts/add-events-crm-link.sql for its own constraints (Postgres,
-- as of the versions this repository targets, has no native "ADD
-- CONSTRAINT IF NOT EXISTS"). Safe to re-run; a second execution changes
-- nothing.
--
-- Additive only: one column, one CHECK constraint, one index added to
-- the existing crm_contacts table. Does not touch crm_companies,
-- crm_deals, crm_activities, event_orders, or any other existing table
-- or row.

ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS classification TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_contacts_classification_check'
  ) THEN
    ALTER TABLE crm_contacts
      ADD CONSTRAINT crm_contacts_classification_check
      CHECK (classification IS NULL OR classification IN (
        'CLIENT',
        'LEAD',
        'EVENT_CONTACT',
        'SUPPLIER',
        'PARTNER',
        'OTHER'
      ));
  END IF;
END $$;

-- organisation_id first: every real query filters by tenant before
-- classification, matching every other composite index already in this
-- schema (idx_crm_contacts_org, idx_event_orders_crm_contact_id, etc.).
CREATE INDEX IF NOT EXISTS idx_crm_contacts_classification
  ON crm_contacts(organisation_id, classification);

-- ─── Verification (run manually, read-only, after applying the above)
-- ─────────────────────────────────────────────────────────────────────
-- Not executed by this script — paste into the same SQL editor session
-- after the statements above.
--
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'crm_contacts' AND column_name = 'classification';
--   -- Expect: data_type = 'text', is_nullable = 'YES', column_default IS NULL.
--
--   SELECT conname, contype, pg_get_constraintdef(oid) AS definition
--   FROM pg_constraint
--   WHERE conrelid = 'crm_contacts'::regclass AND conname = 'crm_contacts_classification_check';
--   -- Expect one row, contype = 'c' (check), definition listing exactly
--   -- the six values above.
--
--   SELECT indexname FROM pg_indexes WHERE tablename = 'crm_contacts' AND indexname = 'idx_crm_contacts_classification';
--   -- Expect one row.
--
--   SELECT count(*) FROM crm_contacts WHERE classification IS NOT NULL;
--   -- Expect 0 immediately after applying this migration — no backfill
--   -- is performed; every existing row stays NULL until the
--   -- application-level Events sync/backfill (or a manager, via the CRM
--   -- contact form) sets it going forward.
--
-- ─── Rollback (not run automatically — keep for reference if this
-- needs to be reverted) ─────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_crm_contacts_classification;
--   ALTER TABLE crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_classification_check;
--   ALTER TABLE crm_contacts DROP COLUMN IF EXISTS classification;
-- Safe at any time: nothing else references idx_crm_contacts_classification,
-- crm_contacts_classification_check, or crm_contacts.classification except
-- the objects this same script created.
