-- Data Hub 6.2D4D1B1 — guarded manual rollback for
-- scripts/create-datahub-dataset-profiles.sql.
--
-- Refuses to destroy any persisted profile-attempt history.

BEGIN;

DO $$
DECLARE
  run_count bigint;
BEGIN
  SELECT count(*) INTO run_count FROM public.data_hub_dataset_profile_runs;
  IF run_count > 0 THEN
    RAISE EXCEPTION
      'Refusing rollback: data_hub_dataset_profile_runs contains % row(s). Rolling back would destroy immutable dataset-profile history.',
      run_count;
  END IF;
END $$;

DROP TRIGGER IF EXISTS data_hub_dataset_profile_columns_immutable_guard
  ON public.data_hub_dataset_profile_columns;
DROP TRIGGER IF EXISTS data_hub_dataset_profile_runs_lifecycle_guard
  ON public.data_hub_dataset_profile_runs;

DROP FUNCTION IF EXISTS public.datahub_guard_dataset_profile_column_immutable();
DROP FUNCTION IF EXISTS public.datahub_guard_dataset_profile_run_lifecycle();

DROP TABLE IF EXISTS public.data_hub_dataset_profile_columns;
DROP TABLE IF EXISTS public.data_hub_dataset_profile_runs;

ALTER TABLE public.uploads
  DROP CONSTRAINT IF EXISTS uploads_id_normalization_run_organisation_key;
ALTER TABLE public.data_hub_normalization_runs
  DROP CONSTRAINT IF EXISTS data_hub_normalization_runs_profile_lineage_key;

COMMIT;
