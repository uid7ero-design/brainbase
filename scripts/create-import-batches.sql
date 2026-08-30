-- Data Hub 5A.2C — canonical durable ingestion lineage.
-- Run once against the target database. NOT run automatically by this
-- task.
--
-- Repeatable AND fail-loud, by construction. Every column/CHECK/unique
-- constraint/unique index/foreign key below is handled by a single
-- pg_temp.ensure_*() call that either:
--   (a) creates the exact expected object, if genuinely absent — which
--       fails normally and loudly if pre-existing data violates it
--       (e.g. ADD COLUMN ... NOT NULL on a table with existing rows,
--       or ADD CONSTRAINT ... CHECK (...) on rows that violate it), or
--   (b) validates the exact expected definition, if already present,
--       and RAISEs if it differs.
-- There is no third code path and no boolean return value a caller
-- could discard: ensure_*() returns void and either leaves the
-- invariant holding or raises. This directly replaces an earlier
-- revision (5A.2C-R1) that validated a pre-existing table's objects via
-- boolean-returning assert_*() calls invoked with PERFORM — silently
-- discarding "this required object does not exist at all" as a
-- passing result. A single uniform ensure_*() sequence now runs
-- unconditionally, whether import_batches is brand new or pre-existing,
-- rather than branching into a "CREATE whole table" path and a
-- separate, weaker "validate existing table" path.
--
-- Every DDL target and catalog lookup is schema-qualified as
-- public.<table> — this migration never relies on search_path.
--
-- Creates:
--   public.import_batches — one physical uploaded file / storage+
--     inspection event (see
--     docs/architecture/decisions/0001-data-hub-ingestion-foundation.md).
--   Additive, nullable canonical worksheet-lineage columns on the
--     existing public.uploads table — the existing seven domain FK
--     relations are untouched and keep pointing at valid uploads rows,
--     canonical or legacy.
--
-- Column/id convention: TEXT ids with NO database-side default —
-- matches uploads.id's own convention (Prisma Client supplies cuid()
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
-- import_batches.sha256 is NULLABLE. Under the selected direct
-- browser-to-private-Blob protocol (initiate -> create pending
-- ImportBatch -> browser uploads -> finalize -> server retrieves bytes
-- -> authoritative SHA-256 computed), the authoritative hash is not yet
-- known at batch creation (status = AWAITING_UPLOAD/PROCESSING). A CHECK
-- constraint enforces the one truthful invariant that IS always true:
-- status = 'READY' requires a non-NULL sha256.
--
-- The composite tenant FK from uploads to import_batches (and both of
-- import_batches' own foreign keys) are explicitly validated as MATCH
-- SIMPLE (Postgres's default). MATCH FULL would reject any row where
-- exactly one of the two FK columns is NULL — but every legacy uploads
-- row has import_batch_id NULL and organisation_id NOT NULL, which is
-- exactly that shape. A MATCH FULL composite FK would make every
-- legacy upload row uninsertable/unupdatable.
--
-- Repeatable behavioral validation: scripts/tests/verify-import-batches-migration.sh
-- runs 11 normal-path scenarios and 15 adversarial drift scenarios
-- against a disposable, self-cleaning Docker postgres:16-alpine
-- container (`bash scripts/tests/verify-import-batches-migration.sh`).
-- No Neon/Production access, no npm dependency, no local psql client
-- required. Added in 5A.2C-R3 because static source-text containment
-- tests (tests/containment/importBatchLineageSchema.test.ts) had twice
-- missed real PostgreSQL migration regressions that only a live catalog
-- could reveal (a discardable-boolean validation bypass, and an
-- unvalidated FK match-type bypass) — this harness is the repeatable
-- artifact so that check no longer depends on ad-hoc scratch SQL.

-- ═══════════════════════════════════════════════════════════════════
-- Session-scoped validation/repair helpers (pg_temp schema). These
-- exist only for the lifetime of this psql session/connection and are
-- never persisted as permanent schema objects — no generic migration
-- framework is being introduced, just enough shared logic to avoid
-- copy-pasted catalog SQL for every one of the ~40 critical objects
-- below. Also explicitly DROPped at the end of this script as a second,
-- defensive layer in case this script is ever run over a pooled/
-- persistent connection rather than a fresh one.
-- ═══════════════════════════════════════════════════════════════════

-- Ensures one column exists with the exact expected type/nullability/
-- default contract. Absent -> executes p_add_column_sql (the caller's
-- exact ADD COLUMN statement, which fails loudly if existing rows can't
-- satisfy it). Present -> validates; RAISEs on any mismatch.
--
-- p_check_default and p_expected_default are DELIBERATELY separate
-- parameters (5A.2C-R4 fix) — collapsing "should the default be
-- checked?" into "is expected_default NULL?" is ambiguous and unsafe:
-- NULL cannot simultaneously mean both "skip this check" and "this
-- column must have NO database default" without one of those two real,
-- distinct intentions going unenforced. Concretely, an unrelated,
-- unexpected DEFAULT added out-of-band to a column that was always
-- meant to have none (e.g. import_batches.sha256 acquiring
-- DEFAULT repeat('0', 64), fabricating an authoritative hash for every
-- new row) passed silently under the old single-parameter design,
-- because NULL was being used for both meanings at once. Every
-- 5A.2C-owned column call below passes p_check_default = true; the only
-- question left per-column is whether p_expected_default is NULL
-- ("must have no database default") or an exact canonical string
-- ("must have exactly this default").
CREATE OR REPLACE FUNCTION pg_temp.ensure_column(
  p_table text, p_column text, p_expected_type text, p_expected_nullable boolean,
  p_check_default boolean, -- false = default contract intentionally out of scope for this call
  p_expected_default text, -- meaningful only when p_check_default; NULL = "must have NO database default", otherwise the exact canonical default expected
  p_add_column_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
  actual_default text;
BEGIN
  SELECT data_type, is_nullable INTO r
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column;

  IF NOT FOUND THEN
    EXECUTE p_add_column_sql;
    RETURN;
  END IF;

  IF r.data_type IS DISTINCT FROM p_expected_type THEN
    RAISE EXCEPTION 'Migration drift: public.%.% has type % but % was expected',
      p_table, p_column, r.data_type, p_expected_type;
  END IF;

  IF (r.is_nullable = 'YES') IS DISTINCT FROM p_expected_nullable THEN
    RAISE EXCEPTION 'Migration drift: public.%.% nullability is % but % was expected',
      p_table, p_column, r.is_nullable, (CASE WHEN p_expected_nullable THEN 'YES' ELSE 'NO' END);
  END IF;

  IF p_check_default THEN
    SELECT pg_get_expr(ad.adbin, ad.adrelid) INTO actual_default
      FROM pg_attrdef ad
      JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
      JOIN pg_class t ON t.oid = ad.adrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = p_table AND a.attname = p_column;

    IF actual_default IS DISTINCT FROM p_expected_default THEN
      RAISE EXCEPTION 'Migration drift: public.%.% default is % but % was expected',
        p_table, p_column, COALESCE(actual_default, 'NULL (no default)'), COALESCE(p_expected_default, 'NULL (no default)');
    END IF;
  END IF;
END;
$fn$;

-- Ensures a named CHECK constraint, scoped by (schema, table, conname).
-- A same-named CHECK on a different table is invisible to this lookup,
-- so it can never suppress or satisfy this check. Compares Postgres's
-- own canonical pg_get_constraintdef() text (deterministically
-- normalized by Postgres, not a fragile source-text/whitespace
-- comparison). Absent -> executes p_create_sql (fails loudly if
-- existing rows violate it).
CREATE OR REPLACE FUNCTION pg_temp.ensure_check(
  p_table text, p_conname text, p_expected_def text, p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  actual_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO actual_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = p_table
      AND c.conname = p_conname AND c.contype = 'c';

  IF NOT FOUND THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  IF actual_def IS DISTINCT FROM p_expected_def THEN
    RAISE EXCEPTION 'Migration drift: public.%.% CHECK constraint is "%" but "%" was expected',
      p_table, p_conname, actual_def, p_expected_def;
  END IF;
END;
$fn$;

-- Ensures a named UNIQUE constraint, scoped by (schema, table, conname).
CREATE OR REPLACE FUNCTION pg_temp.ensure_unique_constraint(
  p_table text, p_conname text, p_expected_def text, p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  actual_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO actual_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = p_table
      AND c.conname = p_conname AND c.contype = 'u';

  IF NOT FOUND THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  IF actual_def IS DISTINCT FROM p_expected_def THEN
    RAISE EXCEPTION 'Migration drift: public.%.% UNIQUE constraint is "%" but "%" was expected',
      p_table, p_conname, actual_def, p_expected_def;
  END IF;
END;
$fn$;

-- Ensures the table's PRIMARY KEY is on exactly the expected column(s),
-- structurally (pg_constraint contype='p' + pg_attribute), not by
-- constraint name (Postgres auto-names PKs, and semantics — which
-- column(s) — matter more than the cosmetic name). Absent -> executes
-- p_create_sql, which fails loudly if existing id values are NULL or
-- duplicated.
CREATE OR REPLACE FUNCTION pg_temp.ensure_primary_key(
  p_table text, p_expected_cols text[], p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
  actual_cols text[];
BEGIN
  SELECT c.conkey, c.conrelid INTO r
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = p_table AND c.contype = 'p';

  IF NOT FOUND THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  SELECT array_agg(a.attname ORDER BY ord.n) INTO actual_cols
    FROM unnest(r.conkey) WITH ORDINALITY AS ord(attnum, n)
    JOIN pg_attribute a ON a.attrelid = r.conrelid AND a.attnum = ord.attnum;

  IF actual_cols IS DISTINCT FROM p_expected_cols THEN
    RAISE EXCEPTION 'Migration drift: public.% PRIMARY KEY is on % but % was expected',
      p_table, actual_cols, p_expected_cols;
  END IF;
END;
$fn$;

-- Ensures a named foreign key, scoped by (schema, table, conname) —
-- structural comparison (ordered source columns, referenced table/
-- schema, ordered referenced columns, ON DELETE/UPDATE, match type),
-- not string text, so formatting differences can't hide a real semantic
-- difference and a same-named FK on a DIFFERENT table can never satisfy
-- or block this. Explicitly requires MATCH SIMPLE ('s') — MATCH FULL
-- ('f') would reject any row where exactly one FK column is NULL, which
-- describes every legitimate legacy uploads row. Also requires
-- convalidated (a NOT VALID foreign key — one added with the exact
-- right shape but skipping the creation-time full-table scan — can
-- coexist indefinitely with a pre-existing row that already violates
-- it; Postgres enforces it only for rows written AFTER it was added,
-- not retroactively, so accepting it here would let the migration
-- report success while referential integrity is silently broken for
-- data that predates the constraint).
CREATE OR REPLACE FUNCTION pg_temp.ensure_fk(
  p_table text, p_conname text,
  p_expected_source_cols text[], p_expected_ref_table text, p_expected_ref_cols text[],
  p_expected_ondelete char, p_expected_onupdate char,
  p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
  source_cols text[];
  ref_cols text[];
BEGIN
  SELECT c.confdeltype, c.confupdtype, c.confmatchtype, c.conkey, c.confkey, c.confrelid, c.conrelid, c.convalidated
    INTO r
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = p_table
      AND c.conname = p_conname AND c.contype = 'f';

  IF NOT FOUND THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  IF NOT r.convalidated THEN
    RAISE EXCEPTION 'Migration drift: public.%.% exists but is NOT VALID — it was never confirmed against pre-existing rows and may not actually hold',
      p_table, p_conname;
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

  IF r.confmatchtype IS DISTINCT FROM 's' THEN
    RAISE EXCEPTION 'Migration drift: public.%.% match type is % but MATCH SIMPLE (s) was expected — MATCH FULL would reject legitimate rows where only one FK column is NULL',
      p_table, p_conname, r.confmatchtype;
  END IF;
END;
$fn$;

-- Ensures a UNIQUE INDEX (not a named CONSTRAINT), scoped by (schema,
-- table, index name), via pg_index/pg_class structural catalog fields:
-- uniqueness, ordered columns, no partial predicate, no expression
-- columns. A same-named NON-UNIQUE index, or one with the wrong
-- columns, is rejected rather than silently accepted.
CREATE OR REPLACE FUNCTION pg_temp.ensure_unique_index(
  p_table text, p_index_name text, p_expected_cols text[], p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
  actual_cols text[];
BEGIN
  SELECT i.indrelid, i.indisunique, i.indpred, i.indexprs, i.indkey
    INTO r
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = ic.relnamespace
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE n.nspname = 'public' AND ic.relname = p_index_name AND t.relname = p_table;

  IF NOT FOUND THEN
    EXECUTE p_create_sql;
    RETURN;
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
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════
-- public.import_batches
-- ═══════════════════════════════════════════════════════════════════

-- Minimal, always-safe bootstrap: a zero-column table if genuinely new,
-- a no-op if it already exists in any shape. Every column below is then
-- independently ensured — there is no separate "whole table" branch.
CREATE TABLE IF NOT EXISTS public.import_batches ();

SELECT pg_temp.ensure_column('import_batches', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('import_batches', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('import_batches', 'uploaded_by', 'text', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN uploaded_by TEXT');
SELECT pg_temp.ensure_column('import_batches', 'original_filename', 'text', false, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN original_filename TEXT NOT NULL');
SELECT pg_temp.ensure_column('import_batches', 'content_type', 'text', false, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN content_type TEXT NOT NULL');
SELECT pg_temp.ensure_column('import_batches', 'size_bytes', 'integer', false, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN size_bytes INTEGER NOT NULL');
SELECT pg_temp.ensure_column('import_batches', 'sha256', 'text', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN sha256 TEXT');
SELECT pg_temp.ensure_column('import_batches', 'storage_provider', 'text', false, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN storage_provider TEXT NOT NULL');
SELECT pg_temp.ensure_column('import_batches', 'storage_key', 'text', false, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN storage_key TEXT NOT NULL');
SELECT pg_temp.ensure_column('import_batches', 'storage_etag', 'text', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN storage_etag TEXT');
SELECT pg_temp.ensure_column('import_batches', 'status', 'text', false, true, '''AWAITING_UPLOAD''::text',
  'ALTER TABLE public.import_batches ADD COLUMN status TEXT NOT NULL DEFAULT ''AWAITING_UPLOAD''');
SELECT pg_temp.ensure_column('import_batches', 'idempotency_key', 'text', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN idempotency_key TEXT');
SELECT pg_temp.ensure_column('import_batches', 'expected_sha256', 'text', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN expected_sha256 TEXT');
SELECT pg_temp.ensure_column('import_batches', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.import_batches ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
SELECT pg_temp.ensure_column('import_batches', 'updated_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.import_batches ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now()');
SELECT pg_temp.ensure_column('import_batches', 'deleted_at', 'timestamp with time zone', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN deleted_at TIMESTAMPTZ');
SELECT pg_temp.ensure_column('import_batches', 'storage_deletion_status', 'text', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN storage_deletion_status TEXT');
SELECT pg_temp.ensure_column('import_batches', 'storage_deleted_at', 'timestamp with time zone', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN storage_deleted_at TIMESTAMPTZ');

-- Data Hub 5A.2G.0 — additive attempt/failure metadata, ahead of the
-- 5A.2G.1 initiate/finalize service layer. Naming/type conventions
-- copied directly from uploads.last_attempt_at/attempt_count/
-- last_failure_code/last_failure_message/last_failure_retryable above.
SELECT pg_temp.ensure_column('import_batches', 'last_attempt_at', 'timestamp with time zone', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN last_attempt_at TIMESTAMPTZ');
SELECT pg_temp.ensure_column('import_batches', 'attempt_count', 'integer', false, true, '0',
  'ALTER TABLE public.import_batches ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0');
SELECT pg_temp.ensure_column('import_batches', 'last_failure_code', 'text', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN last_failure_code TEXT');
SELECT pg_temp.ensure_column('import_batches', 'last_failure_message', 'text', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN last_failure_message TEXT');
SELECT pg_temp.ensure_column('import_batches', 'last_failure_retryable', 'boolean', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN last_failure_retryable BOOLEAN');

SELECT pg_temp.ensure_primary_key('import_batches', ARRAY['id'],
  'ALTER TABLE public.import_batches ADD PRIMARY KEY (id)');

SELECT pg_temp.ensure_check('import_batches', 'import_batches_content_type_check',
  'CHECK ((content_type = ANY (ARRAY[''csv''::text, ''xls''::text, ''xlsx''::text])))',
  $sql$ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_content_type_check CHECK (content_type IN ('csv', 'xls', 'xlsx'))$sql$);

SELECT pg_temp.ensure_check('import_batches', 'import_batches_size_bytes_check',
  'CHECK ((size_bytes >= 0))',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_size_bytes_check CHECK (size_bytes >= 0)');

SELECT pg_temp.ensure_check('import_batches', 'import_batches_sha256_check',
  'CHECK (((sha256 IS NULL) OR (char_length(sha256) = 64)))',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_sha256_check CHECK (sha256 IS NULL OR char_length(sha256) = 64)');

SELECT pg_temp.ensure_check('import_batches', 'import_batches_status_check',
  'CHECK ((status = ANY (ARRAY[''AWAITING_UPLOAD''::text, ''PROCESSING''::text, ''READY''::text, ''FAILED''::text, ''DELETION_PENDING''::text])))',
  $sql$ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_status_check CHECK (status IN ('AWAITING_UPLOAD', 'PROCESSING', 'READY', 'FAILED', 'DELETION_PENDING'))$sql$);

SELECT pg_temp.ensure_check('import_batches', 'import_batches_expected_sha256_check',
  'CHECK (((expected_sha256 IS NULL) OR (char_length(expected_sha256) = 64)))',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_expected_sha256_check CHECK (expected_sha256 IS NULL OR char_length(expected_sha256) = 64)');

SELECT pg_temp.ensure_check('import_batches', 'import_batches_storage_deletion_status_check',
  'CHECK (((storage_deletion_status IS NULL) OR (storage_deletion_status = ANY (ARRAY[''PENDING''::text, ''DELETED''::text, ''FAILED''::text]))))',
  $sql$ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_storage_deletion_status_check CHECK (storage_deletion_status IS NULL OR storage_deletion_status IN ('PENDING', 'DELETED', 'FAILED'))$sql$);

-- READY is the one status that truthfully requires the authoritative
-- hash to be known.
SELECT pg_temp.ensure_check('import_batches', 'import_batches_ready_requires_sha256',
  'CHECK (((status <> ''READY''::text) OR (sha256 IS NOT NULL)))',
  $sql$ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_ready_requires_sha256 CHECK (status <> 'READY' OR sha256 IS NOT NULL)$sql$);

-- ═══════════════════════════════════════════════════════════════════
-- Data Hub 5A.2G.0 — attempt/failure metadata CHECK constraints.
--
-- MIGRATION SAFETY: import_batches_failure_retryable_status_check below
-- requires last_failure_retryable IS NOT NULL exactly when
-- status = 'FAILED'. A straightforward `ALTER TABLE ... ADD CONSTRAINT`
-- validates that predicate against every existing row at add-time — and
-- this table may already contain a status='FAILED' row created before
-- this migration phase ever ran, i.e. with last_failure_retryable NULL
-- (the column didn't exist yet). This was verified directly against a
-- disposable Postgres 16 container before writing this migration: a pre-
-- existing FAILED row with last_failure_retryable NULL causes a naive
-- `ADD CONSTRAINT ... CHECK (status = 'FAILED' AND last_failure_retryable
-- IS NOT NULL OR ...)` to fail with "check constraint ... is violated by
-- some row" — it does NOT succeed silently, and it does NOT skip the
-- offending row.
--
-- Chosen fix: option (a) — a minimal, targeted, self-limiting, idempotent
-- backfill of ONLY the new nullable column, for ONLY rows already in the
-- FAILED state, run once immediately before the CHECK is added. It sets
-- last_failure_retryable = true (a conservative "assume it might be
-- retryable; an operator can inspect and correct it" default — never
-- false, which would permanently foreclose a retry that might have
-- succeeded) for any row where status = 'FAILED' AND
-- last_failure_retryable IS NULL. This is NOT the general "backfill
-- meaningful data" this migration otherwise avoids: it is narrowly typed
-- to satisfy a brand-new nullability rule on a brand-new column, exactly
-- analogous to how uploads.lineage_kind/canonical_status were introduced
-- with safe defaults for existing rows in 5A.2C. The UPDATE is idempotent
-- (its own WHERE clause excludes every row it has already corrected) and
-- never touches last_failure_code/last_failure_message or any unrelated
-- column. Options (b) (NOT VALID + separate VALIDATE CONSTRAINT) and (c)
-- (a weaker predicate enforced only in application code) were considered
-- and rejected as unnecessary once (a) was confirmed safe and minimal.
--
-- Full failure-field coherence (also requiring last_failure_code/
-- last_failure_message non-NULL exactly when status='FAILED') is
-- DELIBERATELY NOT enforced by a DB CHECK in this phase: unlike a boolean
-- retryability flag, a safe backfill value for a pre-existing FAILED
-- row's code/message would mean fabricating diagnostic text that was
-- never actually recorded — a materially different (and unsafe) kind of
-- backfill from the conservative boolean default above. That coherence
-- is left to application logic in the 5A.2G.1 service layer, not a DB
-- CHECK, per option (c).
SELECT pg_temp.ensure_check('import_batches', 'import_batches_attempt_count_nonneg_check',
  'CHECK ((attempt_count >= 0))',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_attempt_count_nonneg_check CHECK (attempt_count >= 0)');

-- Targeted, idempotent, self-limiting backfill — see the migration-safety
-- note above. Must run before import_batches_failure_retryable_status_check
-- is added below.
UPDATE public.import_batches
  SET last_failure_retryable = true
  WHERE status = 'FAILED' AND last_failure_retryable IS NULL;

SELECT pg_temp.ensure_check('import_batches', 'import_batches_failure_retryable_status_check',
  'CHECK ((((status = ''FAILED''::text) AND (last_failure_retryable IS NOT NULL)) OR ((status <> ''FAILED''::text) AND (last_failure_retryable IS NULL))))',
  $sql$ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_failure_retryable_status_check CHECK (status = 'FAILED' AND last_failure_retryable IS NOT NULL OR status <> 'FAILED' AND last_failure_retryable IS NULL)$sql$);

SELECT pg_temp.ensure_check('import_batches', 'import_batches_failure_message_length_check',
  'CHECK (((last_failure_message IS NULL) OR (char_length(last_failure_message) <= 500)))',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_failure_message_length_check CHECK (last_failure_message IS NULL OR char_length(last_failure_message) <= 500)');

-- Required by the composite tenant-scoped FK from uploads below.
SELECT pg_temp.ensure_unique_constraint('import_batches', 'import_batches_id_organisation_id_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_id_organisation_id_key UNIQUE (id, organisation_id)');

SELECT pg_temp.ensure_unique_constraint('import_batches', 'import_batches_storage_key_key',
  'UNIQUE (storage_key)',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_storage_key_key UNIQUE (storage_key)');

-- Tenant-scoped start-upload idempotency. NULL keys are exempt from
-- uniqueness (Postgres treats every NULL as distinct) — many NULLs per
-- tenant are allowed.
SELECT pg_temp.ensure_unique_constraint('import_batches', 'import_batches_organisation_id_idempotency_key_key',
  'UNIQUE (organisation_id, idempotency_key)',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_organisation_id_idempotency_key_key UNIQUE (organisation_id, idempotency_key)');

SELECT pg_temp.ensure_fk('import_batches', 'import_batches_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations (id)');

SELECT pg_temp.ensure_fk('import_batches', 'import_batches_uploaded_by_fkey',
  ARRAY['uploaded_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users (id) ON DELETE SET NULL');

CREATE INDEX IF NOT EXISTS idx_import_batches_org_created ON public.import_batches(organisation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_import_batches_status      ON public.import_batches(status);

-- ═══════════════════════════════════════════════════════════════════
-- Additive canonical worksheet-lineage columns on the existing
-- public.uploads table. All NULL/defaulted for every existing row —
-- zero backfill required.
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_column('uploads', 'import_batch_id', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN import_batch_id TEXT');
SELECT pg_temp.ensure_column('uploads', 'worksheet_index', 'integer', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN worksheet_index INTEGER');
SELECT pg_temp.ensure_column('uploads', 'worksheet_name', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN worksheet_name TEXT');
SELECT pg_temp.ensure_column('uploads', 'worksheet_visibility', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN worksheet_visibility TEXT');
SELECT pg_temp.ensure_column('uploads', 'worksheet_is_empty', 'boolean', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN worksheet_is_empty BOOLEAN');
SELECT pg_temp.ensure_column('uploads', 'lineage_kind', 'text', false, true, '''LEGACY''::text',
  'ALTER TABLE public.uploads ADD COLUMN lineage_kind TEXT NOT NULL DEFAULT ''LEGACY''');
SELECT pg_temp.ensure_column('uploads', 'canonical_status', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN canonical_status TEXT');
SELECT pg_temp.ensure_column('uploads', 'last_attempt_at', 'timestamp with time zone', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN last_attempt_at TIMESTAMPTZ');
SELECT pg_temp.ensure_column('uploads', 'attempt_count', 'integer', false, true, '0',
  'ALTER TABLE public.uploads ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0');
SELECT pg_temp.ensure_column('uploads', 'last_failure_code', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN last_failure_code TEXT');
SELECT pg_temp.ensure_column('uploads', 'last_failure_message', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN last_failure_message TEXT');
SELECT pg_temp.ensure_column('uploads', 'last_failure_retryable', 'boolean', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN last_failure_retryable BOOLEAN');

SELECT pg_temp.ensure_check('uploads', 'uploads_worksheet_visibility_check',
  'CHECK (((worksheet_visibility IS NULL) OR (worksheet_visibility = ANY (ARRAY[''visible''::text, ''hidden''::text, ''veryHidden''::text]))))',
  $sql$ALTER TABLE public.uploads ADD CONSTRAINT uploads_worksheet_visibility_check CHECK (worksheet_visibility IS NULL OR worksheet_visibility IN ('visible', 'hidden', 'veryHidden'))$sql$);

SELECT pg_temp.ensure_check('uploads', 'uploads_lineage_kind_check',
  'CHECK ((lineage_kind = ANY (ARRAY[''LEGACY''::text, ''DATA_HUB''::text])))',
  $sql$ALTER TABLE public.uploads ADD CONSTRAINT uploads_lineage_kind_check CHECK (lineage_kind IN ('LEGACY', 'DATA_HUB'))$sql$);

SELECT pg_temp.ensure_check('uploads', 'uploads_canonical_status_check',
  'CHECK (((canonical_status IS NULL) OR (canonical_status = ANY (ARRAY[''AWAITING_CONFIRMATION''::text, ''INELIGIBLE''::text, ''SKIPPED''::text, ''IMPORTED''::text]))))',
  $sql$ALTER TABLE public.uploads ADD CONSTRAINT uploads_canonical_status_check CHECK (canonical_status IS NULL OR canonical_status IN ('AWAITING_CONFIRMATION', 'INELIGIBLE', 'SKIPPED', 'IMPORTED'))$sql$);

SELECT pg_temp.ensure_check('uploads', 'uploads_worksheet_index_nonneg_check',
  'CHECK (((worksheet_index IS NULL) OR (worksheet_index >= 0)))',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_worksheet_index_nonneg_check CHECK (worksheet_index IS NULL OR worksheet_index >= 0)');

SELECT pg_temp.ensure_check('uploads', 'uploads_attempt_count_nonneg_check',
  'CHECK ((attempt_count >= 0))',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_attempt_count_nonneg_check CHECK (attempt_count >= 0)');

-- Canonical row coherence: a LEGACY row carries none of the canonical
-- identity/status fields; a DATA_HUB row carries all of them. Strong
-- (not merely permissive) coherence is deliberate — no canonical rows
-- exist yet. worksheet_name/visibility/is_empty are deliberately NOT
-- required here: name is descriptive only (identity is index-based),
-- and nothing in the architecture requires visibility/emptiness to be
-- known for every canonical row.
SELECT pg_temp.ensure_check('uploads', 'uploads_lineage_coherence_check',
  'CHECK ((((lineage_kind = ''LEGACY''::text) AND (import_batch_id IS NULL) AND (worksheet_index IS NULL) AND (canonical_status IS NULL)) OR ((lineage_kind = ''DATA_HUB''::text) AND (import_batch_id IS NOT NULL) AND (worksheet_index IS NOT NULL) AND (canonical_status IS NOT NULL))))',
  $sql$ALTER TABLE public.uploads ADD CONSTRAINT uploads_lineage_coherence_check CHECK (
    (lineage_kind = 'LEGACY' AND import_batch_id IS NULL AND worksheet_index IS NULL AND canonical_status IS NULL)
    OR
    (lineage_kind = 'DATA_HUB' AND import_batch_id IS NOT NULL AND worksheet_index IS NOT NULL AND canonical_status IS NOT NULL)
  )$sql$);

-- Composite tenant-scoped FK — structurally validated (table, ordered
-- columns, reference, delete rule, MATCH SIMPLE), not name-only. A
-- MATCH SIMPLE foreign key (Postgres's default) is satisfied trivially
-- for any row where import_batch_id IS NULL — every legacy row is
-- entirely exempt from this check. For a canonical row (both columns
-- set), this makes it structurally impossible to reference an
-- import_batches row belonging to a different organisation_id.
SELECT pg_temp.ensure_fk('uploads', 'uploads_import_batch_org_fkey',
  ARRAY['import_batch_id', 'organisation_id'], 'import_batches', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_import_batch_org_fkey FOREIGN KEY (import_batch_id, organisation_id) REFERENCES public.import_batches (id, organisation_id)');

-- Worksheet identity — structurally validated unique index (uniqueness,
-- columns, no partial predicate), not a name-only guard. Postgres
-- treats each NULL as distinct, so all legacy (NULL, NULL) rows coexist
-- under this index without conflict; only two genuinely-identical
-- canonical (import_batch_id, worksheet_index) pairs are ever rejected.
SELECT pg_temp.ensure_unique_index('uploads', 'uploads_import_batch_worksheet_key',
  ARRAY['import_batch_id', 'worksheet_index'],
  'CREATE UNIQUE INDEX uploads_import_batch_worksheet_key ON public.uploads (import_batch_id, worksheet_index)');

CREATE INDEX IF NOT EXISTS idx_uploads_import_batch ON public.uploads(import_batch_id);

DROP FUNCTION IF EXISTS pg_temp.ensure_column(text, text, text, boolean, boolean, text, text);
DROP FUNCTION IF EXISTS pg_temp.ensure_check(text, text, text, text);
DROP FUNCTION IF EXISTS pg_temp.ensure_unique_constraint(text, text, text, text);
DROP FUNCTION IF EXISTS pg_temp.ensure_primary_key(text, text[], text);
DROP FUNCTION IF EXISTS pg_temp.ensure_fk(text, text, text[], text, text[], char, char, text);
DROP FUNCTION IF EXISTS pg_temp.ensure_unique_index(text, text, text[], text);

-- Rollback (not run automatically — keep for reference if this needs to
-- be reverted):
--   ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_failure_message_length_check;
--   ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_failure_retryable_status_check;
--   ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_attempt_count_nonneg_check;
--   ALTER TABLE public.import_batches
--     DROP COLUMN IF EXISTS last_attempt_at,
--     DROP COLUMN IF EXISTS attempt_count,
--     DROP COLUMN IF EXISTS last_failure_code,
--     DROP COLUMN IF EXISTS last_failure_message,
--     DROP COLUMN IF EXISTS last_failure_retryable;
--   ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_import_batch_org_fkey;
--   ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_lineage_coherence_check;
--   ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_attempt_count_nonneg_check;
--   ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_worksheet_index_nonneg_check;
--   ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_canonical_status_check;
--   ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_lineage_kind_check;
--   ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_worksheet_visibility_check;
--   DROP INDEX IF EXISTS public.idx_uploads_import_batch;
--   DROP INDEX IF EXISTS public.uploads_import_batch_worksheet_key;
--   ALTER TABLE public.uploads
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
--   DROP TABLE IF EXISTS public.import_batches;
