-- Data Hub 6.2D4C-B2B1 — NORMALIZATION EXECUTION PERSISTENCE.
--
-- Adds the durable primitives a future resumable normalization EXECUTOR
-- will write into: an immutable findings table, and an atomic batch-commit
-- function mirroring D4B's own datahub_stage_raw_batch. NO executor, API
-- route, Prisma application service, workbook read, or canonical/domain
-- write is added in this phase — this is persistence/lifecycle only.
--
-- ADDITIVE. This is a SEPARATE migration from D4A
-- (scripts/create-datahub-raw-staging.sql), D4B
-- (scripts/create-datahub-raw-staging-runs.sql), and D4C-B1
-- (scripts/create-datahub-normalized-staging.sql), none of which are
-- modified by this file except datahub_complete_normalization_run() (see
-- STEP 4 below — CREATE OR REPLACE only, same signature, guarded by an
-- explicit test that its every other invariant is unchanged).
--
-- Trusted chain this migration extends:
--   successful DataHubRawStagingRun -> DataHubNormalizationRun
--     -> DataHubNormalizedRow -> DataHubNormalizedCell        (D4C-B1, untouched)
--     -> DataHubNormalizationFinding                          (this migration)
--
-- NON-NEGOTIABLE INVARIANTS:
--   1. Findings carry ONLY governed metadata/lineage — no raw_value, no
--      source text/header copy, no free-form message, no PII payload, no
--      arbitrary exception detail. severity/finding_code are closed
--      allowlists mirroring lib/data-hub/normalization/contracts.ts's own
--      NormalizationFindingSeverity/NormalizationFindingCode exactly
--      (hand-mirrored, same precedent as D4C-B1's value_kind CHECK — SQL
--      cannot import a TS module).
--   2. Findings are immutable after INSERT (UPDATE and DELETE both
--      rejected) — reuses D4C-B1's own
--      datahub_guard_normalized_evidence_immutable() trigger function
--      verbatim (it is already fully generic; not redefined here).
--   3. datahub_stage_normalized_batch(...) is the ONLY way normalized
--      rows/cells/findings are written: one transaction, lease-verified
--      before AND after every insert (exact D4B precedent), and refuses a
--      batch where the same raw row appears as both a successfully
--      normalized row and a BLOCKING_ERROR finding — "no partial row
--      success" is enforced structurally, not left as a caller convention.
--   4. Completion requires ZERO blocking findings for the run — enforced
--      at the DB completion gate (defense in depth), independent of
--      whatever the future executor's own logic does.
--   5. No active/current profile pointer (WorksheetMappingProfile.active_
--      profile_version_id) is read anywhere in this file.
--
-- Creates:
--   public.data_hub_normalization_findings
--   public.datahub_stage_normalized_batch(...)   -- atomic batch insert + lease guard
-- Replaces (CREATE OR REPLACE only, same signature/return type — see STEP 4):
--   public.datahub_complete_normalization_run(...)  -- adds the blocking-findings-zero gate
--
-- NO SYNTHETIC BACKFILL, NO DATA WRITE of any kind performed by this
-- migration itself. Production/Preview/Neon execution remains a separate
-- explicit gate, applied independently. NOT executed by this task.

BEGIN;

-- Every create-datahub-*.sql script redefines its own copies of these
-- pg_temp helpers (session-scoped). Copied verbatim from
-- scripts/create-datahub-normalized-staging.sql.

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
-- PRECONDITION — D4A/D4B/D4C-B1 must already be applied.
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.data_hub_normalization_runs') IS NULL
     OR to_regclass('public.data_hub_normalized_rows') IS NULL
     OR to_regclass('public.data_hub_normalized_cells') IS NULL THEN
    RAISE EXCEPTION '6.2D4C-B2B1 requires the D4C-B1 foundation (data_hub_normalization_runs/data_hub_normalized_rows/data_hub_normalized_cells) to already exist. Apply scripts/create-datahub-normalized-staging.sql first.';
  END IF;
  IF to_regclass('public.data_hub_raw_staging_runs') IS NULL
     OR to_regclass('public.data_hub_raw_rows') IS NULL
     OR to_regclass('public.data_hub_raw_cells') IS NULL THEN
    RAISE EXCEPTION '6.2D4C-B2B1 requires the D4A/D4B foundation to already exist.';
  END IF;
  IF to_regproc('public.datahub_guard_normalized_evidence_immutable') IS NULL THEN
    RAISE EXCEPTION '6.2D4C-B2B1 requires D4C-B1''s datahub_guard_normalized_evidence_immutable() to already exist (reused verbatim, not redefined here).';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1 — public.data_hub_normalization_findings
--
-- Every finding is tied to a normalization run and a raw row; raw_cell_id/
-- source_schema_column_id are nullable (a finding can be row-level — e.g.
-- a structural issue not tied to one specific cell — or cell-level).
-- raw_staging_run_id is a denormalized lineage column, same precedent and
-- same reason as DataHubNormalizedRow.raw_staging_run_id: it lets this
-- table structurally prove its own raw_row_id really belongs to the same
-- raw staging run the normalization run is pinned to, and (via the wider
-- raw-row key) that its own declared source_row_number is that raw row's
-- own physical row number — never an arbitrary claim.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.data_hub_normalization_findings ();

SELECT pg_temp.ensure_column('data_hub_normalization_findings', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_findings ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_findings', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_findings ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_findings', 'normalization_run_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_findings ADD COLUMN normalization_run_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_findings', 'raw_staging_run_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_findings ADD COLUMN raw_staging_run_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_findings', 'raw_row_id', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_findings ADD COLUMN raw_row_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_findings', 'source_row_number', 'integer', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_findings ADD COLUMN source_row_number INTEGER NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_findings', 'raw_cell_id', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_normalization_findings ADD COLUMN raw_cell_id TEXT');
SELECT pg_temp.ensure_column('data_hub_normalization_findings', 'source_schema_column_id', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_normalization_findings ADD COLUMN source_schema_column_id TEXT');
SELECT pg_temp.ensure_column('data_hub_normalization_findings', 'severity', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_findings ADD COLUMN severity TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_findings', 'finding_code', 'text', false, true, NULL,
  'ALTER TABLE public.data_hub_normalization_findings ADD COLUMN finding_code TEXT NOT NULL');
SELECT pg_temp.ensure_column('data_hub_normalization_findings', 'value_kind', 'text', true, true, NULL,
  'ALTER TABLE public.data_hub_normalization_findings ADD COLUMN value_kind TEXT');
SELECT pg_temp.ensure_column('data_hub_normalization_findings', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.data_hub_normalization_findings ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('data_hub_normalization_findings', ARRAY['id'],
  'ALTER TABLE public.data_hub_normalization_findings ADD PRIMARY KEY (id)');

-- Mirrors lib/data-hub/normalization/contracts.ts's NormalizationFindingSeverity exactly.
SELECT pg_temp.ensure_check(
  'data_hub_normalization_findings',
  'data_hub_normalization_findings_severity_check',
  'CHECK ((severity = ANY (ARRAY[''WARNING''::text, ''BLOCKING_ERROR''::text])))',
  $sql$ALTER TABLE public.data_hub_normalization_findings ADD CONSTRAINT data_hub_normalization_findings_severity_check CHECK (
    severity IN ('WARNING', 'BLOCKING_ERROR')
  )$sql$
);

-- Mirrors lib/data-hub/normalization/contracts.ts's NORMALIZATION_FINDING_CODES
-- allowlist exactly (hand-mirrored; SQL cannot import a TS module — kept in
-- sync by hand, same precedent as data_hub_normalized_cells_value_kind_check).
SELECT pg_temp.ensure_check(
  'data_hub_normalization_findings',
  'data_hub_normalization_findings_code_check',
  'CHECK ((finding_code = ANY (ARRAY[''PROFILE_DOCUMENT_INVALID''::text, ''NORMALIZATION_INELIGIBLE_V1''::text, ''MISSING_GOVERNED_RULE''::text, ''UNKNOWN_RULE_COLUMN''::text, ''INVALID_RAW_SHAPE''::text, ''UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND''::text, ''MALFORMED_NUMERIC_STRING''::text, ''UNSAFE_NUMERIC_VALUE''::text, ''INTEGER_NOT_WHOLE''::text, ''LATITUDE_OUT_OF_RANGE''::text, ''LONGITUDE_OUT_OF_RANGE''::text, ''NON_TERMINATING_UNIT_CONVERSION''::text, ''MALFORMED_DATE_STRING''::text, ''INVALID_CALENDAR_DATE''::text, ''MALFORMED_TIME_STRING''::text, ''INVALID_CLOCK_TIME''::text, ''MALFORMED_DATETIME_STRING''::text, ''MISSING_SOURCE_OFFSET''::text, ''UNEXPECTED_OFFSET_PRESENT''::text, ''INVALID_UTC_OFFSET''::text, ''NORMALIZED_YEAR_OUT_OF_RANGE''::text, ''INVALID_IANA_ZONE''::text, ''NONEXISTENT_LOCAL_TIME''::text, ''AMBIGUOUS_LOCAL_TIME''::text, ''IANA_OFFSET_UNRESOLVABLE''::text])))',
  $sql$ALTER TABLE public.data_hub_normalization_findings ADD CONSTRAINT data_hub_normalization_findings_code_check CHECK (
    finding_code IN (
      'PROFILE_DOCUMENT_INVALID', 'NORMALIZATION_INELIGIBLE_V1', 'MISSING_GOVERNED_RULE', 'UNKNOWN_RULE_COLUMN',
      'INVALID_RAW_SHAPE', 'UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND',
      'MALFORMED_NUMERIC_STRING', 'UNSAFE_NUMERIC_VALUE', 'INTEGER_NOT_WHOLE', 'LATITUDE_OUT_OF_RANGE', 'LONGITUDE_OUT_OF_RANGE',
      'NON_TERMINATING_UNIT_CONVERSION',
      'MALFORMED_DATE_STRING', 'INVALID_CALENDAR_DATE', 'MALFORMED_TIME_STRING', 'INVALID_CLOCK_TIME', 'MALFORMED_DATETIME_STRING',
      'MISSING_SOURCE_OFFSET', 'UNEXPECTED_OFFSET_PRESENT', 'INVALID_UTC_OFFSET', 'NORMALIZED_YEAR_OUT_OF_RANGE',
      'INVALID_IANA_ZONE', 'NONEXISTENT_LOCAL_TIME', 'AMBIGUOUS_LOCAL_TIME', 'IANA_OFFSET_UNRESOLVABLE'
    )
  )$sql$
);

-- Mirrors the D4C-A/D4C-B1 ValueKind vocabulary exactly. Nullable — a
-- plan-level finding (e.g. MISSING_GOVERNED_RULE) has no single value kind.
SELECT pg_temp.ensure_check(
  'data_hub_normalization_findings',
  'data_hub_normalization_findings_value_kind_check',
  'CHECK (((value_kind IS NULL) OR (value_kind = ANY (ARRAY[''STRING''::text, ''IDENTIFIER''::text, ''INTEGER''::text, ''DECIMAL''::text, ''BOOLEAN''::text, ''DATE''::text, ''TIME''::text, ''DATETIME''::text, ''DURATION''::text, ''PERCENTAGE''::text, ''CURRENCY''::text, ''LATITUDE''::text, ''LONGITUDE''::text]))))',
  $sql$ALTER TABLE public.data_hub_normalization_findings ADD CONSTRAINT data_hub_normalization_findings_value_kind_check CHECK (
    value_kind IS NULL OR value_kind IN ('STRING','IDENTIFIER','INTEGER','DECIMAL','BOOLEAN','DATE','TIME','DATETIME','DURATION','PERCENTAGE','CURRENCY','LATITUDE','LONGITUDE')
  )$sql$
);

-- raw_cell_id and source_schema_column_id must agree: both present or both
-- absent never enforced here on purpose — a row-level finding may name a
-- governed column without a specific cell only if that is ever needed, but
-- MISSING_GOVERNED_RULE/UNKNOWN_RULE_COLUMN style findings always DO have a
-- concrete raw cell in D4B's data model, so in practice both are usually
-- present together; not structurally forced to keep this table usable for
-- genuinely row-only findings without inventing an unused cell reference.

SELECT pg_temp.ensure_fk(
  'data_hub_normalization_findings', 'data_hub_normalization_findings_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_findings ADD CONSTRAINT data_hub_normalization_findings_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)'
);

-- Finding belongs to the run's own organisation.
SELECT pg_temp.ensure_fk(
  'data_hub_normalization_findings', 'data_hub_normalization_findings_run_org_fkey',
  ARRAY['normalization_run_id', 'organisation_id'],
  'data_hub_normalization_runs', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_findings ADD CONSTRAINT data_hub_normalization_findings_run_org_fkey FOREIGN KEY (normalization_run_id, organisation_id) REFERENCES public.data_hub_normalization_runs(id, organisation_id)'
);

-- Proves this finding's own raw_staging_run_id agrees with its normalization
-- run's own pin (never a different run's raw evidence) — same idiom as
-- data_hub_normalized_rows_run_raw_run_fkey.
SELECT pg_temp.ensure_fk(
  'data_hub_normalization_findings', 'data_hub_normalization_findings_run_raw_run_fkey',
  ARRAY['normalization_run_id', 'raw_staging_run_id', 'organisation_id'],
  'data_hub_normalization_runs', ARRAY['id', 'raw_staging_run_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_findings ADD CONSTRAINT data_hub_normalization_findings_run_raw_run_fkey FOREIGN KEY (normalization_run_id, raw_staging_run_id, organisation_id) REFERENCES public.data_hub_normalization_runs(id, raw_staging_run_id, organisation_id)'
);

-- Proves this finding's own raw_row_id really belongs to the raw staging
-- run its normalization run is pinned to, AND that its own declared
-- source_row_number is that SAME raw row's own physical source_row_number
-- (the exact D4C-B1 remediation idiom for physical source-row identity —
-- a finding can never reference raw row A while claiming an arbitrary
-- different row number).
SELECT pg_temp.ensure_fk(
  'data_hub_normalization_findings', 'data_hub_normalization_findings_raw_row_fkey',
  ARRAY['raw_row_id', 'raw_staging_run_id', 'source_row_number', 'organisation_id'],
  'data_hub_raw_rows', ARRAY['id', 'staging_run_id', 'source_row_number', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_findings ADD CONSTRAINT data_hub_normalization_findings_raw_row_fkey FOREIGN KEY (raw_row_id, raw_staging_run_id, source_row_number, organisation_id) REFERENCES public.data_hub_raw_rows(id, staging_run_id, source_row_number, organisation_id)'
);

-- Exact raw cell, tenant-scoped — MATCH SIMPLE, so a NULL raw_cell_id
-- (row-level finding) is entirely exempt from this and the two FKs below.
SELECT pg_temp.ensure_fk(
  'data_hub_normalization_findings', 'data_hub_normalization_findings_raw_cell_org_fkey',
  ARRAY['raw_cell_id', 'organisation_id'],
  'data_hub_raw_cells', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_findings ADD CONSTRAINT data_hub_normalization_findings_raw_cell_org_fkey FOREIGN KEY (raw_cell_id, organisation_id) REFERENCES public.data_hub_raw_cells(id, organisation_id)'
);

-- Proves that (when present) the raw cell really belongs to the exact raw
-- row this finding concerns (never a different row's cell).
SELECT pg_temp.ensure_fk(
  'data_hub_normalization_findings', 'data_hub_normalization_findings_raw_cell_row_fkey',
  ARRAY['raw_cell_id', 'raw_row_id', 'organisation_id'],
  'data_hub_raw_cells', ARRAY['id', 'raw_row_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_findings ADD CONSTRAINT data_hub_normalization_findings_raw_cell_row_fkey FOREIGN KEY (raw_cell_id, raw_row_id, organisation_id) REFERENCES public.data_hub_raw_cells(id, raw_row_id, organisation_id)'
);

-- Proves the declared governed column identity (when present) agrees with
-- that SAME raw cell's own recorded column id (never a mismatched/invented
-- column) — MATCH SIMPLE, so this is exempt whenever either side is NULL.
SELECT pg_temp.ensure_fk(
  'data_hub_normalization_findings', 'data_hub_normalization_findings_raw_cell_column_fkey',
  ARRAY['raw_cell_id', 'source_schema_column_id', 'organisation_id'],
  'data_hub_raw_cells', ARRAY['id', 'source_schema_column_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_findings ADD CONSTRAINT data_hub_normalization_findings_raw_cell_column_fkey FOREIGN KEY (raw_cell_id, source_schema_column_id, organisation_id) REFERENCES public.data_hub_raw_cells(id, source_schema_column_id, organisation_id)'
);

-- The governed column itself (when present) must be real, tenant-scoped.
SELECT pg_temp.ensure_fk(
  'data_hub_normalization_findings', 'data_hub_normalization_findings_column_org_fkey',
  ARRAY['source_schema_column_id', 'organisation_id'],
  'source_schema_columns', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.data_hub_normalization_findings ADD CONSTRAINT data_hub_normalization_findings_column_org_fkey FOREIGN KEY (source_schema_column_id, organisation_id) REFERENCES public.source_schema_columns(id, organisation_id)'
);

-- Primary query pattern: the completion gate's own blocking-findings count
-- (STEP 4) filters by (normalization_run_id, severity) — drift-checked,
-- per the established "every D4C-B1+ index must be pg_temp.ensure_index-
-- checked" convention (no bare CREATE INDEX IF NOT EXISTS anywhere in this
-- file).
SELECT pg_temp.ensure_index(
  'data_hub_normalization_findings', 'idx_data_hub_normalization_findings_run_severity',
  'CREATE INDEX idx_data_hub_normalization_findings_run_severity ON public.data_hub_normalization_findings USING btree (normalization_run_id, severity)',
  'CREATE INDEX idx_data_hub_normalization_findings_run_severity ON public.data_hub_normalization_findings (normalization_run_id, severity)'
);
SELECT pg_temp.ensure_index(
  'data_hub_normalization_findings', 'idx_data_hub_normalization_findings_org_run',
  'CREATE INDEX idx_data_hub_normalization_findings_org_run ON public.data_hub_normalization_findings USING btree (organisation_id, normalization_run_id)',
  'CREATE INDEX idx_data_hub_normalization_findings_org_run ON public.data_hub_normalization_findings (organisation_id, normalization_run_id)'
);
SELECT pg_temp.ensure_index(
  'data_hub_normalization_findings', 'idx_data_hub_normalization_findings_raw_row',
  'CREATE INDEX idx_data_hub_normalization_findings_raw_row ON public.data_hub_normalization_findings USING btree (raw_row_id)',
  'CREATE INDEX idx_data_hub_normalization_findings_raw_row ON public.data_hub_normalization_findings (raw_row_id)'
);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2 — findings are immutable after INSERT. Reuses D4C-B1's own
-- datahub_guard_normalized_evidence_immutable() verbatim (it is already
-- fully generic — keyed off TG_TABLE_NAME/OLD.id — not redefined here).
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS data_hub_normalization_findings_immutable_guard ON public.data_hub_normalization_findings;
CREATE TRIGGER data_hub_normalization_findings_immutable_guard
  BEFORE UPDATE OR DELETE ON public.data_hub_normalization_findings
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_normalized_evidence_immutable();

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3 — datahub_stage_normalized_batch(...): the atomic batch-commit
-- primitive. Exact D4B precedent (datahub_stage_raw_batch), applied to
-- normalization instead of raw staging, within ONE transaction:
--   1-4. lock + verify RUNNING + verify token + verify lease live, THEN
--        renew the lease — BEFORE any evidence insert. An expired lease is
--        treated exactly like a wrong token, regardless of whether the
--        token string still matches.
--   5.   verify the pinned raw_staging_run is STILL SUCCEEDED.
--   (unambiguous persistence) refuse a batch where the same raw row
--        appears as both a normalized row and a BLOCKING_ERROR finding.
--   6-7. bulk-insert normalized rows/cells, then findings.
--   8-9. re-verify the SAME lease while recording progress and
--        last_progress_at. A mismatch here RAISEs, rolling back the
--        ENTIRE statement — including every insert above. Returning a
--        partial/lease-lost result after committing partial evidence is
--        impossible by construction.
--   10.  the re-verify IS the "recheck token/live lease before return" —
--        there is no path to RETURN QUERY without it having just passed.
--
-- Cell identity (source_schema_column_id, raw_cell_id, valueKind,
-- normalizedValue, sourceUnit, normalizedUnit) is NEVER inferred
-- positionally — every entry in p_normalized_payload/p_finding_payload
-- already carries its own exact values, resolved by the caller.
--
-- p_normalized_payload shape (jsonb array), one entry per successfully
-- normalized row:
--   [{ "id": "...", "rawRowId": "...", "sourceRowNumber": 12,
--      "cells": [{ "id": "...", "rawCellId": "...", "sourceSchemaColumnId": "...",
--                  "valueKind": "STRING", "normalizedValue": <json scalar/null>,
--                  "sourceUnit": "kg"|null, "normalizedUnit": "kg"|null }] }]
--
-- p_finding_payload shape (jsonb array), one entry per finding:
--   [{ "id": "...", "rawRowId": "...", "sourceRowNumber": 12,
--      "rawCellId": "..."|null, "sourceSchemaColumnId": "..."|null,
--      "severity": "BLOCKING_ERROR"|"WARNING", "findingCode": "...",
--      "valueKind": "..."|null }]
--
-- Scope note: this function enforces "no partial row success" WITHIN one
-- call. It does not (and structurally cannot, without an additional
-- cross-call scan this phase does not add) prevent a caller from writing a
-- normalized row for a raw row in one call and a blocking finding for that
-- SAME raw row in a LATER call — that discipline belongs to the future
-- executor, which is explicitly out of scope for B2B1.
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.datahub_stage_normalized_batch(text, text, text, jsonb, jsonb, integer);

CREATE OR REPLACE FUNCTION public.datahub_stage_normalized_batch(
  p_normalization_run_id text,
  p_organisation_id text,
  p_execution_token text,
  p_normalized_payload jsonb,
  p_finding_payload jsonb,
  p_lease_seconds integer
) RETURNS TABLE(inserted_row_count integer, inserted_cell_count integer, inserted_finding_count integer)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_lease_rows int;
  v_progress_rows int;
  v_row_count int;
  v_cell_count int;
  v_finding_count int;
  v_raw_staging_run_id text;
  v_raw_status text;
  v_overlap_count int;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 THEN
    RAISE EXCEPTION 'datahub_stage_normalized_batch: p_lease_seconds must be a positive integer (got %)', p_lease_seconds;
  END IF;
  IF p_normalized_payload IS NULL OR jsonb_typeof(p_normalized_payload) <> 'array' THEN
    RAISE EXCEPTION 'datahub_stage_normalized_batch: p_normalized_payload must be a JSON array';
  END IF;
  IF p_finding_payload IS NULL OR jsonb_typeof(p_finding_payload) <> 'array' THEN
    RAISE EXCEPTION 'datahub_stage_normalized_batch: p_finding_payload must be a JSON array';
  END IF;

  -- Steps 1-4: verify AND RENEW the lease BEFORE any evidence insert.
  UPDATE public.data_hub_normalization_runs
  SET lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_progress_at = now()
  WHERE id = p_normalization_run_id AND organisation_id = p_organisation_id
    AND status = 'RUNNING' AND execution_token = p_execution_token
    AND lease_expires_at > now()
  RETURNING raw_staging_run_id INTO v_raw_staging_run_id;
  GET DIAGNOSTICS v_lease_rows = ROW_COUNT;
  IF v_lease_rows <> 1 THEN
    RAISE EXCEPTION 'datahub_stage_normalized_batch: lease not held before insert (normalization_run_id=%, expected exactly 1 row, got %)',
      p_normalization_run_id, v_lease_rows;
  END IF;

  -- Step 5: the pinned raw staging run must still be SUCCEEDED.
  SELECT status INTO v_raw_status FROM public.data_hub_raw_staging_runs WHERE id = v_raw_staging_run_id AND organisation_id = p_organisation_id;
  IF v_raw_status IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION 'datahub_stage_normalized_batch: pinned raw_staging_run is no longer SUCCEEDED (normalization_run_id=%, raw_staging_run_id=%, status=%)',
      p_normalization_run_id, v_raw_staging_run_id, v_raw_status;
  END IF;

  -- Unambiguous persistence: a raw row may never appear as BOTH a
  -- successfully normalized row AND the subject of a BLOCKING_ERROR
  -- finding within this SAME batch call.
  SELECT count(*) INTO v_overlap_count
    FROM (SELECT DISTINCT r ->> 'rawRowId' AS raw_row_id FROM jsonb_array_elements(p_normalized_payload) AS r) nr
    JOIN (SELECT DISTINCT f ->> 'rawRowId' AS raw_row_id FROM jsonb_array_elements(p_finding_payload) AS f WHERE f ->> 'severity' = 'BLOCKING_ERROR') bf
      ON nr.raw_row_id = bf.raw_row_id;
  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION 'datahub_stage_normalized_batch: % raw row(s) appear in both the normalized payload and a BLOCKING_ERROR finding in this same batch — a blocking finding means that row cannot be represented as successfully normalized',
      v_overlap_count;
  END IF;

  -- Step 6: bulk-insert normalized rows.
  INSERT INTO public.data_hub_normalized_rows (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, created_at)
  SELECT r ->> 'id', p_organisation_id, p_normalization_run_id, v_raw_staging_run_id, r ->> 'rawRowId', (r ->> 'sourceRowNumber')::int, now()
  FROM jsonb_array_elements(p_normalized_payload) AS r;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  -- bulk-insert normalized cells — every identity field taken verbatim
  -- from the caller-supplied, already-resolved values (never inferred
  -- positionally).
  INSERT INTO public.data_hub_normalized_cells (id, organisation_id, normalized_row_id, raw_row_id, raw_cell_id, source_schema_column_id, value_kind, normalized_value, source_unit, normalized_unit, created_at)
  SELECT c ->> 'id', p_organisation_id, r ->> 'id', r ->> 'rawRowId', c ->> 'rawCellId', c ->> 'sourceSchemaColumnId', c ->> 'valueKind', c -> 'normalizedValue', c ->> 'sourceUnit', c ->> 'normalizedUnit', now()
  FROM jsonb_array_elements(p_normalized_payload) AS r,
       jsonb_array_elements(r -> 'cells') AS c;
  GET DIAGNOSTICS v_cell_count = ROW_COUNT;

  -- Step 7: bulk-insert findings.
  INSERT INTO public.data_hub_normalization_findings (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, raw_cell_id, source_schema_column_id, severity, finding_code, value_kind, created_at)
  SELECT f ->> 'id', p_organisation_id, p_normalization_run_id, v_raw_staging_run_id, f ->> 'rawRowId', (f ->> 'sourceRowNumber')::int, f ->> 'rawCellId', f ->> 'sourceSchemaColumnId', f ->> 'severity', f ->> 'findingCode', f ->> 'valueKind', now()
  FROM jsonb_array_elements(p_finding_payload) AS f;
  GET DIAGNOSTICS v_finding_count = ROW_COUNT;

  -- Steps 8-10: re-verify the SAME lease while recording progress. A
  -- mismatch here RAISEs, rolling back the ENTIRE statement including the
  -- inserts above — there is no path to RETURN QUERY without this having
  -- just passed, which IS the "recheck token/live lease before return".
  UPDATE public.data_hub_normalization_runs
  SET persisted_row_count = persisted_row_count + v_row_count,
      persisted_cell_count = persisted_cell_count + v_cell_count,
      last_progress_at = now()
  WHERE id = p_normalization_run_id AND organisation_id = p_organisation_id
    AND status = 'RUNNING' AND execution_token = p_execution_token
    AND lease_expires_at > now();
  GET DIAGNOSTICS v_progress_rows = ROW_COUNT;
  IF v_progress_rows <> 1 THEN
    RAISE EXCEPTION 'datahub_stage_normalized_batch: lease lost before progress commit (normalization_run_id=%, expected exactly 1 row, got %)',
      p_normalization_run_id, v_progress_rows;
  END IF;

  RETURN QUERY SELECT v_row_count, v_cell_count, v_finding_count;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 4 — datahub_complete_normalization_run(...): CREATE OR REPLACE
-- ONLY. Exact same signature/return type as D4C-B1's own definition (no
-- DROP FUNCTION needed), with exactly one addition: completion is refused
-- while ANY blocking finding exists for the run. Every other invariant
-- (lease/token/lease-expiry checks, actor tenant check, raw-run-still-
-- SUCCEEDED check, row/cell count reconciliation, atomic run+Upload
-- completion write) is copied verbatim from the D4C-B1 body — see
-- tests/containment's own byte-level diff assertion proving this.
-- ═══════════════════════════════════════════════════════════════════

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
  v_blocking_finding_count int;
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

  -- 6.2D4C-B2B1 — completion is impossible while any blocking finding
  -- exists for this run. Enforced HERE (the DB completion gate) as
  -- defense in depth, independent of whatever the future executor's own
  -- logic does; datahub_stage_normalized_batch's own overlap check is the
  -- OTHER, earlier line of defense (a blocking finding can never coexist
  -- with a normalized row for the SAME raw row in one batch), but this
  -- check is unconditional across the whole run regardless of how the
  -- findings arrived.
  SELECT count(*) INTO v_blocking_finding_count
    FROM public.data_hub_normalization_findings
    WHERE normalization_run_id = p_normalization_run_id AND severity = 'BLOCKING_ERROR';
  IF v_blocking_finding_count > 0 THEN
    RAISE EXCEPTION 'datahub_complete_normalization_run: % blocking finding(s) exist for this run; completion is not possible (normalization_run_id=%)',
      v_blocking_finding_count, p_normalization_run_id;
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
-- scripts/rollback-datahub-normalization-findings.sql: it aborts if any
-- finding evidence exists, otherwise drops every object this file created
-- and restores datahub_complete_normalization_run() to its EXACT D4C-B1
-- body (verbatim, without the blocking-findings-zero gate).
