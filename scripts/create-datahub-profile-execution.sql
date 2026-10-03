-- Data Hub 6.2D4D1B2 — dataset-profile execution + completion.
-- Additive only. No executor semantic logic lives in SQL — this migration
-- only adds: (1) Upload's authoritative profile-completion pointer, with
-- the same immutability discipline as its normalization-completion
-- sibling; (2) the single atomic completion function the execution
-- service calls for Phase C (insert every immutable column row,
-- transition the run to SUCCEEDED, write the Upload pointer — all inside
-- one function call, so D4D1B1's own pre-existing reconciliation trigger
-- can roll back the WHOLE operation, including every column insert
-- already performed in this same call, if anything fails).

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.data_hub_dataset_profile_runs') IS NULL
     OR to_regclass('public.data_hub_dataset_profile_columns') IS NULL THEN
    RAISE EXCEPTION '6.2D4D1B2 requires the D4D1B1 dataset-profile persistence foundation to already exist';
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- Upload authoritative profile-completion pointer (section 15/16).
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS dataset_profile_run_id text;
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS profiled_at timestamptz;
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS profiled_by text;
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS profiler_version text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.data_hub_dataset_profile_runs'::regclass
      AND conname = 'data_hub_dataset_profile_runs_id_upload_organisation_key'
  ) THEN
    ALTER TABLE public.data_hub_dataset_profile_runs
      ADD CONSTRAINT data_hub_dataset_profile_runs_id_upload_organisation_key
      UNIQUE (id, upload_id, organisation_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.uploads'::regclass
      AND conname = 'uploads_id_dataset_profile_run_organisation_key'
  ) THEN
    ALTER TABLE public.uploads
      ADD CONSTRAINT uploads_id_dataset_profile_run_organisation_key
      UNIQUE (id, dataset_profile_run_id, organisation_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.uploads'::regclass
      AND conname = 'uploads_profiled_by_fkey'
  ) THEN
    ALTER TABLE public.uploads
      ADD CONSTRAINT uploads_profiled_by_fkey
      FOREIGN KEY (profiled_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Proves the pointed-to run really belongs to THIS upload's own id — same
-- precedent as uploads_normalization_run_upload_fkey.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.uploads'::regclass
      AND conname = 'uploads_dataset_profile_run_upload_fkey'
  ) THEN
    ALTER TABLE public.uploads
      ADD CONSTRAINT uploads_dataset_profile_run_upload_fkey
      FOREIGN KEY (dataset_profile_run_id, id, organisation_id)
      REFERENCES public.data_hub_dataset_profile_runs(id, upload_id, organisation_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.uploads'::regclass
      AND conname = 'uploads_dataset_profile_coherence_check'
  ) THEN
    ALTER TABLE public.uploads
      ADD CONSTRAINT uploads_dataset_profile_coherence_check
      CHECK (
        (dataset_profile_run_id IS NULL AND profiled_at IS NULL AND profiler_version IS NULL)
        OR
        (dataset_profile_run_id IS NOT NULL AND profiled_at IS NOT NULL AND profiler_version IS NOT NULL)
      );
  END IF;
END $$;

-- Mirrors datahub_guard_upload_normalization_metadata()'s exact shape
-- (immutable completion group, profiled_by's one actor-deletion
-- exception, same-org actor check). ADDITIONALLY — unique to this
-- pointer — proves the referenced DataHubDatasetProfileRun is SUCCEEDED
-- and belongs to the exact SAME upload_id/organisation_id, since a plain
-- FK cannot express a status condition (section 16).
CREATE OR REPLACE FUNCTION public.datahub_guard_upload_dataset_profile_metadata()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_run_status text;
  v_run_upload_id text;
BEGIN
  IF OLD.profiled_at IS NULL THEN
    IF NEW.profiled_at IS NULL THEN
      RETURN NEW;
    END IF;

    IF NEW.profiled_by IS NULL THEN
      RAISE EXCEPTION 'uploads: initial profile completion requires profiled_by (upload=%)', OLD.id;
    END IF;
    IF NEW.dataset_profile_run_id IS NULL THEN
      RAISE EXCEPTION 'uploads: initial profile completion requires dataset_profile_run_id (upload=%)', OLD.id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.users WHERE id = NEW.profiled_by AND organisation_id = NEW.organisation_id
    ) THEN
      RAISE EXCEPTION 'uploads: profiled_by must belong to the same organisation_id as the upload (upload=%)', OLD.id;
    END IF;

    SELECT status, upload_id INTO v_run_status, v_run_upload_id
    FROM public.data_hub_dataset_profile_runs
    WHERE id = NEW.dataset_profile_run_id AND organisation_id = NEW.organisation_id;

    IF v_run_upload_id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'uploads: dataset_profile_run_id must belong to this exact upload (upload=%)', OLD.id;
    END IF;
    IF v_run_status IS DISTINCT FROM 'SUCCEEDED' THEN
      RAISE EXCEPTION 'uploads: dataset_profile_run_id must reference a SUCCEEDED profile run (upload=%)', OLD.id;
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.profiled_at IS DISTINCT FROM OLD.profiled_at
     OR NEW.dataset_profile_run_id IS DISTINCT FROM OLD.dataset_profile_run_id
     OR NEW.profiler_version IS DISTINCT FROM OLD.profiler_version THEN
    RAISE EXCEPTION 'uploads: dataset-profile metadata is immutable once completed (upload=%)', OLD.id;
  END IF;

  IF NEW.profiled_by IS DISTINCT FROM OLD.profiled_by THEN
    IF NOT (OLD.profiled_by IS NOT NULL AND NEW.profiled_by IS NULL) THEN
      RAISE EXCEPTION 'uploads: profiled_by cannot be rewritten after profile completion (upload=%)', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS uploads_dataset_profile_metadata_guard ON public.uploads;
CREATE TRIGGER uploads_dataset_profile_metadata_guard
  BEFORE UPDATE ON public.uploads
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_upload_dataset_profile_metadata();

-- ───────────────────────────────────────────────────────────────────────
-- STEP 2 — datahub_complete_dataset_profile_run(...): the single atomic
-- Phase C completion. Inserts every immutable
-- DataHubDatasetProfileColumn row (from the caller-supplied JSONB array —
-- the execution service, not this function, mints each column row's own
-- id, mirroring normalizeWorksheetRows.ts's own precedent), transitions
-- the run to SUCCEEDED (firing D4D1B1's own pre-existing reconciliation
-- trigger), and writes Upload's own pointer — all inside this one
-- function call, i.e. one transaction. Any failure (the reconciliation
-- trigger, a column-insert constraint violation, anything) rolls back
-- every column insert this call already performed, since a PL/pgSQL
-- function body shares its caller's transaction.
--
-- Does not implement or execute any profiling logic itself — that is
-- exactly the "do not duplicate the D4D1A semantic engine in SQL"
-- boundary this phase does not cross. This function only performs the
-- atomic structural write.
-- ───────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.datahub_complete_dataset_profile_run(text, text, text, jsonb, bigint, bigint, bigint, bigint, bigint, bigint, bigint);

CREATE OR REPLACE FUNCTION public.datahub_complete_dataset_profile_run(
  p_profile_run_id text,
  p_organisation_id text,
  p_completed_by text,
  p_columns jsonb,
  p_row_count bigint,
  p_column_count bigint,
  p_total_cell_count bigint,
  p_non_null_cell_count bigint,
  p_null_cell_count bigint,
  p_complete_row_count bigint,
  p_incomplete_row_count bigint
) RETURNS TABLE(row_count bigint, column_count bigint)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_run RECORD;
  v_col jsonb;
BEGIN
  SELECT * INTO v_run
  FROM public.data_hub_dataset_profile_runs
  WHERE id = p_profile_run_id AND organisation_id = p_organisation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dataset profile run not found for completion';
  END IF;
  IF v_run.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'dataset profile run is not RUNNING';
  END IF;

  FOR v_col IN SELECT * FROM jsonb_array_elements(p_columns) LOOP
    INSERT INTO public.data_hub_dataset_profile_columns (
      id, organisation_id, profile_run_id, source_schema_worksheet_id, source_schema_column_id,
      ordinal, source_column_ordinal, value_kind, source_unit, normalized_unit,
      row_count, non_null_count, null_count, distinct_non_null_count,
      null_ratio, non_null_ratio, distinct_ratio,
      is_constant, is_all_null, is_unique_among_non_null, is_complete, is_sparse,
      min_length, max_length, total_length, mean_length, empty_string_count,
      true_count, false_count,
      numeric_min, numeric_max, numeric_sum, numeric_mean,
      temporal_min, temporal_max
    ) VALUES (
      v_col->>'id', p_organisation_id, p_profile_run_id, v_run.source_schema_worksheet_id, v_col->>'sourceSchemaColumnId',
      (v_col->>'ordinal')::integer, (v_col->>'sourceColumnOrdinal')::integer, v_col->>'valueKind', v_col->>'sourceUnit', v_col->>'normalizedUnit',
      (v_col->>'rowCount')::bigint, (v_col->>'nonNullCount')::bigint, (v_col->>'nullCount')::bigint, (v_col->>'distinctNonNullCount')::bigint,
      v_col->>'nullRatio', v_col->>'nonNullRatio', v_col->>'distinctRatio',
      (v_col->>'isConstant')::boolean, (v_col->>'isAllNull')::boolean, (v_col->>'isUniqueAmongNonNull')::boolean, (v_col->>'isComplete')::boolean, (v_col->>'isSparse')::boolean,
      (v_col->>'minLength')::bigint, (v_col->>'maxLength')::bigint, (v_col->>'totalLength')::bigint, v_col->>'meanLength', (v_col->>'emptyStringCount')::bigint,
      (v_col->>'trueCount')::bigint, (v_col->>'falseCount')::bigint,
      v_col->>'numericMin', v_col->>'numericMax', v_col->>'numericSum', v_col->>'numericMean',
      v_col->>'temporalMin', v_col->>'temporalMax'
    );
  END LOOP;

  UPDATE public.data_hub_dataset_profile_runs
  SET status = 'SUCCEEDED',
      completed_at = now(),
      row_count = p_row_count,
      column_count = p_column_count,
      total_cell_count = p_total_cell_count,
      non_null_cell_count = p_non_null_cell_count,
      null_cell_count = p_null_cell_count,
      complete_row_count = p_complete_row_count,
      incomplete_row_count = p_incomplete_row_count
  WHERE id = p_profile_run_id AND organisation_id = p_organisation_id;

  UPDATE public.uploads
  SET dataset_profile_run_id = p_profile_run_id,
      profiled_at = now(),
      profiled_by = p_completed_by,
      profiler_version = v_run.profiler_version
  WHERE id = v_run.upload_id AND organisation_id = p_organisation_id;

  RETURN QUERY SELECT p_row_count, p_column_count;
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────
-- Idempotent schema-drift verification.
-- ───────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  missing_columns text[];
  v_constraint_name text;
BEGIN
  SELECT array_agg(req.col ORDER BY req.col) INTO missing_columns
  FROM (VALUES ('dataset_profile_run_id'),('profiled_at'),('profiled_by'),('profiler_version')) AS req(col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name='uploads' AND c.column_name=req.col
  );
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Dataset profile execution migration drift: uploads columns missing: %', missing_columns;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('uploads','dataset_profile_run_id','text'),
      ('uploads','profiled_at','timestamp with time zone'),
      ('uploads','profiled_by','text'),
      ('uploads','profiler_version','text')
    ) AS exp(tbl,col,typ)
    LEFT JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=exp.tbl AND c.column_name=exp.col
    WHERE c.data_type IS DISTINCT FROM exp.typ
  ) THEN
    RAISE EXCEPTION 'Dataset profile execution migration drift: uploads column types do not match';
  END IF;

  FOREACH v_constraint_name IN ARRAY ARRAY[
    'uploads_id_dataset_profile_run_organisation_key',
    'uploads_profiled_by_fkey',
    'uploads_dataset_profile_run_upload_fkey',
    'uploads_dataset_profile_coherence_check',
    'data_hub_dataset_profile_runs_id_upload_organisation_key'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conname = v_constraint_name
        AND c.conrelid IN ('public.uploads'::regclass, 'public.data_hub_dataset_profile_runs'::regclass)
        AND c.convalidated
    ) THEN
      RAISE EXCEPTION 'Dataset profile execution migration drift: required constraint % is missing', v_constraint_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.uploads'::regclass
      AND tgname = 'uploads_dataset_profile_metadata_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Dataset profile execution migration drift: uploads pointer guard trigger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'datahub_complete_dataset_profile_run'
  ) THEN
    RAISE EXCEPTION 'Dataset profile execution migration drift: completion function missing';
  END IF;
END $$;

-- Privacy boundary drift guard: no raw/example/sample value column may
-- ever be added to uploads' profile-pointer columns (there are none here
-- by design — this just re-asserts the closed field list stays closed).
DO $$
DECLARE
  forbidden text;
BEGIN
  SELECT column_name INTO forbidden
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'uploads'
    AND column_name IN ('profile_raw_value', 'profile_sample_value', 'profile_example_value', 'profile_failure_detail', 'profile_message');
  IF forbidden IS NOT NULL THEN
    RAISE EXCEPTION 'Dataset profile execution privacy drift: forbidden column % exists', forbidden;
  END IF;
END $$;

COMMIT;
