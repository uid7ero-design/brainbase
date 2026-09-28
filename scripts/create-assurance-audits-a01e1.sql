-- BrainBase Assurance A0.1E-1 - Audit workflow foundation
-- DRAFT ONLY. DO NOT APPLY UNTIL static review + disposable PostgreSQL +
-- isolated Neon behavioral proof + Production preflight have passed.
--
-- Frozen scope: 6 tables
--   assurance_audit_templates
--   assurance_audit_template_versions
--   assurance_audits
--   assurance_audit_responses
--   assurance_audit_findings
--   assurance_evidence_audits
--
-- Boundary:
--   * Audit is a structured review against a standard or requirement.
--   * Supports reusable/versioned templates and controlled ad hoc audits.
--   * Template versions are immutable snapshots.
--   * Findings and Evidence reuse A0.1C shared primitives.
--   * Corrective Actions flow through shared Findings; there is no Audit->Action shortcut.
--   * All FKs use ON DELETE NO ACTION.
--   * No generic entity_type/entity_id relationships.
--   * No automatic closure propagation between Audit, Finding, Action or Case.
--
-- Deferred: project/team/process/policy shared subject entities, Evaluation,
-- Contractor Assurance, Insurance and recurring audit scheduling.

BEGIN;

DO $$
DECLARE actual_def text;
BEGIN
  IF to_regclass('public.organisations') IS NULL THEN
    RAISE EXCEPTION 'A0.1E-1 preflight failed: public.organisations is missing';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'A0.1E-1 preflight failed: public.users is missing';
  END IF;
  IF to_regclass('public.locations') IS NULL
     OR to_regclass('public.assets') IS NULL
     OR to_regclass('public.external_organisations') IS NULL THEN
    RAISE EXCEPTION 'A0.1E-1 preflight failed: A0.1B shared foundations are incomplete';
  END IF;
  IF to_regclass('public.assurance_cases') IS NULL
     OR to_regclass('public.assurance_findings') IS NULL
     OR to_regclass('public.assurance_evidence') IS NULL THEN
    RAISE EXCEPTION 'A0.1E-1 preflight failed: A0.1C Assurance core is incomplete';
  END IF;
  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'A0.1E-1 preflight failed: gen_random_uuid() is unavailable';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid='public.locations'::regclass
    AND conname='locations_organisation_id_id_key' AND contype='u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1E-1 preflight failed: locations tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid='public.assets'::regclass
    AND conname='assets_organisation_id_id_key' AND contype='u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1E-1 preflight failed: assets tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid='public.external_organisations'::regclass
    AND conname='external_organisations_organisation_id_id_key' AND contype='u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1E-1 preflight failed: external_organisations tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid='public.assurance_cases'::regclass
    AND conname='assurance_cases_organisation_id_id_key' AND contype='u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1E-1 preflight failed: assurance_cases tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid='public.assurance_findings'::regclass
    AND conname='assurance_findings_organisation_id_id_key' AND contype='u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1E-1 preflight failed: assurance_findings tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid='public.assurance_evidence'::regclass
    AND conname='assurance_evidence_organisation_id_id_key' AND contype='u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1E-1 preflight failed: assurance_evidence tenant anchor is "%"', actual_def;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS assurance_audit_templates (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     TEXT        NOT NULL,
  template_reference  TEXT        NOT NULL,
  name                TEXT        NOT NULL,
  audit_type          TEXT        NOT NULL,
  description         TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assurance_audit_templates_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audit_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audit_templates_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT assurance_audit_templates_org_reference_key UNIQUE (organisation_id, template_reference),
  CONSTRAINT assurance_audit_templates_reference_not_blank_check CHECK (btrim(template_reference) <> ''),
  CONSTRAINT assurance_audit_templates_name_not_blank_check CHECK (btrim(name) <> ''),
  CONSTRAINT assurance_audit_templates_description_not_blank_check CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT assurance_audit_templates_type_check CHECK (audit_type IN ('INTERNAL','CONTRACTOR','SITE','PROCESS','FACILITY','POLICY','COMPLIANCE','OTHER'))
);

CREATE INDEX IF NOT EXISTS idx_assurance_audit_templates_org_active
  ON assurance_audit_templates (organisation_id, is_active, audit_type);

CREATE TABLE IF NOT EXISTS assurance_audit_template_versions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     TEXT        NOT NULL,
  template_id         UUID        NOT NULL,
  version_number      INTEGER     NOT NULL,
  title               TEXT        NOT NULL,
  standard_reference  TEXT,
  instructions        TEXT,
  criteria            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  effective_from      TIMESTAMPTZ,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assurance_audit_template_versions_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audit_template_versions_template_org_fkey FOREIGN KEY (organisation_id, template_id) REFERENCES assurance_audit_templates (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audit_template_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audit_template_versions_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT assurance_audit_template_versions_template_version_key UNIQUE (organisation_id, template_id, version_number),
  CONSTRAINT assurance_audit_template_versions_number_check CHECK (version_number > 0),
  CONSTRAINT assurance_audit_template_versions_title_not_blank_check CHECK (btrim(title) <> ''),
  CONSTRAINT assurance_audit_template_versions_standard_check CHECK (standard_reference IS NULL OR btrim(standard_reference) <> ''),
  CONSTRAINT assurance_audit_template_versions_instructions_check CHECK (instructions IS NULL OR btrim(instructions) <> ''),
  CONSTRAINT assurance_audit_template_versions_criteria_array_check CHECK (jsonb_typeof(criteria) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_assurance_audit_template_versions_org_template
  ON assurance_audit_template_versions (organisation_id, template_id, version_number DESC);

CREATE OR REPLACE FUNCTION assurance_prevent_audit_template_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit template versions are immutable; create a new version instead';
END;
$$;

DROP TRIGGER IF EXISTS trg_assurance_audit_template_versions_immutable ON assurance_audit_template_versions;
CREATE TRIGGER trg_assurance_audit_template_versions_immutable
BEFORE UPDATE OR DELETE ON assurance_audit_template_versions
FOR EACH ROW EXECUTE FUNCTION assurance_prevent_audit_template_version_mutation();

CREATE TABLE IF NOT EXISTS assurance_audits (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           TEXT        NOT NULL,
  audit_reference           TEXT        NOT NULL,
  case_id                   UUID,
  template_version_id       UUID,
  audit_type                TEXT        NOT NULL,
  title                     TEXT        NOT NULL,
  scope                     TEXT        NOT NULL,
  standard_reference        TEXT,
  status                    TEXT        NOT NULL DEFAULT 'PLANNED',
  auditor_user_id           TEXT,
  scheduled_at              TIMESTAMPTZ,
  started_at                TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  location_id               UUID,
  asset_id                  UUID,
  external_organisation_id  UUID,
  summary                   TEXT,
  recommendations           TEXT,
  created_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assurance_audits_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audits_case_org_fkey FOREIGN KEY (organisation_id, case_id) REFERENCES assurance_cases (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audits_template_version_org_fkey FOREIGN KEY (organisation_id, template_version_id) REFERENCES assurance_audit_template_versions (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audits_location_org_fkey FOREIGN KEY (organisation_id, location_id) REFERENCES locations (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audits_asset_org_fkey FOREIGN KEY (organisation_id, asset_id) REFERENCES assets (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audits_external_org_org_fkey FOREIGN KEY (organisation_id, external_organisation_id) REFERENCES external_organisations (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audits_auditor_user_id_fkey FOREIGN KEY (auditor_user_id) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audits_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audits_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT assurance_audits_org_reference_key UNIQUE (organisation_id, audit_reference),
  CONSTRAINT assurance_audits_reference_not_blank_check CHECK (btrim(audit_reference) <> ''),
  CONSTRAINT assurance_audits_title_not_blank_check CHECK (btrim(title) <> ''),
  CONSTRAINT assurance_audits_scope_not_blank_check CHECK (btrim(scope) <> ''),
  CONSTRAINT assurance_audits_standard_not_blank_check CHECK (standard_reference IS NULL OR btrim(standard_reference) <> ''),
  CONSTRAINT assurance_audits_summary_not_blank_check CHECK (summary IS NULL OR btrim(summary) <> ''),
  CONSTRAINT assurance_audits_recommendations_not_blank_check CHECK (recommendations IS NULL OR btrim(recommendations) <> ''),
  CONSTRAINT assurance_audits_type_check CHECK (audit_type IN ('INTERNAL','CONTRACTOR','SITE','PROCESS','FACILITY','POLICY','COMPLIANCE','OTHER')),
  CONSTRAINT assurance_audits_status_check CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  CONSTRAINT assurance_audits_basis_check CHECK (template_version_id IS NOT NULL OR (standard_reference IS NOT NULL AND btrim(standard_reference) <> '')),
  CONSTRAINT assurance_audits_started_state_check CHECK (
    (status='PLANNED' AND started_at IS NULL AND completed_at IS NULL)
    OR (status='IN_PROGRESS' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (status='COMPLETED' AND started_at IS NOT NULL AND completed_at IS NOT NULL)
    OR (status='CANCELLED' AND completed_at IS NULL)
  ),
  CONSTRAINT assurance_audits_completion_order_check CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_assurance_audits_org_status ON assurance_audits (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_assurance_audits_org_scheduled ON assurance_audits (organisation_id, scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assurance_audits_org_location ON assurance_audits (organisation_id, location_id) WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assurance_audits_org_asset ON assurance_audits (organisation_id, asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assurance_audits_org_external ON assurance_audits (organisation_id, external_organisation_id) WHERE external_organisation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assurance_audits_org_template ON assurance_audits (organisation_id, template_version_id) WHERE template_version_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS assurance_audit_responses (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   TEXT        NOT NULL,
  audit_id          UUID        NOT NULL,
  criterion_key     TEXT        NOT NULL,
  criterion_label   TEXT        NOT NULL,
  response_type     TEXT        NOT NULL,
  response_value    JSONB,
  outcome           TEXT,
  notes             TEXT,
  responded_by      TEXT,
  responded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assurance_audit_responses_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audit_responses_audit_org_fkey FOREIGN KEY (organisation_id, audit_id) REFERENCES assurance_audits (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audit_responses_responded_by_fkey FOREIGN KEY (responded_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audit_responses_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT assurance_audit_responses_criterion_key_key UNIQUE (organisation_id, audit_id, criterion_key),
  CONSTRAINT assurance_audit_responses_key_not_blank_check CHECK (btrim(criterion_key) <> ''),
  CONSTRAINT assurance_audit_responses_label_not_blank_check CHECK (btrim(criterion_label) <> ''),
  CONSTRAINT assurance_audit_responses_notes_not_blank_check CHECK (notes IS NULL OR btrim(notes) <> ''),
  CONSTRAINT assurance_audit_responses_type_check CHECK (response_type IN ('COMPLIANCE_RATING','BOOLEAN','TEXT','NUMBER','CHOICE','OTHER')),
  CONSTRAINT assurance_audit_responses_outcome_check CHECK (outcome IS NULL OR outcome IN ('COMPLIANT','PARTIAL','NON_COMPLIANT','NOT_APPLICABLE','OBSERVATION'))
);

CREATE INDEX IF NOT EXISTS idx_assurance_audit_responses_org_audit ON assurance_audit_responses (organisation_id, audit_id);

CREATE TABLE IF NOT EXISTS assurance_audit_findings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   TEXT        NOT NULL,
  audit_id          UUID        NOT NULL,
  finding_id        UUID        NOT NULL,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assurance_audit_findings_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audit_findings_audit_org_fkey FOREIGN KEY (organisation_id, audit_id) REFERENCES assurance_audits (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audit_findings_finding_org_fkey FOREIGN KEY (organisation_id, finding_id) REFERENCES assurance_findings (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audit_findings_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_audit_findings_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT assurance_audit_findings_pair_key UNIQUE (organisation_id, audit_id, finding_id)
);

CREATE INDEX IF NOT EXISTS idx_assurance_audit_findings_org_audit ON assurance_audit_findings (organisation_id, audit_id);
CREATE INDEX IF NOT EXISTS idx_assurance_audit_findings_org_finding ON assurance_audit_findings (organisation_id, finding_id);

CREATE TABLE IF NOT EXISTS assurance_evidence_audits (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   TEXT        NOT NULL,
  evidence_id       UUID        NOT NULL,
  audit_id          UUID        NOT NULL,
  purpose           TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at        TIMESTAMPTZ,
  removed_by        TEXT,
  removal_reason    TEXT,
  CONSTRAINT assurance_evidence_audits_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_evidence_audits_evidence_org_fkey FOREIGN KEY (organisation_id, evidence_id) REFERENCES assurance_evidence (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_evidence_audits_audit_org_fkey FOREIGN KEY (organisation_id, audit_id) REFERENCES assurance_audits (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_evidence_audits_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_evidence_audits_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_evidence_audits_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT assurance_evidence_audits_purpose_not_blank_check CHECK (purpose IS NULL OR btrim(purpose) <> ''),
  CONSTRAINT assurance_evidence_audits_removal_state_check CHECK (
    (removed_at IS NULL AND removed_by IS NULL AND removal_reason IS NULL)
    OR (removed_at IS NOT NULL AND removal_reason IS NOT NULL AND btrim(removal_reason) <> '')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_evidence_audits_active_link
  ON assurance_evidence_audits (organisation_id, evidence_id, audit_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assurance_evidence_audits_org_audit
  ON assurance_evidence_audits (organisation_id, audit_id, removed_at);
CREATE INDEX IF NOT EXISTS idx_assurance_evidence_audits_org_evidence
  ON assurance_evidence_audits (organisation_id, evidence_id, removed_at);

DO $$
DECLARE missing_tables text; wrong_delete_count integer; immutable_trigger_count integer;
BEGIN
  SELECT string_agg(expected.table_name, ', ' ORDER BY expected.table_name) INTO missing_tables
  FROM (VALUES
    ('assurance_audit_templates'),
    ('assurance_audit_template_versions'),
    ('assurance_audits'),
    ('assurance_audit_responses'),
    ('assurance_audit_findings'),
    ('assurance_evidence_audits')
  ) AS expected(table_name)
  LEFT JOIN information_schema.tables t ON t.table_schema='public' AND t.table_name=expected.table_name
  WHERE t.table_name IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'A0.1E-1 post-condition failed: missing tables: %', missing_tables;
  END IF;

  SELECT count(*) INTO wrong_delete_count
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=cl.relnamespace
  WHERE n.nspname='public'
    AND cl.relname IN ('assurance_audit_templates','assurance_audit_template_versions','assurance_audits','assurance_audit_responses','assurance_audit_findings','assurance_evidence_audits')
    AND c.contype='f' AND c.confdeltype <> 'a';

  IF wrong_delete_count <> 0 THEN
    RAISE EXCEPTION 'A0.1E-1 post-condition failed: % foreign keys do not use ON DELETE NO ACTION', wrong_delete_count;
  END IF;

  SELECT count(*) INTO immutable_trigger_count
  FROM pg_trigger
  WHERE tgrelid='public.assurance_audit_template_versions'::regclass
    AND tgname='trg_assurance_audit_template_versions_immutable'
    AND NOT tgisinternal;

  IF immutable_trigger_count <> 1 THEN
    RAISE EXCEPTION 'A0.1E-1 post-condition failed: immutable audit template trigger count is %', immutable_trigger_count;
  END IF;
END $$;

SELECT
  (SELECT count(*) FROM information_schema.tables
   WHERE table_schema='public'
     AND table_name IN ('assurance_audit_templates','assurance_audit_template_versions','assurance_audits','assurance_audit_responses','assurance_audit_findings','assurance_evidence_audits')) AS a01e1_table_count,
  (SELECT count(*) FROM pg_constraint c
   WHERE c.contype='f'
     AND c.conrelid::regclass::text IN ('assurance_audit_templates','assurance_audit_template_versions','assurance_audits','assurance_audit_responses','assurance_audit_findings','assurance_evidence_audits')) AS a01e1_fk_count;

COMMIT;
