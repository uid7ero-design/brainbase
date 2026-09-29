-- BrainBase Assurance A0.1C — shared Assurance core foundation
-- DRAFT ONLY. DO NOT APPLY UNTIL containment + disposable Postgres + Neon Preview proofs pass.
--
-- Frozen scope: 16 tables
--   assurance_risk_levels
--   assurance_cases
--   assurance_case_people
--   assurance_findings
--   assurance_actions
--   assurance_action_findings
--   assurance_action_tasks
--   assurance_evidence
--   assurance_evidence_cases
--   assurance_evidence_findings
--   assurance_evidence_actions
--   assurance_evidence_verifications
--   assurance_verifications
--   assurance_timeframes
--   assurance_timeframe_extensions
--   assurance_escalations
--
-- Core rules:
--   * Every Assurance-owned table is tenant scoped.
--   * Composite tenant FKs are used wherever the parent exposes (organisation_id, id).
--   * users(id) is the known exception and requires same-org validation in the service layer.
--   * All FKs use ON DELETE NO ACTION. Assurance history must not cascade-delete.
--   * No generic entity_type/entity_id relationships.
--   * Findings <-> Actions is many-to-many.
--   * Evidence is first-class and reusable through explicit link tables.
--   * Verification history is append-only at DB level.
--   * Task completion does not close an Assurance Action.
--   * Work completion != verification != closure.
--   * Deadline history is authoritative in assurance_timeframes.
--   * original_due_at is immutable at DB level; extensions change current_due_at.
--
-- This migration intentionally does NOT create incidents, investigations, inspections,
-- audits, evaluations, insurance claims, contractor engagements/non-conformances,
-- projects, documents, or workflow-specific source link tables.

BEGIN;

-- ============================================================================
-- PRE-FLIGHT
-- ============================================================================

DO $$
DECLARE
  actual_def text;
BEGIN
  IF to_regclass('public.organisations') IS NULL THEN
    RAISE EXCEPTION 'A0.1C preflight failed: public.organisations is missing';
  END IF;

  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'A0.1C preflight failed: public.users is missing';
  END IF;

  IF to_regclass('public.hr_people') IS NULL THEN
    RAISE EXCEPTION 'A0.1C preflight failed: public.hr_people is missing';
  END IF;

  IF to_regclass('public.organiser_items') IS NULL THEN
    RAISE EXCEPTION 'A0.1C preflight failed: public.organiser_items is missing';
  END IF;

  IF to_regclass('public.external_organisations') IS NULL THEN
    RAISE EXCEPTION 'A0.1C preflight failed: public.external_organisations is missing; A0.1B must exist first';
  END IF;

  IF to_regclass('public.assets') IS NULL THEN
    RAISE EXCEPTION 'A0.1C preflight failed: public.assets is missing; A0.1B must exist first';
  END IF;

  IF to_regclass('public.locations') IS NULL THEN
    RAISE EXCEPTION 'A0.1C preflight failed: public.locations is missing; A0.1B must exist first';
  END IF;

  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'A0.1C preflight failed: gen_random_uuid() is unavailable';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.hr_people'::regclass
    AND conname = 'hr_people_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1C preflight failed: hr_people tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.organiser_items'::regclass
    AND conname = 'organiser_items_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1C preflight failed: organiser_items tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.external_organisations'::regclass
    AND conname = 'external_organisations_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1C preflight failed: external_organisations tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assets'::regclass
    AND conname = 'assets_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1C preflight failed: assets tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.locations'::regclass
    AND conname = 'locations_organisation_id_id_key'
    AND contype = 'u';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1C preflight failed: locations tenant anchor is "%"', actual_def;
  END IF;
END $$;

-- ============================================================================
-- LEVEL 1 — RISK CONFIGURATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_risk_levels (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        TEXT        NOT NULL,
  code                    TEXT        NOT NULL,
  name                    TEXT        NOT NULL,
  description             TEXT,
  rank                    INTEGER     NOT NULL,
  is_active               BOOLEAN     NOT NULL DEFAULT true,
  requires_verification   BOOLEAN     NOT NULL DEFAULT false,
  created_by              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_risk_levels_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_risk_levels_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_risk_levels_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_risk_levels_org_code_key
    UNIQUE (organisation_id, code),

  CONSTRAINT assurance_risk_levels_org_rank_key
    UNIQUE (organisation_id, rank),

  CONSTRAINT assurance_risk_levels_code_not_blank_check
    CHECK (btrim(code) <> ''),

  CONSTRAINT assurance_risk_levels_name_not_blank_check
    CHECK (btrim(name) <> ''),

  CONSTRAINT assurance_risk_levels_description_not_blank_check
    CHECK (description IS NULL OR btrim(description) <> ''),

  CONSTRAINT assurance_risk_levels_rank_check
    CHECK (rank >= 0)
);

CREATE INDEX IF NOT EXISTS idx_assurance_risk_levels_org_active_rank
  ON assurance_risk_levels (organisation_id, is_active, rank);

-- ============================================================================
-- LEVEL 2 — CASES
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_cases (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           TEXT        NOT NULL,
  case_reference            TEXT        NOT NULL,
  case_type                 TEXT        NOT NULL,
  title                     TEXT        NOT NULL,
  description               TEXT,
  status                    TEXT        NOT NULL DEFAULT 'OPEN',
  risk_level_id             UUID,
  owner_user_id             TEXT,
  identified_at             TIMESTAMPTZ,
  occurred_at               TIMESTAMPTZ,
  closed_at                 TIMESTAMPTZ,
  closed_by                 TEXT,
  external_organisation_id  UUID,
  asset_id                  UUID,
  location_id               UUID,
  created_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_cases_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_cases_risk_level_org_fkey
    FOREIGN KEY (organisation_id, risk_level_id)
    REFERENCES assurance_risk_levels (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_cases_external_org_org_fkey
    FOREIGN KEY (organisation_id, external_organisation_id)
    REFERENCES external_organisations (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_cases_asset_org_fkey
    FOREIGN KEY (organisation_id, asset_id)
    REFERENCES assets (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_cases_location_org_fkey
    FOREIGN KEY (organisation_id, location_id)
    REFERENCES locations (organisation_id, id)
    ON DELETE NO ACTION,

  -- users(id) is intentionally a bare FK because users currently lacks
  -- UNIQUE (organisation_id, id). Same-org validation remains mandatory
  -- in the governed service layer.
  CONSTRAINT assurance_cases_owner_user_id_fkey
    FOREIGN KEY (owner_user_id)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_cases_closed_by_fkey
    FOREIGN KEY (closed_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_cases_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_cases_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_cases_org_reference_key
    UNIQUE (organisation_id, case_reference),

  CONSTRAINT assurance_cases_reference_not_blank_check
    CHECK (btrim(case_reference) <> ''),

  CONSTRAINT assurance_cases_type_not_blank_check
    CHECK (btrim(case_type) <> ''),

  CONSTRAINT assurance_cases_title_not_blank_check
    CHECK (btrim(title) <> ''),

  CONSTRAINT assurance_cases_description_not_blank_check
    CHECK (description IS NULL OR btrim(description) <> ''),

  CONSTRAINT assurance_cases_status_check
    CHECK (status IN (
      'OPEN',
      'IN_PROGRESS',
      'AWAITING_ACTION',
      'AWAITING_VERIFICATION',
      'CLOSED',
      'CANCELLED'
    )),

  CONSTRAINT assurance_cases_closed_state_check
    CHECK (
      (status = 'CLOSED' AND closed_at IS NOT NULL)
      OR
      (status <> 'CLOSED' AND closed_at IS NULL)
    ),

  CONSTRAINT assurance_cases_closed_by_state_check
    CHECK (closed_at IS NOT NULL OR closed_by IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_assurance_cases_org_status
  ON assurance_cases (organisation_id, status);

CREATE INDEX IF NOT EXISTS idx_assurance_cases_org_risk
  ON assurance_cases (organisation_id, risk_level_id)
  WHERE risk_level_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_cases_org_external_org
  ON assurance_cases (organisation_id, external_organisation_id)
  WHERE external_organisation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_cases_org_location
  ON assurance_cases (organisation_id, location_id)
  WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_cases_org_asset
  ON assurance_cases (organisation_id, asset_id)
  WHERE asset_id IS NOT NULL;

-- ============================================================================
-- LEVEL 3 — CASE PEOPLE / FINDINGS / ACTIONS / EVIDENCE
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_case_people (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  case_id           UUID        NOT NULL,
  person_id         UUID        NOT NULL,
  role              TEXT        NOT NULL,
  notes             TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_case_people_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_case_people_case_org_fkey
    FOREIGN KEY (organisation_id, case_id)
    REFERENCES assurance_cases (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_case_people_person_org_fkey
    FOREIGN KEY (organisation_id, person_id)
    REFERENCES hr_people (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_case_people_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_case_people_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_case_people_case_person_role_key
    UNIQUE (organisation_id, case_id, person_id, role),

  CONSTRAINT assurance_case_people_role_check
    CHECK (role IN (
      'AFFECTED_PERSON',
      'INVOLVED_PERSON',
      'WITNESS',
      'REPORTER',
      'RESPONSIBLE_PERSON',
      'CONTACT',
      'OTHER'
    )),

  CONSTRAINT assurance_case_people_notes_not_blank_check
    CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE INDEX IF NOT EXISTS idx_assurance_case_people_org_case
  ON assurance_case_people (organisation_id, case_id);

CREATE INDEX IF NOT EXISTS idx_assurance_case_people_org_person
  ON assurance_case_people (organisation_id, person_id);


CREATE TABLE IF NOT EXISTS assurance_findings (
  id                                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                       TEXT        NOT NULL,
  finding_reference                     TEXT        NOT NULL,
  case_id                               UUID,
  finding_type                          TEXT        NOT NULL,
  title                                 TEXT        NOT NULL,
  description                           TEXT        NOT NULL,
  status                                TEXT        NOT NULL DEFAULT 'OPEN',
  risk_level_id                         UUID,
  responsible_user_id                   TEXT,
  responsible_external_organisation_id  UUID,
  identified_at                         TIMESTAMPTZ NOT NULL,
  closed_at                             TIMESTAMPTZ,
  closed_by                             TEXT,
  location_id                           UUID,
  asset_id                              UUID,
  created_by                            TEXT,
  created_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_findings_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_findings_case_org_fkey
    FOREIGN KEY (organisation_id, case_id)
    REFERENCES assurance_cases (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_findings_risk_org_fkey
    FOREIGN KEY (organisation_id, risk_level_id)
    REFERENCES assurance_risk_levels (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_findings_responsible_external_org_fkey
    FOREIGN KEY (organisation_id, responsible_external_organisation_id)
    REFERENCES external_organisations (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_findings_location_org_fkey
    FOREIGN KEY (organisation_id, location_id)
    REFERENCES locations (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_findings_asset_org_fkey
    FOREIGN KEY (organisation_id, asset_id)
    REFERENCES assets (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_findings_responsible_user_id_fkey
    FOREIGN KEY (responsible_user_id)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_findings_closed_by_fkey
    FOREIGN KEY (closed_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_findings_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_findings_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_findings_org_reference_key
    UNIQUE (organisation_id, finding_reference),

  CONSTRAINT assurance_findings_reference_not_blank_check
    CHECK (btrim(finding_reference) <> ''),

  CONSTRAINT assurance_findings_title_not_blank_check
    CHECK (btrim(title) <> ''),

  CONSTRAINT assurance_findings_description_not_blank_check
    CHECK (btrim(description) <> ''),

  CONSTRAINT assurance_findings_type_check
    CHECK (finding_type IN (
      'OBSERVATION',
      'HAZARD',
      'DEFECT',
      'NON_CONFORMANCE',
      'AUDIT_FINDING',
      'SERVICE_FAILURE',
      'IMPROVEMENT_OPPORTUNITY',
      'OTHER'
    )),

  CONSTRAINT assurance_findings_status_check
    CHECK (status IN (
      'OPEN',
      'UNDER_REVIEW',
      'ACTION_REQUIRED',
      'ACTION_IN_PROGRESS',
      'AWAITING_VERIFICATION',
      'CLOSED',
      'CANCELLED'
    )),

  CONSTRAINT assurance_findings_closed_state_check
    CHECK (
      (status = 'CLOSED' AND closed_at IS NOT NULL)
      OR
      (status <> 'CLOSED' AND closed_at IS NULL)
    ),

  CONSTRAINT assurance_findings_closed_by_state_check
    CHECK (closed_at IS NOT NULL OR closed_by IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_assurance_findings_org_status
  ON assurance_findings (organisation_id, status);

CREATE INDEX IF NOT EXISTS idx_assurance_findings_org_type_status
  ON assurance_findings (organisation_id, finding_type, status);

CREATE INDEX IF NOT EXISTS idx_assurance_findings_org_case
  ON assurance_findings (organisation_id, case_id)
  WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_findings_org_risk
  ON assurance_findings (organisation_id, risk_level_id)
  WHERE risk_level_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS assurance_actions (
  id                                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                       TEXT        NOT NULL,
  action_reference                      TEXT        NOT NULL,
  case_id                               UUID,
  action_type                           TEXT        NOT NULL,
  title                                 TEXT        NOT NULL,
  description                           TEXT,
  priority                              TEXT        NOT NULL,
  status                                TEXT        NOT NULL DEFAULT 'OPEN',
  owner_user_id                         TEXT,
  responsible_external_organisation_id  UUID,
  evidence_required                     BOOLEAN     NOT NULL DEFAULT false,
  verification_required                 BOOLEAN     NOT NULL DEFAULT false,
  work_completed_at                     TIMESTAMPTZ,
  work_completed_by                     TEXT,
  closed_at                             TIMESTAMPTZ,
  closed_by                             TEXT,
  created_by                            TEXT,
  created_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_actions_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_actions_case_org_fkey
    FOREIGN KEY (organisation_id, case_id)
    REFERENCES assurance_cases (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_actions_responsible_external_org_fkey
    FOREIGN KEY (organisation_id, responsible_external_organisation_id)
    REFERENCES external_organisations (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_actions_owner_user_id_fkey
    FOREIGN KEY (owner_user_id)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_actions_work_completed_by_fkey
    FOREIGN KEY (work_completed_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_actions_closed_by_fkey
    FOREIGN KEY (closed_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_actions_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_actions_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_actions_org_reference_key
    UNIQUE (organisation_id, action_reference),

  CONSTRAINT assurance_actions_reference_not_blank_check
    CHECK (btrim(action_reference) <> ''),

  CONSTRAINT assurance_actions_title_not_blank_check
    CHECK (btrim(title) <> ''),

  CONSTRAINT assurance_actions_description_not_blank_check
    CHECK (description IS NULL OR btrim(description) <> ''),

  CONSTRAINT assurance_actions_priority_not_blank_check
    CHECK (btrim(priority) <> ''),

  CONSTRAINT assurance_actions_type_check
    CHECK (action_type IN (
      'IMMEDIATE_CONTROL',
      'CORRECTIVE',
      'PREVENTATIVE',
      'REMEDIAL',
      'IMPROVEMENT',
      'FOLLOW_UP',
      'MONITORING',
      'OTHER'
    )),

  CONSTRAINT assurance_actions_status_check
    CHECK (status IN (
      'OPEN',
      'IN_PROGRESS',
      'AWAITING_EVIDENCE',
      'AWAITING_VERIFICATION',
      'CLOSED',
      'CANCELLED'
    )),

  CONSTRAINT assurance_actions_work_completed_by_state_check
    CHECK (work_completed_at IS NOT NULL OR work_completed_by IS NULL),

  CONSTRAINT assurance_actions_closed_state_check
    CHECK (
      (status = 'CLOSED' AND closed_at IS NOT NULL)
      OR
      (status <> 'CLOSED' AND closed_at IS NULL)
    ),

  CONSTRAINT assurance_actions_closed_by_state_check
    CHECK (closed_at IS NOT NULL OR closed_by IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_assurance_actions_org_status
  ON assurance_actions (organisation_id, status);

CREATE INDEX IF NOT EXISTS idx_assurance_actions_org_type_status
  ON assurance_actions (organisation_id, action_type, status);

CREATE INDEX IF NOT EXISTS idx_assurance_actions_org_case
  ON assurance_actions (organisation_id, case_id)
  WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_actions_org_responsible_external_org
  ON assurance_actions (organisation_id, responsible_external_organisation_id)
  WHERE responsible_external_organisation_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS assurance_evidence (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    TEXT        NOT NULL,
  evidence_reference TEXT        NOT NULL,
  evidence_type      TEXT        NOT NULL,
  title              TEXT,
  description        TEXT,
  captured_by        TEXT,
  captured_at        TIMESTAMPTZ,
  location_id        UUID,
  metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_evidence_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_location_org_fkey
    FOREIGN KEY (organisation_id, location_id)
    REFERENCES locations (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_captured_by_fkey
    FOREIGN KEY (captured_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_evidence_org_reference_key
    UNIQUE (organisation_id, evidence_reference),

  CONSTRAINT assurance_evidence_reference_not_blank_check
    CHECK (btrim(evidence_reference) <> ''),

  CONSTRAINT assurance_evidence_title_not_blank_check
    CHECK (title IS NULL OR btrim(title) <> ''),

  CONSTRAINT assurance_evidence_description_not_blank_check
    CHECK (description IS NULL OR btrim(description) <> ''),

  CONSTRAINT assurance_evidence_type_check
    CHECK (evidence_type IN (
      'PHOTO',
      'VIDEO',
      'DOCUMENT',
      'EMAIL',
      'STATEMENT',
      'MEASUREMENT',
      'SYSTEM_RECORD',
      'OTHER'
    )),

  CONSTRAINT assurance_evidence_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_assurance_evidence_org_type
  ON assurance_evidence (organisation_id, evidence_type);

CREATE INDEX IF NOT EXISTS idx_assurance_evidence_org_captured_at
  ON assurance_evidence (organisation_id, captured_at)
  WHERE captured_at IS NOT NULL;

-- ============================================================================
-- LEVEL 4 — RELATIONSHIPS / VERIFICATION / TIMEFRAMES
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_action_findings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  action_id         UUID        NOT NULL,
  finding_id        UUID        NOT NULL,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_action_findings_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_action_findings_action_org_fkey
    FOREIGN KEY (organisation_id, action_id)
    REFERENCES assurance_actions (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_action_findings_finding_org_fkey
    FOREIGN KEY (organisation_id, finding_id)
    REFERENCES assurance_findings (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_action_findings_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_action_findings_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_action_findings_pair_key
    UNIQUE (organisation_id, action_id, finding_id)
);

CREATE INDEX IF NOT EXISTS idx_assurance_action_findings_org_finding
  ON assurance_action_findings (organisation_id, finding_id);


CREATE TABLE IF NOT EXISTS assurance_action_tasks (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    TEXT        NOT NULL,
  action_id           UUID        NOT NULL,
  organiser_item_id   UUID        NOT NULL,
  relationship_type   TEXT        NOT NULL DEFAULT 'IMPLEMENTATION',
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_action_tasks_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_action_tasks_action_org_fkey
    FOREIGN KEY (organisation_id, action_id)
    REFERENCES assurance_actions (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_action_tasks_organiser_item_org_fkey
    FOREIGN KEY (organisation_id, organiser_item_id)
    REFERENCES organiser_items (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_action_tasks_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_action_tasks_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_action_tasks_action_item_key
    UNIQUE (organisation_id, action_id, organiser_item_id),

  CONSTRAINT assurance_action_tasks_relationship_type_check
    CHECK (relationship_type IN (
      'IMPLEMENTATION',
      'FOLLOW_UP',
      'EVIDENCE_COLLECTION',
      'OTHER'
    ))
);

CREATE INDEX IF NOT EXISTS idx_assurance_action_tasks_org_item
  ON assurance_action_tasks (organisation_id, organiser_item_id);


CREATE TABLE IF NOT EXISTS assurance_verifications (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  action_id         UUID        NOT NULL,
  attempt_number    INTEGER     NOT NULL,
  result            TEXT        NOT NULL,
  verified_by       TEXT        NOT NULL,
  verified_at       TIMESTAMPTZ NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_verifications_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_verifications_action_org_fkey
    FOREIGN KEY (organisation_id, action_id)
    REFERENCES assurance_actions (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_verifications_verified_by_fkey
    FOREIGN KEY (verified_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_verifications_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_verifications_action_attempt_key
    UNIQUE (organisation_id, action_id, attempt_number),

  CONSTRAINT assurance_verifications_attempt_number_check
    CHECK (attempt_number >= 1),

  CONSTRAINT assurance_verifications_result_check
    CHECK (result IN (
      'ACCEPTED',
      'REJECTED',
      'PARTIALLY_ACCEPTED',
      'MORE_EVIDENCE_REQUIRED',
      'NOT_APPLICABLE'
    )),

  CONSTRAINT assurance_verifications_notes_not_blank_check
    CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE INDEX IF NOT EXISTS idx_assurance_verifications_org_action_verified_at
  ON assurance_verifications (organisation_id, action_id, verified_at DESC);


-- Append-only verification history.
-- UPDATE and DELETE are rejected. Corrections must be recorded as new attempts.
CREATE OR REPLACE FUNCTION assurance_reject_verification_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'assurance_verifications is append-only; % is not permitted. Record a new verification attempt instead.',
    TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_assurance_verifications_append_only
  ON assurance_verifications;

CREATE TRIGGER trg_assurance_verifications_append_only
BEFORE UPDATE OR DELETE ON assurance_verifications
FOR EACH ROW
EXECUTE FUNCTION assurance_reject_verification_mutation();


CREATE TABLE IF NOT EXISTS assurance_timeframes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  case_id           UUID,
  finding_id        UUID,
  action_id         UUID,
  timeframe_type    TEXT        NOT NULL,
  original_due_at   TIMESTAMPTZ NOT NULL,
  current_due_at    TIMESTAMPTZ NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'ACTIVE',
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_timeframes_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_timeframes_case_org_fkey
    FOREIGN KEY (organisation_id, case_id)
    REFERENCES assurance_cases (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_timeframes_finding_org_fkey
    FOREIGN KEY (organisation_id, finding_id)
    REFERENCES assurance_findings (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_timeframes_action_org_fkey
    FOREIGN KEY (organisation_id, action_id)
    REFERENCES assurance_actions (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_timeframes_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_timeframes_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_timeframes_exactly_one_parent_check
    CHECK (num_nonnulls(case_id, finding_id, action_id) = 1),

  CONSTRAINT assurance_timeframes_type_check
    CHECK (timeframe_type IN (
      'RESPONSE',
      'ACTION',
      'EVIDENCE',
      'VERIFICATION',
      'CLOSURE',
      'FOLLOW_UP',
      'OTHER'
    )),

  CONSTRAINT assurance_timeframes_status_check
    CHECK (status IN (
      'ACTIVE',
      'MET',
      'OVERDUE',
      'SUPERSEDED',
      'CANCELLED'
    ))
);

CREATE INDEX IF NOT EXISTS idx_assurance_timeframes_org_status_due
  ON assurance_timeframes (organisation_id, status, current_due_at);

CREATE INDEX IF NOT EXISTS idx_assurance_timeframes_org_case
  ON assurance_timeframes (organisation_id, case_id)
  WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_timeframes_org_finding
  ON assurance_timeframes (organisation_id, finding_id)
  WHERE finding_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_timeframes_org_action
  ON assurance_timeframes (organisation_id, action_id)
  WHERE action_id IS NOT NULL;

-- original_due_at is immutable once the timeframe row exists.
-- Approved extensions must update current_due_at and preserve original_due_at.
CREATE OR REPLACE FUNCTION assurance_reject_original_due_at_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.original_due_at IS DISTINCT FROM OLD.original_due_at THEN
    RAISE EXCEPTION
      'assurance_timeframes.original_due_at is immutable; update current_due_at through the governed extension workflow instead.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assurance_timeframes_original_due_at_immutable
  ON assurance_timeframes;

CREATE TRIGGER trg_assurance_timeframes_original_due_at_immutable
BEFORE UPDATE OF original_due_at ON assurance_timeframes
FOR EACH ROW
EXECUTE FUNCTION assurance_reject_original_due_at_change();

-- ============================================================================
-- LEVEL 5 — EXPLICIT EVIDENCE LINKS / EXTENSIONS / ESCALATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS assurance_evidence_cases (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  evidence_id       UUID        NOT NULL,
  case_id           UUID        NOT NULL,
  purpose           TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at        TIMESTAMPTZ,
  removed_by        TEXT,
  removal_reason    TEXT,

  CONSTRAINT assurance_evidence_cases_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_cases_evidence_org_fkey
    FOREIGN KEY (organisation_id, evidence_id)
    REFERENCES assurance_evidence (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_cases_case_org_fkey
    FOREIGN KEY (organisation_id, case_id)
    REFERENCES assurance_cases (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_cases_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_cases_removed_by_fkey
    FOREIGN KEY (removed_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_cases_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_evidence_cases_purpose_not_blank_check
    CHECK (purpose IS NULL OR btrim(purpose) <> ''),

  CONSTRAINT assurance_evidence_cases_removal_state_check
    CHECK (
      (removed_at IS NULL AND removed_by IS NULL AND removal_reason IS NULL)
      OR
      (removed_at IS NOT NULL AND removal_reason IS NOT NULL AND btrim(removal_reason) <> '')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_evidence_cases_active_link
  ON assurance_evidence_cases (organisation_id, evidence_id, case_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_evidence_cases_org_case
  ON assurance_evidence_cases (organisation_id, case_id, removed_at);


CREATE TABLE IF NOT EXISTS assurance_evidence_findings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  evidence_id       UUID        NOT NULL,
  finding_id        UUID        NOT NULL,
  purpose           TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at        TIMESTAMPTZ,
  removed_by        TEXT,
  removal_reason    TEXT,

  CONSTRAINT assurance_evidence_findings_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_findings_evidence_org_fkey
    FOREIGN KEY (organisation_id, evidence_id)
    REFERENCES assurance_evidence (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_findings_finding_org_fkey
    FOREIGN KEY (organisation_id, finding_id)
    REFERENCES assurance_findings (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_findings_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_findings_removed_by_fkey
    FOREIGN KEY (removed_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_findings_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_evidence_findings_purpose_not_blank_check
    CHECK (purpose IS NULL OR btrim(purpose) <> ''),

  CONSTRAINT assurance_evidence_findings_removal_state_check
    CHECK (
      (removed_at IS NULL AND removed_by IS NULL AND removal_reason IS NULL)
      OR
      (removed_at IS NOT NULL AND removal_reason IS NOT NULL AND btrim(removal_reason) <> '')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_evidence_findings_active_link
  ON assurance_evidence_findings (organisation_id, evidence_id, finding_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_evidence_findings_org_finding
  ON assurance_evidence_findings (organisation_id, finding_id, removed_at);


CREATE TABLE IF NOT EXISTS assurance_evidence_actions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  evidence_id       UUID        NOT NULL,
  action_id         UUID        NOT NULL,
  purpose           TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at        TIMESTAMPTZ,
  removed_by        TEXT,
  removal_reason    TEXT,

  CONSTRAINT assurance_evidence_actions_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_actions_evidence_org_fkey
    FOREIGN KEY (organisation_id, evidence_id)
    REFERENCES assurance_evidence (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_actions_action_org_fkey
    FOREIGN KEY (organisation_id, action_id)
    REFERENCES assurance_actions (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_actions_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_actions_removed_by_fkey
    FOREIGN KEY (removed_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_actions_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_evidence_actions_purpose_not_blank_check
    CHECK (purpose IS NULL OR btrim(purpose) <> ''),

  CONSTRAINT assurance_evidence_actions_removal_state_check
    CHECK (
      (removed_at IS NULL AND removed_by IS NULL AND removal_reason IS NULL)
      OR
      (removed_at IS NOT NULL AND removal_reason IS NOT NULL AND btrim(removal_reason) <> '')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_evidence_actions_active_link
  ON assurance_evidence_actions (organisation_id, evidence_id, action_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_evidence_actions_org_action
  ON assurance_evidence_actions (organisation_id, action_id, removed_at);


CREATE TABLE IF NOT EXISTS assurance_evidence_verifications (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  evidence_id       UUID        NOT NULL,
  verification_id   UUID        NOT NULL,
  purpose           TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at        TIMESTAMPTZ,
  removed_by        TEXT,
  removal_reason    TEXT,

  CONSTRAINT assurance_evidence_verifications_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_verifications_evidence_org_fkey
    FOREIGN KEY (organisation_id, evidence_id)
    REFERENCES assurance_evidence (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_verifications_verification_org_fkey
    FOREIGN KEY (organisation_id, verification_id)
    REFERENCES assurance_verifications (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_verifications_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_verifications_removed_by_fkey
    FOREIGN KEY (removed_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_evidence_verifications_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_evidence_verifications_purpose_not_blank_check
    CHECK (purpose IS NULL OR btrim(purpose) <> ''),

  CONSTRAINT assurance_evidence_verifications_removal_state_check
    CHECK (
      (removed_at IS NULL AND removed_by IS NULL AND removal_reason IS NULL)
      OR
      (removed_at IS NOT NULL AND removal_reason IS NOT NULL AND btrim(removal_reason) <> '')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_evidence_verifications_active_link
  ON assurance_evidence_verifications (organisation_id, evidence_id, verification_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_assurance_evidence_verifications_org_verification
  ON assurance_evidence_verifications (organisation_id, verification_id, removed_at);


CREATE TABLE IF NOT EXISTS assurance_timeframe_extensions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   TEXT        NOT NULL,
  timeframe_id       UUID        NOT NULL,
  requested_due_at   TIMESTAMPTZ NOT NULL,
  reason             TEXT        NOT NULL,
  requested_by       TEXT,
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT        NOT NULL DEFAULT 'PENDING',
  decided_by         TEXT,
  decided_at         TIMESTAMPTZ,
  decision_notes     TEXT,
  previous_due_at    TIMESTAMPTZ NOT NULL,
  approved_due_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_timeframe_extensions_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_timeframe_extensions_timeframe_org_fkey
    FOREIGN KEY (organisation_id, timeframe_id)
    REFERENCES assurance_timeframes (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_timeframe_extensions_requested_by_fkey
    FOREIGN KEY (requested_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_timeframe_extensions_decided_by_fkey
    FOREIGN KEY (decided_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_timeframe_extensions_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_timeframe_extensions_reason_not_blank_check
    CHECK (btrim(reason) <> ''),

  CONSTRAINT assurance_timeframe_extensions_decision_notes_not_blank_check
    CHECK (decision_notes IS NULL OR btrim(decision_notes) <> ''),

  CONSTRAINT assurance_timeframe_extensions_status_check
    CHECK (status IN (
      'PENDING',
      'APPROVED',
      'REJECTED',
      'CANCELLED'
    )),

  CONSTRAINT assurance_timeframe_extensions_approved_state_check
    CHECK (
      (
        status = 'APPROVED'
        AND decided_by IS NOT NULL
        AND decided_at IS NOT NULL
        AND approved_due_at IS NOT NULL
      )
      OR
      (
        status <> 'APPROVED'
        AND approved_due_at IS NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_assurance_timeframe_extensions_org_timeframe
  ON assurance_timeframe_extensions (organisation_id, timeframe_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_assurance_timeframe_extensions_org_status
  ON assurance_timeframe_extensions (organisation_id, status);


CREATE TABLE IF NOT EXISTS assurance_escalations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT        NOT NULL,
  timeframe_id          UUID        NOT NULL,
  escalation_level     INTEGER     NOT NULL,
  reason                TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'OPEN',
  escalated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  escalated_by          TEXT,
  assigned_user_id      TEXT,
  acknowledged_at       TIMESTAMPTZ,
  acknowledged_by       TEXT,
  resolved_at           TIMESTAMPTZ,
  resolved_by           TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_escalations_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_escalations_timeframe_org_fkey
    FOREIGN KEY (organisation_id, timeframe_id)
    REFERENCES assurance_timeframes (organisation_id, id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_escalations_escalated_by_fkey
    FOREIGN KEY (escalated_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_escalations_assigned_user_id_fkey
    FOREIGN KEY (assigned_user_id)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_escalations_acknowledged_by_fkey
    FOREIGN KEY (acknowledged_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_escalations_resolved_by_fkey
    FOREIGN KEY (resolved_by)
    REFERENCES users(id)
    ON DELETE NO ACTION,

  CONSTRAINT assurance_escalations_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assurance_escalations_level_check
    CHECK (escalation_level >= 1),

  CONSTRAINT assurance_escalations_reason_not_blank_check
    CHECK (btrim(reason) <> ''),

  CONSTRAINT assurance_escalations_notes_not_blank_check
    CHECK (notes IS NULL OR btrim(notes) <> ''),

  CONSTRAINT assurance_escalations_status_check
    CHECK (status IN (
      'OPEN',
      'ACKNOWLEDGED',
      'RESOLVED',
      'CANCELLED'
    )),

  CONSTRAINT assurance_escalations_acknowledged_by_state_check
    CHECK (acknowledged_at IS NOT NULL OR acknowledged_by IS NULL),

  CONSTRAINT assurance_escalations_resolved_by_state_check
    CHECK (resolved_at IS NOT NULL OR resolved_by IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_assurance_escalations_org_status
  ON assurance_escalations (organisation_id, status);

CREATE INDEX IF NOT EXISTS idx_assurance_escalations_org_timeframe
  ON assurance_escalations (organisation_id, timeframe_id, escalated_at DESC);

-- ============================================================================
-- FAIL-LOUD POST-CONDITIONS
-- ============================================================================

DO $$
DECLARE
  missing_tables text;
  wrong_delete_count integer;
  verification_trigger_count integer;
  original_due_at_trigger_count integer;
  actual_def text;
BEGIN
  SELECT string_agg(expected.table_name, ', ' ORDER BY expected.table_name)
    INTO missing_tables
  FROM (
    VALUES
      ('assurance_risk_levels'),
      ('assurance_cases'),
      ('assurance_case_people'),
      ('assurance_findings'),
      ('assurance_actions'),
      ('assurance_action_findings'),
      ('assurance_action_tasks'),
      ('assurance_evidence'),
      ('assurance_evidence_cases'),
      ('assurance_evidence_findings'),
      ('assurance_evidence_actions'),
      ('assurance_evidence_verifications'),
      ('assurance_verifications'),
      ('assurance_timeframes'),
      ('assurance_timeframe_extensions'),
      ('assurance_escalations')
  ) AS expected(table_name)
  LEFT JOIN information_schema.tables t
    ON t.table_schema = 'public'
   AND t.table_name = expected.table_name
  WHERE t.table_name IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'A0.1C post-condition failed: missing tables: %', missing_tables;
  END IF;

  -- Core composite tenant anchors.
  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_cases'::regclass
    AND conname = 'assurance_cases_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1C schema drift: assurance_cases tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_findings'::regclass
    AND conname = 'assurance_findings_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1C schema drift: assurance_findings tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_actions'::regclass
    AND conname = 'assurance_actions_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1C schema drift: assurance_actions tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_evidence'::regclass
    AND conname = 'assurance_evidence_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1C schema drift: assurance_evidence tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_verifications'::regclass
    AND conname = 'assurance_verifications_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1C schema drift: assurance_verifications tenant anchor is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_timeframes'::regclass
    AND conname = 'assurance_timeframes_organisation_id_id_key';
  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1C schema drift: assurance_timeframes tenant anchor is "%"', actual_def;
  END IF;

  -- Critical composite relationship checks.
  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_action_findings'::regclass
    AND conname = 'assurance_action_findings_action_org_fkey';
  IF actual_def IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, action_id) REFERENCES assurance_actions(organisation_id, id)'
  THEN
    RAISE EXCEPTION 'A0.1C schema drift: action_findings action tenant FK is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_action_findings'::regclass
    AND conname = 'assurance_action_findings_finding_org_fkey';
  IF actual_def IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, finding_id) REFERENCES assurance_findings(organisation_id, id)'
  THEN
    RAISE EXCEPTION 'A0.1C schema drift: action_findings finding tenant FK is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_action_tasks'::regclass
    AND conname = 'assurance_action_tasks_organiser_item_org_fkey';
  IF actual_def IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, organiser_item_id) REFERENCES organiser_items(organisation_id, id)'
  THEN
    RAISE EXCEPTION 'A0.1C schema drift: action_tasks organiser tenant FK is "%"', actual_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.assurance_verifications'::regclass
    AND conname = 'assurance_verifications_action_org_fkey';
  IF actual_def IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, action_id) REFERENCES assurance_actions(organisation_id, id)'
  THEN
    RAISE EXCEPTION 'A0.1C schema drift: verifications action tenant FK is "%"', actual_def;
  END IF;

  -- Every FK owned by the 16 A0.1C tables must remain NO ACTION.
  SELECT count(*) INTO wrong_delete_count
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE n.nspname = 'public'
    AND cl.relname IN (
      'assurance_risk_levels',
      'assurance_cases',
      'assurance_case_people',
      'assurance_findings',
      'assurance_actions',
      'assurance_action_findings',
      'assurance_action_tasks',
      'assurance_evidence',
      'assurance_evidence_cases',
      'assurance_evidence_findings',
      'assurance_evidence_actions',
      'assurance_evidence_verifications',
      'assurance_verifications',
      'assurance_timeframes',
      'assurance_timeframe_extensions',
      'assurance_escalations'
    )
    AND c.contype = 'f'
    AND c.confdeltype <> 'a';

  IF wrong_delete_count <> 0 THEN
    RAISE EXCEPTION
      'A0.1C post-condition failed: % foreign keys do not use ON DELETE NO ACTION',
      wrong_delete_count;
  END IF;

  SELECT count(*) INTO verification_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.assurance_verifications'::regclass
    AND tgname = 'trg_assurance_verifications_append_only'
    AND NOT tgisinternal
    AND tgenabled <> 'D';

  IF verification_trigger_count <> 1 THEN
    RAISE EXCEPTION
      'A0.1C post-condition failed: append-only verification trigger is missing or disabled';
  END IF;

  SELECT count(*) INTO original_due_at_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.assurance_timeframes'::regclass
    AND tgname = 'trg_assurance_timeframes_original_due_at_immutable'
    AND NOT tgisinternal
    AND tgenabled <> 'D';

  IF original_due_at_trigger_count <> 1 THEN
    RAISE EXCEPTION
      'A0.1C post-condition failed: original_due_at immutability trigger is missing or disabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.assurance_timeframes'::regclass
      AND conname = 'assurance_timeframes_exactly_one_parent_check'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION
      'A0.1C post-condition failed: assurance_timeframes exactly-one-parent check is missing';
  END IF;
END $$;

-- Read-only summary emitted by psql/clients after successful application.
SELECT
  (SELECT count(*)
   FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN (
       'assurance_risk_levels',
       'assurance_cases',
       'assurance_case_people',
       'assurance_findings',
       'assurance_actions',
       'assurance_action_findings',
       'assurance_action_tasks',
       'assurance_evidence',
       'assurance_evidence_cases',
       'assurance_evidence_findings',
       'assurance_evidence_actions',
       'assurance_evidence_verifications',
       'assurance_verifications',
       'assurance_timeframes',
       'assurance_timeframe_extensions',
       'assurance_escalations'
     )) AS a01c_table_count,
  (SELECT count(*)
   FROM pg_trigger
   WHERE tgrelid = 'public.assurance_verifications'::regclass
     AND tgname = 'trg_assurance_verifications_append_only'
     AND NOT tgisinternal
     AND tgenabled <> 'D') AS append_only_trigger_count,
  (SELECT count(*)
   FROM pg_trigger
   WHERE tgrelid = 'public.assurance_timeframes'::regclass
     AND tgname = 'trg_assurance_timeframes_original_due_at_immutable'
     AND NOT tgisinternal
     AND tgenabled <> 'D') AS original_due_at_immutable_trigger_count;

COMMIT;
