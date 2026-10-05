-- BrainBase Assurance A0.1D-2 — Investigation workflow foundation
-- DRAFT ONLY. DO NOT APPLY UNTIL static review + disposable PostgreSQL +
-- isolated Neon behavioral proof + Production preflight have passed.
--
-- Frozen scope: 5 tables
--   assurance_investigations
--   assurance_investigation_incidents
--   assurance_investigation_people
--   assurance_investigation_findings
--   assurance_evidence_investigations
--
-- Boundary:
--   * Investigation records the formal process used to understand an event or issue.
--   * Incident remains the record of what happened.
--   * Investigation↔Incident is explicit M:N; neither side owns the other.
--   * Findings and Evidence reuse A0.1C shared primitives.
--   * Restricted is a data marker only; server permissions remain mandatory.
--   * No automatic closure propagation between Investigation, Incident, Finding, Action or Case.
--   * All FKs use ON DELETE NO ACTION.
--   * No generic entity_type/entity_id relationships.
--
-- Explicitly deferred:
--   * structured causal taxonomies / root-cause trees
--   * medical, treatment, workers compensation and return-to-work data
--   * disciplinary outcomes, regulator notifications and legal-privilege workflow
--   * investigation templates and interview-specific tables
--   * Inspection/Audit/Contractor/Insurance workflow tables

BEGIN;

-- ============================================================================
-- PRE-FLIGHT
-- ============================================================================

DO $$
DECLARE
  actual_def text;
BEGIN
  IF to_regclass('public.organisations') IS NULL THEN
    RAISE EXCEPTION 'A0.1D-2 preflight failed: public.organisations is missing';
  END IF;

  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'A0.1D-2 preflight failed: public.users is missing';
  END IF;

  IF to_regclass('public.hr_people') IS NULL THEN
    RAISE EXCEPTION 'A0.1D-2 preflight failed: public.hr_people is missing';
  END IF;

  IF to_regclass('public.assurance_cases') IS NULL
     OR to_regclass('public.assurance_risk_levels') IS NULL
     OR to_regclass('public.assurance_findings') IS NULL
     OR to_regclass('public.assurance_evidence') IS NULL
  THEN
    RAISE EXCEPTION 'A0.1D-2 preflight failed: A0.1C Assurance core is incomplete';
  END IF;

  IF to_regclass('public.assurance_incidents') IS NULL THEN
    RAISE EXCEPTION 'A0.1D-2 preflight failed: A0.1D-1 Incident foundation is missing';
  END IF;
  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'A0.1D-2 preflight failed: gen_random_uuid() is unavailable';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.hr_people'::regclass
    AND conname = 'hr_people_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-2 preflight failed: hr_people tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_cases'::regclass
    AND conname = 'assurance_cases_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-2 preflight failed: assurance_cases tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_risk_levels'::regclass
    AND conname = 'assurance_risk_levels_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-2 preflight failed: assurance_risk_levels tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_findings'::regclass
    AND conname = 'assurance_findings_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-2 preflight failed: assurance_findings tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_evidence'::regclass
    AND conname = 'assurance_evidence_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-2 preflight failed: assurance_evidence tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_incidents'::regclass
    AND conname = 'assurance_incidents_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-2 preflight failed: assurance_incidents tenant anchor is "%"', actual_def;
  END IF;
END $$;
-- ============================================================================
-- INVESTIGATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_investigations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       TEXT        NOT NULL,
  investigation_reference TEXT      NOT NULL,
  case_id               UUID,
  title                 TEXT        NOT NULL,
  scope                 TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'OPEN',
  risk_level_id         UUID,
  lead_user_id          TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  target_completion_at  TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  completed_by          TEXT,
  conclusion            TEXT,
  restricted            BOOLEAN     NOT NULL DEFAULT false,
  created_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_investigations_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,
  CONSTRAINT assurance_investigations_case_org_fkey
    FOREIGN KEY (organisation_id, case_id)
    REFERENCES assurance_cases (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigations_risk_level_org_fkey
    FOREIGN KEY (organisation_id, risk_level_id)
    REFERENCES assurance_risk_levels (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigations_lead_user_id_fkey
    FOREIGN KEY (lead_user_id)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigations_completed_by_fkey
    FOREIGN KEY (completed_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigations_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigations_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_investigations_org_reference_key
    UNIQUE (organisation_id, investigation_reference),
  CONSTRAINT assurance_investigations_reference_not_blank_check
    CHECK (btrim(investigation_reference) <> ''),

  CONSTRAINT assurance_investigations_title_not_blank_check
    CHECK (btrim(title) <> ''),

  CONSTRAINT assurance_investigations_scope_not_blank_check
    CHECK (btrim(scope) <> ''),

  CONSTRAINT assurance_investigations_conclusion_not_blank_check
    CHECK (conclusion IS NULL OR btrim(conclusion) <> ''),

  CONSTRAINT assurance_investigations_status_check
    CHECK (status IN (
      'OPEN',
      'PLANNING',
      'IN_PROGRESS',
      'AWAITING_INFORMATION',
      'AWAITING_REVIEW',
      'COMPLETED',
      'CANCELLED'
    )),

  CONSTRAINT assurance_investigations_completed_state_check
    CHECK (
      (status = 'COMPLETED' AND completed_at IS NOT NULL AND conclusion IS NOT NULL)
      OR
      (status <> 'COMPLETED' AND completed_at IS NULL)
    ),
  CONSTRAINT assurance_investigations_completed_by_state_check
    CHECK (completed_at IS NOT NULL OR completed_by IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_assurance_investigations_org_status
  ON assurance_investigations (organisation_id, status);

CREATE INDEX IF NOT EXISTS idx_assurance_investigations_org_started_at
  ON assurance_investigations (organisation_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_assurance_investigations_org_target_completion
  ON assurance_investigations (organisation_id, target_completion_at)
  WHERE target_completion_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_investigations_org_case
  ON assurance_investigations (organisation_id, case_id)
  WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_investigations_org_risk
  ON assurance_investigations (organisation_id, risk_level_id)
  WHERE risk_level_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_investigations_org_lead_status
  ON assurance_investigations (organisation_id, lead_user_id, status)
  WHERE lead_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_investigations_org_restricted_status
  ON assurance_investigations (organisation_id, restricted, status);
-- ============================================================================
-- INVESTIGATION ↔ INCIDENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_investigation_incidents (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   TEXT        NOT NULL,
  investigation_id  UUID        NOT NULL,
  incident_id       UUID        NOT NULL,
  relationship      TEXT        NOT NULL DEFAULT 'RELATED',
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_investigation_incidents_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigation_incidents_investigation_org_fkey
    FOREIGN KEY (organisation_id, investigation_id)
    REFERENCES assurance_investigations (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigation_incidents_incident_org_fkey
    FOREIGN KEY (organisation_id, incident_id)
    REFERENCES assurance_incidents (organisation_id, id)
    ON DELETE NO ACTION,
  CONSTRAINT assurance_investigation_incidents_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigation_incidents_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_investigation_incidents_pair_key
    UNIQUE (organisation_id, investigation_id, incident_id),

  CONSTRAINT assurance_investigation_incidents_relationship_check
    CHECK (relationship IN ('PRIMARY','RELATED','TRIGGERING','CONTEXT'))
);

CREATE INDEX IF NOT EXISTS idx_assurance_investigation_incidents_org_investigation
  ON assurance_investigation_incidents (organisation_id, investigation_id);

CREATE INDEX IF NOT EXISTS idx_assurance_investigation_incidents_org_incident
  ON assurance_investigation_incidents (organisation_id, incident_id);

-- ============================================================================
-- INVESTIGATION PEOPLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_investigation_people (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   TEXT        NOT NULL,
  investigation_id  UUID        NOT NULL,
  person_id         UUID        NOT NULL,
  role              TEXT        NOT NULL,
  notes             TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_investigation_people_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigation_people_investigation_org_fkey
    FOREIGN KEY (organisation_id, investigation_id)
    REFERENCES assurance_investigations (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigation_people_person_org_fkey
    FOREIGN KEY (organisation_id, person_id)
    REFERENCES hr_people (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigation_people_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigation_people_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_investigation_people_investigation_person_role_key
    UNIQUE (organisation_id, investigation_id, person_id, role),
  CONSTRAINT assurance_investigation_people_role_check
    CHECK (role IN (
      'INVESTIGATOR',
      'LEAD_INVESTIGATOR',
      'WITNESS',
      'SUBJECT',
      'TECHNICAL_ADVISER',
      'REVIEWER',
      'CONTACT',
      'OTHER'
    )),

  CONSTRAINT assurance_investigation_people_notes_not_blank_check
    CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE INDEX IF NOT EXISTS idx_assurance_investigation_people_org_investigation
  ON assurance_investigation_people (organisation_id, investigation_id);

CREATE INDEX IF NOT EXISTS idx_assurance_investigation_people_org_person
  ON assurance_investigation_people (organisation_id, person_id);

-- ============================================================================
-- INVESTIGATION ↔ FINDING
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_investigation_findings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   TEXT        NOT NULL,
  investigation_id  UUID        NOT NULL,
  finding_id        UUID        NOT NULL,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_investigation_findings_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigation_findings_investigation_org_fkey
    FOREIGN KEY (organisation_id, investigation_id)
    REFERENCES assurance_investigations (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigation_findings_finding_org_fkey
    FOREIGN KEY (organisation_id, finding_id)
    REFERENCES assurance_findings (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigation_findings_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_investigation_findings_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_investigation_findings_pair_key
    UNIQUE (organisation_id, investigation_id, finding_id)
);
CREATE INDEX IF NOT EXISTS idx_assurance_investigation_findings_org_investigation
  ON assurance_investigation_findings (organisation_id, investigation_id);

CREATE INDEX IF NOT EXISTS idx_assurance_investigation_findings_org_finding
  ON assurance_investigation_findings (organisation_id, finding_id);

-- ============================================================================
-- EVIDENCE ↔ INVESTIGATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_evidence_investigations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   TEXT        NOT NULL,
  evidence_id       UUID        NOT NULL,
  investigation_id  UUID        NOT NULL,
  purpose           TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at        TIMESTAMPTZ,
  removed_by        TEXT,
  removal_reason    TEXT,

  CONSTRAINT assurance_evidence_investigations_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_investigations_evidence_org_fkey
    FOREIGN KEY (organisation_id, evidence_id)
    REFERENCES assurance_evidence (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_investigations_investigation_org_fkey
    FOREIGN KEY (organisation_id, investigation_id)
    REFERENCES assurance_investigations (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_investigations_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_investigations_removed_by_fkey
    FOREIGN KEY (removed_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_investigations_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_evidence_investigations_purpose_not_blank_check
    CHECK (purpose IS NULL OR btrim(purpose) <> ''),

  CONSTRAINT assurance_evidence_investigations_removal_state_check
    CHECK (
      (removed_at IS NULL AND removed_by IS NULL AND removal_reason IS NULL)
      OR
      (removed_at IS NOT NULL AND removal_reason IS NOT NULL AND btrim(removal_reason) <> '')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_evidence_investigations_active_link
  ON assurance_evidence_investigations
    (organisation_id, evidence_id, investigation_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_evidence_investigations_org_investigation
  ON assurance_evidence_investigations
    (organisation_id, investigation_id, removed_at);

CREATE INDEX IF NOT EXISTS idx_assurance_evidence_investigations_org_evidence
  ON assurance_evidence_investigations
    (organisation_id, evidence_id, removed_at);

-- ============================================================================
-- FAIL-LOUD POST-CONDITIONS
-- ============================================================================

DO $$
DECLARE
  missing_tables text;
  wrong_delete_count integer;
  actual_def text;
BEGIN
  SELECT string_agg(expected.table_name, ', ' ORDER BY expected.table_name)
    INTO missing_tables
  FROM (
    VALUES
      ('assurance_investigations'),
      ('assurance_investigation_incidents'),
      ('assurance_investigation_people'),
      ('assurance_investigation_findings'),
      ('assurance_evidence_investigations')
  ) AS expected(table_name)
  LEFT JOIN information_schema.tables t
    ON t.table_schema = 'public'
   AND t.table_name = expected.table_name
  WHERE t.table_name IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'A0.1D-2 post-condition failed: missing tables: %', missing_tables;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_investigations'::regclass
    AND conname = 'assurance_investigations_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-2 schema drift: assurance_investigations tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_investigation_incidents'::regclass
    AND conname = 'assurance_investigation_incidents_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-2 schema drift: assurance_investigation_incidents tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_investigation_people'::regclass
    AND conname = 'assurance_investigation_people_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-2 schema drift: assurance_investigation_people tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_investigation_findings'::regclass
    AND conname = 'assurance_investigation_findings_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-2 schema drift: assurance_investigation_findings tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_evidence_investigations'::regclass
    AND conname = 'assurance_evidence_investigations_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-2 schema drift: assurance_evidence_investigations tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_investigation_incidents'::regclass
    AND conname = 'assurance_investigation_incidents_incident_org_fkey';
  IF actual_def IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, incident_id) REFERENCES assurance_incidents(organisation_id, id)'
  THEN
    RAISE EXCEPTION 'A0.1D-2 schema drift: investigation incident tenant FK is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_investigation_people'::regclass
    AND conname = 'assurance_investigation_people_person_org_fkey';
  IF actual_def IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, person_id) REFERENCES hr_people(organisation_id, id)'
  THEN
    RAISE EXCEPTION 'A0.1D-2 schema drift: investigation people tenant FK is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_investigation_findings'::regclass
    AND conname = 'assurance_investigation_findings_finding_org_fkey';
  IF actual_def IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, finding_id) REFERENCES assurance_findings(organisation_id, id)'
  THEN
    RAISE EXCEPTION 'A0.1D-2 schema drift: investigation finding tenant FK is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_evidence_investigations'::regclass
    AND conname = 'assurance_evidence_investigations_evidence_org_fkey';
  IF actual_def IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, evidence_id) REFERENCES assurance_evidence(organisation_id, id)'
  THEN
    RAISE EXCEPTION 'A0.1D-2 schema drift: investigation evidence tenant FK is "%"', actual_def;
  END IF;

  SELECT count(*) INTO wrong_delete_count
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE n.nspname = 'public'
    AND cl.relname IN (
      'assurance_investigations',
      'assurance_investigation_incidents',
      'assurance_investigation_people',
      'assurance_investigation_findings',
      'assurance_evidence_investigations'
    )
    AND c.contype = 'f'
    AND c.confdeltype <> 'a';

  IF wrong_delete_count <> 0 THEN
    RAISE EXCEPTION
      'A0.1D-2 post-condition failed: % foreign keys do not use ON DELETE NO ACTION',
      wrong_delete_count;
  END IF;
END $$;

-- Read-only summary emitted after successful application.
SELECT
  (SELECT count(*)
   FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN (
       'assurance_investigations',
       'assurance_investigation_incidents',
       'assurance_investigation_people',
       'assurance_investigation_findings',
       'assurance_evidence_investigations'
     )) AS a01d2_table_count,
  (SELECT count(*)
   FROM pg_constraint c
   JOIN pg_class cl ON cl.oid = c.conrelid
   JOIN pg_namespace n ON n.oid = cl.relnamespace
   WHERE n.nspname = 'public'
     AND cl.relname IN (
       'assurance_investigations',
       'assurance_investigation_incidents',
       'assurance_investigation_people',
       'assurance_investigation_findings',
       'assurance_evidence_investigations'
     )
     AND c.contype = 'f') AS a01d2_fk_count;

COMMIT;
