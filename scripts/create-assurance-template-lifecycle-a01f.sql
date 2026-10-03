-- BrainBase Assurance A0.1F — Template lifecycle (DRAFT → PUBLISHED → RETIRED)
-- DRAFT ONLY. DO NOT APPLY TO PRODUCTION UNTIL static review + disposable
-- PostgreSQL proof + isolated Neon behavioural proof + Production preflight
-- have passed and the Production handoff is explicitly approved.
--
-- Scope: ADDITIVE changes to two existing tables plus triggers.
--   assurance_inspection_template_versions  (A0.1D-3)
--   assurance_audit_template_versions       (A0.1E-1)
--   assurance_inspections / assurance_audits (binding trigger only)
--
-- What it adds:
--   * Lifecycle columns on both version tables:
--       status, published_at, published_by, retired_at, retired_by,
--       updated_at, updated_by, lock_version
--   * Backfill: the latest version of every template becomes PUBLISHED
--     (published_at = created_at); every older version becomes RETIRED.
--   * At most one DRAFT and at most one PUBLISHED version per template.
--   * The A0.1D-3 / A0.1E-1 "always immutable" triggers are replaced by a
--     lifecycle guard:
--       - DRAFT content may be edited (lock_version must advance by one);
--       - DRAFT → PUBLISHED (content unchanged) is allowed, and atomically
--         retires the template's previously PUBLISHED version;
--       - PUBLISHED → RETIRED (content unchanged) is allowed;
--       - PUBLISHED / RETIRED content is immutable; RETIRED is terminal;
--       - identity, organisation and version number never change;
--       - DELETE is allowed only for a DRAFT (drafts can never be referenced).
--   * Inspections and Audits may bind only to a PUBLISHED version of the same
--     organisation (DB-enforced, race-safe via FOR SHARE).
--
-- Compatibility with the pre-A0.1F application (migration deploys FIRST):
--   * status DEFAULTs to 'PUBLISHED' and published_at DEFAULTs to now(), so a
--     legacy INSERT that omits every new column produces a valid PUBLISHED
--     version. Inserting a PUBLISHED version retires the previous PUBLISHED
--     version of that template inside the same statement, so the legacy
--     "publish version N+1" path keeps working under the one-PUBLISHED index.
--   * The legacy application never UPDATEs or DELETEs versions (the old
--     trigger forbade it) and always binds new records to the LATEST version,
--     which the backfill makes PUBLISHED.
--   * New application code must insert drafts EXPLICITLY with
--     status='DRAFT', published_at=NULL, published_by=NULL.
--
-- Re-application: idempotent. If A0.1D-3 or A0.1E-1 is ever re-applied after
-- this migration, re-apply A0.1F afterwards (those scripts recreate the old
-- always-immutable triggers).
--
-- Rollback: scripts/rollback-assurance-template-lifecycle-a01f.sql
-- (DISCARDS unpublished DRAFT versions; see that file).

BEGIN;

-- ============================================================================
-- PRE-FLIGHT
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'A0.1F preflight failed: public.users is missing';
  END IF;
  IF to_regclass('public.assurance_inspection_templates') IS NULL
     OR to_regclass('public.assurance_inspection_template_versions') IS NULL
     OR to_regclass('public.assurance_inspections') IS NULL
  THEN
    RAISE EXCEPTION 'A0.1F preflight failed: A0.1D-3 Inspection foundation is incomplete';
  END IF;
  IF to_regclass('public.assurance_audit_templates') IS NULL
     OR to_regclass('public.assurance_audit_template_versions') IS NULL
     OR to_regclass('public.assurance_audits') IS NULL
  THEN
    RAISE EXCEPTION 'A0.1F preflight failed: A0.1E-1 Audit foundation is incomplete';
  END IF;
END $$;

-- ============================================================================
-- LIFECYCLE COLUMNS
-- published_at is added WITHOUT a default first so the backfill can set it to
-- created_at; the now() default is attached after the backfill.
-- ============================================================================
ALTER TABLE assurance_inspection_template_versions
  ADD COLUMN IF NOT EXISTS status        TEXT        NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by  TEXT,
  ADD COLUMN IF NOT EXISTS retired_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retired_by    TEXT,
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by    TEXT,
  ADD COLUMN IF NOT EXISTS lock_version  INTEGER     NOT NULL DEFAULT 1;

ALTER TABLE assurance_audit_template_versions
  ADD COLUMN IF NOT EXISTS status        TEXT        NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by  TEXT,
  ADD COLUMN IF NOT EXISTS retired_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retired_by    TEXT,
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by    TEXT,
  ADD COLUMN IF NOT EXISTS lock_version  INTEGER     NOT NULL DEFAULT 1;

-- ============================================================================
-- BACKFILL (version triggers removed for the duration; recreated below)
-- ============================================================================
DROP TRIGGER IF EXISTS trg_assurance_inspection_template_versions_immutable ON assurance_inspection_template_versions;
DROP TRIGGER IF EXISTS trg_assurance_audit_template_versions_immutable ON assurance_audit_template_versions;
DROP TRIGGER IF EXISTS trg_assurance_inspection_template_versions_lifecycle ON assurance_inspection_template_versions;
DROP TRIGGER IF EXISTS trg_assurance_audit_template_versions_lifecycle ON assurance_audit_template_versions;

-- 1. Every non-draft version without a publication stamp was published when it
--    was created (pre-A0.1F semantics). published_by may stay NULL when the
--    creator is unknown.
UPDATE assurance_inspection_template_versions
   SET published_at = created_at, published_by = created_by, updated_at = created_at
 WHERE status <> 'DRAFT' AND published_at IS NULL;
UPDATE assurance_audit_template_versions
   SET published_at = created_at, published_by = created_by, updated_at = created_at
 WHERE status <> 'DRAFT' AND published_at IS NULL;

-- 2. Pre-A0.1F, the LATEST version of a template was its current one. Any
--    PUBLISHED version with a newer non-draft version is superseded: RETIRED
--    when the next version was created. retired_by is unknown (NULL).
UPDATE assurance_inspection_template_versions v
   SET status = 'RETIRED',
       retired_at = GREATEST(v.published_at, nx.next_created_at),
       retired_by = NULL
  FROM (
    SELECT o.id, min(n.created_at) AS next_created_at
      FROM assurance_inspection_template_versions o
      JOIN assurance_inspection_template_versions n
        ON n.organisation_id = o.organisation_id AND n.template_id = o.template_id
       AND n.version_number > o.version_number AND n.status <> 'DRAFT'
     WHERE o.status = 'PUBLISHED'
     GROUP BY o.id
  ) nx
 WHERE v.id = nx.id AND v.status = 'PUBLISHED';
UPDATE assurance_audit_template_versions v
   SET status = 'RETIRED',
       retired_at = GREATEST(v.published_at, nx.next_created_at),
       retired_by = NULL
  FROM (
    SELECT o.id, min(n.created_at) AS next_created_at
      FROM assurance_audit_template_versions o
      JOIN assurance_audit_template_versions n
        ON n.organisation_id = o.organisation_id AND n.template_id = o.template_id
       AND n.version_number > o.version_number AND n.status <> 'DRAFT'
     WHERE o.status = 'PUBLISHED'
     GROUP BY o.id
  ) nx
 WHERE v.id = nx.id AND v.status = 'PUBLISHED';

-- 3. Legacy inserts omit published_at: default it so they stay valid.
ALTER TABLE assurance_inspection_template_versions ALTER COLUMN published_at SET DEFAULT now();
ALTER TABLE assurance_audit_template_versions ALTER COLUMN published_at SET DEFAULT now();

-- ============================================================================
-- CONSTRAINTS (added only when missing, so re-application is a no-op)
-- ============================================================================
DO $$
DECLARE
  t text;
  short text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assurance_inspection_template_versions','assurance_audit_template_versions'] LOOP
    short := t;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname = short || '_published_by_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE NO ACTION', t, short || '_published_by_fkey');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname = short || '_retired_by_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (retired_by) REFERENCES users(id) ON DELETE NO ACTION', t, short || '_retired_by_fkey');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname = short || '_updated_by_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE NO ACTION', t, short || '_updated_by_fkey');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname = short || '_status_check') THEN
      EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I CHECK (status IN ('DRAFT','PUBLISHED','RETIRED'))$f$, t, short || '_status_check');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname = short || '_lifecycle_state_check') THEN
      EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I CHECK (
          (status = 'DRAFT' AND published_at IS NULL AND published_by IS NULL AND retired_at IS NULL AND retired_by IS NULL)
          OR (status = 'PUBLISHED' AND published_at IS NOT NULL AND retired_at IS NULL AND retired_by IS NULL)
          OR (status = 'RETIRED' AND published_at IS NOT NULL AND retired_at IS NOT NULL)
        )$f$, t, short || '_lifecycle_state_check');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname = short || '_retire_order_check') THEN
      EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I CHECK (retired_at IS NULL OR published_at IS NULL OR retired_at >= published_at)$f$, t, short || '_retire_order_check');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname = short || '_lock_version_check') THEN
      EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I CHECK (lock_version > 0)$f$, t, short || '_lock_version_check');
    END IF;
  END LOOP;
END $$;

-- At most one DRAFT and at most one PUBLISHED (current) version per template.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_inspection_template_versions_one_draft
  ON assurance_inspection_template_versions (organisation_id, template_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_inspection_template_versions_one_published
  ON assurance_inspection_template_versions (organisation_id, template_id) WHERE status = 'PUBLISHED';
CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_audit_template_versions_one_draft
  ON assurance_audit_template_versions (organisation_id, template_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_audit_template_versions_one_published
  ON assurance_audit_template_versions (organisation_id, template_id) WHERE status = 'PUBLISHED';

-- ============================================================================
-- VERSION LIFECYCLE GUARD (shared by both version tables)
-- Error codes: AT001 = lifecycle/immutability violation; AT003 = stale write.
-- ============================================================================
CREATE OR REPLACE FUNCTION assurance_template_version_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  kind text := CASE TG_TABLE_NAME
    WHEN 'assurance_inspection_template_versions' THEN 'Inspection'
    ELSE 'Audit' END;
  lifecycle_cols text[] := ARRAY['status','published_at','published_by','retired_at','retired_by','updated_at','updated_by','lock_version'];
  identity_cols text[] := ARRAY['id','organisation_id','template_id','version_number','created_by','created_at'];
  col text;
  content_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'DRAFT' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '% template version % is %; only a draft can be deleted', kind, OLD.version_number, lower(OLD.status)
      USING ERRCODE = 'AT001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('DRAFT','PUBLISHED') THEN
      RAISE EXCEPTION '% template versions are created as DRAFT or PUBLISHED', kind USING ERRCODE = 'AT001';
    END IF;
  ELSE
    FOREACH col IN ARRAY identity_cols LOOP
      IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
        RAISE EXCEPTION '% template version identity (%) cannot change', kind, col USING ERRCODE = 'AT001';
      END IF;
    END LOOP;

    content_changed := (to_jsonb(NEW) - lifecycle_cols) IS DISTINCT FROM (to_jsonb(OLD) - lifecycle_cols);

    IF OLD.status = 'DRAFT' AND NEW.status = 'DRAFT' THEN
      NULL; -- draft content edit
    ELSIF OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED' THEN
      IF content_changed THEN
        RAISE EXCEPTION '% template version % must be saved before it is published', kind, OLD.version_number USING ERRCODE = 'AT001';
      END IF;
    ELSIF OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED' THEN
      IF content_changed
         OR NEW.published_at IS DISTINCT FROM OLD.published_at
         OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
        RAISE EXCEPTION 'Published % template versions are immutable; create a new version instead', lower(kind) USING ERRCODE = 'AT001';
      END IF;
    ELSIF OLD.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'Published % template versions are immutable; create a new version instead', lower(kind) USING ERRCODE = 'AT001';
    ELSIF OLD.status = 'RETIRED' THEN
      RAISE EXCEPTION 'Retired % template versions are immutable and cannot be republished', lower(kind) USING ERRCODE = 'AT001';
    ELSE
      RAISE EXCEPTION '% template version cannot move from % to %', kind, OLD.status, NEW.status USING ERRCODE = 'AT001';
    END IF;

    -- Checked after the transition rules, so an attempt to rewrite a
    -- published/retired version reports immutability, not staleness.
    IF NEW.lock_version IS DISTINCT FROM OLD.lock_version + 1 THEN
      RAISE EXCEPTION '% template version % was changed by someone else', kind, OLD.version_number USING ERRCODE = 'AT003';
    END IF;

    NEW.updated_at := now();
  END IF;

  -- Publishing (a DRAFT → PUBLISHED update, or a legacy PUBLISHED insert)
  -- retires the template's current PUBLISHED version in the same statement.
  IF NEW.status = 'PUBLISHED' AND (TG_OP = 'INSERT' OR OLD.status = 'DRAFT') THEN
    EXECUTE format(
      'UPDATE %I SET status = ''RETIRED'', retired_at = now(), retired_by = $1, updated_by = $1, lock_version = lock_version + 1
        WHERE organisation_id = $2 AND template_id = $3 AND status = ''PUBLISHED'' AND id <> $4',
      TG_TABLE_NAME)
    USING COALESCE(NEW.published_by, NEW.created_by), NEW.organisation_id, NEW.template_id, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assurance_inspection_template_versions_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON assurance_inspection_template_versions
FOR EACH ROW EXECUTE FUNCTION assurance_template_version_lifecycle_guard();

CREATE TRIGGER trg_assurance_audit_template_versions_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON assurance_audit_template_versions
FOR EACH ROW EXECUTE FUNCTION assurance_template_version_lifecycle_guard();

-- ============================================================================
-- OPERATIONAL BINDING: records bind only to a PUBLISHED same-org version.
-- FOR SHARE blocks a concurrent retire/supersede until this record commits,
-- and re-reads the row if a retire committed first (READ COMMITTED), so a
-- record can never bind to a version that was retired concurrently.
-- Error code: AT002.
-- ============================================================================
CREATE OR REPLACE FUNCTION assurance_require_published_template_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_table text := CASE TG_TABLE_NAME
    WHEN 'assurance_inspections' THEN 'assurance_inspection_template_versions'
    WHEN 'assurance_audits' THEN 'assurance_audit_template_versions' END;
  kind text := CASE TG_TABLE_NAME WHEN 'assurance_inspections' THEN 'Inspection' ELSE 'Audit' END;
  found_status text;
BEGIN
  IF NEW.template_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.template_version_id IS NOT DISTINCT FROM OLD.template_version_id
     AND NEW.organisation_id IS NOT DISTINCT FROM OLD.organisation_id THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT status FROM %I WHERE organisation_id = $1 AND id = $2 FOR SHARE', version_table)
    INTO found_status
    USING NEW.organisation_id, NEW.template_version_id;

  IF found_status IS NULL THEN
    RAISE EXCEPTION '% template version not found in this organisation', kind USING ERRCODE = 'AT002';
  ELSIF found_status <> 'PUBLISHED' THEN
    RAISE EXCEPTION '% template version is % and cannot be used', kind, lower(found_status) USING ERRCODE = 'AT002';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assurance_inspections_published_template ON assurance_inspections;
CREATE TRIGGER trg_assurance_inspections_published_template
BEFORE INSERT OR UPDATE OF template_version_id, organisation_id ON assurance_inspections
FOR EACH ROW EXECUTE FUNCTION assurance_require_published_template_version();

DROP TRIGGER IF EXISTS trg_assurance_audits_published_template ON assurance_audits;
CREATE TRIGGER trg_assurance_audits_published_template
BEFORE INSERT OR UPDATE OF template_version_id, organisation_id ON assurance_audits
FOR EACH ROW EXECUTE FUNCTION assurance_require_published_template_version();

-- ============================================================================
-- POST-CONDITIONS
-- ============================================================================
DO $$
DECLARE
  missing_cols integer;
  trigger_count integer;
  legacy_trigger_count integer;
  index_count integer;
  constraint_count integer;
BEGIN
  SELECT count(*) INTO missing_cols
  FROM (VALUES ('status'),('published_at'),('published_by'),('retired_at'),('retired_by'),('updated_at'),('updated_by'),('lock_version')) AS c(col)
  CROSS JOIN (VALUES ('assurance_inspection_template_versions'),('assurance_audit_template_versions')) AS t(tbl)
  LEFT JOIN information_schema.columns ic
    ON ic.table_schema = 'public' AND ic.table_name = t.tbl AND ic.column_name = c.col
  WHERE ic.column_name IS NULL;
  IF missing_cols <> 0 THEN
    RAISE EXCEPTION 'A0.1F post-condition failed: % lifecycle columns missing', missing_cols;
  END IF;

  SELECT count(*) INTO trigger_count FROM pg_trigger
  WHERE NOT tgisinternal AND tgname IN (
    'trg_assurance_inspection_template_versions_lifecycle',
    'trg_assurance_audit_template_versions_lifecycle',
    'trg_assurance_inspections_published_template',
    'trg_assurance_audits_published_template');
  IF trigger_count <> 4 THEN
    RAISE EXCEPTION 'A0.1F post-condition failed: expected 4 lifecycle/binding triggers, found %', trigger_count;
  END IF;

  SELECT count(*) INTO legacy_trigger_count FROM pg_trigger
  WHERE NOT tgisinternal AND tgname IN (
    'trg_assurance_inspection_template_versions_immutable',
    'trg_assurance_audit_template_versions_immutable');
  IF legacy_trigger_count <> 0 THEN
    RAISE EXCEPTION 'A0.1F post-condition failed: % always-immutable triggers remain', legacy_trigger_count;
  END IF;

  SELECT count(*) INTO index_count FROM pg_indexes
  WHERE schemaname = 'public' AND indexname IN (
    'uq_assurance_inspection_template_versions_one_draft',
    'uq_assurance_inspection_template_versions_one_published',
    'uq_assurance_audit_template_versions_one_draft',
    'uq_assurance_audit_template_versions_one_published');
  IF index_count <> 4 THEN
    RAISE EXCEPTION 'A0.1F post-condition failed: expected 4 lifecycle indexes, found %', index_count;
  END IF;

  SELECT count(*) INTO constraint_count FROM pg_constraint
  WHERE conrelid IN ('assurance_inspection_template_versions'::regclass, 'assurance_audit_template_versions'::regclass)
    AND conname ~ '_(published_by_fkey|retired_by_fkey|updated_by_fkey|status_check|lifecycle_state_check|retire_order_check|lock_version_check)$';
  IF constraint_count <> 14 THEN
    RAISE EXCEPTION 'A0.1F post-condition failed: expected 14 lifecycle constraints, found %', constraint_count;
  END IF;
END $$;

SELECT
  (SELECT count(*) FROM assurance_inspection_template_versions WHERE status = 'PUBLISHED') AS inspection_published,
  (SELECT count(*) FROM assurance_inspection_template_versions WHERE status = 'RETIRED')   AS inspection_retired,
  (SELECT count(*) FROM assurance_inspection_template_versions WHERE status = 'DRAFT')     AS inspection_draft,
  (SELECT count(*) FROM assurance_audit_template_versions WHERE status = 'PUBLISHED')      AS audit_published,
  (SELECT count(*) FROM assurance_audit_template_versions WHERE status = 'RETIRED')        AS audit_retired,
  (SELECT count(*) FROM assurance_audit_template_versions WHERE status = 'DRAFT')          AS audit_draft;

COMMIT;
