-- Data Hub 6.2D4D1B2 — guarded manual rollback for
-- scripts/create-datahub-profile-execution.sql.
--
-- Refuses to run while any Upload still carries a profile pointer, since
-- dropping the pointer columns would destroy that completion state. The
-- established D4D1B1 convention (clear immutable history first) applies
-- equally here: an operator must explicitly clear every
-- dataset_profile_run_id before this rollback may proceed.

BEGIN;

DO $$
DECLARE
  pointer_count bigint;
BEGIN
  SELECT count(*) INTO pointer_count FROM public.uploads WHERE dataset_profile_run_id IS NOT NULL;
  IF pointer_count > 0 THEN
    RAISE EXCEPTION
      'Refusing rollback: % upload(s) still carry a dataset_profile_run_id pointer. Clear it first.',
      pointer_count;
  END IF;
END $$;

DROP TRIGGER IF EXISTS uploads_dataset_profile_metadata_guard ON public.uploads;
DROP FUNCTION IF EXISTS public.datahub_guard_upload_dataset_profile_metadata();
DROP FUNCTION IF EXISTS public.datahub_complete_dataset_profile_run(text, text, text, jsonb, bigint, bigint, bigint, bigint, bigint, bigint, bigint);

ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_dataset_profile_coherence_check;
ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_dataset_profile_run_upload_fkey;
ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_profiled_by_fkey;
ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_id_dataset_profile_run_organisation_key;

ALTER TABLE public.uploads DROP COLUMN IF EXISTS dataset_profile_run_id;
ALTER TABLE public.uploads DROP COLUMN IF EXISTS profiled_at;
ALTER TABLE public.uploads DROP COLUMN IF EXISTS profiled_by;
ALTER TABLE public.uploads DROP COLUMN IF EXISTS profiler_version;

ALTER TABLE public.data_hub_dataset_profile_runs
  DROP CONSTRAINT IF EXISTS data_hub_dataset_profile_runs_id_upload_organisation_key;

COMMIT;
