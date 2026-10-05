-- Data Hub 6.2D4C-B1 — guarded manual rollback for
-- scripts/create-datahub-normalized-staging.sql.
--
-- NOT executed automatically by anything. Run by hand, deliberately, only
-- when D4C-B1 needs to be fully reverted.
--
-- SAFETY GUARD: aborts unconditionally if data_hub_normalization_runs
-- contains ANY row, or if any upload already carries normalization
-- completion metadata (normalization_run_id or normalized_at set).
-- Rolling back with real evidence present would destroy immutable
-- normalization-attempt history — the same discipline
-- rollback-datahub-raw-staging-runs.sql applies to D4B.
--
-- Removes every D4C-B1 object and drops the additive composite UNIQUE
-- constraints this migration added to data_hub_raw_rows/data_hub_raw_cells/
-- uploads. D4A's and D4B's OWN objects/constraints are left completely
-- untouched either way — this migration never modified them, so there is
-- nothing of theirs to restore.

BEGIN;

DO $$
DECLARE
  run_count integer;
  normalized_upload_count integer;
BEGIN
  SELECT count(*) INTO run_count FROM public.data_hub_normalization_runs;
  IF run_count > 0 THEN
    RAISE EXCEPTION
      'Refusing rollback: data_hub_normalization_runs contains % row(s). Rolling back would destroy immutable normalization-attempt history. Manual review required before proceeding.',
      run_count;
  END IF;

  SELECT count(*) INTO normalized_upload_count
    FROM public.uploads
    WHERE normalization_run_id IS NOT NULL OR normalized_at IS NOT NULL;
  IF normalized_upload_count > 0 THEN
    RAISE EXCEPTION
      'Refusing rollback: % upload(s) already carry D4C-B1 normalization completion metadata. Manual review required before proceeding.',
      normalized_upload_count;
  END IF;
END $$;

-- ─── Remove D4C-B1-only functions ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.datahub_complete_normalization_run(text, text, text, text);

-- ─── Restore uploads to its pre-D4C-B1 shape ──────────────────────────────
DROP TRIGGER IF EXISTS uploads_normalization_metadata_guard ON public.uploads;
DROP FUNCTION IF EXISTS public.datahub_guard_upload_normalization_metadata();

ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_normalization_coherence_check;
ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_normalization_run_upload_fkey;
ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_normalization_run_org_fkey;
ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_normalized_profile_version_org_fkey;
ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_normalized_by_fkey;
-- NOTE: uploads_id_raw_staging_run_organisation_key (REMEDIATION, pre-PR
-- review) is dropped LATER, after data_hub_normalization_runs itself is
-- dropped below — that table's own
-- data_hub_normalization_runs_upload_authoritative_raw_run_fkey depends on
-- this index, so dropping it here (before the table is gone) fails with
-- "other objects depend on it".

ALTER TABLE public.uploads DROP COLUMN IF EXISTS normalization_run_id;
ALTER TABLE public.uploads DROP COLUMN IF EXISTS normalized_cell_count;
ALTER TABLE public.uploads DROP COLUMN IF EXISTS normalized_row_count;
ALTER TABLE public.uploads DROP COLUMN IF EXISTS normalized_profile_version_id;
ALTER TABLE public.uploads DROP COLUMN IF EXISTS normalized_by;
ALTER TABLE public.uploads DROP COLUMN IF EXISTS normalized_at;

-- ─── Remove data_hub_normalized_cells entirely ────────────────────────────
DROP TRIGGER IF EXISTS data_hub_normalized_cells_immutable_guard ON public.data_hub_normalized_cells;
DROP TABLE IF EXISTS public.data_hub_normalized_cells;

-- ─── Remove data_hub_normalized_rows entirely ─────────────────────────────
DROP TRIGGER IF EXISTS data_hub_normalized_rows_immutable_guard ON public.data_hub_normalized_rows;
DROP TABLE IF EXISTS public.data_hub_normalized_rows;

-- Shared by both tables above; safe to drop once both triggers are gone.
DROP FUNCTION IF EXISTS public.datahub_guard_normalized_evidence_immutable();

-- ─── Restore data_hub_raw_cells to its pre-D4C-B1 shape ───────────────────
-- Additive-only constraints — D4A's own shape is otherwise untouched.
ALTER TABLE public.data_hub_raw_cells DROP CONSTRAINT IF EXISTS data_hub_raw_cells_id_column_organisation_key;
ALTER TABLE public.data_hub_raw_cells DROP CONSTRAINT IF EXISTS data_hub_raw_cells_id_raw_row_organisation_key;
ALTER TABLE public.data_hub_raw_cells DROP CONSTRAINT IF EXISTS data_hub_raw_cells_id_organisation_key;

-- ─── Restore data_hub_raw_rows to its pre-D4C-B1 shape ────────────────────
-- Additive-only constraints — D4B's own shape is otherwise untouched.
ALTER TABLE public.data_hub_raw_rows DROP CONSTRAINT IF EXISTS data_hub_raw_rows_id_staging_run_source_row_organisation_key;
ALTER TABLE public.data_hub_raw_rows DROP CONSTRAINT IF EXISTS data_hub_raw_rows_id_staging_run_organisation_key;

-- ─── Remove data_hub_normalization_runs entirely ──────────────────────────
DROP TRIGGER IF EXISTS data_hub_normalization_runs_lifecycle_guard ON public.data_hub_normalization_runs;
DROP FUNCTION IF EXISTS public.datahub_guard_normalization_run_lifecycle();
DROP TABLE IF EXISTS public.data_hub_normalization_runs;

-- Additive-only (REMEDIATION, pre-PR review) — D4B's own uploads shape is
-- otherwise untouched. Dropped LAST: data_hub_normalization_runs (and its
-- dependent FK on this index) is now gone, so this can finally be dropped.
ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_id_raw_staging_run_organisation_key;

COMMIT;
