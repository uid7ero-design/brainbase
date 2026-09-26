-- Data Hub 6.2D4A — governed XLSX raw persistence foundation.
--
-- ADDITIVE SCHEMA ONLY. This migration does not stage any workbook, activate
-- any runtime endpoint, alter canonical_status, or write canonical/domain data.
-- It creates the immutable raw evidence structures required by the later D4A
-- staging service.
--
-- Production/Preview execution remains a separate explicit gate.
--
-- Creates:
--   public.data_hub_raw_rows
--   public.data_hub_raw_cells
-- Adds:
--   public.uploads.raw_staged_at
--   public.uploads.raw_staged_by
--   public.uploads.raw_profile_version_id
--   public.uploads.raw_row_count
--   public.uploads.raw_cell_count
--
-- Historical lineage uses NO ACTION throughout. Actor references use SET NULL.
-- Raw rows/cells are immutable after INSERT. Upload raw-staging completion is a
-- one-way transition; after completion all raw-staging metadata is frozen except
-- raw_staged_by may become NULL through its FK when that User is deleted.

BEGIN;

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

-- NEW helper (6.2D3A). Same ensure/validate/RAISE shape as every helper
-- above: create if absent, otherwise compare the EXACT stored definition
-- (pg_get_indexdef — covers uniqueness, access method, column list/order,
-- expressions and any partial predicate in one normalized string) and
-- RAISE on any difference. Replaces the bare CREATE INDEX IF NOT EXISTS
-- used by earlier scripts, which silently accepts a same-named index
-- with a different definition.
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

  -- e.g. left behind by an interrupted CREATE INDEX CONCURRENTLY: same
  -- definition text, but not usable/maintained as a real index.
  IF NOT actual_valid THEN
    RAISE EXCEPTION 'Migration drift: index public.% exists but is INVALID', p_index_name;
  END IF;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1 — parent composite keys used by strict D4A lineage FKs.
-- Purely additive uniqueness; no row changes.
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_unique_constraint(
  'import_batches',
  'import_batches_id_schema_version_organisation_key',
  'UNIQUE (id, source_schema_version_id, organisation_id)',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_id_schema_version_organisation_key UNIQUE (id, source_schema_version_id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'uploads',
  'uploads_id_import_batch_organisation_key',
  'UNIQUE (id, import_batch_id, organisation_id)',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_id_import_batch_organisation_key UNIQUE (id, import_batch_id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'uploads',
  'uploads_id_raw_profile_version_organisation_key',
  'UNIQUE (id, raw_profile_version_id, organisation_id)',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_id_raw_profile_version_organisation_key UNIQUE (id, raw_profile_version_id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'source_schema_worksheets',
  'source_schema_worksheets_id_version_organisation_key',
  'UNIQUE (id, source_schema_version_id, organisation_id)',
  'ALTER TABLE public.source_schema_worksheets ADD CONSTRAINT source_schema_worksheets_id_version_organisation_key UNIQUE (id, source_schema_version_id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'worksheet_mapping_profiles',
  'worksheet_mapping_profiles_id_worksheet_organisation_key',
  'UNIQUE (id, source_schema_worksheet_id, organisation_id)',
  'ALTER TABLE public.worksheet_mapping_profiles ADD CONSTRAINT worksheet_mapping_profiles_id_worksheet_organisation_key UNIQUE (id, source_schema_worksheet_id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'source_schema_columns',
  'source_schema_columns_id_worksheet_ordinal_organisation_key',
  'UNIQUE (id, source_schema_worksheet_id, ordinal, organisation_id)',
  'ALTER TABLE public.source_schema_columns ADD CONSTRAINT source_schema_columns_id_worksheet_ordinal_organisation_key UNIQUE (id, source_schema_worksheet_id, ordinal, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'source_schema_columns',
  'source_schema_columns_raw_evidence_key',
  'UNIQUE (id, source_schema_worksheet_id, ordinal, source_header, sensitivity_class, organisation_id)',
  'ALTER TABLE public.source_schema_columns ADD CONSTRAINT source_schema_columns_raw_evidence_key UNIQUE (id, source_schema_worksheet_id, ordinal, source_header, sensitivity_class, organisation_id)'
);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2 — public.data_hub_raw_rows
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.data_hub_raw_rows ();

SELECT pg_temp.ensure_column('data_hub_raw_rows', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_rows ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_rows', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_rows ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_rows', 'import_batch_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_rows ADD COLUMN import_batch_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_rows', 'upload_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_rows ADD COLUMN upload_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_rows', 'source_schema_version_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_rows ADD COLUMN source_schema_version_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_rows', 'source_schema_worksheet_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_rows ADD COLUMN source_schema_worksheet_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_rows', 'worksheet_mapping_profile_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_rows ADD COLUMN worksheet_mapping_profile_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_rows', 'worksheet_mapping_profile_version_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_rows ADD COLUMN worksheet_mapping_profile_version_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_rows', 'source_row_number', 'integer', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_rows ADD COLUMN source_row_number INTEGER NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_rows', 'created_by', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_raw_rows ADD COLUMN created_by TEXT');
SELECT pg_temp.ensure_column('data_hub_raw_rows', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.data_hub_raw_rows ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('data_hub_raw_rows', ARRAY['id'],
  'ALTER TABLE public.data_hub_raw_rows ADD PRIMARY KEY (id)');

SELECT pg_temp.ensure_check(
  'data_hub_raw_rows',
  'data_hub_raw_rows_source_row_positive_check',
  'CHECK ((source_row_number >= 1))',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_source_row_positive_check CHECK (source_row_number >= 1)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_rows',
  'data_hub_raw_rows_id_worksheet_organisation_key',
  'UNIQUE (id, source_schema_worksheet_id, organisation_id)',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_id_worksheet_organisation_key UNIQUE (id, source_schema_worksheet_id, organisation_id)'
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_rows',
  'data_hub_raw_rows_upload_source_row_key',
  'UNIQUE (upload_id, source_row_number)',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_upload_source_row_key UNIQUE (upload_id, source_row_number)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_rows', 'data_hub_raw_rows_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_rows', 'data_hub_raw_rows_batch_schema_org_fkey',
  ARRAY['import_batch_id', 'source_schema_version_id', 'organisation_id'],
  'import_batches', ARRAY['id', 'source_schema_version_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_batch_schema_org_fkey FOREIGN KEY (import_batch_id, source_schema_version_id, organisation_id) REFERENCES public.import_batches(id, source_schema_version_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_rows', 'data_hub_raw_rows_upload_batch_org_fkey',
  ARRAY['upload_id', 'import_batch_id', 'organisation_id'],
  'uploads', ARRAY['id', 'import_batch_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_upload_batch_org_fkey FOREIGN KEY (upload_id, import_batch_id, organisation_id) REFERENCES public.uploads(id, import_batch_id, organisation_id)'
);

-- Proves the raw row uses the exact profile version frozen onto this
-- Upload's completed raw-staging metadata. Because uploads_raw_staging_
-- coherence_check requires raw_staged_at/profile/counts together, a raw
-- row cannot exist for an unstaged Upload and cannot silently reinterpret
-- that Upload under another governed profile version.
SELECT pg_temp.ensure_fk(
  'data_hub_raw_rows', 'data_hub_raw_rows_upload_profile_version_org_fkey',
  ARRAY['upload_id', 'worksheet_mapping_profile_version_id', 'organisation_id'],
  'uploads', ARRAY['id', 'raw_profile_version_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_upload_profile_version_org_fkey FOREIGN KEY (upload_id, worksheet_mapping_profile_version_id, organisation_id) REFERENCES public.uploads(id, raw_profile_version_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_rows', 'data_hub_raw_rows_schema_worksheet_fkey',
  ARRAY['source_schema_worksheet_id', 'source_schema_version_id', 'organisation_id'],
  'source_schema_worksheets', ARRAY['id', 'source_schema_version_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_schema_worksheet_fkey FOREIGN KEY (source_schema_worksheet_id, source_schema_version_id, organisation_id) REFERENCES public.source_schema_worksheets(id, source_schema_version_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_rows', 'data_hub_raw_rows_mapping_profile_fkey',
  ARRAY['worksheet_mapping_profile_id', 'source_schema_worksheet_id', 'organisation_id'],
  'worksheet_mapping_profiles', ARRAY['id', 'source_schema_worksheet_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_mapping_profile_fkey FOREIGN KEY (worksheet_mapping_profile_id, source_schema_worksheet_id, organisation_id) REFERENCES public.worksheet_mapping_profiles(id, source_schema_worksheet_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_rows', 'data_hub_raw_rows_mapping_profile_version_fkey',
  ARRAY['worksheet_mapping_profile_version_id', 'worksheet_mapping_profile_id', 'organisation_id'],
  'worksheet_mapping_profile_versions', ARRAY['id', 'worksheet_mapping_profile_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_mapping_profile_version_fkey FOREIGN KEY (worksheet_mapping_profile_version_id, worksheet_mapping_profile_id, organisation_id) REFERENCES public.worksheet_mapping_profile_versions(id, worksheet_mapping_profile_id, organisation_id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_rows', 'data_hub_raw_rows_created_by_fkey',
  ARRAY['created_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.data_hub_raw_rows ADD CONSTRAINT data_hub_raw_rows_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL'
);

CREATE INDEX IF NOT EXISTS idx_data_hub_raw_rows_org_batch ON public.data_hub_raw_rows(organisation_id, import_batch_id);
CREATE INDEX IF NOT EXISTS idx_data_hub_raw_rows_upload ON public.data_hub_raw_rows(upload_id);
CREATE INDEX IF NOT EXISTS idx_data_hub_raw_rows_schema ON public.data_hub_raw_rows(source_schema_version_id);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3 — public.data_hub_raw_cells
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.data_hub_raw_cells ();

SELECT pg_temp.ensure_column('data_hub_raw_cells', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_cells ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_cells', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_cells ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_cells', 'raw_row_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_cells ADD COLUMN raw_row_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_cells', 'source_schema_worksheet_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_cells ADD COLUMN source_schema_worksheet_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_cells', 'source_schema_column_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_cells ADD COLUMN source_schema_column_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_cells', 'column_ordinal', 'integer', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_cells ADD COLUMN column_ordinal INTEGER NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_cells', 'source_header', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_cells ADD COLUMN source_header TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_cells', 'raw_value', 'jsonb', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_cells ADD COLUMN raw_value JSONB NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_cells', 'raw_value_type', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_cells ADD COLUMN raw_value_type TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_cells', 'sensitivity_class', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_raw_cells ADD COLUMN sensitivity_class TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_raw_cells', 'original_unit', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_raw_cells ADD COLUMN original_unit TEXT');
SELECT pg_temp.ensure_column('data_hub_raw_cells', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.data_hub_raw_cells ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('data_hub_raw_cells', ARRAY['id'],
  'ALTER TABLE public.data_hub_raw_cells ADD PRIMARY KEY (id)');

SELECT pg_temp.ensure_check(
  'data_hub_raw_cells',
  'data_hub_raw_cells_column_ordinal_nonneg_check',
  'CHECK ((column_ordinal >= 0))',
  'ALTER TABLE public.data_hub_raw_cells ADD CONSTRAINT data_hub_raw_cells_column_ordinal_nonneg_check CHECK (column_ordinal >= 0)'
);

SELECT pg_temp.ensure_check(
  'data_hub_raw_cells',
  'data_hub_raw_cells_value_type_check',
  'CHECK ((raw_value_type = ANY (ARRAY[''STRING''::text, ''NUMBER''::text, ''BOOLEAN''::text, ''NULL''::text])))',
  $sql$ALTER TABLE public.data_hub_raw_cells ADD CONSTRAINT data_hub_raw_cells_value_type_check CHECK (raw_value_type IN ('STRING', 'NUMBER', 'BOOLEAN', 'NULL'))$sql$
);

SELECT pg_temp.ensure_check(
  'data_hub_raw_cells',
  'data_hub_raw_cells_value_shape_check',
  'CHECK ((((raw_value_type = ''STRING''::text) AND (jsonb_typeof(raw_value) = ''string''::text)) OR ((raw_value_type = ''NUMBER''::text) AND (jsonb_typeof(raw_value) = ''number''::text)) OR ((raw_value_type = ''BOOLEAN''::text) AND (jsonb_typeof(raw_value) = ''boolean''::text)) OR ((raw_value_type = ''NULL''::text) AND (raw_value = ''null''::jsonb))))',
  $sql$ALTER TABLE public.data_hub_raw_cells ADD CONSTRAINT data_hub_raw_cells_value_shape_check CHECK (
    (raw_value_type = 'STRING' AND jsonb_typeof(raw_value) = 'string')
    OR (raw_value_type = 'NUMBER' AND jsonb_typeof(raw_value) = 'number')
    OR (raw_value_type = 'BOOLEAN' AND jsonb_typeof(raw_value) = 'boolean')
    OR (raw_value_type = 'NULL' AND raw_value = 'null'::jsonb)
  )$sql$
);

SELECT pg_temp.ensure_unique_constraint(
  'data_hub_raw_cells',
  'data_hub_raw_cells_row_ordinal_key',
  'UNIQUE (raw_row_id, column_ordinal)',
  'ALTER TABLE public.data_hub_raw_cells ADD CONSTRAINT data_hub_raw_cells_row_ordinal_key UNIQUE (raw_row_id, column_ordinal)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_cells', 'data_hub_raw_cells_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_cells ADD CONSTRAINT data_hub_raw_cells_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)'
);

SELECT pg_temp.ensure_fk(
  'data_hub_raw_cells', 'data_hub_raw_cells_raw_row_worksheet_org_fkey',
  ARRAY['raw_row_id', 'source_schema_worksheet_id', 'organisation_id'],
  'data_hub_raw_rows', ARRAY['id', 'source_schema_worksheet_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_cells ADD CONSTRAINT data_hub_raw_cells_raw_row_worksheet_org_fkey FOREIGN KEY (raw_row_id, source_schema_worksheet_id, organisation_id) REFERENCES public.data_hub_raw_rows(id, source_schema_worksheet_id, organisation_id)'
);

-- Includes header + sensitivity snapshot so the durable cell cannot drift from
-- the exact governed column it claims to represent.
SELECT pg_temp.ensure_fk(
  'data_hub_raw_cells', 'data_hub_raw_cells_schema_column_fkey',
  ARRAY['source_schema_column_id', 'source_schema_worksheet_id', 'column_ordinal', 'source_header', 'sensitivity_class', 'organisation_id'],
  'source_schema_columns', ARRAY['id', 'source_schema_worksheet_id', 'ordinal', 'source_header', 'sensitivity_class', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_raw_cells ADD CONSTRAINT data_hub_raw_cells_schema_column_fkey FOREIGN KEY (source_schema_column_id, source_schema_worksheet_id, column_ordinal, source_header, sensitivity_class, organisation_id) REFERENCES public.source_schema_columns(id, source_schema_worksheet_id, ordinal, source_header, sensitivity_class, organisation_id)'
);

CREATE INDEX IF NOT EXISTS idx_data_hub_raw_cells_org_row ON public.data_hub_raw_cells(organisation_id, raw_row_id);
CREATE INDEX IF NOT EXISTS idx_data_hub_raw_cells_schema_column ON public.data_hub_raw_cells(source_schema_column_id);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 4 — uploads raw-staging completion metadata.
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_column('uploads', 'raw_staged_at', 'timestamp with time zone', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN raw_staged_at TIMESTAMPTZ');
SELECT pg_temp.ensure_column('uploads', 'raw_staged_by', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN raw_staged_by TEXT');
SELECT pg_temp.ensure_column('uploads', 'raw_profile_version_id', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN raw_profile_version_id TEXT');
SELECT pg_temp.ensure_column('uploads', 'raw_row_count', 'integer', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN raw_row_count INTEGER');
SELECT pg_temp.ensure_column('uploads', 'raw_cell_count', 'integer', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN raw_cell_count INTEGER');

SELECT pg_temp.ensure_check(
  'uploads',
  'uploads_raw_staging_counts_nonneg_check',
  'CHECK ((((raw_row_count IS NULL) OR (raw_row_count >= 0)) AND ((raw_cell_count IS NULL) OR (raw_cell_count >= 0))))',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_raw_staging_counts_nonneg_check CHECK ((raw_row_count IS NULL OR raw_row_count >= 0) AND (raw_cell_count IS NULL OR raw_cell_count >= 0))'
);

SELECT pg_temp.ensure_check(
  'uploads',
  'uploads_raw_staging_coherence_check',
  'CHECK ((((raw_staged_at IS NULL) AND (raw_staged_by IS NULL) AND (raw_profile_version_id IS NULL) AND (raw_row_count IS NULL) AND (raw_cell_count IS NULL)) OR ((raw_staged_at IS NOT NULL) AND (raw_profile_version_id IS NOT NULL) AND (raw_row_count IS NOT NULL) AND (raw_cell_count IS NOT NULL) AND (lineage_kind = ''DATA_HUB''::text))))',
  $sql$ALTER TABLE public.uploads ADD CONSTRAINT uploads_raw_staging_coherence_check CHECK (
    (
      raw_staged_at IS NULL
      AND raw_staged_by IS NULL
      AND raw_profile_version_id IS NULL
      AND raw_row_count IS NULL
      AND raw_cell_count IS NULL
    )
    OR
    (
      raw_staged_at IS NOT NULL
      AND raw_profile_version_id IS NOT NULL
      AND raw_row_count IS NOT NULL
      AND raw_cell_count IS NOT NULL
      AND lineage_kind = 'DATA_HUB'
    )
  )$sql$
);

SELECT pg_temp.ensure_fk(
  'uploads', 'uploads_raw_staged_by_fkey',
  ARRAY['raw_staged_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_raw_staged_by_fkey FOREIGN KEY (raw_staged_by) REFERENCES public.users(id) ON DELETE SET NULL'
);

SELECT pg_temp.ensure_fk(
  'uploads', 'uploads_raw_profile_version_org_fkey',
  ARRAY['raw_profile_version_id', 'organisation_id'],
  'worksheet_mapping_profile_versions', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_raw_profile_version_org_fkey FOREIGN KEY (raw_profile_version_id, organisation_id) REFERENCES public.worksheet_mapping_profile_versions(id, organisation_id)'
);

-- One-way raw-staging completion metadata.
CREATE OR REPLACE FUNCTION public.datahub_guard_upload_raw_staging_metadata()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  -- Before first completion, all fields are expected NULL by CHECK. A first
  -- transition to staged must carry an actor and full metadata atomically.
  IF OLD.raw_staged_at IS NULL THEN
    IF NEW.raw_staged_at IS NULL THEN
      RETURN NEW;
    END IF;

    IF NEW.raw_staged_by IS NULL THEN
      RAISE EXCEPTION 'uploads: initial raw staging completion requires raw_staged_by (upload=%)', OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Once staged, all staging identity/count/timestamp fields are frozen.
  IF NEW.raw_staged_at IS DISTINCT FROM OLD.raw_staged_at
     OR NEW.raw_profile_version_id IS DISTINCT FROM OLD.raw_profile_version_id
     OR NEW.raw_row_count IS DISTINCT FROM OLD.raw_row_count
     OR NEW.raw_cell_count IS DISTINCT FROM OLD.raw_cell_count THEN
    RAISE EXCEPTION 'uploads: raw staging metadata is immutable once completed (upload=%)', OLD.id;
  END IF;

  -- Actor deletion may drive non-NULL -> NULL through ON DELETE SET NULL.
  -- Any other rewrite of the staging actor is forbidden.
  IF NEW.raw_staged_by IS DISTINCT FROM OLD.raw_staged_by THEN
    IF NOT (OLD.raw_staged_by IS NOT NULL AND NEW.raw_staged_by IS NULL) THEN
      RAISE EXCEPTION 'uploads: raw_staged_by cannot be rewritten after staging completion (upload=%)', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS datahub_guard_upload_raw_staging_metadata ON public.uploads;
CREATE TRIGGER datahub_guard_upload_raw_staging_metadata
  BEFORE UPDATE ON public.uploads
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_upload_raw_staging_metadata();

-- ═══════════════════════════════════════════════════════════════════
-- STEP 5 — raw evidence is append-only/immutable.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.datahub_guard_raw_row_immutable()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'data_hub_raw_rows: raw source evidence is immutable; DELETE is not permitted (id=%)', OLD.id;
  END IF;
  RAISE EXCEPTION 'data_hub_raw_rows: raw source evidence is immutable; UPDATE is not permitted (id=%)', OLD.id;
END;
$fn$;

DROP TRIGGER IF EXISTS datahub_guard_raw_row_immutable ON public.data_hub_raw_rows;
CREATE TRIGGER datahub_guard_raw_row_immutable
  BEFORE UPDATE OR DELETE ON public.data_hub_raw_rows
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_raw_row_immutable();

CREATE OR REPLACE FUNCTION public.datahub_guard_raw_cell_immutable()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'data_hub_raw_cells: raw source evidence is immutable; DELETE is not permitted (id=%)', OLD.id;
  END IF;
  RAISE EXCEPTION 'data_hub_raw_cells: raw source evidence is immutable; UPDATE is not permitted (id=%)', OLD.id;
END;
$fn$;

DROP TRIGGER IF EXISTS datahub_guard_raw_cell_immutable ON public.data_hub_raw_cells;
CREATE TRIGGER datahub_guard_raw_cell_immutable
  BEFORE UPDATE OR DELETE ON public.data_hub_raw_cells
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_raw_cell_immutable();

COMMIT;

-- Rollback is deliberately manual and not executed automatically. Because raw
-- evidence is historical source lineage, rollback is safe only before any D4A
-- runtime path has persisted raw rows/cells.
