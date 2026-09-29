-- BrainBase Assurance A0.1D-1 — Incident workflow foundation
-- DRAFT ONLY. DO NOT APPLY UNTIL static review + disposable PostgreSQL +
-- isolated Neon behavioral proof + Production preflight have passed.
--
-- Frozen scope: 4 tables
--   assurance_incidents
--   assurance_incident_people
--   assurance_incident_findings
--   assurance_evidence_incidents
--
-- Boundary:
--   * Incident records what happened.
--   * Investigation is a separate A0.1D-2 workflow and is NOT created here.
--   * Findings and Evidence reuse A0.1C shared primitives.
--   * Formal follow-up Actions flow through shared Findings/Case context.
--   * Sensitive/restricted is a data marker only; server permissions remain mandatory.
--   * No automatic status/closure propagation between Incident, Finding, Action or Case.
--   * All FKs use ON DELETE NO ACTION.
--   * No generic entity_type/entity_id relationships.

BEGIN;

-- ============================================================================
-- PRE-FLIGHT
-- ============================================================================

DO $$
DECLARE
  actual_def text;
BEGIN
  IF to_regclass('public.organisations') IS NULL THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: public.organisations is missing';
  END IF;

  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: public.users is missing';
  END IF;

  IF to_regclass('public.hr_people') IS NULL THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: public.hr_people is missing';
  END IF;

  IF to_regclass('public.external_organisations') IS NULL THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: public.external_organisations is missing';
  END IF;

  IF to_regclass('public.assets') IS NULL THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: public.assets is missing';
  END IF;

  IF to_regclass('public.locations') IS NULL THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: public.locations is missing';
  END IF;

  IF to_regclass('public.assurance_cases') IS NULL
     OR to_regclass('public.assurance_risk_levels') IS NULL
     OR to_regclass('public.assurance_findings') IS NULL
     OR to_regclass('public.assurance_evidence') IS NULL
  THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: A0.1C Assurance core is incomplete';
  END IF;

  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: gen_random_uuid() is unavailable';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.hr_people'::regclass
    AND conname = 'hr_people_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: hr_people tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.external_organisations'::regclass
    AND conname = 'external_organisations_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: external_organisations tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assets'::regclass
    AND conname = 'assets_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: assets tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.locations'::regclass
    AND conname = 'locations_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: locations tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_cases'::regclass
    AND conname = 'assurance_cases_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: assurance_cases tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_risk_levels'::regclass
    AND conname = 'assurance_risk_levels_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: assurance_risk_levels tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_findings'::regclass
    AND conname = 'assurance_findings_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: assurance_findings tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_evidence'::regclass
    AND conname = 'assurance_evidence_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-1 preflight failed: assurance_evidence tenant anchor is "%"', actual_def;
  END IF;
END $$;

-- ============================================================================
-- INCIDENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_incidents (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           TEXT        NOT NULL,
  incident_reference        TEXT        NOT NULL,
  case_id                   UUID,
  category                  TEXT        NOT NULL,
  title                     TEXT        NOT NULL,
  description               TEXT        NOT NULL,
  status                    TEXT        NOT NULL DEFAULT 'REPORTED',
  risk_level_id             UUID,
  occurred_at               TIMESTAMPTZ NOT NULL,
  reported_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_by_user_id       TEXT,
  owner_user_id             TEXT,
  location_id               UUID,
  asset_id                  UUID,
  external_organisation_id  UUID,
  immediate_response        TEXT,
  restricted                BOOLEAN     NOT NULL DEFAULT false,
  closed_at                 TIMESTAMPTZ,
  closed_by                 TEXT,
  closure_summary           TEXT,
  created_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_incidents_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incidents_case_org_fkey
    FOREIGN KEY (organisation_id, case_id)
    REFERENCES assurance_cases (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incidents_risk_level_org_fkey
    FOREIGN KEY (organisation_id, risk_level_id)
    REFERENCES assurance_risk_levels (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incidents_location_org_fkey
    FOREIGN KEY (organisation_id, location_id)
    REFERENCES locations (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incidents_asset_org_fkey
    FOREIGN KEY (organisation_id, asset_id)
    REFERENCES assets (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incidents_external_org_org_fkey
    FOREIGN KEY (organisation_id, external_organisation_id)
    REFERENCES external_organisations (organisation_id, id)
    ON DELETE NO ACTION,

  -- users(id) remains the known tenant-containment exception because users
  -- does not expose UNIQUE (organisation_id, id). Service-layer same-org
  -- validation is mandatory for every user reference below.
  CONSTRAINT assurance_incidents_reported_by_user_id_fkey
    FOREIGN KEY (reported_by_user_id)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incidents_owner_user_id_fkey
    FOREIGN KEY (owner_user_id)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incidents_closed_by_fkey
    FOREIGN KEY (closed_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incidents_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incidents_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_incidents_org_reference_key
    UNIQUE (organisation_id, incident_reference),

  CONSTRAINT assurance_incidents_reference_not_blank_check
    CHECK (btrim(incident_reference) <> ''),

  CONSTRAINT assurance_incidents_title_not_blank_check
    CHECK (btrim(title) <> ''),

  CONSTRAINT assurance_incidents_description_not_blank_check
    CHECK (btrim(description) <> ''),

  CONSTRAINT assurance_incidents_immediate_response_not_blank_check
    CHECK (immediate_response IS NULL OR btrim(immediate_response) <> ''),

  CONSTRAINT assurance_incidents_closure_summary_not_blank_check
    CHECK (closure_summary IS NULL OR btrim(closure_summary) <> ''),

  CONSTRAINT assurance_incidents_category_check
    CHECK (category IN (
      'INJURY_SAFETY',
      'ENVIRONMENTAL',
      'PROPERTY_EQUIPMENT',
      'OPERATIONAL_SERVICE',
      'SECURITY',
      'NEAR_MISS',
      'OTHER'
    )),

  CONSTRAINT assurance_incidents_status_check
    CHECK (status IN (
      'REPORTED',
      'UNDER_REVIEW',
      'INVESTIGATION_REQUIRED',
      'UNDER_INVESTIGATION',
      'ACTION_REQUIRED',
      'AWAITING_VERIFICATION',
      'CLOSED',
      'CANCELLED'
    )),

  CONSTRAINT assurance_incidents_closed_state_check
    CHECK (
      (status = 'CLOSED' AND closed_at IS NOT NULL)
      OR
      (status <> 'CLOSED' AND closed_at IS NULL)
    ),

  CONSTRAINT assurance_incidents_closed_by_state_check
    CHECK (closed_at IS NOT NULL OR closed_by IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_assurance_incidents_org_status
  ON assurance_incidents (organisation_id, status);

CREATE INDEX IF NOT EXISTS idx_assurance_incidents_org_category_status
  ON assurance_incidents (organisation_id, category, status);

CREATE INDEX IF NOT EXISTS idx_assurance_incidents_org_occurred_at
  ON assurance_incidents (organisation_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_assurance_incidents_org_case
  ON assurance_incidents (organisation_id, case_id)
  WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_incidents_org_risk
  ON assurance_incidents (organisation_id, risk_level_id)
  WHERE risk_level_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_incidents_org_location
  ON assurance_incidents (organisation_id, location_id)
  WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_incidents_org_asset
  ON assurance_incidents (organisation_id, asset_id)
  WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_incidents_org_external_org
  ON assurance_incidents (organisation_id, external_organisation_id)
  WHERE external_organisation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_incidents_org_restricted_status
  ON assurance_incidents (organisation_id, restricted, status);

-- ============================================================================
-- INCIDENT PEOPLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_incident_people (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  incident_id       UUID        NOT NULL,
  person_id         UUID        NOT NULL,
  role              TEXT        NOT NULL,
  notes             TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_incident_people_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incident_people_incident_org_fkey
    FOREIGN KEY (organisation_id, incident_id)
    REFERENCES assurance_incidents (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incident_people_person_org_fkey
    FOREIGN KEY (organisation_id, person_id)
    REFERENCES hr_people (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incident_people_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incident_people_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_incident_people_incident_person_role_key
    UNIQUE (organisation_id, incident_id, person_id, role),

  CONSTRAINT assurance_incident_people_role_check
    CHECK (role IN (
      'AFFECTED_PERSON',
      'INJURED_PERSON',
      'INVOLVED_PERSON',
      'WITNESS',
      'REPORTER',
      'RESPONDER',
      'SUPERVISOR',
      'CONTACT',
      'OTHER'
    )),

  CONSTRAINT assurance_incident_people_notes_not_blank_check
    CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE INDEX IF NOT EXISTS idx_assurance_incident_people_org_incident
  ON assurance_incident_people (organisation_id, incident_id);

CREATE INDEX IF NOT EXISTS idx_assurance_incident_people_org_person
  ON assurance_incident_people (organisation_id, person_id);

-- ============================================================================
-- INCIDENT FINDINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_incident_findings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  incident_id       UUID        NOT NULL,
  finding_id        UUID        NOT NULL,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_incident_findings_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incident_findings_incident_org_fkey
    FOREIGN KEY (organisation_id, incident_id)
    REFERENCES assurance_incidents (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incident_findings_finding_org_fkey
    FOREIGN KEY (organisation_id, finding_id)
    REFERENCES assurance_findings (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incident_findings_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_incident_findings_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_incident_findings_pair_key
    UNIQUE (organisation_id, incident_id, finding_id)
);

CREATE INDEX IF NOT EXISTS idx_assurance_incident_findings_org_incident
  ON assurance_incident_findings (organisation_id, incident_id);

CREATE INDEX IF NOT EXISTS idx_assurance_incident_findings_org_finding
  ON assurance_incident_findings (organisation_id, finding_id);

-- ============================================================================
-- INCIDENT EVIDENCE
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_evidence_incidents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  evidence_id       UUID        NOT NULL,
  incident_id       UUID        NOT NULL,
  purpose           TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at        TIMESTAMPTZ,
  removed_by        TEXT,
  removal_reason    TEXT,

  CONSTRAINT assurance_evidence_incidents_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_incidents_evidence_org_fkey
    FOREIGN KEY (organisation_id, evidence_id)
    REFERENCES assurance_evidence (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_incidents_incident_org_fkey
    FOREIGN KEY (organisation_id, incident_id)
    REFERENCES assurance_incidents (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_incidents_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_incidents_removed_by_fkey
    FOREIGN KEY (removed_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_incidents_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_evidence_incidents_purpose_not_blank_check
    CHECK (purpose IS NULL OR btrim(purpose) <> ''),

  CONSTRAINT assurance_evidence_incidents_removal_state_check
    CHECK (
      (removed_at IS NULL AND removed_by IS NULL AND removal_reason IS NULL)
      OR
      (removed_at IS NOT NULL AND removal_reason IS NOT NULL AND btrim(removal_reason) <> '')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_evidence_incidents_active_link
  ON assurance_evidence_incidents (organisation_id, evidence_id, incident_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_evidence_incidents_org_incident
  ON assurance_evidence_incidents (organisation_id, incident_id, removed_at);

CREATE INDEX IF NOT EXISTS idx_assurance_evidence_incidents_org_evidence
  ON assurance_evidence_incidents (organisation_id, evidence_id, removed_at);

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
      ('assurance_incidents'),
      ('assurance_incident_people'),
      ('assurance_incident_findings'),
      ('assurance_evidence_incidents')
  ) AS expected(table_name)
  LEFT JOIN information_schema.tables t
    ON t.table_schema = 'public'
   AND t.table_name = expected.table_name
  WHERE t.table_name IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'A0.1D-1 post-condition failed: missing tables: %', missing_tables;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_incidents'::regclass
    AND conname = 'assurance_incidents_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-1 schema drift: assurance_incidents tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_incident_people'::regclass
    AND conname = 'assurance_incident_people_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-1 schema drift: assurance_incident_people tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_incident_findings'::regclass
    AND conname = 'assurance_incident_findings_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-1 schema drift: assurance_incident_findings tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_evidence_incidents'::regclass
    AND conname = 'assurance_evidence_incidents_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1D-1 schema drift: assurance_evidence_incidents tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_incidents'::regclass
    AND conname = 'assurance_incidents_case_org_fkey';
  IF actual_def IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, case_id) REFERENCES assurance_cases(organisation_id, id)'
  THEN
    RAISE EXCEPTION 'A0.1D-1 schema drift: incident case tenant FK is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_incident_people'::regclass
    AND conname = 'assurance_incident_people_person_org_fkey';
  IF actual_def IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, person_id) REFERENCES hr_people(organisation_id, id)'
  THEN
    RAISE EXCEPTION 'A0.1D-1 schema drift: incident people tenant FK is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_incident_findings'::regclass
    AND conname = 'assurance_incident_findings_finding_org_fkey';
  IF actual_def IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, finding_id) REFERENCES assurance_findings(organisation_id, id)'
  THEN
    RAISE EXCEPTION 'A0.1D-1 schema drift: incident finding tenant FK is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_evidence_incidents'::regclass
    AND conname = 'assurance_evidence_incidents_evidence_org_fkey';
  IF actual_def IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, evidence_id) REFERENCES assurance_evidence(organisation_id, id)'
  THEN
    RAISE EXCEPTION 'A0.1D-1 schema drift: incident evidence tenant FK is "%"', actual_def;
  END IF;

  SELECT count(*) INTO wrong_delete_count
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE n.nspname = 'public'
    AND cl.relname IN (
      'assurance_incidents',
      'assurance_incident_people',
      'assurance_incident_findings',
      'assurance_evidence_incidents'
    )
    AND c.contype = 'f'
    AND c.confdeltype <> 'a';

  IF wrong_delete_count <> 0 THEN
    RAISE EXCEPTION
      'A0.1D-1 post-condition failed: % foreign keys do not use ON DELETE NO ACTION',
      wrong_delete_count;
  END IF;
END $$;

-- Read-only summary emitted after successful application.
SELECT
  (SELECT count(*)
   FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN (
       'assurance_incidents',
       'assurance_incident_people',
       'assurance_incident_findings',
       'assurance_evidence_incidents'
     )) AS a01d1_table_count,
  (SELECT count(*)
   FROM pg_constraint c
   JOIN pg_class cl ON cl.oid = c.conrelid
   JOIN pg_namespace n ON n.oid = cl.relnamespace
   WHERE n.nspname = 'public'
     AND cl.relname IN (
       'assurance_incidents',
       'assurance_incident_people',
       'assurance_incident_findings',
       'assurance_evidence_incidents'
     )
     AND c.contype = 'f') AS a01d1_fk_count;

COMMIT;
