-- Runs pilot mapping approvals and per-workbook first-use confirmations.
-- Apply manually after D4C findings/governed immutability, to an approved target.
-- No backfill, profile activation, uploads or historical repinning. Local proof first.
BEGIN;

-- Extend stored vocabulary, preserving all existing units/findings.
ALTER TABLE public.data_hub_dataset_profile_columns DROP CONSTRAINT data_hub_dataset_profile_columns_units_check;
ALTER TABLE public.data_hub_dataset_profile_columns ADD CONSTRAINT data_hub_dataset_profile_columns_units_check CHECK (
  (source_unit IS NULL) = (normalized_unit IS NULL) AND
  (source_unit IS NULL OR source_unit IN ('kg','t','m','km','s','min','h','%','AUD','d','kg/h','t/h','bins/h')) AND
  (normalized_unit IS NULL OR normalized_unit IN ('kg','t','m','km','s','min','h','%','AUD','d','kg/h','t/h','bins/h'))
);
ALTER TABLE public.data_hub_normalized_cells DROP CONSTRAINT data_hub_normalized_cells_unit_allowlist_check;
ALTER TABLE public.data_hub_normalized_cells ADD CONSTRAINT data_hub_normalized_cells_unit_allowlist_check CHECK (
  (source_unit IS NULL OR source_unit IN ('kg','t','m','km','s','min','h','%','AUD','d','kg/h','t/h','bins/h')) AND
  (normalized_unit IS NULL OR normalized_unit IN ('kg','t','m','km','s','min','h','%','AUD','d','kg/h','t/h','bins/h'))
);
ALTER TABLE public.data_hub_normalization_findings DROP CONSTRAINT data_hub_normalization_findings_code_check;
ALTER TABLE public.data_hub_normalization_findings ADD CONSTRAINT data_hub_normalization_findings_code_check CHECK (finding_code IN (
  'PROFILE_DOCUMENT_INVALID','NORMALIZATION_INELIGIBLE_V1','MISSING_GOVERNED_RULE','UNKNOWN_RULE_COLUMN','INVALID_RAW_SHAPE',
  'UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND','MALFORMED_NUMERIC_STRING','UNSAFE_NUMERIC_VALUE','INTEGER_NOT_WHOLE',
  'LATITUDE_OUT_OF_RANGE','LONGITUDE_OUT_OF_RANGE','NON_TERMINATING_UNIT_CONVERSION','MALFORMED_DATE_STRING',
  'INVALID_CALENDAR_DATE','MALFORMED_TIME_STRING','INVALID_CLOCK_TIME','MALFORMED_DATETIME_STRING','MISSING_SOURCE_OFFSET',
  'UNEXPECTED_OFFSET_PRESENT','INVALID_UTC_OFFSET','NORMALIZED_YEAR_OUT_OF_RANGE','INVALID_IANA_ZONE','NONEXISTENT_LOCAL_TIME',
  'AMBIGUOUS_LOCAL_TIME','IANA_OFFSET_UNRESOLVABLE','NUMERIC_VALUE_BELOW_MINIMUM'
));

CREATE TABLE IF NOT EXISTS public.data_hub_mapping_approvals (
  profile_version_id text PRIMARY KEY,
  profile_id text NOT NULL,
  organisation_id text NOT NULL REFERENCES public.organisations(id),
  review_document jsonb NOT NULL,
  review_digest text NOT NULL CHECK (review_digest ~ '^[0-9a-f]{64}$'),
  approved_by text NOT NULL REFERENCES public.users(id),
  approved_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(profile_version_id, profile_id, organisation_id),
  FOREIGN KEY(profile_version_id, profile_id, organisation_id)
    REFERENCES public.worksheet_mapping_profile_versions(id, worksheet_mapping_profile_id, organisation_id),
  CHECK (COALESCE(jsonb_typeof(review_document) = 'object' AND review_document->>'template' = 'onkaparinga-runs-review-v1'
    AND review_document->'activationAllowed' = 'false'::jsonb, false))
);
CREATE TABLE IF NOT EXISTS public.data_hub_mapping_use_confirmations (
  upload_id text NOT NULL,
  organisation_id text NOT NULL,
  profile_id text NOT NULL,
  profile_version_id text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  confirmed_by text NOT NULL REFERENCES public.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(upload_id, profile_version_id, organisation_id),
  FOREIGN KEY(upload_id, organisation_id) REFERENCES public.uploads(id, organisation_id),
  FOREIGN KEY(profile_version_id, profile_id, organisation_id)
    REFERENCES public.data_hub_mapping_approvals(profile_version_id, profile_id, organisation_id)
);

CREATE OR REPLACE FUNCTION public.datahub_guard_mapping_approval() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'MAPPING_APPROVAL_IMMUTABLE'; END IF;
  PERFORM id FROM public.users WHERE id=NEW.approved_by AND organisation_id=NEW.organisation_id
    AND status::text='ACTIVE' AND role::text IN ('ADMIN','SUPER_ADMIN') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MAPPING_ACTOR_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.worksheet_mapping_profile_versions v WHERE v.id=NEW.profile_version_id
    AND v.organisation_id=NEW.organisation_id AND v.worksheet_mapping_profile_id=NEW.profile_id
    AND v.disposition='STAGING_DATASET' AND v.profile_document->>'documentVersion'='2') THEN RAISE EXCEPTION 'MAPPING_PROFILE_INVALID'; END IF;
  NEW.approved_at := statement_timestamp(); RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS datahub_mapping_approval_guard ON public.data_hub_mapping_approvals;
CREATE TRIGGER datahub_mapping_approval_guard BEFORE INSERT OR UPDATE OR DELETE ON public.data_hub_mapping_approvals
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_mapping_approval();

CREATE OR REPLACE FUNCTION public.datahub_guard_mapping_use() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE current_version text; actual_sha text; actual_worksheet text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'MAPPING_CONFIRMATION_IMMUTABLE'; END IF;
  PERFORM id FROM public.users WHERE id=NEW.confirmed_by AND organisation_id=NEW.organisation_id
    AND status::text='ACTIVE' AND role::text IN ('MANAGER','ADMIN','SUPER_ADMIN') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MAPPING_ACTOR_FORBIDDEN'; END IF;
  SELECT p.active_profile_version_id INTO current_version FROM public.worksheet_mapping_profiles p
    WHERE p.id=NEW.profile_id AND p.organisation_id=NEW.organisation_id AND p.active FOR SHARE;
  SELECT b.sha256,w.id INTO actual_sha,actual_worksheet FROM public.uploads u
    JOIN public.import_batches b ON b.id=u.import_batch_id AND b.organisation_id=u.organisation_id
    JOIN public.source_schema_worksheets w ON w.source_schema_version_id=b.source_schema_version_id
      AND w.organisation_id=b.organisation_id AND w.ordinal_hint=u.worksheet_index AND w.expected_name=u.worksheet_name
    JOIN public.worksheet_mapping_profiles p ON p.source_schema_worksheet_id=w.id AND p.id=NEW.profile_id AND p.organisation_id=w.organisation_id
    WHERE u.id=NEW.upload_id AND u.organisation_id=NEW.organisation_id AND u.lineage_kind='DATA_HUB'
      AND b.status='READY' AND b.deleted_at IS NULL AND u.raw_staged_at IS NULL;
  IF current_version IS DISTINCT FROM NEW.profile_version_id OR actual_sha IS DISTINCT FROM NEW.source_sha256
    OR actual_worksheet IS NULL THEN RAISE EXCEPTION 'MAPPING_CONFIRMATION_STALE'; END IF;
  IF EXISTS (SELECT 1 FROM public.data_hub_raw_staging_runs WHERE upload_id=NEW.upload_id AND organisation_id=NEW.organisation_id)
    THEN RAISE EXCEPTION 'MAPPING_ALREADY_STARTED'; END IF;
  NEW.confirmed_at := statement_timestamp(); RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS datahub_mapping_use_guard ON public.data_hub_mapping_use_confirmations;
CREATE TRIGGER datahub_mapping_use_guard BEFORE INSERT OR UPDATE OR DELETE ON public.data_hub_mapping_use_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_mapping_use();

-- Atomic final gate closes the gap between eligibility and durable run creation.
-- Only the explicitly scoped pilot Runs worksheet gets this new policy.
CREATE OR REPLACE FUNCTION public.datahub_require_mapping_confirmation() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE current_version text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.source_schema_worksheets WHERE id=NEW.source_schema_worksheet_id
    AND organisation_id=NEW.organisation_id AND source_schema_version_id='dhcfg-onk-mwco-sv1' AND logical_key='runs') THEN
    PERFORM id FROM public.users WHERE id=NEW.created_by AND organisation_id=NEW.organisation_id
      AND status::text='ACTIVE' AND role::text IN ('MANAGER','ADMIN','SUPER_ADMIN') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MAPPING_ACTOR_FORBIDDEN'; END IF;
    PERFORM id FROM public.source_schema_versions WHERE id=NEW.source_schema_version_id
      AND organisation_id=NEW.organisation_id AND status='ACTIVE' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MAPPING_SCHEMA_NOT_ACTIVE'; END IF;
    SELECT active_profile_version_id INTO current_version FROM public.worksheet_mapping_profiles
      WHERE id=NEW.worksheet_mapping_profile_id AND organisation_id=NEW.organisation_id AND active FOR SHARE;
    IF (SELECT count(*) FROM public.worksheet_mapping_profiles WHERE source_schema_worksheet_id=NEW.source_schema_worksheet_id
        AND organisation_id=NEW.organisation_id AND active) <> 1
      OR current_version IS DISTINCT FROM NEW.worksheet_mapping_profile_version_id OR NOT EXISTS (
      SELECT 1 FROM public.data_hub_mapping_use_confirmations c JOIN public.import_batches b
        ON b.id=NEW.import_batch_id AND b.organisation_id=NEW.organisation_id
      WHERE c.upload_id=NEW.upload_id AND c.organisation_id=NEW.organisation_id
        AND c.profile_id=NEW.worksheet_mapping_profile_id AND c.profile_version_id=NEW.worksheet_mapping_profile_version_id
        AND c.source_sha256=NEW.source_sha256 AND c.source_sha256=b.sha256
    ) THEN RAISE EXCEPTION 'MAPPING_CONFIRMATION_REQUIRED'; END IF;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS datahub_raw_run_mapping_confirmation ON public.data_hub_raw_staging_runs;
CREATE TRIGGER datahub_raw_run_mapping_confirmation BEFORE INSERT ON public.data_hub_raw_staging_runs
  FOR EACH ROW EXECUTE FUNCTION public.datahub_require_mapping_confirmation();
COMMIT;
