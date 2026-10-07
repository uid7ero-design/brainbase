-- D4D5Q: durable append-only review decisions, foundation only.
-- No backfill, READY state, schema snapshot, source values or executor.
-- v1 decisions must later be recomputed against the pinned profile by the
-- trusted save/read services. SQL validates storage shape, not semantics.
BEGIN;

CREATE OR REPLACE FUNCTION public.datahub_valid_review_semantic_choices(p_choices jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE item jsonb; seen text[] := ARRAY[]::text[]; column_id text;
BEGIN
  IF jsonb_typeof(p_choices) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_choices) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF (item - ARRAY['sourceSchemaColumnId', 'role']) <> '{}'::jsonb
       OR jsonb_typeof(item->'sourceSchemaColumnId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'role') IS DISTINCT FROM 'string'
       OR btrim(item->>'sourceSchemaColumnId') = ''
       OR item->>'role' NOT IN ('TEXT','IDENTIFIER','RECORD_KEY','CATEGORICAL_DIMENSION','BOOLEAN_FLAG',
         'MEASURE','TEMPORAL','DURATION','PERCENTAGE','CURRENCY','GEO_LATITUDE','GEO_LONGITUDE') THEN RETURN false; END IF;
    column_id := item->>'sourceSchemaColumnId';
    IF column_id = ANY(seen) THEN RETURN false; END IF;
    seen := array_append(seen, column_id);
  END LOOP;
  RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.datahub_valid_review_quality_decisions(p_decisions jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE item jsonb; seen text[] := ARRAY[]::text[]; identity text;
BEGIN
  IF jsonb_typeof(p_decisions) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_decisions) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF (item - ARRAY['code','scope','sourceSchemaColumnId','decision']) <> '{}'::jsonb
       OR jsonb_typeof(item->'code') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'scope') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'decision') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    IF item->>'scope' = 'DATASET' THEN
      IF item ? 'sourceSchemaColumnId' OR item->>'code' NOT IN
        ('EMPTY_DATASET','NO_COLUMNS','MULTIPLE_RECORD_KEY_CANDIDATES') THEN RETURN false; END IF;
    ELSIF item->>'scope' = 'COLUMN' THEN
      IF jsonb_typeof(item->'sourceSchemaColumnId') IS DISTINCT FROM 'string'
         OR btrim(item->>'sourceSchemaColumnId') = ''
         OR item->>'code' NOT IN ('COLUMN_ALL_NULL','COLUMN_PARTIALLY_NULL','COLUMN_CONSTANT',
           'RECORD_KEY_CANDIDATE_NOT_UNIQUE','RECORD_KEY_CANDIDATE_INCOMPLETE') THEN RETURN false; END IF;
    ELSE RETURN false;
    END IF;
    IF item->>'code' IN ('COLUMN_PARTIALLY_NULL','COLUMN_CONSTANT') THEN
      IF item->>'decision' <> 'ACKNOWLEDGE' THEN RETURN false; END IF;
    ELSIF item->>'decision' NOT IN ('CONTINUE','HOLD') THEN RETURN false;
    END IF;
    identity := (item->>'code') || ':' || (item->>'scope') || ':' || COALESCE(item->>'sourceSchemaColumnId','');
    IF identity = ANY(seen) THEN RETURN false; END IF;
    seen := array_append(seen, identity);
  END LOOP;
  RETURN true;
END;
$fn$;

CREATE TABLE IF NOT EXISTS public.data_hub_analysis_reviews (
  id text PRIMARY KEY,
  organisation_id text NOT NULL REFERENCES public.organisations(id),
  upload_id text NOT NULL,
  profile_run_id text NOT NULL,
  revision integer NOT NULL,
  review_version text NOT NULL,
  reviewed_by_id text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  semantic_choices jsonb NOT NULL,
  quality_decisions jsonb NOT NULL,
  CONSTRAINT data_hub_analysis_reviews_profile_fkey FOREIGN KEY (profile_run_id, upload_id, organisation_id)
    REFERENCES public.data_hub_dataset_profile_runs(id, upload_id, organisation_id),
  CONSTRAINT data_hub_analysis_reviews_profile_revision_key UNIQUE (profile_run_id, revision),
  CONSTRAINT data_hub_analysis_reviews_identity_check CHECK (btrim(id) <> '' AND btrim(reviewed_by_id) <> ''),
  CONSTRAINT data_hub_analysis_reviews_revision_check CHECK (revision >= 1),
  CONSTRAINT data_hub_analysis_reviews_version_check CHECK (review_version = 'v1'),
  CONSTRAINT data_hub_analysis_reviews_choices_check CHECK (public.datahub_valid_review_semantic_choices(semantic_choices)),
  CONSTRAINT data_hub_analysis_reviews_decisions_check CHECK (public.datahub_valid_review_quality_decisions(quality_decisions))
);
CREATE INDEX IF NOT EXISTS data_hub_analysis_reviews_scope_idx
  ON public.data_hub_analysis_reviews(organisation_id, upload_id, profile_run_id, revision);

CREATE OR REPLACE FUNCTION public.datahub_guard_analysis_review()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE profile_status text; profile_version text; pinned_profile text;
  actor_role text; actor_status text; next_revision integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'ANALYSIS_REVIEW_IMMUTABLE'; END IF;
  IF NOT public.datahub_valid_review_semantic_choices(NEW.semantic_choices)
     OR NOT public.datahub_valid_review_quality_decisions(NEW.quality_decisions) THEN
    RAISE EXCEPTION 'ANALYSIS_REVIEW_PAYLOAD_INVALID';
  END IF;
  -- Never accept a caller-selected review timestamp.
  NEW.reviewed_at := statement_timestamp();
  -- Serialize revision allocation per profile, and pin the upload until commit.
  SELECT p.status, p.profiler_version, u.dataset_profile_run_id
    INTO profile_status, profile_version, pinned_profile
    FROM public.data_hub_dataset_profile_runs p JOIN public.uploads u
      ON u.id = p.upload_id AND u.organisation_id = p.organisation_id
    WHERE p.id = NEW.profile_run_id AND p.upload_id = NEW.upload_id
      AND p.organisation_id = NEW.organisation_id AND u.lineage_kind = 'DATA_HUB'
    FOR UPDATE OF p, u;
  IF NOT FOUND OR profile_status <> 'SUCCEEDED' OR profile_version <> 'v1'
     OR pinned_profile IS DISTINCT FROM NEW.profile_run_id THEN
    RAISE EXCEPTION 'ANALYSIS_REVIEW_PROFILE_INVALID';
  END IF;
  -- Historical actor id is retained without a live FK. Validate authority now
  -- and lock it so role/status/org changes cannot race this insertion.
  SELECT role::text, status::text INTO actor_role, actor_status FROM public.users
    WHERE id = NEW.reviewed_by_id AND organisation_id = NEW.organisation_id FOR SHARE;
  IF NOT FOUND OR actor_status <> 'ACTIVE' OR actor_role NOT IN ('SUPER_ADMIN','ADMIN','MANAGER') THEN
    RAISE EXCEPTION 'ANALYSIS_REVIEW_ACTOR_INVALID';
  END IF;
  SELECT COALESCE(max(revision), 0) + 1 INTO next_revision FROM public.data_hub_analysis_reviews
    WHERE profile_run_id = NEW.profile_run_id;
  IF NEW.revision <> next_revision THEN RAISE EXCEPTION 'ANALYSIS_REVIEW_REVISION_INVALID'; END IF;
  -- Column references must belong to this exact persisted profile. Payload
  -- completeness/candidate membership still require the semantic engines.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT value->>'sourceSchemaColumnId' AS column_id FROM jsonb_array_elements(NEW.semantic_choices)
      UNION ALL
      SELECT value->>'sourceSchemaColumnId' FROM jsonb_array_elements(NEW.quality_decisions) WHERE value->>'scope' = 'COLUMN'
    ) requested WHERE NOT EXISTS (
      SELECT 1 FROM public.data_hub_dataset_profile_columns c WHERE c.profile_run_id = NEW.profile_run_id
        AND c.organisation_id = NEW.organisation_id AND c.source_schema_column_id = requested.column_id
    )
  ) THEN RAISE EXCEPTION 'ANALYSIS_REVIEW_COLUMN_INVALID'; END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS data_hub_analysis_reviews_guard ON public.data_hub_analysis_reviews;
CREATE TRIGGER data_hub_analysis_reviews_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.data_hub_analysis_reviews FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_analysis_review();
DROP TRIGGER IF EXISTS data_hub_analysis_reviews_truncate_guard ON public.data_hub_analysis_reviews;
CREATE TRIGGER data_hub_analysis_reviews_truncate_guard BEFORE TRUNCATE
  ON public.data_hub_analysis_reviews FOR EACH STATEMENT EXECUTE FUNCTION public.datahub_guard_analysis_review();
COMMIT;
