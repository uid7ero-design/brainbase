-- Data Hub 6.2D4D1B1 — durable dataset-profile persistence foundation.
-- Additive only. No profiler execution, API, UI, Upload profile pointer, or
-- production data mutation occurs here.
--
-- Trusted chain extended by this migration:
--   Upload -> authoritative SUCCEEDED DataHubNormalizationRun
--     -> DataHubDatasetProfileRun -> DataHubDatasetProfileColumn
--
-- Profile rows are derived structural evidence. STRING/IDENTIFIER source
-- values, raw values, exemplars and source headers have no storage column.
-- Exact decimal/ratio/temporal statistics are persisted as TEXT exactly as
-- produced by D4D1A; this layer never converts them through floating point.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.data_hub_normalization_runs') IS NULL
     OR to_regclass('public.data_hub_normalized_rows') IS NULL
     OR to_regclass('public.data_hub_normalized_cells') IS NULL THEN
    RAISE EXCEPTION '6.2D4D1B1 requires the D4C normalized evidence foundation to already exist';
  END IF;
END $$;

-- Wider immutable lineage target. Additive only: lets a dataset-profile run
-- prove every duplicated pin agrees with the exact normalization run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.data_hub_normalization_runs'::regclass
      AND conname = 'data_hub_normalization_runs_profile_lineage_key'
  ) THEN
    ALTER TABLE public.data_hub_normalization_runs
      ADD CONSTRAINT data_hub_normalization_runs_profile_lineage_key
      UNIQUE (
        id,
        import_batch_id,
        upload_id,
        source_schema_version_id,
        source_schema_worksheet_id,
        worksheet_mapping_profile_version_id,
        organisation_id
      );
  END IF;
END $$;

-- Authoritative Upload normalization pointer target. This proves a profile
-- run cannot select an older/alternate SUCCEEDED normalization attempt for
-- the same upload: it must be the exact run Upload.normalization_run_id
-- names as authoritative.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.uploads'::regclass
      AND conname = 'uploads_id_normalization_run_organisation_key'
  ) THEN
    ALTER TABLE public.uploads
      ADD CONSTRAINT uploads_id_normalization_run_organisation_key
      UNIQUE (id, normalization_run_id, organisation_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.data_hub_dataset_profile_runs (
  id text PRIMARY KEY,
  organisation_id text NOT NULL,
  import_batch_id text NOT NULL,
  upload_id text NOT NULL,
  normalization_run_id text NOT NULL,
  source_schema_version_id text NOT NULL,
  source_schema_worksheet_id text NOT NULL,
  worksheet_mapping_profile_version_id text NOT NULL,
  attempt_number integer NOT NULL,
  profiler_version text NOT NULL,
  status text NOT NULL,
  created_by text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),

  row_count bigint,
  column_count bigint,
  total_cell_count bigint,
  non_null_cell_count bigint,
  null_cell_count bigint,
  complete_row_count bigint,
  incomplete_row_count bigint,

  CONSTRAINT data_hub_dataset_profile_runs_status_check
    CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED')),
  CONSTRAINT data_hub_dataset_profile_runs_attempt_positive_check
    CHECK (attempt_number >= 1),
  CONSTRAINT data_hub_dataset_profile_runs_profiler_version_check
    CHECK (length(profiler_version) > 0),
  CONSTRAINT data_hub_dataset_profile_runs_failure_code_check
    CHECK (
      failure_code IS NULL OR failure_code IN (
        'NORMALIZATION_NOT_COMPLETE',
        'NORMALIZATION_RUN_NOT_SUCCEEDED',
        'PROFILER_VERSION_UNSUPPORTED',
        'PROFILE_INPUT_INVALID',
        'PROFILE_RECONCILIATION_FAILED',
        'PERSISTENCE_FAILURE'
      )
    ),
  CONSTRAINT data_hub_dataset_profile_runs_counts_nonneg_check
    CHECK (
      (row_count IS NULL OR row_count >= 0)
      AND (column_count IS NULL OR column_count >= 0)
      AND (total_cell_count IS NULL OR total_cell_count >= 0)
      AND (non_null_cell_count IS NULL OR non_null_cell_count >= 0)
      AND (null_cell_count IS NULL OR null_cell_count >= 0)
      AND (complete_row_count IS NULL OR complete_row_count >= 0)
      AND (incomplete_row_count IS NULL OR incomplete_row_count >= 0)
    ),
  CONSTRAINT data_hub_dataset_profile_runs_counts_safe_integer_check
    CHECK (
      (row_count IS NULL OR row_count <= 9007199254740991)
      AND (column_count IS NULL OR column_count <= 9007199254740991)
      AND (total_cell_count IS NULL OR total_cell_count <= 9007199254740991)
      AND (non_null_cell_count IS NULL OR non_null_cell_count <= 9007199254740991)
      AND (null_cell_count IS NULL OR null_cell_count <= 9007199254740991)
      AND (complete_row_count IS NULL OR complete_row_count <= 9007199254740991)
      AND (incomplete_row_count IS NULL OR incomplete_row_count <= 9007199254740991)
    ),
  CONSTRAINT data_hub_dataset_profile_runs_state_coherence_check
    CHECK (
      (
        status = 'RUNNING'
        AND completed_at IS NULL
        AND failed_at IS NULL
        AND failure_code IS NULL
        AND row_count IS NULL
        AND column_count IS NULL
        AND total_cell_count IS NULL
        AND non_null_cell_count IS NULL
        AND null_cell_count IS NULL
        AND complete_row_count IS NULL
        AND incomplete_row_count IS NULL
      )
      OR
      (
        status = 'SUCCEEDED'
        AND completed_at IS NOT NULL
        AND failed_at IS NULL
        AND failure_code IS NULL
        AND row_count IS NOT NULL
        AND column_count IS NOT NULL
        AND total_cell_count IS NOT NULL
        AND non_null_cell_count IS NOT NULL
        AND null_cell_count IS NOT NULL
        AND complete_row_count IS NOT NULL
        AND incomplete_row_count IS NOT NULL
      )
      OR
      (
        status = 'FAILED'
        AND completed_at IS NULL
        AND failed_at IS NOT NULL
        AND failure_code IS NOT NULL
        AND row_count IS NULL
        AND column_count IS NULL
        AND total_cell_count IS NULL
        AND non_null_cell_count IS NULL
        AND null_cell_count IS NULL
        AND complete_row_count IS NULL
        AND incomplete_row_count IS NULL
      )
      OR
      (
        -- Match the established raw-staging/normalization lifecycle:
        -- ABANDONED is terminal history, not a data/error failure.
        status = 'ABANDONED'
        AND completed_at IS NULL
        AND failed_at IS NULL
        AND failure_code IS NULL
        AND row_count IS NULL
        AND column_count IS NULL
        AND total_cell_count IS NULL
        AND non_null_cell_count IS NULL
        AND null_cell_count IS NULL
        AND complete_row_count IS NULL
        AND incomplete_row_count IS NULL
      )
    ),
  CONSTRAINT data_hub_dataset_profile_runs_id_org_key
    UNIQUE (id, organisation_id),
  CONSTRAINT data_hub_dataset_profile_runs_id_worksheet_org_key
    UNIQUE (id, source_schema_worksheet_id, organisation_id),
  CONSTRAINT data_hub_dataset_profile_runs_upload_attempt_key
    UNIQUE (upload_id, attempt_number),

  CONSTRAINT data_hub_dataset_profile_runs_org_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id),
  CONSTRAINT data_hub_dataset_profile_runs_import_batch_fkey
    FOREIGN KEY (import_batch_id, source_schema_version_id, organisation_id)
    REFERENCES public.import_batches(id, source_schema_version_id, organisation_id),
  CONSTRAINT data_hub_dataset_profile_runs_upload_fkey
    FOREIGN KEY (upload_id, import_batch_id, organisation_id)
    REFERENCES public.uploads(id, import_batch_id, organisation_id),
  CONSTRAINT data_hub_dataset_profile_runs_authoritative_normalization_fkey
    FOREIGN KEY (upload_id, normalization_run_id, organisation_id)
    REFERENCES public.uploads(id, normalization_run_id, organisation_id),
  CONSTRAINT data_hub_dataset_profile_runs_normalization_lineage_fkey
    FOREIGN KEY (
      normalization_run_id,
      import_batch_id,
      upload_id,
      source_schema_version_id,
      source_schema_worksheet_id,
      worksheet_mapping_profile_version_id,
      organisation_id
    )
    REFERENCES public.data_hub_normalization_runs(
      id,
      import_batch_id,
      upload_id,
      source_schema_version_id,
      source_schema_worksheet_id,
      worksheet_mapping_profile_version_id,
      organisation_id
    ),
  CONSTRAINT data_hub_dataset_profile_runs_worksheet_fkey
    FOREIGN KEY (source_schema_worksheet_id, source_schema_version_id, organisation_id)
    REFERENCES public.source_schema_worksheets(id, source_schema_version_id, organisation_id),
  CONSTRAINT data_hub_dataset_profile_runs_profile_version_fkey
    FOREIGN KEY (worksheet_mapping_profile_version_id, organisation_id)
    REFERENCES public.worksheet_mapping_profile_versions(id, organisation_id),
  CONSTRAINT data_hub_dataset_profile_runs_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES public.users(id)
    ON DELETE SET NULL
);

-- Scoped by normalization_run_id rather than upload_id (the task's own
-- stated preference), documented per that same instruction: B2B2A's
-- createOrResumeNormalizationRun() short-circuits on Upload.normalized_at
-- and never creates a second normalization attempt once one has
-- SUCCEEDED, so at most one normalization_run_id can ever be SUCCEEDED
-- (and therefore ever be a valid pin target, per the
-- authoritative_normalization_fkey below) for a given upload at a time.
-- Scoping by normalization_run_id is therefore equivalent in practice to
-- scoping by upload_id, while additionally remaining correct if a future
-- phase ever lets more than one worksheet share an upload_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_data_hub_dataset_profile_runs_one_running_per_normalization
  ON public.data_hub_dataset_profile_runs(normalization_run_id)
  WHERE status = 'RUNNING';

CREATE INDEX IF NOT EXISTS idx_data_hub_dataset_profile_runs_org_upload
  ON public.data_hub_dataset_profile_runs(organisation_id, upload_id);
CREATE INDEX IF NOT EXISTS idx_data_hub_dataset_profile_runs_normalization
  ON public.data_hub_dataset_profile_runs(normalization_run_id);

CREATE TABLE IF NOT EXISTS public.data_hub_dataset_profile_columns (
  id text PRIMARY KEY,
  organisation_id text NOT NULL,
  profile_run_id text NOT NULL,
  source_schema_worksheet_id text NOT NULL,
  source_schema_column_id text NOT NULL,
  -- Contiguous D4D1A output position (0..column_count-1), independent of
  -- SourceSchemaColumn.ordinal, which is governed source structure and may
  -- legally contain gaps.
  ordinal integer NOT NULL,
  source_column_ordinal integer NOT NULL,

  value_kind text NOT NULL,
  source_unit text,
  normalized_unit text,

  row_count bigint NOT NULL,
  non_null_count bigint NOT NULL,
  null_count bigint NOT NULL,
  distinct_non_null_count bigint NOT NULL,

  null_ratio text,
  non_null_ratio text,
  distinct_ratio text,

  is_constant boolean NOT NULL,
  is_all_null boolean NOT NULL,
  is_unique_among_non_null boolean NOT NULL,
  is_complete boolean NOT NULL,
  is_sparse boolean NOT NULL,

  min_length bigint,
  max_length bigint,
  total_length bigint,
  mean_length text,
  empty_string_count bigint,

  true_count bigint,
  false_count bigint,

  numeric_min text,
  numeric_max text,
  numeric_sum text,
  numeric_mean text,

  temporal_min text,
  temporal_max text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT data_hub_dataset_profile_columns_ordinal_nonneg_check
    CHECK (ordinal >= 0 AND source_column_ordinal >= 0),
  CONSTRAINT data_hub_dataset_profile_columns_value_kind_check
    CHECK (value_kind IN (
      'STRING','IDENTIFIER','INTEGER','DECIMAL','BOOLEAN','DATE','TIME',
      'DATETIME','DURATION','PERCENTAGE','CURRENCY','LATITUDE','LONGITUDE'
    )),
  CONSTRAINT data_hub_dataset_profile_columns_units_check
    CHECK (
      -- D4C-A/B2A guarantee unit-pair coherence upstream. Preserve that
      -- exact structural fact here without duplicating the deliberately
      -- deferred valueKind->unit-family matrix.
      (source_unit IS NULL) = (normalized_unit IS NULL)
      AND (source_unit IS NULL OR source_unit IN ('kg','t','m','km','s','min','h','%','AUD'))
      AND (normalized_unit IS NULL OR normalized_unit IN ('kg','t','m','km','s','min','h','%','AUD'))
    ),
  CONSTRAINT data_hub_dataset_profile_columns_counts_check
    CHECK (
      row_count >= 0
      AND non_null_count >= 0
      AND null_count >= 0
      AND distinct_non_null_count >= 0
      AND non_null_count + null_count = row_count
      AND distinct_non_null_count <= non_null_count
      AND (min_length IS NULL OR min_length >= 0)
      AND (max_length IS NULL OR max_length >= 0)
      AND (total_length IS NULL OR total_length >= 0)
      AND (empty_string_count IS NULL OR empty_string_count >= 0)
      AND (true_count IS NULL OR true_count >= 0)
      AND (false_count IS NULL OR false_count >= 0)
    ),
  CONSTRAINT data_hub_dataset_profile_columns_safe_integer_check
    CHECK (
      row_count <= 9007199254740991
      AND non_null_count <= 9007199254740991
      AND null_count <= 9007199254740991
      AND distinct_non_null_count <= 9007199254740991
      AND (min_length IS NULL OR min_length <= 9007199254740991)
      AND (max_length IS NULL OR max_length <= 9007199254740991)
      AND (total_length IS NULL OR total_length <= 9007199254740991)
      AND (empty_string_count IS NULL OR empty_string_count <= 9007199254740991)
      AND (true_count IS NULL OR true_count <= 9007199254740991)
      AND (false_count IS NULL OR false_count <= 9007199254740991)
    ),
  CONSTRAINT data_hub_dataset_profile_columns_flags_coherence_check
    CHECK (
      is_all_null = (row_count > 0 AND non_null_count = 0)
      AND is_complete = (null_count = 0)
      AND is_sparse = (row_count > 0 AND non_null_count > 0 AND non_null_count < row_count)
      AND is_constant = (distinct_non_null_count = 1)
      AND is_unique_among_non_null = (non_null_count > 0 AND distinct_non_null_count = non_null_count)
    ),
  CONSTRAINT data_hub_dataset_profile_columns_canonical_decimal_text_check
    CHECK (
      (null_ratio IS NULL OR null_ratio ~ '^(0|-?[1-9][0-9]*|-?0\.[0-9]*[1-9]|-?[1-9][0-9]*\.[0-9]*[1-9])$')
      AND (non_null_ratio IS NULL OR non_null_ratio ~ '^(0|-?[1-9][0-9]*|-?0\.[0-9]*[1-9]|-?[1-9][0-9]*\.[0-9]*[1-9])$')
      AND (distinct_ratio IS NULL OR distinct_ratio ~ '^(0|-?[1-9][0-9]*|-?0\.[0-9]*[1-9]|-?[1-9][0-9]*\.[0-9]*[1-9])$')
      AND (mean_length IS NULL OR mean_length ~ '^(0|-?[1-9][0-9]*|-?0\.[0-9]*[1-9]|-?[1-9][0-9]*\.[0-9]*[1-9])$')
      AND (numeric_min IS NULL OR numeric_min ~ '^(0|-?[1-9][0-9]*|-?0\.[0-9]*[1-9]|-?[1-9][0-9]*\.[0-9]*[1-9])$')
      AND (numeric_max IS NULL OR numeric_max ~ '^(0|-?[1-9][0-9]*|-?0\.[0-9]*[1-9]|-?[1-9][0-9]*\.[0-9]*[1-9])$')
      AND (numeric_sum IS NULL OR numeric_sum ~ '^(0|-?[1-9][0-9]*|-?0\.[0-9]*[1-9]|-?[1-9][0-9]*\.[0-9]*[1-9])$')
      AND (numeric_mean IS NULL OR numeric_mean ~ '^(0|-?[1-9][0-9]*|-?0\.[0-9]*[1-9]|-?[1-9][0-9]*\.[0-9]*[1-9])$')
    ),
  CONSTRAINT data_hub_dataset_profile_columns_ratio_range_check
    CHECK (
      (null_ratio IS NULL OR null_ratio::numeric BETWEEN 0 AND 1)
      AND (non_null_ratio IS NULL OR non_null_ratio::numeric BETWEEN 0 AND 1)
      AND (distinct_ratio IS NULL OR distinct_ratio::numeric BETWEEN 0 AND 1)
      AND (mean_length IS NULL OR mean_length::numeric >= 0)
    ),
  CONSTRAINT data_hub_dataset_profile_columns_ratio_shape_check
    CHECK (
      (row_count = 0 AND null_ratio IS NULL AND non_null_ratio IS NULL)
      OR
      (row_count > 0 AND null_ratio IS NOT NULL AND non_null_ratio IS NOT NULL)
    ),
  CONSTRAINT data_hub_dataset_profile_columns_distinct_ratio_shape_check
    CHECK (
      (non_null_count = 0 AND distinct_ratio IS NULL)
      OR
      (non_null_count > 0 AND distinct_ratio IS NOT NULL)
    ),
  CONSTRAINT data_hub_dataset_profile_columns_kind_stats_check
    CHECK (
      (
        value_kind IN ('STRING','IDENTIFIER')
        AND min_length IS NOT NULL
        AND max_length IS NOT NULL
        AND total_length IS NOT NULL
        AND empty_string_count IS NOT NULL
        AND ((non_null_count = 0 AND mean_length IS NULL) OR (non_null_count > 0 AND mean_length IS NOT NULL))
        AND true_count IS NULL AND false_count IS NULL
        AND numeric_min IS NULL AND numeric_max IS NULL AND numeric_sum IS NULL AND numeric_mean IS NULL
        AND temporal_min IS NULL AND temporal_max IS NULL
      )
      OR
      (
        value_kind = 'BOOLEAN'
        AND min_length IS NULL AND max_length IS NULL AND total_length IS NULL AND mean_length IS NULL AND empty_string_count IS NULL
        AND true_count IS NOT NULL AND false_count IS NOT NULL
        AND true_count + false_count = non_null_count
        AND numeric_min IS NULL AND numeric_max IS NULL AND numeric_sum IS NULL AND numeric_mean IS NULL
        AND temporal_min IS NULL AND temporal_max IS NULL
      )
      OR
      (
        value_kind IN ('INTEGER','DECIMAL','DURATION','PERCENTAGE','CURRENCY','LATITUDE','LONGITUDE')
        AND min_length IS NULL AND max_length IS NULL AND total_length IS NULL AND mean_length IS NULL AND empty_string_count IS NULL
        AND true_count IS NULL AND false_count IS NULL
        AND (
          (non_null_count = 0 AND numeric_min IS NULL AND numeric_max IS NULL AND numeric_sum IS NULL AND numeric_mean IS NULL)
          OR
          (non_null_count > 0 AND numeric_min IS NOT NULL AND numeric_max IS NOT NULL AND numeric_sum IS NOT NULL AND numeric_mean IS NOT NULL)
        )
        AND temporal_min IS NULL AND temporal_max IS NULL
      )
      OR
      (
        value_kind IN ('DATE','TIME','DATETIME')
        AND min_length IS NULL AND max_length IS NULL AND total_length IS NULL AND mean_length IS NULL AND empty_string_count IS NULL
        AND true_count IS NULL AND false_count IS NULL
        AND numeric_min IS NULL AND numeric_max IS NULL AND numeric_sum IS NULL AND numeric_mean IS NULL
        AND (
          (non_null_count = 0 AND temporal_min IS NULL AND temporal_max IS NULL)
          OR
          (non_null_count > 0 AND temporal_min IS NOT NULL AND temporal_max IS NOT NULL)
        )
      )
    ),
  CONSTRAINT data_hub_dataset_profile_columns_run_ordinal_key
    UNIQUE (profile_run_id, ordinal),
  CONSTRAINT data_hub_dataset_profile_columns_run_source_column_key
    UNIQUE (profile_run_id, source_schema_column_id),

  CONSTRAINT data_hub_dataset_profile_columns_org_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id),
  CONSTRAINT data_hub_dataset_profile_columns_run_worksheet_fkey
    FOREIGN KEY (profile_run_id, source_schema_worksheet_id, organisation_id)
    REFERENCES public.data_hub_dataset_profile_runs(id, source_schema_worksheet_id, organisation_id),
  CONSTRAINT data_hub_dataset_profile_columns_source_column_fkey
    FOREIGN KEY (source_schema_column_id, source_schema_worksheet_id, source_column_ordinal, organisation_id)
    REFERENCES public.source_schema_columns(id, source_schema_worksheet_id, ordinal, organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_data_hub_dataset_profile_columns_org_run
  ON public.data_hub_dataset_profile_columns(organisation_id, profile_run_id);
CREATE INDEX IF NOT EXISTS idx_data_hub_dataset_profile_columns_source_column
  ON public.data_hub_dataset_profile_columns(source_schema_column_id);

CREATE OR REPLACE FUNCTION public.datahub_guard_dataset_profile_column_immutable()
RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Dataset profile column evidence is immutable';
  END IF;

  SELECT status INTO v_status
  FROM public.data_hub_dataset_profile_runs
  WHERE id = NEW.profile_run_id
    AND organisation_id = NEW.organisation_id
    AND source_schema_worksheet_id = NEW.source_schema_worksheet_id;

  IF v_status IS DISTINCT FROM 'RUNNING' THEN
    RAISE EXCEPTION 'Dataset profile columns may only be inserted into a RUNNING profile attempt';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS data_hub_dataset_profile_columns_immutable_guard
  ON public.data_hub_dataset_profile_columns;
CREATE TRIGGER data_hub_dataset_profile_columns_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.data_hub_dataset_profile_columns
FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_dataset_profile_column_immutable();

CREATE OR REPLACE FUNCTION public.datahub_guard_dataset_profile_run_lifecycle()
RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_normalization_status text;
  v_column_count bigint;
  v_governed_column_count bigint;
  v_min_ordinal integer;
  v_max_ordinal integer;
  v_sum_non_null numeric;
  v_sum_null numeric;
  v_bad_row_count bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Dataset profile attempt history is immutable';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RUNNING' THEN
      RAISE EXCEPTION 'Dataset profile attempts must be created RUNNING';
    END IF;

    SELECT status INTO v_normalization_status
    FROM public.data_hub_normalization_runs
    WHERE id = NEW.normalization_run_id
      AND import_batch_id = NEW.import_batch_id
      AND upload_id = NEW.upload_id
      AND source_schema_version_id = NEW.source_schema_version_id
      AND source_schema_worksheet_id = NEW.source_schema_worksheet_id
      AND worksheet_mapping_profile_version_id = NEW.worksheet_mapping_profile_version_id
      AND organisation_id = NEW.organisation_id;

    IF v_normalization_status IS DISTINCT FROM 'SUCCEEDED' THEN
      RAISE EXCEPTION 'Dataset profiling requires the exact pinned normalization run to be SUCCEEDED';
    END IF;

    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE id = NEW.created_by AND organisation_id = NEW.organisation_id
    ) THEN
      RAISE EXCEPTION 'Dataset profile initiating actor must belong to the same organisation';
    END IF;

    RETURN NEW;
  END IF;

  -- Allow only ON DELETE SET NULL actor cleanup without treating it as a
  -- lifecycle transition.
  IF OLD.created_by IS NOT NULL
     AND NEW.created_by IS NULL
     AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'Terminal dataset profile attempts are immutable';
  END IF;

  IF NEW.status NOT IN ('SUCCEEDED', 'FAILED', 'ABANDONED') THEN
    RAISE EXCEPTION 'Dataset profile lifecycle may only leave RUNNING for a terminal state';
  END IF;

  IF (
    to_jsonb(NEW)
      - 'status' - 'completed_at' - 'failed_at' - 'failure_code'
      - 'row_count' - 'column_count' - 'total_cell_count'
      - 'non_null_cell_count' - 'null_cell_count'
      - 'complete_row_count' - 'incomplete_row_count'
  ) <> (
    to_jsonb(OLD)
      - 'status' - 'completed_at' - 'failed_at' - 'failure_code'
      - 'row_count' - 'column_count' - 'total_cell_count'
      - 'non_null_cell_count' - 'null_cell_count'
      - 'complete_row_count' - 'incomplete_row_count'
  ) THEN
    RAISE EXCEPTION 'Dataset profile lineage and attempt identity are immutable';
  END IF;

  IF NEW.status = 'SUCCEEDED' THEN
    SELECT status INTO v_normalization_status
    FROM public.data_hub_normalization_runs
    WHERE id = NEW.normalization_run_id
      AND organisation_id = NEW.organisation_id;

    IF v_normalization_status IS DISTINCT FROM 'SUCCEEDED' THEN
      RAISE EXCEPTION 'Dataset profile completion requires the pinned normalization run to remain SUCCEEDED';
    END IF;

    IF NEW.total_cell_count::numeric <> NEW.row_count::numeric * NEW.column_count::numeric
       OR NEW.non_null_cell_count + NEW.null_cell_count <> NEW.total_cell_count
       OR NEW.complete_row_count + NEW.incomplete_row_count <> NEW.row_count THEN
      RAISE EXCEPTION 'Dataset profile completion count reconciliation failed';
    END IF;

    SELECT
      count(*),
      min(ordinal),
      max(ordinal),
      COALESCE(sum(non_null_count::numeric), 0),
      COALESCE(sum(null_count::numeric), 0),
      count(*) FILTER (WHERE row_count <> NEW.row_count)
    INTO
      v_column_count,
      v_min_ordinal,
      v_max_ordinal,
      v_sum_non_null,
      v_sum_null,
      v_bad_row_count
    FROM public.data_hub_dataset_profile_columns
    WHERE profile_run_id = NEW.id AND organisation_id = NEW.organisation_id;

    SELECT count(*) INTO v_governed_column_count
    FROM public.source_schema_columns
    WHERE source_schema_worksheet_id = NEW.source_schema_worksheet_id
      AND organisation_id = NEW.organisation_id;

    -- A successful D4C v2 normalization plan is only valid when every
    -- governed source column has exactly one rule. D4D1A therefore profiles
    -- that complete governed set (a column may have zero observed cells,
    -- but the column itself is never omitted). Do not permit a partial
    -- profile to declare a smaller column_count and still complete.
    IF v_column_count <> NEW.column_count
       OR v_governed_column_count <> NEW.column_count THEN
      RAISE EXCEPTION 'Dataset profile completion governed column count reconciliation failed';
    END IF;

    IF NEW.column_count = 0 THEN
      IF v_min_ordinal IS NOT NULL OR v_max_ordinal IS NOT NULL THEN
        RAISE EXCEPTION 'Dataset profile completion zero-column ordinal reconciliation failed';
      END IF;
    ELSE
      IF v_min_ordinal <> 0 OR v_max_ordinal <> NEW.column_count - 1 THEN
        RAISE EXCEPTION 'Dataset profile completion ordinal reconciliation failed';
      END IF;
    END IF;

    IF v_bad_row_count <> 0
       OR v_sum_non_null <> NEW.non_null_cell_count
       OR v_sum_null <> NEW.null_cell_count THEN
      RAISE EXCEPTION 'Dataset profile completion per-column reconciliation failed';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS data_hub_dataset_profile_runs_lifecycle_guard
  ON public.data_hub_dataset_profile_runs;
CREATE TRIGGER data_hub_dataset_profile_runs_lifecycle_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.data_hub_dataset_profile_runs
FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_dataset_profile_run_lifecycle();

-- Idempotent schema-drift verification. CREATE TABLE/INDEX IF NOT EXISTS
-- alone is insufficient: on re-apply a same-named but wrong-shaped object
-- must fail loudly rather than being silently accepted.
DO $$
DECLARE
  actual text;
  actual_valid boolean;
  missing_columns text[];
  idx_name text;
  expected_def text;
BEGIN
  SELECT array_agg(req.col ORDER BY req.col) INTO missing_columns
  FROM (
    VALUES
      ('id'),('organisation_id'),('import_batch_id'),('upload_id'),
      ('normalization_run_id'),('source_schema_version_id'),
      ('source_schema_worksheet_id'),('worksheet_mapping_profile_version_id'),
      ('attempt_number'),('profiler_version'),('status'),('created_by'),
      ('started_at'),('completed_at'),('failed_at'),('failure_code'),('created_at'),
      ('row_count'),('column_count'),('total_cell_count'),('non_null_cell_count'),
      ('null_cell_count'),('complete_row_count'),('incomplete_row_count')
  ) AS req(col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public'
      AND c.table_name='data_hub_dataset_profile_runs'
      AND c.column_name=req.col
  );
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Dataset profile migration drift: profile-run columns missing: %', missing_columns;
  END IF;

  SELECT array_agg(req.col ORDER BY req.col) INTO missing_columns
  FROM (
    VALUES
      ('id'),('organisation_id'),('profile_run_id'),('source_schema_worksheet_id'),
      ('source_schema_column_id'),('ordinal'),('source_column_ordinal'),('value_kind'),('source_unit'),
      ('normalized_unit'),('row_count'),('non_null_count'),('null_count'),
      ('distinct_non_null_count'),('null_ratio'),('non_null_ratio'),('distinct_ratio'),
      ('is_constant'),('is_all_null'),('is_unique_among_non_null'),('is_complete'),
      ('is_sparse'),('min_length'),('max_length'),('total_length'),('mean_length'),
      ('empty_string_count'),('true_count'),('false_count'),('numeric_min'),
      ('numeric_max'),('numeric_sum'),('numeric_mean'),('temporal_min'),
      ('temporal_max'),('created_at')
  ) AS req(col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public'
      AND c.table_name='data_hub_dataset_profile_columns'
      AND c.column_name=req.col
  );
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Dataset profile migration drift: profile-column columns missing: %', missing_columns;
  END IF;

  -- Pin the important physical types that preserve D4D1A semantics.
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('data_hub_dataset_profile_runs','row_count','bigint'),
      ('data_hub_dataset_profile_runs','column_count','bigint'),
      ('data_hub_dataset_profile_runs','total_cell_count','bigint'),
      ('data_hub_dataset_profile_columns','row_count','bigint'),
      ('data_hub_dataset_profile_columns','non_null_count','bigint'),
      ('data_hub_dataset_profile_columns','null_count','bigint'),
      ('data_hub_dataset_profile_columns','distinct_non_null_count','bigint'),
      ('data_hub_dataset_profile_columns','null_ratio','text'),
      ('data_hub_dataset_profile_columns','numeric_min','text'),
      ('data_hub_dataset_profile_columns','numeric_max','text'),
      ('data_hub_dataset_profile_columns','numeric_sum','text'),
      ('data_hub_dataset_profile_columns','numeric_mean','text'),
      ('data_hub_dataset_profile_columns','temporal_min','text'),
      ('data_hub_dataset_profile_columns','temporal_max','text')
    ) AS exp(tbl,col,typ)
    LEFT JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=exp.tbl AND c.column_name=exp.col
    WHERE c.data_type IS DISTINCT FROM exp.typ
  ) THEN
    RAISE EXCEPTION 'Dataset profile migration drift: one or more required physical column types do not match';
  END IF;

  SELECT pg_get_indexdef(i.indexrelid), i.indisvalid INTO actual, actual_valid
  FROM pg_index i
  JOIN pg_class ic ON ic.oid=i.indexrelid
  JOIN pg_namespace n ON n.oid=ic.relnamespace
  WHERE n.nspname='public'
    AND ic.relname='idx_data_hub_dataset_profile_runs_one_running_per_normalization';

  IF actual IS DISTINCT FROM
    'CREATE UNIQUE INDEX idx_data_hub_dataset_profile_runs_one_running_per_normalization ON public.data_hub_dataset_profile_runs USING btree (normalization_run_id) WHERE (status = ''RUNNING''::text)'
     OR actual_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Dataset profile migration drift: RUNNING uniqueness index has the wrong shape';
  END IF;

  FOR idx_name, expected_def IN
    SELECT * FROM (VALUES
      ('idx_data_hub_dataset_profile_runs_org_upload',
       'CREATE INDEX idx_data_hub_dataset_profile_runs_org_upload ON public.data_hub_dataset_profile_runs USING btree (organisation_id, upload_id)'),
      ('idx_data_hub_dataset_profile_runs_normalization',
       'CREATE INDEX idx_data_hub_dataset_profile_runs_normalization ON public.data_hub_dataset_profile_runs USING btree (normalization_run_id)'),
      ('idx_data_hub_dataset_profile_columns_org_run',
       'CREATE INDEX idx_data_hub_dataset_profile_columns_org_run ON public.data_hub_dataset_profile_columns USING btree (organisation_id, profile_run_id)'),
      ('idx_data_hub_dataset_profile_columns_source_column',
       'CREATE INDEX idx_data_hub_dataset_profile_columns_source_column ON public.data_hub_dataset_profile_columns USING btree (source_schema_column_id)')
    ) AS expected(idx_name, expected_def)
  LOOP
    SELECT pg_get_indexdef(i.indexrelid), i.indisvalid INTO actual, actual_valid
    FROM pg_index i
    JOIN pg_class ic ON ic.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=ic.relnamespace
    WHERE n.nspname='public' AND ic.relname=idx_name;

    IF actual IS DISTINCT FROM expected_def OR actual_valid IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Dataset profile migration drift: index % has the wrong shape', idx_name;
    END IF;
  END LOOP;

  FOREACH actual IN ARRAY ARRAY[
    'data_hub_dataset_profile_runs_status_check',
    'data_hub_dataset_profile_runs_state_coherence_check',
    'data_hub_dataset_profile_runs_counts_safe_integer_check',
    'data_hub_dataset_profile_runs_normalization_lineage_fkey',
    'data_hub_dataset_profile_runs_authoritative_normalization_fkey',
    'data_hub_dataset_profile_columns_kind_stats_check',
    'data_hub_dataset_profile_columns_safe_integer_check',
    'data_hub_dataset_profile_columns_flags_coherence_check',
    'data_hub_dataset_profile_columns_canonical_decimal_text_check',
    'data_hub_dataset_profile_columns_ratio_range_check',
    'data_hub_dataset_profile_columns_run_worksheet_fkey',
    'data_hub_dataset_profile_columns_source_column_fkey'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conname=actual
        AND c.conrelid IN (
          'public.data_hub_dataset_profile_runs'::regclass,
          'public.data_hub_dataset_profile_columns'::regclass
        )
        AND c.convalidated
    ) THEN
      RAISE EXCEPTION 'Dataset profile migration drift: required validated constraint % is missing', actual;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.data_hub_dataset_profile_runs'::regclass
      AND tgname='data_hub_dataset_profile_runs_lifecycle_guard'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.data_hub_dataset_profile_columns'::regclass
      AND tgname='data_hub_dataset_profile_columns_immutable_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Dataset profile migration drift: lifecycle/immutability trigger missing';
  END IF;
END $$;

-- Drift guard for the privacy boundary: these names must never appear as
-- persisted profile columns. This catches accidental future broadening on
-- rerun as well as on a fresh install.
DO $$
DECLARE
  forbidden text;
BEGIN
  SELECT column_name INTO forbidden
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('data_hub_dataset_profile_runs', 'data_hub_dataset_profile_columns')
    AND column_name IN (
      'raw_value','normalized_value','sample_value','example_value',
      'source_header','message','failure_detail'
    )
  LIMIT 1;

  IF forbidden IS NOT NULL THEN
    RAISE EXCEPTION 'Dataset profile persistence privacy drift: forbidden column % exists', forbidden;
  END IF;
END $$;

COMMIT;
