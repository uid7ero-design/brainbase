-- BrainBase Assurance A0.1F — ROLLBACK of the template lifecycle migration.
--
-- Restores the A0.1D-3 / A0.1E-1 shape exactly: no lifecycle columns, and the
-- always-immutable version triggers.
--
-- NOT DATA-PRESERVING FOR DRAFTS: every DRAFT (unpublished) template version
-- is DELETED, because the pre-A0.1F model has no unpublished state and would
-- otherwise treat a draft as live. Unpublished draft work is discarded.
-- Drafts can never be referenced by an Inspection or Audit (A0.1F binding
-- trigger), so no operational record is affected. A template whose only
-- version was a draft keeps its identity row with zero versions (the
-- pre-A0.1F application already tolerates that: it offers no version).
--
-- PUBLISHED and RETIRED versions are kept unchanged (content was immutable);
-- only their lifecycle columns are dropped. Pre-A0.1F semantics ("the latest
-- version is current") then apply again.
--
-- Idempotent: safe to run more than once, and safe on a database where
-- A0.1F was never applied.

BEGIN;

DROP TRIGGER IF EXISTS trg_assurance_inspections_published_template ON assurance_inspections;
DROP TRIGGER IF EXISTS trg_assurance_audits_published_template ON assurance_audits;
DROP TRIGGER IF EXISTS trg_assurance_inspection_template_versions_lifecycle ON assurance_inspection_template_versions;
DROP TRIGGER IF EXISTS trg_assurance_audit_template_versions_lifecycle ON assurance_audit_template_versions;
DROP TRIGGER IF EXISTS trg_assurance_inspection_template_versions_immutable ON assurance_inspection_template_versions;
DROP TRIGGER IF EXISTS trg_assurance_audit_template_versions_immutable ON assurance_audit_template_versions;

DO $$
DECLARE
  t text;
  discarded integer;
BEGIN
  FOREACH t IN ARRAY ARRAY['assurance_inspection_template_versions','assurance_audit_template_versions'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t AND column_name = 'status') THEN
      EXECUTE format('DELETE FROM %I WHERE status = ''DRAFT''', t);
      GET DIAGNOSTICS discarded = ROW_COUNT;
      RAISE NOTICE 'A0.1F rollback: discarded % unpublished DRAFT row(s) from %', discarded, t;
    END IF;
  END LOOP;
END $$;

DROP INDEX IF EXISTS uq_assurance_inspection_template_versions_one_draft;
DROP INDEX IF EXISTS uq_assurance_inspection_template_versions_one_published;
DROP INDEX IF EXISTS uq_assurance_audit_template_versions_one_draft;
DROP INDEX IF EXISTS uq_assurance_audit_template_versions_one_published;

ALTER TABLE assurance_inspection_template_versions
  DROP CONSTRAINT IF EXISTS assurance_inspection_template_versions_published_by_fkey,
  DROP CONSTRAINT IF EXISTS assurance_inspection_template_versions_retired_by_fkey,
  DROP CONSTRAINT IF EXISTS assurance_inspection_template_versions_updated_by_fkey,
  DROP CONSTRAINT IF EXISTS assurance_inspection_template_versions_status_check,
  DROP CONSTRAINT IF EXISTS assurance_inspection_template_versions_lifecycle_state_check,
  DROP CONSTRAINT IF EXISTS assurance_inspection_template_versions_retire_order_check,
  DROP CONSTRAINT IF EXISTS assurance_inspection_template_versions_lock_version_check,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS published_at,
  DROP COLUMN IF EXISTS published_by,
  DROP COLUMN IF EXISTS retired_at,
  DROP COLUMN IF EXISTS retired_by,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS lock_version;

ALTER TABLE assurance_audit_template_versions
  DROP CONSTRAINT IF EXISTS assurance_audit_template_versions_published_by_fkey,
  DROP CONSTRAINT IF EXISTS assurance_audit_template_versions_retired_by_fkey,
  DROP CONSTRAINT IF EXISTS assurance_audit_template_versions_updated_by_fkey,
  DROP CONSTRAINT IF EXISTS assurance_audit_template_versions_status_check,
  DROP CONSTRAINT IF EXISTS assurance_audit_template_versions_lifecycle_state_check,
  DROP CONSTRAINT IF EXISTS assurance_audit_template_versions_retire_order_check,
  DROP CONSTRAINT IF EXISTS assurance_audit_template_versions_lock_version_check,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS published_at,
  DROP COLUMN IF EXISTS published_by,
  DROP COLUMN IF EXISTS retired_at,
  DROP COLUMN IF EXISTS retired_by,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS lock_version;

DROP FUNCTION IF EXISTS assurance_require_published_template_version();
DROP FUNCTION IF EXISTS assurance_template_version_lifecycle_guard();

-- Restore the A0.1D-3 / A0.1E-1 always-immutable triggers (function bodies
-- re-declared verbatim so the rollback does not depend on them surviving).
CREATE OR REPLACE FUNCTION assurance_prevent_inspection_template_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Inspection template versions are immutable; create a new version instead';
END;
$$;

CREATE TRIGGER trg_assurance_inspection_template_versions_immutable
BEFORE UPDATE OR DELETE ON assurance_inspection_template_versions
FOR EACH ROW
EXECUTE FUNCTION assurance_prevent_inspection_template_version_mutation();

CREATE OR REPLACE FUNCTION assurance_prevent_audit_template_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit template versions are immutable; create a new version instead';
END;
$$;

CREATE TRIGGER trg_assurance_audit_template_versions_immutable
BEFORE UPDATE OR DELETE ON assurance_audit_template_versions
FOR EACH ROW EXECUTE FUNCTION assurance_prevent_audit_template_version_mutation();

DO $$
DECLARE leftover integer; immutable_count integer;
BEGIN
  SELECT count(*) INTO leftover FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('assurance_inspection_template_versions','assurance_audit_template_versions')
    AND column_name IN ('status','published_at','published_by','retired_at','retired_by','updated_at','updated_by','lock_version');
  IF leftover <> 0 THEN
    RAISE EXCEPTION 'A0.1F rollback post-condition failed: % lifecycle columns remain', leftover;
  END IF;
  SELECT count(*) INTO immutable_count FROM pg_trigger
  WHERE NOT tgisinternal AND tgname IN (
    'trg_assurance_inspection_template_versions_immutable',
    'trg_assurance_audit_template_versions_immutable');
  IF immutable_count <> 2 THEN
    RAISE EXCEPTION 'A0.1F rollback post-condition failed: expected 2 immutable triggers, found %', immutable_count;
  END IF;
END $$;

COMMIT;
