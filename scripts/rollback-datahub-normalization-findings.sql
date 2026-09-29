-- Data Hub 6.2D4C-B2B1 — guarded manual rollback for
-- scripts/create-datahub-normalization-findings.sql.
--
-- NOT executed automatically by anything. Run by hand, deliberately, only
-- when B2B1 needs to be fully reverted.
--
-- SAFETY GUARD: aborts unconditionally if data_hub_normalization_findings
-- contains ANY row. Rolling back with real finding evidence present would
-- destroy immutable finding history — the same discipline every prior
-- Data Hub rollback in this repo applies to its own evidence table.
--
-- Removes every B2B1 object (the findings table, its own immutability
-- trigger, and datahub_stage_normalized_batch) and restores
-- datahub_complete_normalization_run() to its EXACT D4C-B1 body —
-- byte-for-byte the same function this repo's own containment tests
-- already pin, minus the blocking-findings-zero gate this migration added.
-- D4A/D4B/D4C-B1's own objects/constraints are otherwise left completely
-- untouched — this migration never modified anything of theirs besides
-- that one CREATE OR REPLACE.

BEGIN;

DO $$
DECLARE
  finding_count integer;
BEGIN
  SELECT count(*) INTO finding_count FROM public.data_hub_normalization_findings;
  IF finding_count > 0 THEN
    RAISE EXCEPTION
      'Refusing rollback: data_hub_normalization_findings contains % row(s). Rolling back would destroy immutable finding history. Manual review required before proceeding.',
      finding_count;
  END IF;
END $$;

-- ─── Remove B2B1-only functions ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.datahub_stage_normalized_batch(text, text, text, jsonb, jsonb, integer);

-- ─── Restore datahub_complete_normalization_run() to its EXACT D4C-B1 body ─
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

-- ─── Remove data_hub_normalization_findings entirely ──────────────────────
DROP TRIGGER IF EXISTS data_hub_normalization_findings_immutable_guard ON public.data_hub_normalization_findings;
DROP TABLE IF EXISTS public.data_hub_normalization_findings;

COMMIT;
