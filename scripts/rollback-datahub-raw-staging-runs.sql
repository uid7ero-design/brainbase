-- Data Hub 6.2D4B — guarded manual rollback for
-- scripts/create-datahub-raw-staging-runs.sql.
--
-- NOT executed automatically by anything. Run by hand, deliberately, only
-- when D4B needs to be fully reverted.
--
-- SAFETY GUARD (correction 6): aborts unconditionally if
-- data_hub_raw_staging_runs contains ANY row, or if any D4B authoritative
-- staging data exists on uploads (raw_staging_run_id set) or data_hub_raw_rows
-- (staging_run_id referencing a real run). Rolling back with real evidence
-- present would destroy immutable staging-attempt history — the same
-- discipline create-datahub-raw-staging.sql's own trailing comment states
-- for D4A's raw rows/cells, extended here to the run table.
--
-- Restores, verbatim/equivalently, D4A's ORIGINAL objects exactly as they
-- exist in scripts/create-datahub-raw-staging.sql (that file is untouched
-- by D4B and remains the canonical source for this text):
--   - uploads_raw_staging_coherence_check (original 5-field predicate)
--   - datahub_guard_upload_raw_staging_metadata() (original body, no
--     raw_staging_run_id awareness)
--   - data_hub_raw_rows_upload_source_row_key (UNIQUE (upload_id, source_row_number))
--   - data_hub_raw_rows_upload_profile_version_org_fkey (the circular FK)
-- and removes every D4B object.

BEGIN;

DO $$
DECLARE
  run_count integer;
  staged_upload_count integer;
BEGIN
  SELECT count(*) INTO run_count FROM public.data_hub_raw_staging_runs;
  IF run_count > 0 THEN
    RAISE EXCEPTION
      'Refusing rollback: data_hub_raw_staging_runs contains % row(s). Rolling back would destroy immutable staging-attempt history. Manual review required before proceeding.',
      run_count;
  END IF;

  SELECT count(*) INTO staged_upload_count
    FROM public.uploads
    WHERE raw_staging_run_id IS NOT NULL OR raw_staged_at IS NOT NULL;
  IF staged_upload_count > 0 THEN
    RAISE EXCEPTION
      'Refusing rollback: % upload(s) already carry D4B/D4A raw-staging completion metadata. Manual review required before proceeding.',
      staged_upload_count;
  END IF;
END $$;

-- ─── Remove D4B-only functions ───────────────────────────────────────────
-- Remediation: both functions' signatures grew a parameter (p_execution_token
-- on completion; p_lease_seconds on batch staging) — drop the CURRENT
-- signatures, not the original D4B ones.
DROP FUNCTION IF EXISTS public.datahub_complete_raw_staging_run(text, text, text, text);
DROP FUNCTION IF EXISTS public.datahub_stage_raw_batch(text, text, text, jsonb, integer);

-- ─── Restore uploads to D4A's original shape ─────────────────────────────
ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_raw_staging_run_upload_fkey;
ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_raw_staging_run_org_fkey;

ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_raw_staging_coherence_check;

-- D4A's ORIGINAL predicate, copied verbatim from
-- scripts/create-datahub-raw-staging.sql (lines 576-593).
ALTER TABLE public.uploads ADD CONSTRAINT uploads_raw_staging_coherence_check CHECK (
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
);

ALTER TABLE public.uploads DROP COLUMN IF EXISTS raw_staging_run_id;

-- D4A's ORIGINAL trigger function body, copied verbatim from
-- scripts/create-datahub-raw-staging.sql (lines 629-663). D4A's own
-- trigger (datahub_guard_upload_raw_staging_metadata on uploads) already
-- calls this function by name, so no CREATE TRIGGER is needed here.
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

-- ─── Restore data_hub_raw_rows to D4A's original shape ───────────────────
ALTER TABLE public.data_hub_raw_rows DROP CONSTRAINT IF EXISTS data_hub_raw_rows_staging_run_pinned_version_fkey;
ALTER TABLE public.data_hub_raw_rows DROP CONSTRAINT IF EXISTS data_hub_raw_rows_staging_run_upload_fkey;
ALTER TABLE public.data_hub_raw_rows DROP CONSTRAINT IF EXISTS data_hub_raw_rows_staging_run_profile_version_fkey;
ALTER TABLE public.data_hub_raw_rows DROP CONSTRAINT IF EXISTS data_hub_raw_rows_staging_run_source_row_key;

-- D4A's ORIGINAL unique constraint, copied verbatim.
ALTER TABLE public.data_hub_raw_rows
  ADD CONSTRAINT data_hub_raw_rows_upload_source_row_key UNIQUE (upload_id, source_row_number);

-- D4A's ORIGINAL (circular) FK, copied verbatim — restored exactly as it
-- was, including the circularity this migration existed to fix. This is
-- intentional: a rollback restores D4A's shape precisely, not a "fixed"
-- version of it.
ALTER TABLE public.data_hub_raw_rows
  ADD CONSTRAINT data_hub_raw_rows_upload_profile_version_org_fkey
  FOREIGN KEY (upload_id, worksheet_mapping_profile_version_id, organisation_id)
  REFERENCES public.uploads(id, raw_profile_version_id, organisation_id);

DROP INDEX IF EXISTS idx_data_hub_raw_rows_staging_run;

ALTER TABLE public.data_hub_raw_rows DROP COLUMN IF EXISTS staging_run_id;

-- ─── Remove data_hub_raw_staging_runs entirely ───────────────────────────
DROP TRIGGER IF EXISTS data_hub_raw_staging_runs_lifecycle_guard ON public.data_hub_raw_staging_runs;
DROP FUNCTION IF EXISTS public.datahub_guard_raw_staging_run_lifecycle();
DROP TABLE IF EXISTS public.data_hub_raw_staging_runs;

COMMIT;
