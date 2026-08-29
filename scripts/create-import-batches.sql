-- Data Hub 5A.2C — canonical durable ingestion lineage.
-- Run once against the target database. NOT run automatically by this
-- task. Safe to run twice: every statement is additive and idempotent
-- (IF NOT EXISTS / guarded DO blocks where Postgres has no native
-- "ADD CONSTRAINT IF NOT EXISTS"). No existing table's semantics are
-- rewritten, no destructive rewrite, no backfill of existing rows.
--
-- Creates:
--   import_batches — one physical uploaded file / storage+inspection
--     event (see docs/architecture/decisions/0001-data-hub-ingestion-foundation.md).
--   Additive, nullable canonical worksheet-lineage columns on the
--     existing `uploads` table — the existing seven domain FK relations
--     (metrics, illegal_dumping, missed_collections, debtor_accounts,
--     service_requests, hlna_insights, evidence_records) are untouched
--     and keep pointing at valid `uploads` rows, canonical or legacy.
--
-- Column/id convention: TEXT ids with NO database-side default — matches
-- uploads.id's own convention exactly (Prisma Client supplies cuid()
-- application-side on every insert; this table will be written the same
-- way). Deliberately NOT scripts/create-implementations.sql's
-- `gen_random_uuid()::text` convention, because that convention is for
-- raw-SQL-only tables with no Prisma Client writer — import_batches is a
-- genuine Prisma model like `uploads`, not a raw-SQL-only table.
--
-- No `updated_at` trigger is created for import_batches, for the same
-- reason: unlike implementations/client_pipeline (raw-SQL-only, nothing
-- else would ever set updated_at), Prisma Client itself sets @updatedAt
-- on every UPDATE it issues — exactly how uploads.updated_at already
-- works with zero DB trigger today.
--
-- organisation_id has NO explicit ON DELETE clause (defaults to NO
-- ACTION) — deliberately NOT the CASCADE used by uploads.organisation_id.
-- import_batches anchors a durable external Blob object via storage_key;
-- a synchronous CASCADE on organisation deletion would hard-delete this
-- row (and lose storage_key) before any tombstone-first Blob-cleanup
-- step could run, permanently orphaning the object with no way to find
-- it again. This matches implementations.organisation_id's existing NO
-- ACTION convention (scripts/create-implementations.sql) for the same
-- "external resource lineage must fail loudly, not silently cascade"
-- reason: deleting an organisation with attached import_batches rows
-- must fail until they are explicitly tombstoned/deleted first.

CREATE TABLE IF NOT EXISTS import_batches (
  id                      TEXT        PRIMARY KEY,
  organisation_id         TEXT        NOT NULL REFERENCES organisations(id),
  uploaded_by             TEXT        REFERENCES users(id) ON DELETE SET NULL,
  original_filename       TEXT        NOT NULL,
  content_type            TEXT        NOT NULL
                            CHECK (content_type IN ('csv', 'xls', 'xlsx')),
  size_bytes              INTEGER     NOT NULL,
  -- Server-computed, authoritative. Never accepted from a client.
  sha256                  TEXT        NOT NULL CHECK (char_length(sha256) = 64),
  storage_provider        TEXT        NOT NULL,
  -- Immutable, server-generated locator. Never client-controlled.
  storage_key             TEXT        NOT NULL,
  storage_etag            TEXT,
  -- Physical-file/storage/inspection lifecycle ONLY — worksheet-level
  -- aggregate outcomes (partial/complete) are derived from child uploads
  -- rows at read time, never stored here.
  status                  TEXT        NOT NULL DEFAULT 'AWAITING_UPLOAD'
                            CHECK (status IN (
                              'AWAITING_UPLOAD', 'PROCESSING', 'READY',
                              'FAILED', 'DELETION_PENDING'
                            )),
  -- Tenant-scoped start-upload idempotency (see UNIQUE below). NULL for
  -- a request that didn't supply one — many NULLs per tenant are allowed
  -- (Postgres UNIQUE treats each NULL as distinct from every other NULL).
  idempotency_key         TEXT,
  -- Client-declared, NON-authoritative — a hint only, never trusted for
  -- integrity. `sha256` above is the sole server-computed authoritative
  -- value; these two columns must never be confused for one another.
  expected_sha256         TEXT        CHECK (expected_sha256 IS NULL OR char_length(expected_sha256) = 64),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Tombstone lifecycle support (delete/cron behaviour implemented in a
  -- later slice, not here) — deleted_at marks intent-to-delete and blocks
  -- new confirmations; storage_deletion_status/storage_deleted_at track
  -- the separate, possibly-retried Blob-side deletion outcome, so
  -- storage_key is retained until that succeeds.
  deleted_at              TIMESTAMPTZ,
  storage_deletion_status TEXT        CHECK (storage_deletion_status IS NULL OR storage_deletion_status IN ('PENDING', 'DELETED', 'FAILED')),
  storage_deleted_at      TIMESTAMPTZ,

  -- Required by the composite tenant-scoped FK from `uploads` below —
  -- makes it structurally impossible for a worksheet row to reference an
  -- import_batches row belonging to a different organisation_id.
  UNIQUE (id, organisation_id),
  UNIQUE (storage_key),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_import_batches_org_created ON import_batches(organisation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_import_batches_status      ON import_batches(status);

-- ─── Additive canonical worksheet-lineage columns on the existing
-- `uploads` table. All NULL/defaulted for every existing row — zero
-- backfill required. A row with lineage_kind = 'DATA_HUB' is a canonical
-- worksheet within import_batch_id; a legacy row (lineage_kind =
-- 'LEGACY', the default) is entirely unaffected by every column below.

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS import_batch_id TEXT;

-- Zero-based, authoritative — matches lib/data-hub/workbookParser.ts's
-- decodeWorksheet contract exactly. worksheet_name is descriptive only.
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS worksheet_index INTEGER;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS worksheet_name TEXT;

-- 'visible' | 'hidden' | 'veryHidden' — a parser fact, not a policy
-- decision (see 5A.1 ADR §5).
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS worksheet_visibility TEXT
  CHECK (worksheet_visibility IS NULL OR worksheet_visibility IN ('visible', 'hidden', 'veryHidden'));

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS worksheet_is_empty BOOLEAN;

-- The discriminator. NOT NULL with a safe default so no row is ever
-- ambiguous about which lineage it belongs to.
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS lineage_kind TEXT NOT NULL DEFAULT 'LEGACY'
  CHECK (lineage_kind IN ('LEGACY', 'DATA_HUB'));

-- Canonical durable worksheet lifecycle only — deliberately NOT the same
-- vocabulary as the legacy `status` enum column, and deliberately
-- excludes IMPORTING (no durable in-progress state; see 5A.2 Pass 3 §M —
-- eliminating the stuck-IMPORTING defect structurally, not renaming it).
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS canonical_status TEXT
  CHECK (canonical_status IS NULL OR canonical_status IN (
    'AWAITING_CONFIRMATION', 'INELIGIBLE', 'SKIPPED', 'IMPORTED'
  ));

-- Retry/attempt history, kept separate from canonical_status so a
-- pre-transaction validation/mapping failure can never be confused with
-- a partially-committed domain import.
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS last_failure_code TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS last_failure_message TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS last_failure_retryable BOOLEAN;

-- Canonical worksheet identity. A unique INDEX (not a named constraint)
-- is used here specifically because CREATE INDEX supports IF NOT EXISTS
-- natively in Postgres, unlike ADD CONSTRAINT — this keeps the statement
-- trivially idempotent. Functionally identical to a UNIQUE constraint.
-- import_batch_id/worksheet_index are NULL on every legacy row, and
-- Postgres's standard uniqueness semantics treat each NULL as distinct,
-- so all legacy rows coexist under this index without conflict; only two
-- genuinely-identical canonical (import_batch_id, worksheet_index) pairs
-- are ever rejected.
CREATE UNIQUE INDEX IF NOT EXISTS uploads_import_batch_worksheet_key
  ON uploads (import_batch_id, worksheet_index);

-- Composite tenant-scoped FK — Postgres has no "ADD CONSTRAINT IF NOT
-- EXISTS", so this is guarded explicitly to stay idempotent. A MATCH
-- SIMPLE foreign key (Postgres's default) is satisfied trivially for any
-- row where import_batch_id IS NULL — i.e. every legacy row is entirely
-- exempt from this check. For a canonical row (both columns set), this
-- makes it structurally impossible to reference an import_batches row
-- belonging to a different organisation_id — not merely an
-- application-level equality check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uploads_import_batch_org_fkey'
  ) THEN
    ALTER TABLE uploads
      ADD CONSTRAINT uploads_import_batch_org_fkey
      FOREIGN KEY (import_batch_id, organisation_id)
      REFERENCES import_batches (id, organisation_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_uploads_import_batch ON uploads(import_batch_id);

-- Rollback (not run automatically — keep for reference if this needs to
-- be reverted):
--   ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_import_batch_org_fkey;
--   DROP INDEX IF EXISTS idx_uploads_import_batch;
--   DROP INDEX IF EXISTS uploads_import_batch_worksheet_key;
--   ALTER TABLE uploads
--     DROP COLUMN IF EXISTS import_batch_id,
--     DROP COLUMN IF EXISTS worksheet_index,
--     DROP COLUMN IF EXISTS worksheet_name,
--     DROP COLUMN IF EXISTS worksheet_visibility,
--     DROP COLUMN IF EXISTS worksheet_is_empty,
--     DROP COLUMN IF EXISTS lineage_kind,
--     DROP COLUMN IF EXISTS canonical_status,
--     DROP COLUMN IF EXISTS last_attempt_at,
--     DROP COLUMN IF EXISTS attempt_count,
--     DROP COLUMN IF EXISTS last_failure_code,
--     DROP COLUMN IF EXISTS last_failure_message,
--     DROP COLUMN IF EXISTS last_failure_retryable;
--   DROP TABLE IF EXISTS import_batches;
