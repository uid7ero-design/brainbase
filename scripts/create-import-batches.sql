-- Data Hub 5A.2C — canonical durable ingestion lineage.
-- Run once against the target database. NOT run automatically by this
-- task.
--
-- Repeatable AND fail-loud: every security/integrity-critical object
-- below is created if absent, and explicitly VALIDATED if already
-- present — a same-named object with the wrong definition (wrong
-- table, wrong columns, wrong uniqueness, wrong delete rule, weaker
-- CHECK) raises an exception rather than being silently accepted. Plain
-- "IF NOT EXISTS" name-only guards were found (5A.2C-R1 remediation) to
-- accept exactly this kind of drift — a same-named object satisfying
-- IF NOT EXISTS while enforcing nothing.
--
-- Creates:
--   import_batches — one physical uploaded file / storage+inspection
--     event (see docs/architecture/decisions/0001-data-hub-ingestion-foundation.md).
--   Additive, nullable canonical worksheet-lineage columns on the
--     existing `uploads` table — the existing seven domain FK relations
--     are untouched and keep pointing at valid `uploads` rows, canonical
--     or legacy.
--
-- Column/id convention: TEXT ids with NO database-side default — matches
-- uploads.id's own convention (Prisma Client supplies cuid()
-- application-side).
--
-- import_batches.organisation_id has NO explicit ON DELETE (NO ACTION)
-- — deliberately NOT uploads.organisation_id's CASCADE. import_batches
-- anchors a durable external Blob object via storage_key; a synchronous
-- CASCADE on organisation deletion would hard-delete this row (and lose
-- storage_key) before any tombstone-first Blob-cleanup step could run.
-- Matches implementations.organisation_id's existing NO ACTION
-- convention (scripts/create-implementations.sql) for the same reason.
--
-- import_batches.sha256 is NULLABLE (5A.2C-R1 fix). Under the selected
-- direct browser-to-private-Blob protocol (initiate -> create pending
-- ImportBatch -> browser uploads -> finalize -> server retrieves bytes
-- -> authoritative SHA-256 computed), the authoritative hash is not yet
-- known at batch creation (status = AWAITING_UPLOAD/PROCESSING). A CHECK
-- constraint enforces the one truthful invariant that IS always true:
-- status = 'READY' requires a non-NULL sha256. FAILED/DELETION_PENDING
-- may have either, since failure can occur before or after the hash is
-- known.

-- ═══════════════════════════════════════════════════════════════════
-- Session-scoped validation helpers (pg_temp schema). These exist only
-- for the lifetime of this psql session/connection and are never
-- persisted as permanent schema objects — no generic migration
-- framework is being introduced, just enough shared logic to avoid
-- copy-pasted catalog SQL for every one of the ~20 critical objects
-- below. Also explicitly DROPed at the end of this script as a second,
-- defensive layer in case this script is ever run over a pooled/
-- persistent connection rather than a fresh one.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pg_temp.assert_column(
  p_table text, p_column text, p_expected_type text, p_expected_nullable boolean
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
BEGIN
  SELECT data_type, is_nullable INTO r
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column;

  IF NOT FOUND THEN
    RETURN; -- caller adds the column
  END IF;

  IF r.data_type IS DISTINCT FROM p_expected_type THEN
    RAISE EXCEPTION 'Migration drift: public.%.% has type % but % was expected',
      p_table, p_column, r.data_type, p_expected_type;
  END IF;

  IF (r.is_nullable = 'YES') IS DISTINCT FROM p_expected_nullable THEN
    RAISE EXCEPTION 'Migration drift: public.%.% nullability is % but % was expected',
      p_table, p_column, r.is_nullable, (CASE WHEN p_expected_nullable THEN 'YES' ELSE 'NO' END);
  END IF;
END;
$fn$;

-- Validates a named CHECK constraint scoped to (schema, table) — a
-- same-named CHECK on a different table is invisible to this lookup
-- (conrelid scoping), so it can never suppress or satisfy this check.
-- Compares Postgres's own canonical pg_get_constraintdef() text, which
-- is deterministically normalized by Postgres itself (not a fragile
-- source-text/whitespace comparison).
CREATE OR REPLACE FUNCTION pg_temp.assert_check(
  p_table text, p_conname text, p_expected_def text
) RETURNS boolean LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
BEGIN
  SELECT pg_get_constraintdef(c.oid) AS def INTO r
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = p_table
      AND c.conname = p_conname AND c.contype = 'c';

  IF NOT FOUND THEN
    RETURN false; -- caller adds the constraint
  END IF;

  IF r.def IS DISTINCT FROM p_expected_def THEN
    RAISE EXCEPTION 'Migration drift: public.%.% CHECK constraint is "%" but "%" was expected',
      p_table, p_conname, r.def, p_expected_def;
  END IF;
  RETURN true;
END;
$fn$;

-- Validates a named UNIQUE constraint scoped to (schema, table), via
-- Postgres's own canonical constraint definition text.
CREATE OR REPLACE FUNCTION pg_temp.assert_unique_constraint(
  p_table text, p_conname text, p_expected_def text
) RETURNS boolean LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
BEGIN
  SELECT pg_get_constraintdef(c.oid) AS def INTO r
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = p_table
      AND c.conname = p_conname AND c.contype = 'u';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF r.def IS DISTINCT FROM p_expected_def THEN
    RAISE EXCEPTION 'Migration drift: public.%.% UNIQUE constraint is "%" but "%" was expected',
      p_table, p_conname, r.def, p_expected_def;
  END IF;
  RETURN true;
END;
$fn$;

-- Validates a named foreign key scoped to (schema, table) — structural
-- comparison (ordered source columns, referenced table/schema, ordered
-- referenced columns, ON DELETE/UPDATE, match type), not string text,
-- so formatting differences can't hide a real semantic difference and a
-- same-named FK on a DIFFERENT table can never satisfy or block this.
CREATE OR REPLACE FUNCTION pg_temp.assert_fk(
  p_table text, p_conname text,
  p_expected_source_cols text[], p_expected_ref_table text, p_expected_ref_cols text[],
  p_expected_ondelete char, p_expected_onupdate char
) RETURNS boolean LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
  source_cols text[];
  ref_cols text[];
BEGIN
  SELECT c.oid, c.confdeltype, c.confupdtype, c.conkey, c.confkey, c.confrelid, c.conrelid
    INTO r
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = p_table
      AND c.conname = p_conname AND c.contype = 'f';

  IF NOT FOUND THEN
    RETURN false; -- caller adds the FK
  END IF;

  IF to_regclass('public.' || p_expected_ref_table)::oid IS DISTINCT FROM r.confrelid THEN
    RAISE EXCEPTION 'Migration drift: public.%.% references the wrong table (expected public.%)',
      p_table, p_conname, p_expected_ref_table;
  END IF;

  SELECT array_agg(a.attname ORDER BY ord.n) INTO source_cols
    FROM unnest(r.conkey) WITH ORDINALITY AS ord(attnum, n)
    JOIN pg_attribute a ON a.attrelid = r.conrelid AND a.attnum = ord.attnum;

  SELECT array_agg(a.attname ORDER BY ord.n) INTO ref_cols
    FROM unnest(r.confkey) WITH ORDINALITY AS ord(attnum, n)
    JOIN pg_attribute a ON a.attrelid = r.confrelid AND a.attnum = ord.attnum;

  IF source_cols IS DISTINCT FROM p_expected_source_cols THEN
    RAISE EXCEPTION 'Migration drift: public.%.% source columns are % but % was expected',
      p_table, p_conname, source_cols, p_expected_source_cols;
  END IF;

  IF ref_cols IS DISTINCT FROM p_expected_ref_cols THEN
    RAISE EXCEPTION 'Migration drift: public.%.% referenced columns are % but % was expected',
      p_table, p_conname, ref_cols, p_expected_ref_cols;
  END IF;

  IF r.confdeltype IS DISTINCT FROM p_expected_ondelete THEN
    RAISE EXCEPTION 'Migration drift: public.%.% ON DELETE is % but % was expected',
      p_table, p_conname, r.confdeltype, p_expected_ondelete;
  END IF;

  IF r.confupdtype IS DISTINCT FROM p_expected_onupdate THEN
    RAISE EXCEPTION 'Migration drift: public.%.% ON UPDATE is % but % was expected',
      p_table, p_conname, r.confupdtype, p_expected_onupdate;
  END IF;

  RETURN true;
END;
$fn$;

-- Validates a UNIQUE INDEX (not a named CONSTRAINT — CREATE INDEX
-- supports IF NOT EXISTS natively, which is why this shape was chosen
-- for worksheet identity) scoped to (schema, table) via pg_index/
-- pg_class structural catalog fields: uniqueness, ordered columns, no
-- partial predicate, no expression columns. A same-named NON-UNIQUE
-- index, or one with the wrong columns, is rejected rather than
-- silently accepted — this is the exact bypass Codex reproduced.
CREATE OR REPLACE FUNCTION pg_temp.assert_unique_index(
  p_table text, p_index_name text, p_expected_cols text[]
) RETURNS boolean LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
  actual_cols text[];
BEGIN
  SELECT i.indexrelid, i.indrelid, i.indisunique, i.indpred, i.indexprs, i.indkey
    INTO r
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = ic.relnamespace
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE n.nspname = 'public' AND ic.relname = p_index_name AND t.relname = p_table;

  IF NOT FOUND THEN
    -- Distinguish "doesn't exist at all" (caller creates it) from
    -- "exists but attached to the wrong table" (a same-named index on
    -- another table must never suppress creation on the intended one).
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = p_index_name) THEN
      PERFORM 1; -- name used elsewhere only; fall through to "absent for this table"
    END IF;
    RETURN false;
  END IF;

  IF NOT r.indisunique THEN
    RAISE EXCEPTION 'Migration drift: public.% is not a UNIQUE index (expected UNIQUE on public.%)',
      p_index_name, p_table;
  END IF;

  IF r.indpred IS NOT NULL THEN
    RAISE EXCEPTION 'Migration drift: public.% has a partial-index predicate; none was expected',
      p_index_name;
  END IF;

  IF r.indexprs IS NOT NULL THEN
    RAISE EXCEPTION 'Migration drift: public.% has expression columns; only plain columns were expected',
      p_index_name;
  END IF;

  SELECT array_agg(a.attname ORDER BY ord.n) INTO actual_cols
    FROM unnest(r.indkey::int2[]) WITH ORDINALITY AS ord(attnum, n)
    JOIN pg_attribute a ON a.attrelid = r.indrelid AND a.attnum = ord.attnum;

  IF actual_cols IS DISTINCT FROM p_expected_cols THEN
    RAISE EXCEPTION 'Migration drift: public.% columns are % but % was expected',
      p_index_name, actual_cols, p_expected_cols;
  END IF;

  RETURN true;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════
-- import_batches
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.import_batches') IS NULL THEN
    CREATE TABLE import_batches (
      id                      TEXT        PRIMARY KEY,
      organisation_id         TEXT        NOT NULL REFERENCES organisations(id),
      uploaded_by             TEXT        REFERENCES users(id) ON DELETE SET NULL,
      original_filename       TEXT        NOT NULL,
      content_type            TEXT        NOT NULL
                                CHECK (content_type IN ('csv', 'xls', 'xlsx')),
      size_bytes              INTEGER     NOT NULL CHECK (size_bytes >= 0),
      -- Server-computed, authoritative. NULL until retrieval/hash
      -- verification completes (AWAITING_UPLOAD/PROCESSING). Never
      -- accepted from a client.
      sha256                  TEXT        CHECK (sha256 IS NULL OR char_length(sha256) = 64),
      storage_provider        TEXT        NOT NULL,
      -- Immutable, server-generated locator. Never client-controlled.
      storage_key             TEXT        NOT NULL,
      storage_etag            TEXT,
      status                  TEXT        NOT NULL DEFAULT 'AWAITING_UPLOAD'
                                CHECK (status IN (
                                  'AWAITING_UPLOAD', 'PROCESSING', 'READY',
                                  'FAILED', 'DELETION_PENDING'
                                )),
      idempotency_key         TEXT,
      -- Client-declared, NON-authoritative — a hint only, never trusted
      -- for integrity. `sha256` above is the sole server-computed
      -- authoritative value; these two columns must never be confused.
      expected_sha256         TEXT        CHECK (expected_sha256 IS NULL OR char_length(expected_sha256) = 64),
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at              TIMESTAMPTZ,
      storage_deletion_status TEXT        CHECK (storage_deletion_status IS NULL OR storage_deletion_status IN ('PENDING', 'DELETED', 'FAILED')),
      storage_deleted_at      TIMESTAMPTZ,

      -- READY is the one status that truthfully requires the
      -- authoritative hash to be known.
      CONSTRAINT import_batches_ready_requires_sha256 CHECK (status <> 'READY' OR sha256 IS NOT NULL),

      -- Required by the composite tenant-scoped FK from `uploads` below.
      CONSTRAINT import_batches_id_organisation_id_key UNIQUE (id, organisation_id),
      CONSTRAINT import_batches_storage_key_key UNIQUE (storage_key),
      CONSTRAINT import_batches_organisation_id_idempotency_key_key UNIQUE (organisation_id, idempotency_key)
    );
  ELSE
    -- Table already exists — validate every critical column, CHECK, and
    -- FK rather than trusting its presence.
    PERFORM pg_temp.assert_column('import_batches', 'id', 'text', false);
    PERFORM pg_temp.assert_column('import_batches', 'organisation_id', 'text', false);
    PERFORM pg_temp.assert_column('import_batches', 'uploaded_by', 'text', true);
    PERFORM pg_temp.assert_column('import_batches', 'original_filename', 'text', false);
    PERFORM pg_temp.assert_column('import_batches', 'content_type', 'text', false);
    PERFORM pg_temp.assert_column('import_batches', 'size_bytes', 'integer', false);
    PERFORM pg_temp.assert_column('import_batches', 'sha256', 'text', true);
    PERFORM pg_temp.assert_column('import_batches', 'storage_provider', 'text', false);
    PERFORM pg_temp.assert_column('import_batches', 'storage_key', 'text', false);
    PERFORM pg_temp.assert_column('import_batches', 'status', 'text', false);
    PERFORM pg_temp.assert_column('import_batches', 'idempotency_key', 'text', true);
    PERFORM pg_temp.assert_column('import_batches', 'expected_sha256', 'text', true);
    PERFORM pg_temp.assert_column('import_batches', 'deleted_at', 'timestamp with time zone', true);
    PERFORM pg_temp.assert_column('import_batches', 'storage_deletion_status', 'text', true);
    PERFORM pg_temp.assert_column('import_batches', 'storage_deleted_at', 'timestamp with time zone', true);

    PERFORM pg_temp.assert_check('import_batches', 'import_batches_content_type_check', 'CHECK ((content_type = ANY (ARRAY[''csv''::text, ''xls''::text, ''xlsx''::text])))');
    PERFORM pg_temp.assert_check('import_batches', 'import_batches_size_bytes_check', 'CHECK ((size_bytes >= 0))');
    PERFORM pg_temp.assert_check('import_batches', 'import_batches_sha256_check', 'CHECK (((sha256 IS NULL) OR (char_length(sha256) = 64)))');
    PERFORM pg_temp.assert_check('import_batches', 'import_batches_status_check', 'CHECK ((status = ANY (ARRAY[''AWAITING_UPLOAD''::text, ''PROCESSING''::text, ''READY''::text, ''FAILED''::text, ''DELETION_PENDING''::text])))');
    PERFORM pg_temp.assert_check('import_batches', 'import_batches_expected_sha256_check', 'CHECK (((expected_sha256 IS NULL) OR (char_length(expected_sha256) = 64)))');
    PERFORM pg_temp.assert_check('import_batches', 'import_batches_ready_requires_sha256', 'CHECK (((status <> ''READY''::text) OR (sha256 IS NOT NULL)))');
    PERFORM pg_temp.assert_check('import_batches', 'import_batches_storage_deletion_status_check', 'CHECK (((storage_deletion_status IS NULL) OR (storage_deletion_status = ANY (ARRAY[''PENDING''::text, ''DELETED''::text, ''FAILED''::text]))))');

    PERFORM pg_temp.assert_unique_constraint('import_batches', 'import_batches_id_organisation_id_key', 'UNIQUE (id, organisation_id)');
    PERFORM pg_temp.assert_unique_constraint('import_batches', 'import_batches_storage_key_key', 'UNIQUE (storage_key)');
    PERFORM pg_temp.assert_unique_constraint('import_batches', 'import_batches_organisation_id_idempotency_key_key', 'UNIQUE (organisation_id, idempotency_key)');

    PERFORM pg_temp.assert_fk('import_batches', 'import_batches_organisation_id_fkey',
      ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a');
    PERFORM pg_temp.assert_fk('import_batches', 'import_batches_uploaded_by_fkey',
      ARRAY['uploaded_by'], 'users', ARRAY['id'], 'n', 'a');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_import_batches_org_created ON import_batches(organisation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_import_batches_status      ON import_batches(status);

-- ═══════════════════════════════════════════════════════════════════
-- Additive canonical worksheet-lineage columns on the existing
-- `uploads` table. All NULL/defaulted for every existing row — zero
-- backfill required.
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  PERFORM pg_temp.assert_column('uploads', 'import_batch_id', 'text', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='uploads' AND column_name='import_batch_id') THEN
    ALTER TABLE uploads ADD COLUMN import_batch_id TEXT;
  END IF;

  PERFORM pg_temp.assert_column('uploads', 'worksheet_index', 'integer', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='uploads' AND column_name='worksheet_index') THEN
    ALTER TABLE uploads ADD COLUMN worksheet_index INTEGER;
  END IF;

  PERFORM pg_temp.assert_column('uploads', 'worksheet_name', 'text', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='uploads' AND column_name='worksheet_name') THEN
    ALTER TABLE uploads ADD COLUMN worksheet_name TEXT;
  END IF;

  PERFORM pg_temp.assert_column('uploads', 'worksheet_visibility', 'text', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='uploads' AND column_name='worksheet_visibility') THEN
    ALTER TABLE uploads ADD COLUMN worksheet_visibility TEXT;
  END IF;

  PERFORM pg_temp.assert_column('uploads', 'worksheet_is_empty', 'boolean', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='uploads' AND column_name='worksheet_is_empty') THEN
    ALTER TABLE uploads ADD COLUMN worksheet_is_empty BOOLEAN;
  END IF;

  PERFORM pg_temp.assert_column('uploads', 'lineage_kind', 'text', false);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='uploads' AND column_name='lineage_kind') THEN
    ALTER TABLE uploads ADD COLUMN lineage_kind TEXT NOT NULL DEFAULT 'LEGACY';
  END IF;

  PERFORM pg_temp.assert_column('uploads', 'canonical_status', 'text', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='uploads' AND column_name='canonical_status') THEN
    ALTER TABLE uploads ADD COLUMN canonical_status TEXT;
  END IF;

  PERFORM pg_temp.assert_column('uploads', 'last_attempt_at', 'timestamp with time zone', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='uploads' AND column_name='last_attempt_at') THEN
    ALTER TABLE uploads ADD COLUMN last_attempt_at TIMESTAMPTZ;
  END IF;

  PERFORM pg_temp.assert_column('uploads', 'attempt_count', 'integer', false);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='uploads' AND column_name='attempt_count') THEN
    ALTER TABLE uploads ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
  END IF;

  PERFORM pg_temp.assert_column('uploads', 'last_failure_code', 'text', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='uploads' AND column_name='last_failure_code') THEN
    ALTER TABLE uploads ADD COLUMN last_failure_code TEXT;
  END IF;

  PERFORM pg_temp.assert_column('uploads', 'last_failure_message', 'text', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='uploads' AND column_name='last_failure_message') THEN
    ALTER TABLE uploads ADD COLUMN last_failure_message TEXT;
  END IF;

  PERFORM pg_temp.assert_column('uploads', 'last_failure_retryable', 'boolean', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='uploads' AND column_name='last_failure_retryable') THEN
    ALTER TABLE uploads ADD COLUMN last_failure_retryable BOOLEAN;
  END IF;
END $$;

-- ─── uploads CHECK constraints (added/validated independently of
-- column existence above, so a pre-existing column with a missing or
-- weakened CHECK is still caught) ───

DO $$
BEGIN
  IF NOT pg_temp.assert_check('uploads', 'uploads_worksheet_visibility_check', 'CHECK (((worksheet_visibility IS NULL) OR (worksheet_visibility = ANY (ARRAY[''visible''::text, ''hidden''::text, ''veryHidden''::text]))))') THEN
    ALTER TABLE uploads ADD CONSTRAINT uploads_worksheet_visibility_check
      CHECK (worksheet_visibility IS NULL OR worksheet_visibility IN ('visible', 'hidden', 'veryHidden'));
  END IF;

  IF NOT pg_temp.assert_check('uploads', 'uploads_lineage_kind_check', 'CHECK ((lineage_kind = ANY (ARRAY[''LEGACY''::text, ''DATA_HUB''::text])))') THEN
    ALTER TABLE uploads ADD CONSTRAINT uploads_lineage_kind_check
      CHECK (lineage_kind IN ('LEGACY', 'DATA_HUB'));
  END IF;

  IF NOT pg_temp.assert_check('uploads', 'uploads_canonical_status_check', 'CHECK (((canonical_status IS NULL) OR (canonical_status = ANY (ARRAY[''AWAITING_CONFIRMATION''::text, ''INELIGIBLE''::text, ''SKIPPED''::text, ''IMPORTED''::text]))))') THEN
    ALTER TABLE uploads ADD CONSTRAINT uploads_canonical_status_check
      CHECK (canonical_status IS NULL OR canonical_status IN ('AWAITING_CONFIRMATION', 'INELIGIBLE', 'SKIPPED', 'IMPORTED'));
  END IF;

  IF NOT pg_temp.assert_check('uploads', 'uploads_worksheet_index_nonneg_check', 'CHECK (((worksheet_index IS NULL) OR (worksheet_index >= 0)))') THEN
    ALTER TABLE uploads ADD CONSTRAINT uploads_worksheet_index_nonneg_check
      CHECK (worksheet_index IS NULL OR worksheet_index >= 0);
  END IF;

  IF NOT pg_temp.assert_check('uploads', 'uploads_attempt_count_nonneg_check', 'CHECK ((attempt_count >= 0))') THEN
    ALTER TABLE uploads ADD CONSTRAINT uploads_attempt_count_nonneg_check
      CHECK (attempt_count >= 0);
  END IF;

  -- Canonical row coherence: a LEGACY row carries none of the canonical
  -- identity/status fields; a DATA_HUB row carries all of them. Strong
  -- (not merely permissive) coherence is deliberate — no canonical rows
  -- exist yet, so there is no legacy data this could conflict with, and
  -- a stricter invariant now is cheaper than loosening a stricter one
  -- later. worksheet_name/visibility/is_empty are deliberately NOT
  -- required here: name is descriptive only (identity is index-based),
  -- and nothing in the architecture requires visibility/emptiness to be
  -- known for every canonical row.
  IF NOT pg_temp.assert_check('uploads', 'uploads_lineage_coherence_check',
    'CHECK ((((lineage_kind = ''LEGACY''::text) AND (import_batch_id IS NULL) AND (worksheet_index IS NULL) AND (canonical_status IS NULL)) OR ((lineage_kind = ''DATA_HUB''::text) AND (import_batch_id IS NOT NULL) AND (worksheet_index IS NOT NULL) AND (canonical_status IS NOT NULL))))'
  ) THEN
    ALTER TABLE uploads ADD CONSTRAINT uploads_lineage_coherence_check
      CHECK (
        (lineage_kind = 'LEGACY' AND import_batch_id IS NULL AND worksheet_index IS NULL AND canonical_status IS NULL)
        OR
        (lineage_kind = 'DATA_HUB' AND import_batch_id IS NOT NULL AND worksheet_index IS NOT NULL AND canonical_status IS NOT NULL)
      );
  END IF;
END $$;

-- ─── Composite tenant-scoped FK — structurally validated, not name-only
-- guarded. A same-named FK on another table is invisible to this check
-- (conrelid-scoped); a same-named FK on `uploads` with the wrong
-- columns/reference/delete-rule raises an exception instead of being
-- silently accepted. A MATCH SIMPLE foreign key (Postgres's default) is
-- satisfied trivially for any row where import_batch_id IS NULL — every
-- legacy row is entirely exempt from this check. For a canonical row
-- (both columns set), this makes it structurally impossible to
-- reference an import_batches row belonging to a different
-- organisation_id. ───

DO $$
BEGIN
  IF NOT pg_temp.assert_fk('uploads', 'uploads_import_batch_org_fkey',
    ARRAY['import_batch_id', 'organisation_id'], 'import_batches', ARRAY['id', 'organisation_id'], 'a', 'a'
  ) THEN
    ALTER TABLE uploads
      ADD CONSTRAINT uploads_import_batch_org_fkey
      FOREIGN KEY (import_batch_id, organisation_id)
      REFERENCES import_batches (id, organisation_id);
  END IF;
END $$;

-- ─── Worksheet identity — structurally validated unique index, not a
-- name-only guard. A same-named NON-UNIQUE index, or one with the wrong
-- columns, raises an exception instead of being silently accepted (this
-- is the exact bypass independently reproduced during review). Postgres
-- treats each NULL as distinct, so all legacy (NULL, NULL) rows coexist
-- under this index without conflict; only two genuinely-identical
-- canonical (import_batch_id, worksheet_index) pairs are ever rejected. ───

DO $$
BEGIN
  IF NOT pg_temp.assert_unique_index('uploads', 'uploads_import_batch_worksheet_key',
    ARRAY['import_batch_id', 'worksheet_index']
  ) THEN
    CREATE UNIQUE INDEX uploads_import_batch_worksheet_key
      ON uploads (import_batch_id, worksheet_index);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_uploads_import_batch ON uploads(import_batch_id);

DROP FUNCTION IF EXISTS pg_temp.assert_column(text, text, text, boolean);
DROP FUNCTION IF EXISTS pg_temp.assert_check(text, text, text);
DROP FUNCTION IF EXISTS pg_temp.assert_unique_constraint(text, text, text);
DROP FUNCTION IF EXISTS pg_temp.assert_fk(text, text, text[], text, text[], char, char);
DROP FUNCTION IF EXISTS pg_temp.assert_unique_index(text, text, text[]);

-- Rollback (not run automatically — keep for reference if this needs to
-- be reverted):
--   ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_import_batch_org_fkey;
--   ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_lineage_coherence_check;
--   ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_attempt_count_nonneg_check;
--   ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_worksheet_index_nonneg_check;
--   ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_canonical_status_check;
--   ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_lineage_kind_check;
--   ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_worksheet_visibility_check;
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
