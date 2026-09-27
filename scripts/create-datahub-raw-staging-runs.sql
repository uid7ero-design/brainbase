-- Data Hub 6.2D4B — durable staging-run/lease foundation + circular-FK fix.
--
-- ADDITIVE + CORRECTIVE. This is a SEPARATE migration from D4A
-- (scripts/create-datahub-raw-staging.sql), which is NOT modified by this
-- file. D4A's own script remains exactly as merged.
--
-- Fixes the D4A circular-FK bug: data_hub_raw_rows_upload_profile_version_org_fkey
-- required uploads.raw_profile_version_id to already be non-NULL before any
-- raw row could be inserted, while uploads_raw_staging_coherence_check only
-- allows that column to be non-NULL as part of Upload's fully-complete
-- state. This made any multi-batch (non-single-giant-transaction) staging
-- flow structurally impossible. This migration introduces
-- data_hub_raw_staging_runs — a durable staging-attempt/lease record — and
-- re-points DataHubRawRow at it instead of at Upload's own completion state.
--
-- Creates:
--   public.data_hub_raw_staging_runs
--   public.datahub_stage_raw_batch(...)       -- atomic batch insert + lease guard
--   public.datahub_complete_raw_staging_run(...) -- atomic completion transaction
-- Adds:
--   public.data_hub_raw_rows.staging_run_id
--   public.uploads.raw_staging_run_id
-- Drops (replaced, see inline comments):
--   data_hub_raw_rows_upload_profile_version_org_fkey
--   data_hub_raw_rows_upload_source_row_key
--
-- NO SYNTHETIC BACKFILL: if data_hub_raw_rows already contains any row with
-- a NULL staging_run_id at the time this migration runs, it FAILS LOUDLY
-- and rolls back (see the precondition check in STEP 6). Legacy backfill is
-- explicitly out of scope for this migration.
--
-- Production/Preview execution remains a separate explicit gate, applied
-- independently of D4A's own application (see the 6.2D4B implementation
-- plan's deployment sequence).

BEGIN;

-- Every create-datahub-*.sql script redefines its own copies of these
-- pg_temp helpers (session-scoped; this script runs as its own psql
-- session). Copied verbatim from scripts/create-datahub-raw-staging.sql.

CREATE OR REPLACE FUNCTION pg_temp.ensure_column(
  p_table text, p_column text, p_expected_type text, p_expected_nullable boolean,
  p_check_default boolean,
  p_expected_default text,
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

-- Correction 5: reused verbatim from create-datahub-raw-staging.sql rather
-- than a bare CREATE UNIQUE INDEX IF NOT EXISTS. Compares the full stored
-- index definition (pg_get_indexdef — covers uniqueness, column list, and
-- any partial predicate in one normalized string) and RAISEs on any
-- difference, including a same-named index with the wrong predicate.
CREATE OR REPLACE FUNCTION pg_temp.ensure_index(
  p_table text, p_index_name text, p_expected_def text, p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  actual_def text;
  actual_valid boolean;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid), i.indisvalid INTO actual_def, actual_valid
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = ic.relnamespace
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE n.nspname = 'public' AND ic.relname = p_index_name AND t.relname = p_table;

  IF NOT FOUND THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  IF actual_def IS DISTINCT FROM p_expected_def THEN
    RAISE EXCEPTION 'Migration drift: index public.% is "%" but "%" was expected',
      p_index_name, actual_def, p_expected_def;
  END IF;

  IF NOT actual_valid THEN
    RAISE EXCEPTION 'Migration drift: index public.% exists but is INVALID', p_index_name;
  END IF;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1 — public.data_hub_raw_staging_runs
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.data_hub_raw_staging_runs ();

SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'import_batch_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN import_batch_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'upload_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN upload_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'source_schema_version_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN source_schema_version_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'source_schema_worksheet_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN source_schema_worksheet_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'worksheet_mapping_profile_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN worksheet_mapping_profile_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'worksheet_mapping_profile_version_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN worksheet_mapping_profile_version_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'attempt_number', 'integer', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN attempt_number INTEGER NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'source_sha256', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN source_sha256 TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'parser_version', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN parser_version TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'status', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN status TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'execution_token', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN execution_token TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'lease_expires_at', 'timestamp with time zone', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN lease_expires_at TIMESTAMPTZ NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'last_progress_at', 'timestamp with time zone', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN last_progress_at TIMESTAMPTZ NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'expected_row_count', 'integer', true, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN expected_row_count INTEGER');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'expected_cell_count', 'integer', true, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN expected_cell_count INTEGER');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'persisted_row_count', 'integer', false, true, '0',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN persisted_row_count INTEGER NOT NULL DEFAULT 0');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'persisted_cell_count', 'integer', false, true, '0',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN persisted_cell_count INTEGER NOT NULL DEFAULT 0');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'created_by', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN created_by TEXT');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'started_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN started_at TIMESTAMPTZ NOT NULL DEFAULT now()');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'completed_at', 'timestamp with time zone', true, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN completed_at TIMESTAMPTZ');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'failed_at', 'timestamp with time zone', true, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN failed_at TIMESTAMPTZ');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'failure_code', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN failure_code TEXT');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'failure_detail', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN failure_detail TEXT');
SELECT pg_temp.ensure_column('data_hub_raw_staging_runs', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('data_hub_raw_staging_runs', ARRAY['id'],
  'ALTER TABLE public.data_hub_raw_staging_runs ADD PRIMARY KEY (id)');

SELECT pg_temp.ensure_check(
  'data_hub_raw_staging_runs',
  'data_hub_raw_staging_runs_status_check',
  'CHECK ((status = ANY (ARRAY[''RUNNING''::text, ''SUCCEEDED''::text, ''FAILED''::text, ''ABANDONED''::text])))',
  $sql$ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_status_check CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED'))$sql$
);

SELECT pg_temp.ensure_check(
  'data_hub_raw_staging_runs',
  'data_hub_raw_staging_runs_attempt_positive_check',
  'CHECK ((attempt_number >= 1))',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_attempt_positive_check CHECK (attempt_number >= 1)'
);

SELECT pg_temp.ensure_check(
  'data_hub_raw_staging_runs',
  'data_hub_raw_staging_runs_counts_nonneg_check',
  'CHECK ((((expected_row_count IS NULL) OR (expected_row_count >= 0)) AND ((expected_cell_count IS NULL) OR (expected_cell_count >= 0)) AND (persisted_row_count >= 0) AND (persisted_cell_count >= 0)))',
  $sql$ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_counts_nonneg_check CHECK (
    (expected_row_count IS NULL OR expected_row_count >= 0)
    AND (expected_cell_count IS NULL OR expected_cell_count >= 0)
    AND persisted_row_count >= 0
    AND persisted_cell_count >= 0
  )$sql$
);

-- Each terminal status carries exactly its own matching timestamp/code, and
-- no run in a non-terminal state has any of them set.
SELECT pg_temp.ensure_check(
  'data_hub_raw_staging_runs',
  'data_hub_raw_staging_runs_completion_coherence_check',
  'CHECK ((((status = ''SUCCEEDED''::text) = (completed_at IS NOT NULL)) AND ((status = ''FAILED''::text) = ((failed_at IS NOT NULL) AND (failure_code IS NOT NULL))) AND ((status = ANY (ARRAY[''RUNNING''::text, ''ABANDONED''::text])) = ((completed_at IS NULL) AND (failed_at IS NULL) AND (failure_code IS NULL)))))',
  $sql$ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_completion_coherence_check CHECK (
    (status = 'SUCCEEDED') = (completed_at IS NOT NULL)
    AND (status = 'FAILED') = (failed_at IS NOT NULL AND failure_code IS NOT NULL)
    AND (status IN ('RUNNING', 'ABANDONED')) = (completed_at IS NULL AND failed_at IS NULL AND failure_code IS NULL)
  )$sql$
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_staging_runs',
  'data_hub_raw_staging_runs_id_organisation_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_id_organisation_key UNIQUE (id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_staging_runs',
  'data_hub_raw_staging_runs_id_upload_organisation_key',
  'UNIQUE (id, upload_id, organisation_id)',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_id_upload_organisation_key UNIQUE (id, upload_id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_staging_runs',
  'data_hub_raw_staging_runs_id_profile_version_organisation_key',
  'UNIQUE (id, worksheet_mapping_profile_version_id, organisation_id)',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_id_profile_version_organisation_key UNIQUE (id, worksheet_mapping_profile_version_id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_staging_runs',
  'data_hub_raw_staging_runs_upload_attempt_key',
  'UNIQUE (upload_id, attempt_number)',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_upload_attempt_key UNIQUE (upload_id, attempt_number)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_staging_runs', 'data_hub_raw_staging_runs_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_staging_runs', 'data_hub_raw_staging_runs_batch_schema_org_fkey',
  ARRAY['import_batch_id', 'source_schema_version_id', 'organisation_id'],
  'import_batches', ARRAY['id', 'source_schema_version_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_batch_schema_org_fkey FOREIGN KEY (import_batch_id, source_schema_version_id, organisation_id) REFERENCES public.import_batches(id, source_schema_version_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_staging_runs', 'data_hub_raw_staging_runs_upload_batch_org_fkey',
  ARRAY['upload_id', 'import_batch_id', 'organisation_id'],
  'uploads', ARRAY['id', 'import_batch_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_upload_batch_org_fkey FOREIGN KEY (upload_id, import_batch_id, organisation_id) REFERENCES public.uploads(id, import_batch_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_staging_runs', 'data_hub_raw_staging_runs_schema_worksheet_fkey',
  ARRAY['source_schema_worksheet_id', 'source_schema_version_id', 'organisation_id'],
  'source_schema_worksheets', ARRAY['id', 'source_schema_version_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_schema_worksheet_fkey FOREIGN KEY (source_schema_worksheet_id, source_schema_version_id, organisation_id) REFERENCES public.source_schema_worksheets(id, source_schema_version_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_staging_runs', 'data_hub_raw_staging_runs_mapping_profile_fkey',
  ARRAY['worksheet_mapping_profile_id', 'source_schema_worksheet_id', 'organisation_id'],
  'worksheet_mapping_profiles', ARRAY['id', 'source_schema_worksheet_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_mapping_profile_fkey FOREIGN KEY (worksheet_mapping_profile_id, source_schema_worksheet_id, organisation_id) REFERENCES public.worksheet_mapping_profiles(id, source_schema_worksheet_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_staging_runs', 'data_hub_raw_staging_runs_mapping_profile_version_fkey',
  ARRAY['worksheet_mapping_profile_version_id', 'worksheet_mapping_profile_id', 'organisation_id'],
  'worksheet_mapping_profile_versions', ARRAY['id', 'worksheet_mapping_profile_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_mapping_profile_version_fkey FOREIGN KEY (worksheet_mapping_profile_version_id, worksheet_mapping_profile_id, organisation_id) REFERENCES public.worksheet_mapping_profile_versions(id, worksheet_mapping_profile_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_staging_runs', 'data_hub_raw_staging_runs_created_by_fkey',
  ARRAY['created_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.data_hub_raw_staging_runs ADD CONSTRAINT data_hub_raw_staging_runs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL'
);

-- Correction 5 — single-active-run-per-upload, drift-checked via
-- ensure_index (not a bare CREATE UNIQUE INDEX IF NOT EXISTS). A same-named
-- index with the wrong columns/predicate makes the migration fail loudly.
SELECT pg_temp.ensure_index(
  'data_hub_raw_staging_runs',
  'data_hub_raw_staging_runs_one_active_per_upload',
  'CREATE UNIQUE INDEX data_hub_raw_staging_runs_one_active_per_upload ON public.data_hub_raw_staging_runs USING btree (upload_id) WHERE (status = ''RUNNING''::text)',
  $sql$CREATE UNIQUE INDEX data_hub_raw_staging_runs_one_active_per_upload ON public.data_hub_raw_staging_runs (upload_id) WHERE (status = 'RUNNING')$sql$
);

CREATE INDEX IF NOT EXISTS idx_data_hub_raw_staging_runs_org_batch ON public.data_hub_raw_staging_runs(organisation_id, import_batch_id);
CREATE INDEX IF NOT EXISTS idx_data_hub_raw_staging_runs_upload ON public.data_hub_raw_staging_runs(upload_id);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2 — lifecycle/lease trigger.
--
-- Correction 2: the actor-deletion transition (created_by non-null -> null)
-- is its own UNCONDITIONAL branch, checked FIRST, before any status-based
-- branch, and applies identically whether OLD.status is RUNNING or
-- terminal. It never requires an ordinary lease/status update alongside it.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.datahub_guard_raw_staging_run_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'data_hub_raw_staging_runs: staging-run evidence is immutable; DELETE is not permitted (id=%)', OLD.id;
  END IF;

  -- Correction 2: actor-deletion cascade — permitted unconditionally,
  -- regardless of status, as long as EVERY other column (including status
  -- and all terminal-state fields) is unchanged. Checked before any
  -- status-transition branch below.
  IF OLD.created_by IS NOT NULL
     AND NEW.created_by IS NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.organisation_id IS NOT DISTINCT FROM OLD.organisation_id
     AND NEW.import_batch_id IS NOT DISTINCT FROM OLD.import_batch_id
     AND NEW.upload_id IS NOT DISTINCT FROM OLD.upload_id
     AND NEW.source_schema_version_id IS NOT DISTINCT FROM OLD.source_schema_version_id
     AND NEW.source_schema_worksheet_id IS NOT DISTINCT FROM OLD.source_schema_worksheet_id
     AND NEW.worksheet_mapping_profile_id IS NOT DISTINCT FROM OLD.worksheet_mapping_profile_id
     AND NEW.worksheet_mapping_profile_version_id IS NOT DISTINCT FROM OLD.worksheet_mapping_profile_version_id
     AND NEW.attempt_number IS NOT DISTINCT FROM OLD.attempt_number
     AND NEW.source_sha256 IS NOT DISTINCT FROM OLD.source_sha256
     AND NEW.parser_version IS NOT DISTINCT FROM OLD.parser_version
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.execution_token IS NOT DISTINCT FROM OLD.execution_token
     AND NEW.lease_expires_at IS NOT DISTINCT FROM OLD.lease_expires_at
     AND NEW.last_progress_at IS NOT DISTINCT FROM OLD.last_progress_at
     AND NEW.expected_row_count IS NOT DISTINCT FROM OLD.expected_row_count
     AND NEW.expected_cell_count IS NOT DISTINCT FROM OLD.expected_cell_count
     AND NEW.persisted_row_count IS NOT DISTINCT FROM OLD.persisted_row_count
     AND NEW.persisted_cell_count IS NOT DISTINCT FROM OLD.persisted_cell_count
     AND NEW.started_at IS NOT DISTINCT FROM OLD.started_at
     AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at
     AND NEW.failed_at IS NOT DISTINCT FROM OLD.failed_at
     AND NEW.failure_code IS NOT DISTINCT FROM OLD.failure_code
     AND NEW.failure_detail IS NOT DISTINCT FROM OLD.failure_detail
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;

  -- Every other UPDATE requires OLD.status = 'RUNNING' — once terminal, the
  -- row is otherwise fully immutable (actor-deletion above is the only
  -- exception, from any status).
  IF OLD.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'data_hub_raw_staging_runs: run is % (terminal) and immutable except for actor deletion (id=%)', OLD.status, OLD.id;
  END IF;

  -- Every identity/pin column is immutable for the life of the row,
  -- regardless of which RUNNING-state transition follows.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id
     OR NEW.upload_id IS DISTINCT FROM OLD.upload_id
     OR NEW.source_schema_version_id IS DISTINCT FROM OLD.source_schema_version_id
     OR NEW.source_schema_worksheet_id IS DISTINCT FROM OLD.source_schema_worksheet_id
     OR NEW.worksheet_mapping_profile_id IS DISTINCT FROM OLD.worksheet_mapping_profile_id
     OR NEW.worksheet_mapping_profile_version_id IS DISTINCT FROM OLD.worksheet_mapping_profile_version_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
     OR NEW.parser_version IS DISTINCT FROM OLD.parser_version
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'data_hub_raw_staging_runs: identity/pin columns are immutable (id=%)', OLD.id;
  END IF;

  IF NEW.status = 'RUNNING' THEN
    -- Lease renewal/takeover, or a batch's progress update. Progress
    -- counters may only move upward.
    IF NEW.persisted_row_count < OLD.persisted_row_count OR NEW.persisted_cell_count < OLD.persisted_cell_count THEN
      RAISE EXCEPTION 'data_hub_raw_staging_runs: persisted counts may never decrease (id=%)', OLD.id;
    END IF;
    IF NEW.expected_row_count IS DISTINCT FROM OLD.expected_row_count
       OR NEW.expected_cell_count IS DISTINCT FROM OLD.expected_cell_count
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.failed_at IS DISTINCT FROM OLD.failed_at
       OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
       OR NEW.failure_detail IS DISTINCT FROM OLD.failure_detail THEN
      RAISE EXCEPTION 'data_hub_raw_staging_runs: only lease/progress columns may change while RUNNING (id=%)', OLD.id;
    END IF;
    RETURN NEW;
  ELSIF NEW.status = 'SUCCEEDED' THEN
    IF NEW.completed_at IS NULL OR NEW.failed_at IS NOT NULL OR NEW.failure_code IS NOT NULL THEN
      RAISE EXCEPTION 'data_hub_raw_staging_runs: malformed SUCCEEDED transition (id=%)', OLD.id;
    END IF;
    RETURN NEW;
  ELSIF NEW.status = 'FAILED' THEN
    IF NEW.failed_at IS NULL OR NEW.failure_code IS NULL OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'data_hub_raw_staging_runs: malformed FAILED transition (id=%)', OLD.id;
    END IF;
    RETURN NEW;
  ELSIF NEW.status = 'ABANDONED' THEN
    -- Reserved for a future reaper; no D4B runtime path takes this branch.
    IF NEW.completed_at IS NOT NULL OR NEW.failed_at IS NOT NULL THEN
      RAISE EXCEPTION 'data_hub_raw_staging_runs: malformed ABANDONED transition (id=%)', OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'data_hub_raw_staging_runs: unrecognized status transition % -> % (id=%)', OLD.status, NEW.status, OLD.id;
END;
$fn$;

DROP TRIGGER IF EXISTS data_hub_raw_staging_runs_lifecycle_guard ON public.data_hub_raw_staging_runs;
CREATE TRIGGER data_hub_raw_staging_runs_lifecycle_guard
  BEFORE UPDATE OR DELETE ON public.data_hub_raw_staging_runs
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_raw_staging_run_lifecycle();

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3 — data_hub_raw_rows.staging_run_id + the circular-FK fix.
-- ═══════════════════════════════════════════════════════════════════

-- staging_run_id is added nullable-then-tightened (a genuine two-phase
-- column, unlike every other ensure_column call in this file), so it is
-- deliberately NOT managed end-to-end by ensure_column's own single-phase
-- drift check (which would otherwise see nullable=YES on a first run and
-- nullable=NO on every subsequent idempotent rerun, and misreport that as
-- drift). This plain existence-only idempotent add is intentional.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'data_hub_raw_rows' AND column_name = 'staging_run_id'
  ) THEN
    ALTER TABLE public.data_hub_raw_rows ADD COLUMN staging_run_id TEXT;
  END IF;
END $$;

-- Correction 7 / no synthetic backfill: FAIL LOUDLY (RAISE, rollback) if any
-- pre-existing row cannot receive a staging_run_id. Given Production has 0
-- schema-pinned ImportBatch rows at the time this migration was authored
-- (and therefore 0 data_hub_raw_rows), this is a guaranteed no-op there —
-- it exists to protect any other environment (e.g. a disposable/staging DB
-- that already exercised D4A's own fixtures) from a silent, incorrect
-- NOT NULL backfill.
DO $$
DECLARE
  legacy_count integer;
BEGIN
  SELECT count(*) INTO legacy_count FROM public.data_hub_raw_rows WHERE staging_run_id IS NULL;
  IF legacy_count > 0 THEN
    RAISE EXCEPTION
      'D4B migration precondition failed: % row(s) in data_hub_raw_rows have a NULL staging_run_id. Backfill is explicitly out of scope for this migration. Resolve manually (in a disposable/test database, delete the offending rows; in any environment with real evidence, a separate, explicitly authorized backfill script is required) before re-running this migration.',
      legacy_count;
  END IF;
END $$;

-- Idempotent regardless of current state: a no-op if already NOT NULL.
ALTER TABLE public.data_hub_raw_rows ALTER COLUMN staging_run_id SET NOT NULL;

-- Final-state drift check, run AFTER the column is guaranteed NOT NULL —
-- this is the one point where ensure_column's own single-phase semantics
-- correctly apply (the column's expected final shape never changes again
-- after this).
SELECT pg_temp.ensure_column('data_hub_raw_rows', 'staging_run_id', 'text', false, false, NULL, '');

-- Drops D4A's circular FK: it required uploads.raw_profile_version_id to
-- already be non-NULL before any raw row could be inserted, while
-- uploads_raw_staging_coherence_check only allows that column non-NULL as
-- part of Upload's fully-complete state. See this file's header comment.
ALTER TABLE public.data_hub_raw_rows DROP CONSTRAINT IF EXISTS data_hub_raw_rows_upload_profile_version_org_fkey;

-- Drops D4A's per-upload row-number uniqueness (blocked any retry from
-- reusing row numbers after a partial failure). Replaced below by a
-- per-run uniqueness.
ALTER TABLE public.data_hub_raw_rows DROP CONSTRAINT IF EXISTS data_hub_raw_rows_upload_source_row_key;

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_rows',
  'data_hub_raw_rows_staging_run_source_row_key',
  'UNIQUE (staging_run_id, source_row_number)',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_staging_run_source_row_key UNIQUE (staging_run_id, source_row_number)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_rows', 'data_hub_raw_rows_staging_run_profile_version_fkey',
  ARRAY['staging_run_id', 'organisation_id'],
  'data_hub_raw_staging_runs', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_staging_run_profile_version_fkey FOREIGN KEY (staging_run_id, organisation_id) REFERENCES public.data_hub_raw_staging_runs(id, organisation_id)'
);

-- Proves this row's own denormalized upload_id agrees with the run's own
-- upload_id — a DB-level-only invariant, deliberately not modeled as a
-- second Prisma relation (see prisma/schema.prisma's own comment there).
SELECT pg_temp.ensure_fk(
  'data_hub_raw_rows', 'data_hub_raw_rows_staging_run_upload_fkey',
  ARRAY['staging_run_id', 'upload_id', 'organisation_id'],
  'data_hub_raw_staging_runs', ARRAY['id', 'upload_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_staging_run_upload_fkey FOREIGN KEY (staging_run_id, upload_id, organisation_id) REFERENCES public.data_hub_raw_staging_runs(id, upload_id, organisation_id)'
);

-- Proves this row's own worksheet_mapping_profile_version_id agrees with
-- the run's pinned profile version — the run's own pin is immutable
-- (enforced by the lifecycle trigger above), so this makes it structurally
-- impossible for a row to claim a different profile version than the run
-- that produced it.
SELECT pg_temp.ensure_fk(
  'data_hub_raw_rows', 'data_hub_raw_rows_staging_run_pinned_version_fkey',
  ARRAY['staging_run_id', 'worksheet_mapping_profile_version_id', 'organisation_id'],
  'data_hub_raw_staging_runs', ARRAY['id', 'worksheet_mapping_profile_version_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_staging_run_pinned_version_fkey FOREIGN KEY (staging_run_id, worksheet_mapping_profile_version_id, organisation_id) REFERENCES public.data_hub_raw_staging_runs(id, worksheet_mapping_profile_version_id, organisation_id)'
);

CREATE INDEX IF NOT EXISTS idx_data_hub_raw_rows_staging_run ON public.data_hub_raw_rows(staging_run_id);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 4 — uploads.raw_staging_run_id.
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_column('uploads', 'raw_staging_run_id', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN raw_staging_run_id TEXT');

SELECT pg_temp.ensure_fk(
  'uploads', 'uploads_raw_staging_run_org_fkey',
  ARRAY['raw_staging_run_id', 'organisation_id'],
  'data_hub_raw_staging_runs', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_raw_staging_run_org_fkey FOREIGN KEY (raw_staging_run_id, organisation_id) REFERENCES public.data_hub_raw_staging_runs(id, organisation_id)'
);

-- Proves the pointed-to run really belongs to THIS upload's own id — a
-- DB-level-only invariant (see prisma/schema.prisma's own comment there).
SELECT pg_temp.ensure_fk(
  'uploads', 'uploads_raw_staging_run_upload_fkey',
  ARRAY['raw_staging_run_id', 'id', 'organisation_id'],
  'data_hub_raw_staging_runs', ARRAY['id', 'upload_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_raw_staging_run_upload_fkey FOREIGN KEY (raw_staging_run_id, id, organisation_id) REFERENCES public.data_hub_raw_staging_runs(id, upload_id, organisation_id)'
);

-- Extend D4A's coherence check to include raw_staging_run_id in lockstep
-- with the other five fields. Drop-and-recreate under the SAME name (no
-- ensure_check drift-diff-and-replace exists; a precondition guard runs
-- first so no existing row can silently violate the new predicate).
DO $$
DECLARE
  violation_count integer;
BEGIN
  SELECT count(*) INTO violation_count
    FROM public.uploads
    WHERE (raw_staged_at IS NULL) IS DISTINCT FROM (raw_staging_run_id IS NULL);
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'D4B migration precondition failed: % row(s) in uploads have raw_staged_at/raw_staging_run_id out of coherence. Resolve manually before re-running this migration.',
      violation_count;
  END IF;
END $$;

ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_raw_staging_coherence_check;

SELECT pg_temp.ensure_check(
  'uploads',
  'uploads_raw_staging_coherence_check',
  'CHECK ((((raw_staged_at IS NULL) AND (raw_staged_by IS NULL) AND (raw_profile_version_id IS NULL) AND (raw_row_count IS NULL) AND (raw_cell_count IS NULL) AND (raw_staging_run_id IS NULL)) OR ((raw_staged_at IS NOT NULL) AND (raw_profile_version_id IS NOT NULL) AND (raw_row_count IS NOT NULL) AND (raw_cell_count IS NOT NULL) AND (raw_staging_run_id IS NOT NULL) AND (lineage_kind = ''DATA_HUB''::text))))',
  $sql$ALTER TABLE public.uploads ADD CONSTRAINT uploads_raw_staging_coherence_check CHECK (
    (
      raw_staged_at IS NULL
      AND raw_staged_by IS NULL
      AND raw_profile_version_id IS NULL
      AND raw_row_count IS NULL
      AND raw_cell_count IS NULL
      AND raw_staging_run_id IS NULL
    )
    OR
    (
      raw_staged_at IS NOT NULL
      AND raw_profile_version_id IS NOT NULL
      AND raw_row_count IS NOT NULL
      AND raw_cell_count IS NOT NULL
      AND raw_staging_run_id IS NOT NULL
      AND lineage_kind = 'DATA_HUB'
    )
  )$sql$
);

-- Extend D4A's one-way-completion trigger function (CREATE OR REPLACE onto
-- the SAME name; D4A's own trigger on uploads already calls this function,
-- so no new CREATE TRIGGER is needed) to also freeze raw_staging_run_id —
-- with NO exception at all (unlike raw_staged_by): the run row it points
-- to can never be deleted (its own lifecycle trigger rejects every
-- DELETE), so there is no legitimate path back to NULL once set.
CREATE OR REPLACE FUNCTION public.datahub_guard_upload_raw_staging_metadata()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.raw_staged_at IS NULL THEN
    IF NEW.raw_staged_at IS NULL THEN
      RETURN NEW;
    END IF;

    IF NEW.raw_staged_by IS NULL THEN
      RAISE EXCEPTION 'uploads: initial raw staging completion requires raw_staged_by (upload=%)', OLD.id;
    END IF;
    IF NEW.raw_staging_run_id IS NULL THEN
      RAISE EXCEPTION 'uploads: initial raw staging completion requires raw_staging_run_id (upload=%)', OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.raw_staged_at IS DISTINCT FROM OLD.raw_staged_at
     OR NEW.raw_profile_version_id IS DISTINCT FROM OLD.raw_profile_version_id
     OR NEW.raw_row_count IS DISTINCT FROM OLD.raw_row_count
     OR NEW.raw_cell_count IS DISTINCT FROM OLD.raw_cell_count
     OR NEW.raw_staging_run_id IS DISTINCT FROM OLD.raw_staging_run_id THEN
    RAISE EXCEPTION 'uploads: raw staging metadata is immutable once completed (upload=%)', OLD.id;
  END IF;

  IF NEW.raw_staged_by IS DISTINCT FROM OLD.raw_staged_by THEN
    IF NOT (OLD.raw_staged_by IS NOT NULL AND NEW.raw_staged_by IS NULL) THEN
      RAISE EXCEPTION 'uploads: raw_staged_by cannot be rewritten after staging completion (upload=%)', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 5 — datahub_stage_raw_batch(...): the atomic batch-commit primitive.
--
-- Correction 1 (remediation): within one statement's implicit transaction —
--   1. atomically verify AND RENEW lease ownership (staging_run_id,
--      organisation_id, status='RUNNING', execution_token=p_execution_token,
--      AND lease_expires_at > now() — an EXPIRED token is not ownership,
--      even if the token string still matches: someone else may already
--      be entitled to take this run over). On success, extends
--      lease_expires_at by p_lease_seconds (the single authoritative lease
--      duration, passed in by the caller rather than hard-coded here — see
--      lib/data-hub/staging/stagingConfig.ts for the one real source of
--      truth). If this does not affect exactly 1 row: RAISE (rolls back
--      everything this function has done so far — nothing has been
--      inserted yet).
--   2. bulk-insert DataHubRawRow rows.
--   3. bulk-insert DataHubRawCell rows.
--   4. re-verify the SAME lease (status/token/lease_expires_at > now())
--      while recording progress. If this does not affect exactly 1 row:
--      RAISE — rolls back the entire statement, INCLUDING the row/cell
--      inserts from steps 2-3. Returning a partial/LEASE_LOST result after
--      committing partial evidence is impossible by construction: a RAISE
--      here undoes everything in this same statement.
--   Only if both lease checks pass does this function return normally,
--   and the caller's single query commits.
--
-- Correction 4: cell identity (source_schema_column_id, column_ordinal,
-- source_header, sensitivity_class) is NEVER inferred positionally by this
-- function — every cell in p_rows already carries its own exact governed
-- values, resolved by the caller from the governed column list (ordinals
-- may be non-contiguous and need not start at 0).
--
-- p_rows shape (jsonb array):
--   [{ "id": "...", "sourceRowNumber": 12,
--      "cells": [{ "id": "...", "sourceSchemaColumnId": "...",
--                  "columnOrdinal": 4, "sourceHeader": "...",
--                  "sensitivityClass": "...", "rawValue": <json scalar>,
--                  "rawValueType": "STRING", "originalUnit": null }] }]
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.datahub_stage_raw_batch(text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.datahub_stage_raw_batch(
  p_staging_run_id text,
  p_organisation_id text,
  p_execution_token text,
  p_rows jsonb,
  p_lease_seconds integer
) RETURNS TABLE(inserted_row_count integer, inserted_cell_count integer)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_lease_rows int;
  v_progress_rows int;
  v_row_count int;
  v_cell_count int;
  v_import_batch_id text;
  v_upload_id text;
  v_source_schema_version_id text;
  v_source_schema_worksheet_id text;
  v_worksheet_mapping_profile_id text;
  v_worksheet_mapping_profile_version_id text;
  v_created_by text;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 THEN
    RAISE EXCEPTION 'datahub_stage_raw_batch: p_lease_seconds must be a positive integer (got %)', p_lease_seconds;
  END IF;

  -- Step 1 (remediation): verify AND RENEW the lease BEFORE any evidence
  -- insert. An expired lease (lease_expires_at <= now()) is treated exactly
  -- like a wrong token — it is not ownership, regardless of whether the
  -- token string still matches (a stale worker resuming after its own
  -- lease lapsed must not be able to keep writing).
  UPDATE public.data_hub_raw_staging_runs
  SET lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_progress_at = now()
  WHERE id = p_staging_run_id AND organisation_id = p_organisation_id
    AND status = 'RUNNING' AND execution_token = p_execution_token
    AND lease_expires_at > now()
  RETURNING import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id,
            worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, created_by
    INTO v_import_batch_id, v_upload_id, v_source_schema_version_id, v_source_schema_worksheet_id,
         v_worksheet_mapping_profile_id, v_worksheet_mapping_profile_version_id, v_created_by;
  GET DIAGNOSTICS v_lease_rows = ROW_COUNT;
  IF v_lease_rows <> 1 THEN
    RAISE EXCEPTION 'datahub_stage_raw_batch: lease not held before insert (staging_run_id=%, expected exactly 1 row, got %)',
      p_staging_run_id, v_lease_rows;
  END IF;

  -- Step 2: bulk-insert rows.
  INSERT INTO public.data_hub_raw_rows (
    id, organisation_id, import_batch_id, upload_id, source_schema_version_id,
    source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id,
    staging_run_id, source_row_number, created_by, created_at
  )
  SELECT
    r ->> 'id', p_organisation_id, v_import_batch_id, v_upload_id, v_source_schema_version_id,
    v_source_schema_worksheet_id, v_worksheet_mapping_profile_id, v_worksheet_mapping_profile_version_id,
    p_staging_run_id, (r ->> 'sourceRowNumber')::int, v_created_by, now()
  FROM jsonb_array_elements(p_rows) AS r;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  -- Step 3: bulk-insert cells — every identity field taken verbatim from
  -- the caller-supplied, already-resolved governed column values (never
  -- inferred positionally; correction 4).
  INSERT INTO public.data_hub_raw_cells (
    id, organisation_id, raw_row_id, source_schema_worksheet_id,
    source_schema_column_id, column_ordinal, source_header,
    raw_value, raw_value_type, sensitivity_class, original_unit, created_at
  )
  SELECT
    c ->> 'id', p_organisation_id, r ->> 'id', v_source_schema_worksheet_id,
    c ->> 'sourceSchemaColumnId', (c ->> 'columnOrdinal')::int, c ->> 'sourceHeader',
    c -> 'rawValue', c ->> 'rawValueType', c ->> 'sensitivityClass', c ->> 'originalUnit', now()
  FROM jsonb_array_elements(p_rows) AS r,
       jsonb_array_elements(r -> 'cells') AS c;
  GET DIAGNOSTICS v_cell_count = ROW_COUNT;

  -- Step 4 (correction 1): re-verify the SAME lease while recording
  -- progress. A mismatch here RAISEs, which rolls back this ENTIRE
  -- statement — including the inserts above. Never return LEASE_LOST after
  -- allowing inserts to commit.
  UPDATE public.data_hub_raw_staging_runs
  SET persisted_row_count = persisted_row_count + v_row_count,
      persisted_cell_count = persisted_cell_count + v_cell_count,
      last_progress_at = now()
  WHERE id = p_staging_run_id AND organisation_id = p_organisation_id
    AND status = 'RUNNING' AND execution_token = p_execution_token
    AND lease_expires_at > now();
  GET DIAGNOSTICS v_progress_rows = ROW_COUNT;
  IF v_progress_rows <> 1 THEN
    RAISE EXCEPTION 'datahub_stage_raw_batch: lease lost before progress commit (staging_run_id=%, expected exactly 1 row, got %)',
      p_staging_run_id, v_progress_rows;
  END IF;

  RETURN QUERY SELECT v_row_count, v_cell_count;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 6 — datahub_complete_raw_staging_run(...): the atomic completion
-- transaction. Reconciles counts server-side and transitions the run to
-- SUCCEEDED together with Upload's own completion metadata, in one
-- statement. p_completed_by is the AUTHENTICATED ACTOR COMPLETING THE RUN
-- (correction 3) — NEVER the run's own created_by (the run's own creator
-- may have been deleted; completion must still succeed).
--
-- Does NOT re-verify the source SHA-256 against blob storage — that
-- requires a network fetch this SQL function cannot perform and must be
-- done by the caller (lib/data-hub/staging/completionGate.ts) immediately
-- before calling this function, inside the same logical request.
--
-- Remediation (point 4): completion now REQUIRES lease ownership —
-- p_execution_token must match the run's current token, status must still
-- be RUNNING, and lease_expires_at must not have passed. A caller whose
-- lease has already lapsed (even if nobody else has taken it over yet)
-- cannot complete the run — completeStagingRun's own TS-level pre-check
-- (lib/data-hub/staging/completionGate.ts) already screens for this
-- before ever calling here; this is the authoritative, non-bypassable
-- enforcement of the same rule at the database layer.
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.datahub_complete_raw_staging_run(text, text, text);

CREATE OR REPLACE FUNCTION public.datahub_complete_raw_staging_run(
  p_staging_run_id text,
  p_organisation_id text,
  p_completed_by text,
  p_execution_token text
) RETURNS TABLE(row_count integer, cell_count integer)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_run RECORD;
  v_actual_row_count int;
  v_actual_cell_count int;
  v_completion_rows int;
BEGIN
  SELECT * INTO v_run
    FROM public.data_hub_raw_staging_runs
    WHERE id = p_staging_run_id AND organisation_id = p_organisation_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'datahub_complete_raw_staging_run: run not found (staging_run_id=%)', p_staging_run_id;
  END IF;
  IF v_run.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'datahub_complete_raw_staging_run: run is not RUNNING (staging_run_id=%, status=%)', p_staging_run_id, v_run.status;
  END IF;
  IF v_run.execution_token IS DISTINCT FROM p_execution_token THEN
    RAISE EXCEPTION 'datahub_complete_raw_staging_run: caller does not hold the current lease token (staging_run_id=%)', p_staging_run_id;
  END IF;
  IF v_run.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'datahub_complete_raw_staging_run: lease has expired (staging_run_id=%)', p_staging_run_id;
  END IF;
  IF v_run.expected_row_count IS NULL OR v_run.expected_cell_count IS NULL THEN
    RAISE EXCEPTION 'datahub_complete_raw_staging_run: run has no expected counts (staging_run_id=%)', p_staging_run_id;
  END IF;

  SELECT count(*) INTO v_actual_row_count FROM public.data_hub_raw_rows WHERE staging_run_id = p_staging_run_id;
  SELECT count(*) INTO v_actual_cell_count
    FROM public.data_hub_raw_cells c JOIN public.data_hub_raw_rows r ON r.id = c.raw_row_id
    WHERE r.staging_run_id = p_staging_run_id;

  IF v_actual_row_count <> v_run.expected_row_count OR v_actual_row_count <> v_run.persisted_row_count THEN
    RAISE EXCEPTION 'datahub_complete_raw_staging_run: row count mismatch (staging_run_id=%, actual=%, expected=%, persisted=%)',
      p_staging_run_id, v_actual_row_count, v_run.expected_row_count, v_run.persisted_row_count;
  END IF;
  IF v_actual_cell_count <> v_run.expected_cell_count OR v_actual_cell_count <> v_run.persisted_cell_count THEN
    RAISE EXCEPTION 'datahub_complete_raw_staging_run: cell count mismatch (staging_run_id=%, actual=%, expected=%, persisted=%)',
      p_staging_run_id, v_actual_cell_count, v_run.expected_cell_count, v_run.persisted_cell_count;
  END IF;

  UPDATE public.data_hub_raw_staging_runs
  SET status = 'SUCCEEDED', completed_at = now()
  WHERE id = p_staging_run_id AND organisation_id = p_organisation_id AND status = 'RUNNING';

  -- Correction 3: raw_staged_by is the AUTHENTICATED COMPLETING actor
  -- (p_completed_by), never v_run.created_by.
  UPDATE public.uploads
  SET raw_staged_at = now(),
      raw_staged_by = p_completed_by,
      raw_profile_version_id = v_run.worksheet_mapping_profile_version_id,
      raw_row_count = v_run.expected_row_count,
      raw_cell_count = v_run.expected_cell_count,
      raw_staging_run_id = p_staging_run_id
  WHERE id = v_run.upload_id AND organisation_id = p_organisation_id AND raw_staged_at IS NULL;
  GET DIAGNOSTICS v_completion_rows = ROW_COUNT;
  IF v_completion_rows <> 1 THEN
    RAISE EXCEPTION 'datahub_complete_raw_staging_run: upload completion write did not match exactly 1 row (staging_run_id=%, upload_id=%)',
      p_staging_run_id, v_run.upload_id;
  END IF;

  RETURN QUERY SELECT v_actual_row_count, v_actual_cell_count;
END;
$fn$;

COMMIT;

-- Rollback is deliberately manual and not executed automatically — see
-- scripts/rollback-datahub-raw-staging-runs.sql for the exact guarded
-- rollback SQL (correction 6): it aborts if data_hub_raw_staging_runs
-- contains any row, and restores D4A's original coherence check, trigger
-- function body, and dropped constraints verbatim.
