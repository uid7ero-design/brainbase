-- Data Hub 6.2D4C-B1 — normalized-staging PERSISTENCE / LIFECYCLE
-- FOUNDATION. No transformation executes in this migration or anywhere in
-- this phase; this creates the durable structure a later executor
-- (D4C-B2) will write into.
--
-- ADDITIVE. This is a SEPARATE migration from D4A
-- (scripts/create-datahub-raw-staging.sql) and D4B
-- (scripts/create-datahub-raw-staging-runs.sql), neither of which is
-- modified by this file. Requires both to already be applied.
--
-- Trusted chain this migration extends:
--   ImportBatch -> Upload -> DataHubRawStagingRun -> DataHubRawRow -> DataHubRawCell   (D4A/D4B, untouched)
--   successful DataHubRawStagingRun -> DataHubNormalizationRun
--     -> DataHubNormalizedRow -> DataHubNormalizedCell                                 (this migration)
--
-- NON-NEGOTIABLE INVARIANTS (see 6.2D4C-B1 task spec for full rationale):
--   1. Raw evidence (data_hub_raw_cells.raw_value/raw_value_type/original_unit,
--      data_hub_raw_rows identity/lineage) is NEVER modified by this file.
--   2. Normalization is derived from PERSISTED RAW ROWS/CELLS, never a
--      workbook re-parse — nothing in this schema references a workbook.
--   3. EXACT PINNED PROFILE — a normalization run is pinned to the SAME
--      worksheet_mapping_profile_version_id its own raw_staging_run
--      carries (data_hub_normalization_runs_raw_run_pinned_version_fkey,
--      STEP 1 below). WorksheetMappingProfile.active_profile_version_id is
--      never read by anything in this file.
--   4. SEPARATE LIFECYCLE — data_hub_normalization_runs is its own table
--      with its own lease/lifecycle trigger and completion function; D4B's
--      objects are never reused or modified.
--   5. Normalized rows/cells are immutable after INSERT (UPDATE and DELETE
--      both rejected).
--
-- Creates:
--   public.data_hub_normalization_runs
--   public.data_hub_normalized_rows
--   public.data_hub_normalized_cells
--   public.datahub_guard_normalization_run_lifecycle()   -- trigger fn
--   public.datahub_guard_normalized_evidence_immutable()  -- trigger fn (rows+cells)
--   public.datahub_guard_upload_normalization_metadata()  -- trigger fn
--   public.datahub_complete_normalization_run(...)        -- atomic completion
-- Adds (additive only — see STEP 2; D4A/D4B constraints are NOT weakened):
--   public.data_hub_raw_rows:  UNIQUE (id, staging_run_id, organisation_id)
--                               UNIQUE (id, staging_run_id, source_row_number, organisation_id)
--   public.data_hub_raw_cells: UNIQUE (id, organisation_id)
--                               UNIQUE (id, raw_row_id, organisation_id)
--                               UNIQUE (id, source_schema_column_id, organisation_id)
--   public.uploads: normalized_at, normalized_by, normalized_profile_version_id,
--                    normalized_row_count, normalized_cell_count, normalization_run_id
--                    UNIQUE (id, raw_staging_run_id, organisation_id) — the
--                    authoritative-raw-run invariant (REMEDIATION, pre-PR review)
--
-- NO SYNTHETIC BACKFILL: this migration performs zero normalization writes
-- and zero backfill of any kind. uploads' new normalization columns are
-- added nullable with no default write to any existing row.
--
-- Production/Preview execution remains a separate explicit gate, applied
-- independently of D4A/D4B's own application. NOT executed by this task.

BEGIN;

-- Every create-datahub-*.sql script redefines its own copies of these
-- pg_temp helpers (session-scoped). Copied verbatim from
-- scripts/create-datahub-raw-staging-runs.sql.

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
-- PRECONDITION — D4A/D4B must already be applied.
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.data_hub_raw_staging_runs') IS NULL THEN
    RAISE EXCEPTION '6.2D4C-B1 requires the D4B foundation (data_hub_raw_staging_runs) to already exist. Apply scripts/create-datahub-raw-staging.sql then scripts/create-datahub-raw-staging-runs.sql first.';
  END IF;
  IF to_regclass('public.data_hub_raw_rows') IS NULL OR to_regclass('public.data_hub_raw_cells') IS NULL THEN
    RAISE EXCEPTION '6.2D4C-B1 requires the D4A foundation (data_hub_raw_rows/data_hub_raw_cells) to already exist.';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1 — public.data_hub_normalization_runs
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.data_hub_normalization_runs ();

SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'import_batch_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN import_batch_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'upload_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN upload_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'raw_staging_run_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN raw_staging_run_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'source_schema_version_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN source_schema_version_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'source_schema_worksheet_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN source_schema_worksheet_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'worksheet_mapping_profile_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN worksheet_mapping_profile_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'worksheet_mapping_profile_version_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN worksheet_mapping_profile_version_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'attempt_number', 'integer', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN attempt_number INTEGER NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'normalizer_version', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN normalizer_version TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'status', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN status TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'execution_token', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN execution_token TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'lease_expires_at', 'timestamp with time zone', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN lease_expires_at TIMESTAMPTZ NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'last_progress_at', 'timestamp with time zone', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN last_progress_at TIMESTAMPTZ NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'expected_row_count', 'integer', true, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN expected_row_count INTEGER');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'expected_cell_count', 'integer', true, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN expected_cell_count INTEGER');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'persisted_row_count', 'integer', false, true, '0',
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN persisted_row_count INTEGER NOT NULL DEFAULT 0');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'persisted_cell_count', 'integer', false, true, '0',
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN persisted_cell_count INTEGER NOT NULL DEFAULT 0');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'created_by', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN created_by TEXT');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'started_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN started_at TIMESTAMPTZ NOT NULL DEFAULT now()');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'completed_at', 'timestamp with time zone', true, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN completed_at TIMESTAMPTZ');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'failed_at', 'timestamp with time zone', true, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN failed_at TIMESTAMPTZ');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'failure_code', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN failure_code TEXT');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'failure_detail', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN failure_detail TEXT');
SELECT pg_temp.ensure_column('data_hub_normalization_runs', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.data_hub_normalization_runs ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('data_hub_normalization_runs', ARRAY['id'],
  'ALTER TABLE public.data_hub_normalization_runs ADD PRIMARY KEY (id)');

SELECT pg_temp.ensure_check(
  'data_hub_normalization_runs',
  'data_hub_normalization_runs_status_check',
  'CHECK ((status = ANY (ARRAY[''RUNNING''::text, ''SUCCEEDED''::text, ''FAILED''::text, ''ABANDONED''::text])))',
  $sql$ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_status_check CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED'))$sql$
);

SELECT pg_temp.ensure_check(
  'data_hub_normalization_runs',
  'data_hub_normalization_runs_attempt_positive_check',
  'CHECK ((attempt_number >= 1))',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_attempt_positive_check CHECK (attempt_number >= 1)'
);

SELECT pg_temp.ensure_check(
  'data_hub_normalization_runs',
  'data_hub_normalization_runs_counts_nonneg_check',
  'CHECK ((((expected_row_count IS NULL) OR (expected_row_count >= 0)) AND ((expected_cell_count IS NULL) OR (expected_cell_count >= 0)) AND (persisted_row_count >= 0) AND (persisted_cell_count >= 0)))',
  $sql$ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_counts_nonneg_check CHECK (
    (expected_row_count IS NULL OR expected_row_count >= 0)
    AND (expected_cell_count IS NULL OR expected_cell_count >= 0)
    AND persisted_row_count >= 0
    AND persisted_cell_count >= 0
  )$sql$
);

SELECT pg_temp.ensure_check(
  'data_hub_normalization_runs',
  'data_hub_normalization_runs_completion_coherence_check',
  'CHECK ((((status = ''SUCCEEDED''::text) = (completed_at IS NOT NULL)) AND ((status = ''FAILED''::text) = ((failed_at IS NOT NULL) AND (failure_code IS NOT NULL))) AND ((status = ANY (ARRAY[''RUNNING''::text, ''ABANDONED''::text])) = ((completed_at IS NULL) AND (failed_at IS NULL) AND (failure_code IS NULL)))))',
  $sql$ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_completion_coherence_check CHECK (
    (status = 'SUCCEEDED') = (completed_at IS NOT NULL)
    AND (status = 'FAILED') = (failed_at IS NOT NULL AND failure_code IS NOT NULL)
    AND (status IN ('RUNNING', 'ABANDONED')) = (completed_at IS NULL AND failed_at IS NULL AND failure_code IS NULL)
  )$sql$
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_normalization_runs',
  'data_hub_normalization_runs_id_organisation_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_id_organisation_key UNIQUE (id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_normalization_runs',
  'data_hub_normalization_runs_id_upload_organisation_key',
  'UNIQUE (id, upload_id, organisation_id)',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_id_upload_organisation_key UNIQUE (id, upload_id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_normalization_runs',
  'data_hub_normalization_runs_id_profile_version_organisation_key',
  'UNIQUE (id, worksheet_mapping_profile_version_id, organisation_id)',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_id_profile_version_organisation_key UNIQUE (id, worksheet_mapping_profile_version_id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_normalization_runs',
  'data_hub_normalization_runs_id_raw_run_organisation_key',
  'UNIQUE (id, raw_staging_run_id, organisation_id)',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_id_raw_run_organisation_key UNIQUE (id, raw_staging_run_id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_normalization_runs',
  'data_hub_normalization_runs_upload_attempt_key',
  'UNIQUE (upload_id, attempt_number)',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_upload_attempt_key UNIQUE (upload_id, attempt_number)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_normalization_runs', 'data_hub_normalization_runs_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_normalization_runs', 'data_hub_normalization_runs_batch_schema_org_fkey',
  ARRAY['import_batch_id', 'source_schema_version_id', 'organisation_id'],
  'import_batches', ARRAY['id', 'source_schema_version_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_batch_schema_org_fkey FOREIGN KEY (import_batch_id, source_schema_version_id, organisation_id) REFERENCES public.import_batches(id, source_schema_version_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_normalization_runs', 'data_hub_normalization_runs_upload_batch_org_fkey',
  ARRAY['upload_id', 'import_batch_id', 'organisation_id'],
  'uploads', ARRAY['id', 'import_batch_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_upload_batch_org_fkey FOREIGN KEY (upload_id, import_batch_id, organisation_id) REFERENCES public.uploads(id, import_batch_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_normalization_runs', 'data_hub_normalization_runs_schema_worksheet_fkey',
  ARRAY['source_schema_worksheet_id', 'source_schema_version_id', 'organisation_id'],
  'source_schema_worksheets', ARRAY['id', 'source_schema_version_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_schema_worksheet_fkey FOREIGN KEY (source_schema_worksheet_id, source_schema_version_id, organisation_id) REFERENCES public.source_schema_worksheets(id, source_schema_version_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_normalization_runs', 'data_hub_normalization_runs_mapping_profile_fkey',
  ARRAY['worksheet_mapping_profile_id', 'source_schema_worksheet_id', 'organisation_id'],
  'worksheet_mapping_profiles', ARRAY['id', 'source_schema_worksheet_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_mapping_profile_fkey FOREIGN KEY (worksheet_mapping_profile_id, source_schema_worksheet_id, organisation_id) REFERENCES public.worksheet_mapping_profiles(id, source_schema_worksheet_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_normalization_runs', 'data_hub_normalization_runs_mapping_profile_version_fkey',
  ARRAY['worksheet_mapping_profile_version_id', 'worksheet_mapping_profile_id', 'organisation_id'],
  'worksheet_mapping_profile_versions', ARRAY['id', 'worksheet_mapping_profile_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_mapping_profile_version_fkey FOREIGN KEY (worksheet_mapping_profile_version_id, worksheet_mapping_profile_id, organisation_id) REFERENCES public.worksheet_mapping_profile_versions(id, worksheet_mapping_profile_id, organisation_id)'
);

-- Exact raw staging run, tenant-scoped.
SELECT pg_temp.ensure_fk(
  'data_hub_normalization_runs', 'data_hub_normalization_runs_raw_run_org_fkey',
  ARRAY['raw_staging_run_id', 'organisation_id'],
  'data_hub_raw_staging_runs', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_raw_run_org_fkey FOREIGN KEY (raw_staging_run_id, organisation_id) REFERENCES public.data_hub_raw_staging_runs(id, organisation_id)'
);

-- Proves this run's own upload_id agrees with its pinned raw staging run's
-- own upload_id (never a different upload's raw evidence).
SELECT pg_temp.ensure_fk(
  'data_hub_normalization_runs', 'data_hub_normalization_runs_raw_run_upload_fkey',
  ARRAY['raw_staging_run_id', 'upload_id', 'organisation_id'],
  'data_hub_raw_staging_runs', ARRAY['id', 'upload_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_raw_run_upload_fkey FOREIGN KEY (raw_staging_run_id, upload_id, organisation_id) REFERENCES public.data_hub_raw_staging_runs(id, upload_id, organisation_id)'
);

-- THE EXACT PINNED PROFILE INVARIANT (non-negotiable invariant 3): this
-- run's own worksheet_mapping_profile_version_id is structurally
-- impossible to be anything other than the SAME version its pinned
-- raw_staging_run itself carries. WorksheetMappingProfile.active_profile_version_id
-- is never consulted anywhere in this migration or the app code that will
-- eventually create these rows.
SELECT pg_temp.ensure_fk(
  'data_hub_normalization_runs', 'data_hub_normalization_runs_raw_run_pinned_version_fkey',
  ARRAY['raw_staging_run_id', 'worksheet_mapping_profile_version_id', 'organisation_id'],
  'data_hub_raw_staging_runs', ARRAY['id', 'worksheet_mapping_profile_version_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_raw_run_pinned_version_fkey FOREIGN KEY (raw_staging_run_id, worksheet_mapping_profile_version_id, organisation_id) REFERENCES public.data_hub_raw_staging_runs(id, worksheet_mapping_profile_version_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_normalization_runs', 'data_hub_normalization_runs_created_by_fkey',
  ARRAY['created_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL'
);

-- REMEDIATION (pre-PR review) — AUTHORITATIVE RAW RUN INVARIANT: D4B
-- deliberately establishes uploads.raw_staging_run_id as the ONE
-- authoritative completed raw-staging run for an upload (set atomically by
-- datahub_complete_raw_staging_run). The FKs above only prove this
-- normalization run's raw_staging_run_id belongs to the SAME upload and
-- carries the SAME pinned profile version as some SUCCEEDED raw run on
-- that upload — they do NOT prove it is upload's own authoritative one.
-- Without this, a second/earlier SUCCEEDED raw run on the same upload
-- (superseded by a later one Upload.raw_staging_run_id now actually
-- points to) could still be normalized from. An additive composite UNIQUE
-- on uploads makes this the exact pointed-to run, structurally, via a
-- composite FK below.
SELECT pg_temp.ensure_unique_constraint(
  'uploads',
  'uploads_id_raw_staging_run_organisation_key',
  'UNIQUE (id, raw_staging_run_id, organisation_id)',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_id_raw_staging_run_organisation_key UNIQUE (id, raw_staging_run_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_normalization_runs', 'data_hub_normalization_runs_upload_authoritative_raw_run_fkey',
  ARRAY['upload_id', 'raw_staging_run_id', 'organisation_id'],
  'uploads', ARRAY['id', 'raw_staging_run_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_upload_authoritative_raw_run_fkey FOREIGN KEY (upload_id, raw_staging_run_id, organisation_id) REFERENCES public.uploads(id, raw_staging_run_id, organisation_id)'
);

-- One RUNNING normalization run per Upload (D4B precedent, separate index).
SELECT pg_temp.ensure_index(
  'data_hub_normalization_runs',
  'data_hub_normalization_runs_one_active_per_upload',
  'CREATE UNIQUE INDEX data_hub_normalization_runs_one_active_per_upload ON public.data_hub_normalization_runs USING btree (upload_id) WHERE (status = ''RUNNING''::text)',
  $sql$CREATE UNIQUE INDEX data_hub_normalization_runs_one_active_per_upload ON public.data_hub_normalization_runs (upload_id) WHERE (status = 'RUNNING')$sql$
);

-- REMEDIATION (pre-PR review): every plain index below is now
-- drift-checked via pg_temp.ensure_index rather than a bare
-- CREATE INDEX IF NOT EXISTS — a same-named index with the wrong column
-- list can no longer silently pass.
SELECT pg_temp.ensure_index(
  'data_hub_normalization_runs', 'idx_data_hub_normalization_runs_org_batch',
  'CREATE INDEX idx_data_hub_normalization_runs_org_batch ON public.data_hub_normalization_runs USING btree (organisation_id, import_batch_id)',
  'CREATE INDEX idx_data_hub_normalization_runs_org_batch ON public.data_hub_normalization_runs (organisation_id, import_batch_id)'
);
SELECT pg_temp.ensure_index(
  'data_hub_normalization_runs', 'idx_data_hub_normalization_runs_upload',
  'CREATE INDEX idx_data_hub_normalization_runs_upload ON public.data_hub_normalization_runs USING btree (upload_id)',
  'CREATE INDEX idx_data_hub_normalization_runs_upload ON public.data_hub_normalization_runs (upload_id)'
);
SELECT pg_temp.ensure_index(
  'data_hub_normalization_runs', 'idx_data_hub_normalization_runs_raw_run',
  'CREATE INDEX idx_data_hub_normalization_runs_raw_run ON public.data_hub_normalization_runs USING btree (raw_staging_run_id)',
  'CREATE INDEX idx_data_hub_normalization_runs_raw_run ON public.data_hub_normalization_runs (raw_staging_run_id)'
);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2 — lifecycle/lease trigger (mirrors, but is separate from,
-- datahub_guard_raw_staging_run_lifecycle). Additionally guards INSERT:
-- a normalization run may only ever be created against a raw_staging_run
-- that is currently SUCCEEDED ("successful DataHubRawStagingRun ->
-- DataHubNormalizationRun").
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.datahub_guard_normalization_run_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_raw_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_raw_status
      FROM public.data_hub_raw_staging_runs
      WHERE id = NEW.raw_staging_run_id AND organisation_id = NEW.organisation_id;
    IF v_raw_status IS DISTINCT FROM 'SUCCEEDED' THEN
      RAISE EXCEPTION 'data_hub_normalization_runs: raw_staging_run_id must reference a SUCCEEDED raw staging run (raw_staging_run_id=%, status=%)',
        NEW.raw_staging_run_id, v_raw_status;
    END IF;

    -- REMEDIATION (pre-PR review) — ACTOR TENANT SAFETY: the plain
    -- created_by -> users(id) FK (kept exactly as-is, ON DELETE SET NULL,
    -- so the actor-deletion cascade below continues to work unchanged)
    -- only proves the user EXISTS, never that they belong to this run's
    -- own organisation_id. Fail closed here rather than trust a future
    -- route to always pass a same-tenant actor.
    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.users WHERE id = NEW.created_by AND organisation_id = NEW.organisation_id
    ) THEN
      RAISE EXCEPTION 'data_hub_normalization_runs: created_by must belong to the same organisation_id as the run (organisation_id=%)', NEW.organisation_id;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'data_hub_normalization_runs: normalization-run evidence is immutable; DELETE is not permitted (id=%)', OLD.id;
  END IF;

  -- Actor-deletion cascade — permitted unconditionally, regardless of
  -- status, as long as EVERY other column is unchanged. Checked before any
  -- status-transition branch below (D4B precedent).
  IF OLD.created_by IS NOT NULL
     AND NEW.created_by IS NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.organisation_id IS NOT DISTINCT FROM OLD.organisation_id
     AND NEW.import_batch_id IS NOT DISTINCT FROM OLD.import_batch_id
     AND NEW.upload_id IS NOT DISTINCT FROM OLD.upload_id
     AND NEW.raw_staging_run_id IS NOT DISTINCT FROM OLD.raw_staging_run_id
     AND NEW.source_schema_version_id IS NOT DISTINCT FROM OLD.source_schema_version_id
     AND NEW.source_schema_worksheet_id IS NOT DISTINCT FROM OLD.source_schema_worksheet_id
     AND NEW.worksheet_mapping_profile_id IS NOT DISTINCT FROM OLD.worksheet_mapping_profile_id
     AND NEW.worksheet_mapping_profile_version_id IS NOT DISTINCT FROM OLD.worksheet_mapping_profile_version_id
     AND NEW.attempt_number IS NOT DISTINCT FROM OLD.attempt_number
     AND NEW.normalizer_version IS NOT DISTINCT FROM OLD.normalizer_version
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
  -- row is otherwise fully immutable.
  IF OLD.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'data_hub_normalization_runs: run is % (terminal) and immutable except for actor deletion (id=%)', OLD.status, OLD.id;
  END IF;

  -- Every identity/pin column is immutable for the life of the row.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id
     OR NEW.upload_id IS DISTINCT FROM OLD.upload_id
     OR NEW.raw_staging_run_id IS DISTINCT FROM OLD.raw_staging_run_id
     OR NEW.source_schema_version_id IS DISTINCT FROM OLD.source_schema_version_id
     OR NEW.source_schema_worksheet_id IS DISTINCT FROM OLD.source_schema_worksheet_id
     OR NEW.worksheet_mapping_profile_id IS DISTINCT FROM OLD.worksheet_mapping_profile_id
     OR NEW.worksheet_mapping_profile_version_id IS DISTINCT FROM OLD.worksheet_mapping_profile_version_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.normalizer_version IS DISTINCT FROM OLD.normalizer_version
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'data_hub_normalization_runs: identity/pin columns are immutable (id=%)', OLD.id;
  END IF;

  IF NEW.status = 'RUNNING' THEN
    IF NEW.persisted_row_count < OLD.persisted_row_count OR NEW.persisted_cell_count < OLD.persisted_cell_count THEN
      RAISE EXCEPTION 'data_hub_normalization_runs: persisted counts may never decrease (id=%)', OLD.id;
    END IF;
    IF NEW.expected_row_count IS DISTINCT FROM OLD.expected_row_count
       OR NEW.expected_cell_count IS DISTINCT FROM OLD.expected_cell_count
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.failed_at IS DISTINCT FROM OLD.failed_at
       OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
       OR NEW.failure_detail IS DISTINCT FROM OLD.failure_detail THEN
      RAISE EXCEPTION 'data_hub_normalization_runs: only lease/progress columns may change while RUNNING (id=%)', OLD.id;
    END IF;
    RETURN NEW;
  ELSIF NEW.status = 'SUCCEEDED' THEN
    IF NEW.completed_at IS NULL OR NEW.failed_at IS NOT NULL OR NEW.failure_code IS NOT NULL THEN
      RAISE EXCEPTION 'data_hub_normalization_runs: malformed SUCCEEDED transition (id=%)', OLD.id;
    END IF;
    RETURN NEW;
  ELSIF NEW.status = 'FAILED' THEN
    IF NEW.failed_at IS NULL OR NEW.failure_code IS NULL OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'data_hub_normalization_runs: malformed FAILED transition (id=%)', OLD.id;
    END IF;
    RETURN NEW;
  ELSIF NEW.status = 'ABANDONED' THEN
    IF NEW.completed_at IS NOT NULL OR NEW.failed_at IS NOT NULL THEN
      RAISE EXCEPTION 'data_hub_normalization_runs: malformed ABANDONED transition (id=%)', OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'data_hub_normalization_runs: unrecognized status transition % -> % (id=%)', OLD.status, NEW.status, OLD.id;
END;
$fn$;

DROP TRIGGER IF EXISTS data_hub_normalization_runs_lifecycle_guard ON public.data_hub_normalization_runs;
CREATE TRIGGER data_hub_normalization_runs_lifecycle_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.data_hub_normalization_runs
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_normalization_run_lifecycle();

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3 — additive composite UNIQUE constraints on the existing D4A/D4B
-- raw-staging tables, required SOLELY to support the tenant/lineage
-- composite FKs below. D4A/D4B's own constraints are NOT touched, dropped,
-- or weakened.
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_rows',
  'data_hub_raw_rows_id_staging_run_organisation_key',
  'UNIQUE (id, staging_run_id, organisation_id)',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_id_staging_run_organisation_key UNIQUE (id, staging_run_id, organisation_id)'
);

-- REMEDIATION (pre-PR review): the 3-column key above proves a raw row
-- belongs to a given staging run, but NOT that a normalized row's declared
-- source_row_number is that SAME raw row's own physical source_row_number
-- — a normalized row could otherwise reference raw row A while claiming an
-- arbitrary different row number. This wider key is what
-- data_hub_normalized_rows_raw_row_fkey (STEP 4 below) actually references.
SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_rows',
  'data_hub_raw_rows_id_staging_run_source_row_organisation_key',
  'UNIQUE (id, staging_run_id, source_row_number, organisation_id)',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_id_staging_run_source_row_organisation_key UNIQUE (id, staging_run_id, source_row_number, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_cells',
  'data_hub_raw_cells_id_organisation_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.data_hub_raw_cells ADD CONSTRAINT data_hub_raw_cells_id_organisation_key UNIQUE (id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_cells',
  'data_hub_raw_cells_id_raw_row_organisation_key',
  'UNIQUE (id, raw_row_id, organisation_id)',
  'ALTER TABLE public.data_hub_raw_cells ADD CONSTRAINT data_hub_raw_cells_id_raw_row_organisation_key UNIQUE (id, raw_row_id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_cells',
  'data_hub_raw_cells_id_column_organisation_key',
  'UNIQUE (id, source_schema_column_id, organisation_id)',
  'ALTER TABLE public.data_hub_raw_cells ADD CONSTRAINT data_hub_raw_cells_id_column_organisation_key UNIQUE (id, source_schema_column_id, organisation_id)'
);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 4 — public.data_hub_normalized_rows
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.data_hub_normalized_rows ();

SELECT pg_temp.ensure_column('data_hub_normalized_rows', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_rows ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_rows', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_rows ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_rows', 'normalization_run_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_rows ADD COLUMN normalization_run_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_rows', 'raw_staging_run_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_rows ADD COLUMN raw_staging_run_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_rows', 'raw_row_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_rows ADD COLUMN raw_row_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_rows', 'source_row_number', 'integer', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_rows ADD COLUMN source_row_number INTEGER NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_rows', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.data_hub_normalized_rows ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('data_hub_normalized_rows', ARRAY['id'],
  'ALTER TABLE public.data_hub_normalized_rows ADD PRIMARY KEY (id)');

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_normalized_rows',
  'data_hub_normalized_rows_id_organisation_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.data_hub_normalized_rows ADD CONSTRAINT data_hub_normalized_rows_id_organisation_key UNIQUE (id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_normalized_rows',
  'data_hub_normalized_rows_id_raw_row_organisation_key',
  'UNIQUE (id, raw_row_id, organisation_id)',
  'ALTER TABLE public.data_hub_normalized_rows ADD CONSTRAINT data_hub_normalized_rows_id_raw_row_organisation_key UNIQUE (id, raw_row_id, organisation_id)'
);

-- Resumability by RUN (invariant 11), not by upload alone — a failed
-- attempt's rows may coexist with a later new attempt's rows. Also
-- separately protects physical-row uniqueness within one run (no two
-- normalized rows in the same run can claim the same source_row_number).
SELECT pg_temp.ensure_unique_constraint(
  'data_hub_normalized_rows',
  'data_hub_normalized_rows_run_source_row_key',
  'UNIQUE (normalization_run_id, source_row_number)',
  'ALTER TABLE public.data_hub_normalized_rows ADD CONSTRAINT data_hub_normalized_rows_run_source_row_key UNIQUE (normalization_run_id, source_row_number)'
);

-- REMEDIATION (pre-PR review): one normalization run may derive AT MOST ONE
-- normalized row from any exact raw row — without this, the same
-- raw_row_id could otherwise appear more than once in one run under
-- different source_row_number claims.
SELECT pg_temp.ensure_unique_constraint(
  'data_hub_normalized_rows',
  'data_hub_normalized_rows_run_raw_row_key',
  'UNIQUE (normalization_run_id, raw_row_id)',
  'ALTER TABLE public.data_hub_normalized_rows ADD CONSTRAINT data_hub_normalized_rows_run_raw_row_key UNIQUE (normalization_run_id, raw_row_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_normalized_rows', 'data_hub_normalized_rows_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalized_rows ADD CONSTRAINT data_hub_normalized_rows_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_normalized_rows', 'data_hub_normalized_rows_run_org_fkey',
  ARRAY['normalization_run_id', 'organisation_id'],
  'data_hub_normalization_runs', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalized_rows ADD CONSTRAINT data_hub_normalized_rows_run_org_fkey FOREIGN KEY (normalization_run_id, organisation_id) REFERENCES public.data_hub_normalization_runs(id, organisation_id)'
);

-- Proves this row's own raw_staging_run_id agrees with its normalization
-- run's own pin (never a different run's raw evidence).
SELECT pg_temp.ensure_fk(
  'data_hub_normalized_rows', 'data_hub_normalized_rows_run_raw_run_fkey',
  ARRAY['normalization_run_id', 'raw_staging_run_id', 'organisation_id'],
  'data_hub_normalization_runs', ARRAY['id', 'raw_staging_run_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalized_rows ADD CONSTRAINT data_hub_normalized_rows_run_raw_run_fkey FOREIGN KEY (normalization_run_id, raw_staging_run_id, organisation_id) REFERENCES public.data_hub_normalization_runs(id, raw_staging_run_id, organisation_id)'
);

-- Proves this row's own raw_row_id really belongs to the raw staging run
-- its normalization run is pinned to (never a different run's row) AND
-- that its own declared source_row_number is that SAME raw row's own
-- physical source_row_number (REMEDIATION, pre-PR review) — a normalized
-- row can no longer reference raw row A while claiming an arbitrary
-- different row number.
SELECT pg_temp.ensure_fk(
  'data_hub_normalized_rows', 'data_hub_normalized_rows_raw_row_fkey',
  ARRAY['raw_row_id', 'raw_staging_run_id', 'source_row_number', 'organisation_id'],
  'data_hub_raw_rows', ARRAY['id', 'staging_run_id', 'source_row_number', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalized_rows ADD CONSTRAINT data_hub_normalized_rows_raw_row_fkey FOREIGN KEY (raw_row_id, raw_staging_run_id, source_row_number, organisation_id) REFERENCES public.data_hub_raw_rows(id, staging_run_id, source_row_number, organisation_id)'
);

SELECT pg_temp.ensure_index(
  'data_hub_normalized_rows', 'idx_data_hub_normalized_rows_org_run',
  'CREATE INDEX idx_data_hub_normalized_rows_org_run ON public.data_hub_normalized_rows USING btree (organisation_id, normalization_run_id)',
  'CREATE INDEX idx_data_hub_normalized_rows_org_run ON public.data_hub_normalized_rows (organisation_id, normalization_run_id)'
);
SELECT pg_temp.ensure_index(
  'data_hub_normalized_rows', 'idx_data_hub_normalized_rows_raw_row',
  'CREATE INDEX idx_data_hub_normalized_rows_raw_row ON public.data_hub_normalized_rows USING btree (raw_row_id)',
  'CREATE INDEX idx_data_hub_normalized_rows_raw_row ON public.data_hub_normalized_rows (raw_row_id)'
);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 5 — public.data_hub_normalized_cells
--
-- normalized_value storage contract (invariant 8, FOUNDATION ONLY — no
-- parsing/conversion executes in this migration or phase):
--   STRING / IDENTIFIER / DATE / TIME / DATETIME -> JSON string
--   BOOLEAN                                       -> JSON boolean
--   INTEGER / DECIMAL / DURATION / PERCENTAGE /
--     CURRENCY / LATITUDE / LONGITUDE             -> canonical DECIMAL JSON string
--   NULL input                                    -> the JSON literal null
-- normalized_value is NOT NULL: a governed "no value" is its own JSON
-- null, distinct from SQL NULL. value_kind mirrors the exact D4C-A
-- ValueKind vocabulary (lib/data-hub/schemaProfiles/profileDocument.ts) —
-- kept in sync by hand; this migration does not import or execute that
-- module. source_unit/normalized_unit mirror the exact D4C-A Unit
-- vocabulary and unit-pair coherence rule (both-null or both-non-null),
-- and are NEVER inferred from source_header.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.data_hub_normalized_cells ();

SELECT pg_temp.ensure_column('data_hub_normalized_cells', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_cells ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_cells', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_cells ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_cells', 'normalized_row_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_cells ADD COLUMN normalized_row_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_cells', 'raw_row_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_cells ADD COLUMN raw_row_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_cells', 'raw_cell_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_cells ADD COLUMN raw_cell_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_cells', 'source_schema_column_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_cells ADD COLUMN source_schema_column_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_cells', 'value_kind', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_cells ADD COLUMN value_kind TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_cells', 'normalized_value', 'jsonb', false, true, NULL,
  'ALTER TABLE public.data_hub_normalized_cells ADD COLUMN normalized_value JSONB NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalized_cells', 'source_unit', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_normalized_cells ADD COLUMN source_unit TEXT');
SELECT pg_temp.ensure_column('data_hub_normalized_cells', 'normalized_unit', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_normalized_cells ADD COLUMN normalized_unit TEXT');
SELECT pg_temp.ensure_column('data_hub_normalized_cells', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.data_hub_normalized_cells ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('data_hub_normalized_cells', ARRAY['id'],
  'ALTER TABLE public.data_hub_normalized_cells ADD PRIMARY KEY (id)');

SELECT pg_temp.ensure_check(
  'data_hub_normalized_cells',
  'data_hub_normalized_cells_value_kind_check',
  'CHECK ((value_kind = ANY (ARRAY[''STRING''::text, ''IDENTIFIER''::text, ''INTEGER''::text, ''DECIMAL''::text, ''BOOLEAN''::text, ''DATE''::text, ''TIME''::text, ''DATETIME''::text, ''DURATION''::text, ''PERCENTAGE''::text, ''CURRENCY''::text, ''LATITUDE''::text, ''LONGITUDE''::text])))',
  $sql$ALTER TABLE public.data_hub_normalized_cells ADD CONSTRAINT data_hub_normalized_cells_value_kind_check CHECK (
    value_kind IN ('STRING','IDENTIFIER','INTEGER','DECIMAL','BOOLEAN','DATE','TIME','DATETIME','DURATION','PERCENTAGE','CURRENCY','LATITUDE','LONGITUDE')
  )$sql$
);

-- Foundation-only scalar/null shape. D4C-B2 owns actual value validation
-- per value_kind; this CHECK only proves the JSON TYPE is one this
-- contract ever allows.
SELECT pg_temp.ensure_check(
  'data_hub_normalized_cells',
  'data_hub_normalized_cells_value_shape_check',
  'CHECK ((jsonb_typeof(normalized_value) = ANY (ARRAY[''string''::text, ''boolean''::text, ''null''::text])))',
  $sql$ALTER TABLE public.data_hub_normalized_cells ADD CONSTRAINT data_hub_normalized_cells_value_shape_check CHECK (
    jsonb_typeof(normalized_value) IN ('string', 'boolean', 'null')
  )$sql$
);

SELECT pg_temp.ensure_check(
  'data_hub_normalized_cells',
  'data_hub_normalized_cells_unit_allowlist_check',
  'CHECK ((((source_unit IS NULL) OR (source_unit = ANY (ARRAY[''kg''::text, ''t''::text, ''m''::text, ''km''::text, ''s''::text, ''min''::text, ''h''::text, ''%''::text, ''AUD''::text]))) AND ((normalized_unit IS NULL) OR (normalized_unit = ANY (ARRAY[''kg''::text, ''t''::text, ''m''::text, ''km''::text, ''s''::text, ''min''::text, ''h''::text, ''%''::text, ''AUD''::text])))))',
  $sql$ALTER TABLE public.data_hub_normalized_cells ADD CONSTRAINT data_hub_normalized_cells_unit_allowlist_check CHECK (
    (source_unit IS NULL OR source_unit IN ('kg','t','m','km','s','min','h','%','AUD'))
    AND (normalized_unit IS NULL OR normalized_unit IN ('kg','t','m','km','s','min','h','%','AUD'))
  )$sql$
);

-- Mirrors the D4C-A unit-pair coherence rule at the storage layer too
-- (defense in depth — D4C-B2's executor is expected to enforce this at
-- write time regardless): both null, or both non-null, never exactly one.
SELECT pg_temp.ensure_check(
  'data_hub_normalized_cells',
  'data_hub_normalized_cells_unit_pair_check',
  'CHECK (((source_unit IS NULL) = (normalized_unit IS NULL)))',
  'ALTER TABLE public.data_hub_normalized_cells ADD CONSTRAINT data_hub_normalized_cells_unit_pair_check CHECK ((source_unit IS NULL) = (normalized_unit IS NULL))'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_normalized_cells',
  'data_hub_normalized_cells_row_cell_key',
  'UNIQUE (normalized_row_id, raw_cell_id)',
  'ALTER TABLE public.data_hub_normalized_cells ADD CONSTRAINT data_hub_normalized_cells_row_cell_key UNIQUE (normalized_row_id, raw_cell_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_normalized_cells', 'data_hub_normalized_cells_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalized_cells ADD CONSTRAINT data_hub_normalized_cells_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)'
);

-- Proves this cell's declared raw_row_id agrees with its own normalized
-- row's raw_row_id (never a different row's evidence).
SELECT pg_temp.ensure_fk(
  'data_hub_normalized_cells', 'data_hub_normalized_cells_normalized_row_fkey',
  ARRAY['normalized_row_id', 'raw_row_id', 'organisation_id'],
  'data_hub_normalized_rows', ARRAY['id', 'raw_row_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalized_cells ADD CONSTRAINT data_hub_normalized_cells_normalized_row_fkey FOREIGN KEY (normalized_row_id, raw_row_id, organisation_id) REFERENCES public.data_hub_normalized_rows(id, raw_row_id, organisation_id)'
);

-- Exact raw cell, tenant-scoped.
SELECT pg_temp.ensure_fk(
  'data_hub_normalized_cells', 'data_hub_normalized_cells_raw_cell_org_fkey',
  ARRAY['raw_cell_id', 'organisation_id'],
  'data_hub_raw_cells', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalized_cells ADD CONSTRAINT data_hub_normalized_cells_raw_cell_org_fkey FOREIGN KEY (raw_cell_id, organisation_id) REFERENCES public.data_hub_raw_cells(id, organisation_id)'
);

-- Proves that exact raw cell really belongs to the exact raw row this
-- normalized row derives from (never a different row's cell).
SELECT pg_temp.ensure_fk(
  'data_hub_normalized_cells', 'data_hub_normalized_cells_raw_cell_row_fkey',
  ARRAY['raw_cell_id', 'raw_row_id', 'organisation_id'],
  'data_hub_raw_cells', ARRAY['id', 'raw_row_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalized_cells ADD CONSTRAINT data_hub_normalized_cells_raw_cell_row_fkey FOREIGN KEY (raw_cell_id, raw_row_id, organisation_id) REFERENCES public.data_hub_raw_cells(id, raw_row_id, organisation_id)'
);

-- Proves the declared governed column identity agrees with that SAME raw
-- cell's own recorded column id (never a mismatched/invented column).
SELECT pg_temp.ensure_fk(
  'data_hub_normalized_cells', 'data_hub_normalized_cells_raw_cell_column_fkey',
  ARRAY['raw_cell_id', 'source_schema_column_id', 'organisation_id'],
  'data_hub_raw_cells', ARRAY['id', 'source_schema_column_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalized_cells ADD CONSTRAINT data_hub_normalized_cells_raw_cell_column_fkey FOREIGN KEY (raw_cell_id, source_schema_column_id, organisation_id) REFERENCES public.data_hub_raw_cells(id, source_schema_column_id, organisation_id)'
);

-- The governed column itself must be real, tenant-scoped.
SELECT pg_temp.ensure_fk(
  'data_hub_normalized_cells', 'data_hub_normalized_cells_column_org_fkey',
  ARRAY['source_schema_column_id', 'organisation_id'],
  'source_schema_columns', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalized_cells ADD CONSTRAINT data_hub_normalized_cells_column_org_fkey FOREIGN KEY (source_schema_column_id, organisation_id) REFERENCES public.source_schema_columns(id, organisation_id)'
);

SELECT pg_temp.ensure_index(
  'data_hub_normalized_cells', 'idx_data_hub_normalized_cells_org_row',
  'CREATE INDEX idx_data_hub_normalized_cells_org_row ON public.data_hub_normalized_cells USING btree (organisation_id, normalized_row_id)',
  'CREATE INDEX idx_data_hub_normalized_cells_org_row ON public.data_hub_normalized_cells (organisation_id, normalized_row_id)'
);
SELECT pg_temp.ensure_index(
  'data_hub_normalized_cells', 'idx_data_hub_normalized_cells_column',
  'CREATE INDEX idx_data_hub_normalized_cells_column ON public.data_hub_normalized_cells USING btree (source_schema_column_id)',
  'CREATE INDEX idx_data_hub_normalized_cells_column ON public.data_hub_normalized_cells (source_schema_column_id)'
);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 6 — normalized-evidence immutability: UPDATE and DELETE are BOTH
-- rejected outright on both tables, unconditionally, from creation.
-- Unlike the run tables, there is no lifecycle here to make exceptions
-- for — a normalized row/cell is written once by the (future) executor
-- and never touched again.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.datahub_guard_normalized_evidence_immutable()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '%: normalized evidence is immutable; UPDATE is not permitted (id=%)', TG_TABLE_NAME, OLD.id;
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '%: normalized evidence is immutable; DELETE is not permitted (id=%)', TG_TABLE_NAME, OLD.id;
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS data_hub_normalized_rows_immutable_guard ON public.data_hub_normalized_rows;
CREATE TRIGGER data_hub_normalized_rows_immutable_guard
  BEFORE UPDATE OR DELETE ON public.data_hub_normalized_rows
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_normalized_evidence_immutable();

DROP TRIGGER IF EXISTS data_hub_normalized_cells_immutable_guard ON public.data_hub_normalized_cells;
CREATE TRIGGER data_hub_normalized_cells_immutable_guard
  BEFORE UPDATE OR DELETE ON public.data_hub_normalized_cells
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_normalized_evidence_immutable();

-- ═══════════════════════════════════════════════════════════════════
-- STEP 7 — public.uploads normalization completion metadata. A completely
-- SEPARATE completion group from raw_staged_*/raw_staging_run_id — never
-- repurposes raw_staged_at, raw_profile_version_id, raw_staging_run_id,
-- canonical_status, status, or mapping_version_id.
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_column('uploads', 'normalized_at', 'timestamp with time zone', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN normalized_at TIMESTAMPTZ');
SELECT pg_temp.ensure_column('uploads', 'normalized_by', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN normalized_by TEXT');
SELECT pg_temp.ensure_column('uploads', 'normalized_profile_version_id', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN normalized_profile_version_id TEXT');
SELECT pg_temp.ensure_column('uploads', 'normalized_row_count', 'integer', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN normalized_row_count INTEGER');
SELECT pg_temp.ensure_column('uploads', 'normalized_cell_count', 'integer', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN normalized_cell_count INTEGER');
SELECT pg_temp.ensure_column('uploads', 'normalization_run_id', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN normalization_run_id TEXT');

SELECT pg_temp.ensure_fk(
  'uploads', 'uploads_normalized_by_fkey',
  ARRAY['normalized_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_normalized_by_fkey FOREIGN KEY (normalized_by) REFERENCES public.users(id) ON DELETE SET NULL'
);

SELECT pg_temp.ensure_fk(
  'uploads', 'uploads_normalized_profile_version_org_fkey',
  ARRAY['normalized_profile_version_id', 'organisation_id'],
  'worksheet_mapping_profile_versions', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_normalized_profile_version_org_fkey FOREIGN KEY (normalized_profile_version_id, organisation_id) REFERENCES public.worksheet_mapping_profile_versions(id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'uploads', 'uploads_normalization_run_org_fkey',
  ARRAY['normalization_run_id', 'organisation_id'],
  'data_hub_normalization_runs', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_normalization_run_org_fkey FOREIGN KEY (normalization_run_id, organisation_id) REFERENCES public.data_hub_normalization_runs(id, organisation_id)'
);

-- Proves the pointed-to run really belongs to THIS upload's own id.
SELECT pg_temp.ensure_fk(
  'uploads', 'uploads_normalization_run_upload_fkey',
  ARRAY['normalization_run_id', 'id', 'organisation_id'],
  'data_hub_normalization_runs', ARRAY['id', 'upload_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_normalization_run_upload_fkey FOREIGN KEY (normalization_run_id, id, organisation_id) REFERENCES public.data_hub_normalization_runs(id, upload_id, organisation_id)'
);

SELECT pg_temp.ensure_check(
  'uploads',
  'uploads_normalization_coherence_check',
  'CHECK ((((normalized_at IS NULL) AND (normalized_by IS NULL) AND (normalized_profile_version_id IS NULL) AND (normalized_row_count IS NULL) AND (normalized_cell_count IS NULL) AND (normalization_run_id IS NULL)) OR ((normalized_at IS NOT NULL) AND (normalized_profile_version_id IS NOT NULL) AND (normalized_row_count IS NOT NULL) AND (normalized_cell_count IS NOT NULL) AND (normalization_run_id IS NOT NULL) AND (raw_staged_at IS NOT NULL) AND (lineage_kind = ''DATA_HUB''::text))))',
  $sql$ALTER TABLE public.uploads ADD CONSTRAINT uploads_normalization_coherence_check CHECK (
    (
      normalized_at IS NULL
      AND normalized_by IS NULL
      AND normalized_profile_version_id IS NULL
      AND normalized_row_count IS NULL
      AND normalized_cell_count IS NULL
      AND normalization_run_id IS NULL
    )
    OR
    (
      normalized_at IS NOT NULL
      AND normalized_profile_version_id IS NOT NULL
      AND normalized_row_count IS NOT NULL
      AND normalized_cell_count IS NOT NULL
      AND normalization_run_id IS NOT NULL
      -- Cannot be normalized without having been raw-staged first.
      AND raw_staged_at IS NOT NULL
      AND lineage_kind = 'DATA_HUB'
    )
  )$sql$
);

-- A SEPARATE trigger from D4A/D4B's own datahub_guard_upload_raw_staging_metadata
-- trigger (never touched by this file) — freezes the normalization
-- completion group independently. normalized_by carries the one
-- actor-deletion exception; every other field is frozen forever once set
-- (no exception at all — the run row it points to can never be deleted).
CREATE OR REPLACE FUNCTION public.datahub_guard_upload_normalization_metadata()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.normalized_at IS NULL THEN
    IF NEW.normalized_at IS NULL THEN
      RETURN NEW;
    END IF;

    IF NEW.normalized_by IS NULL THEN
      RAISE EXCEPTION 'uploads: initial normalization completion requires normalized_by (upload=%)', OLD.id;
    END IF;
    IF NEW.normalization_run_id IS NULL THEN
      RAISE EXCEPTION 'uploads: initial normalization completion requires normalization_run_id (upload=%)', OLD.id;
    END IF;

    -- REMEDIATION (pre-PR review) — ACTOR TENANT SAFETY: the plain
    -- normalized_by -> users(id) FK (kept exactly as-is, ON DELETE SET
    -- NULL, so the post-completion actor-deletion path below continues to
    -- work unchanged) only proves the user EXISTS, never that they belong
    -- to THIS upload's own organisation_id.
    IF NOT EXISTS (
      SELECT 1 FROM public.users WHERE id = NEW.normalized_by AND organisation_id = NEW.organisation_id
    ) THEN
      RAISE EXCEPTION 'uploads: normalized_by must belong to the same organisation_id as the upload (upload=%)', OLD.id;
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.normalized_at IS DISTINCT FROM OLD.normalized_at
     OR NEW.normalized_profile_version_id IS DISTINCT FROM OLD.normalized_profile_version_id
     OR NEW.normalized_row_count IS DISTINCT FROM OLD.normalized_row_count
     OR NEW.normalized_cell_count IS DISTINCT FROM OLD.normalized_cell_count
     OR NEW.normalization_run_id IS DISTINCT FROM OLD.normalization_run_id THEN
    RAISE EXCEPTION 'uploads: normalization metadata is immutable once completed (upload=%)', OLD.id;
  END IF;

  IF NEW.normalized_by IS DISTINCT FROM OLD.normalized_by THEN
    IF NOT (OLD.normalized_by IS NOT NULL AND NEW.normalized_by IS NULL) THEN
      RAISE EXCEPTION 'uploads: normalized_by cannot be rewritten after normalization completion (upload=%)', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS uploads_normalization_metadata_guard ON public.uploads;
CREATE TRIGGER uploads_normalization_metadata_guard
  BEFORE UPDATE ON public.uploads
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_upload_normalization_metadata();

-- ═══════════════════════════════════════════════════════════════════
-- STEP 8 — datahub_complete_normalization_run(...): the atomic completion
-- transaction. Mirrors datahub_complete_raw_staging_run's own shape
-- (reconciles counts server-side; transitions the run to SUCCEEDED
-- together with Upload's own completion metadata, in one statement) but is
-- entirely separate. p_completed_by is the AUTHENTICATED ACTOR COMPLETING
-- THE RUN — never the run's own created_by.
--
-- Additionally verifies (invariant 12) that the pinned raw_staging_run is
-- STILL SUCCEEDED at completion time (defense in depth; the FK already
-- proves it was SUCCEEDED at run-creation time, and D4B's own lifecycle
-- makes a SUCCEEDED run's status immutable, but this re-check costs
-- nothing and documents the requirement structurally).
--
-- Does not implement or execute any normalization transformation — that is
-- exactly the "do not add the application normalization executor" boundary
-- this phase does not cross. This function only reconciles counts and
-- performs the atomic completion write.
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.datahub_complete_normalization_run(text, text, text, text);

CREATE OR REPLACE FUNCTION public.datahub_complete_normalization_run(
  p_normalization_run_id text,
  p_organisation_id text,
  p_completed_by text,
  p_execution_token text
) RETURNS TABLE(row_count integer, cell_count integer)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_run RECORD;
  v_raw_status text;
  v_actual_row_count int;
  v_actual_cell_count int;
  v_completion_rows int;
BEGIN
  SELECT * INTO v_run
    FROM public.data_hub_normalization_runs
    WHERE id = p_normalization_run_id AND organisation_id = p_organisation_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'datahub_complete_normalization_run: run not found (normalization_run_id=%)', p_normalization_run_id;
  END IF;
  IF v_run.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'datahub_complete_normalization_run: run is not RUNNING (normalization_run_id=%, status=%)', p_normalization_run_id, v_run.status;
  END IF;
  IF v_run.execution_token IS DISTINCT FROM p_execution_token THEN
    RAISE EXCEPTION 'datahub_complete_normalization_run: caller does not hold the current lease token (normalization_run_id=%)', p_normalization_run_id;
  END IF;
  IF v_run.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'datahub_complete_normalization_run: lease has expired (normalization_run_id=%)', p_normalization_run_id;
  END IF;
  IF v_run.expected_row_count IS NULL OR v_run.expected_cell_count IS NULL THEN
    RAISE EXCEPTION 'datahub_complete_normalization_run: run has no expected counts (normalization_run_id=%)', p_normalization_run_id;
  END IF;

  -- REMEDIATION (pre-PR review) — ACTOR TENANT SAFETY, defense in depth:
  -- the Upload trigger (datahub_guard_upload_normalization_metadata) is the
  -- authoritative enforcement point, but this function validates
  -- p_completed_by BEFORE touching any run/upload state, so a direct
  -- function call fails clearly and no partial state change is ever
  -- attempted for a cross-tenant actor. Never echoes the actor id/value.
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_completed_by AND organisation_id = p_organisation_id
  ) THEN
    RAISE EXCEPTION 'datahub_complete_normalization_run: completing actor does not belong to this organisation (normalization_run_id=%)', p_normalization_run_id;
  END IF;

  SELECT status INTO v_raw_status FROM public.data_hub_raw_staging_runs WHERE id = v_run.raw_staging_run_id AND organisation_id = p_organisation_id;
  IF v_raw_status IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION 'datahub_complete_normalization_run: pinned raw_staging_run is no longer SUCCEEDED (normalization_run_id=%, raw_staging_run_id=%, status=%)',
      p_normalization_run_id, v_run.raw_staging_run_id, v_raw_status;
  END IF;

  SELECT count(*) INTO v_actual_row_count FROM public.data_hub_normalized_rows WHERE normalization_run_id = p_normalization_run_id;
  SELECT count(*) INTO v_actual_cell_count
    FROM public.data_hub_normalized_cells c JOIN public.data_hub_normalized_rows r ON r.id = c.normalized_row_id
    WHERE r.normalization_run_id = p_normalization_run_id;

  IF v_actual_row_count <> v_run.expected_row_count OR v_actual_row_count <> v_run.persisted_row_count THEN
    RAISE EXCEPTION 'datahub_complete_normalization_run: row count mismatch (normalization_run_id=%, actual=%, expected=%, persisted=%)',
      p_normalization_run_id, v_actual_row_count, v_run.expected_row_count, v_run.persisted_row_count;
  END IF;
  IF v_actual_cell_count <> v_run.expected_cell_count OR v_actual_cell_count <> v_run.persisted_cell_count THEN
    RAISE EXCEPTION 'datahub_complete_normalization_run: cell count mismatch (normalization_run_id=%, actual=%, expected=%, persisted=%)',
      p_normalization_run_id, v_actual_cell_count, v_run.expected_cell_count, v_run.persisted_cell_count;
  END IF;

  UPDATE public.data_hub_normalization_runs
  SET status = 'SUCCEEDED', completed_at = now()
  WHERE id = p_normalization_run_id AND organisation_id = p_organisation_id AND status = 'RUNNING';

  UPDATE public.uploads
  SET normalized_at = now(),
      normalized_by = p_completed_by,
      normalized_profile_version_id = v_run.worksheet_mapping_profile_version_id,
      normalized_row_count = v_run.expected_row_count,
      normalized_cell_count = v_run.expected_cell_count,
      normalization_run_id = p_normalization_run_id
  WHERE id = v_run.upload_id AND organisation_id = p_organisation_id AND normalized_at IS NULL;
  GET DIAGNOSTICS v_completion_rows = ROW_COUNT;
  IF v_completion_rows <> 1 THEN
    RAISE EXCEPTION 'datahub_complete_normalization_run: upload completion write did not match exactly 1 row (normalization_run_id=%, upload_id=%)',
      p_normalization_run_id, v_run.upload_id;
  END IF;

  RETURN QUERY SELECT v_actual_row_count, v_actual_cell_count;
END;
$fn$;

COMMIT;

-- Rollback is deliberately manual and not executed automatically — see
-- scripts/rollback-datahub-normalized-staging.sql for the exact guarded
-- rollback SQL: it aborts if any normalization evidence or Upload
-- completion metadata exists, and otherwise removes every object this
-- file created and drops the additive composite UNIQUE constraints from
-- data_hub_raw_rows/data_hub_raw_cells/uploads (D4A/D4B's OWN constraints
-- are left completely untouched either way).
