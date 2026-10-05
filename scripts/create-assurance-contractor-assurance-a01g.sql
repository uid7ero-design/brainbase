-- BrainBase Assurance A0.1G — Contractor Assurance (requirements, scope,
-- assignments, evidence submissions with decisions, explicit Finding links).
-- DRAFT ONLY. DO NOT APPLY TO PRODUCTION UNTIL static review + disposable
-- PostgreSQL proof + isolated Neon behavioural proof + Production preflight
-- have passed and the Production handoff is explicitly approved.
--
-- Additive: 5 NEW tables; nothing existing is altered.
--   assurance_requirements                    organisation's requirement library
--   assurance_external_organisation_scopes    explicit in/out of Assurance scope
--   assurance_requirement_assignments         requirement ↔ shared external org
--   assurance_requirement_submissions         evidence submissions + decisions
--   assurance_requirement_assignment_findings explicit Finding ↔ assignment links
--
-- Shared BrainBase records stay canonical: external_organisations (A0.1B),
-- assurance_evidence (A0.1C) and assurance_findings (A0.1C) are referenced,
-- never copied. Scope is NEVER inferred from external_organisation_roles.
--
-- Rules enforced in the database (error codes):
--   CA001 lifecycle / immutability violation
--   CA002 precondition (inactive requirement, organisation not in scope,
--         inactive external organisation, assignment not active)
--   CA003 stale write (lock_version must advance by exactly one)
--   * No hard deletes on any of the five tables.
--   * One ACTIVE assignment per (organisation, external org, requirement);
--     a CANCELLED assignment may be followed by a new one.
--   * Submissions: SUBMITTED → ACCEPTED → SUPERSEDED, SUBMITTED → REJECTED,
--     SUBMITTED → WITHDRAWN. Content is immutable once recorded.
--   * At most one ACCEPTED (current) submission per assignment. Accepting a
--     submission supersedes the previous ACCEPTED one in the same statement;
--     rejecting or withdrawing a replacement leaves it current.
--   * The person who recorded a submission cannot accept or reject it
--     (decided_by <> recorded_by). This is the independence the identity
--     model can prove; nothing stronger is claimed.
--   * Accepting evidence for a requirement whose snapshot says expiry is
--     required needs expires_on.
--   * Requirement snapshot is taken at RECORD time by trigger (code, name,
--     category, description, evidence guidance, expiry required, renewal
--     notice days) and is immutable: later edits to the live requirement
--     never rewrite what an old submission was assessed against.
--   * New assignments need an ACTIVE requirement, an ACTIVE external
--     organisation and an IN_SCOPE scope record (FOR SHARE, race-safe).
--     Deactivating a requirement or moving an organisation out of scope
--     does NOT cancel existing assignments or rewrite history.
--
-- Compatibility: nothing in the currently deployed application reads or
-- writes these tables, so applying this before deploying the feature is safe.
--
-- Rollback: scripts/rollback-assurance-contractor-assurance-a01g.sql —
-- DESTRUCTIVE once used (drops all Contractor Assurance relational data).

BEGIN;

-- ============================================================================
-- PRE-FLIGHT
-- ============================================================================
DO $$
DECLARE actual_def text;
BEGIN
  IF to_regclass('public.users') IS NULL OR to_regclass('public.organisations') IS NULL THEN
    RAISE EXCEPTION 'A0.1G preflight failed: organisations/users missing';
  END IF;
  IF to_regclass('public.external_organisations') IS NULL THEN
    RAISE EXCEPTION 'A0.1G preflight failed: A0.1B external_organisations missing';
  END IF;
  IF to_regclass('public.assurance_evidence') IS NULL OR to_regclass('public.assurance_findings') IS NULL THEN
    RAISE EXCEPTION 'A0.1G preflight failed: A0.1C Assurance core is incomplete';
  END IF;
  FOR actual_def IN
    SELECT t FROM (VALUES ('external_organisations'), ('assurance_evidence'), ('assurance_findings')) AS x(t)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = ('public.' || x.t)::regclass AND c.contype = 'u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (organisation_id, id)')
  LOOP
    RAISE EXCEPTION 'A0.1G preflight failed: % lacks its (organisation_id, id) tenant anchor', actual_def;
  END LOOP;
END $$;

-- ============================================================================
-- 1. REQUIREMENT LIBRARY
-- ============================================================================
CREATE TABLE IF NOT EXISTS assurance_requirements (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT        NOT NULL,
  requirement_code     TEXT        NOT NULL,
  name                 TEXT        NOT NULL,
  description          TEXT,
  category             TEXT        NOT NULL,
  evidence_guidance    TEXT,
  expiry_required      BOOLEAN     NOT NULL DEFAULT false,
  renewal_notice_days  INTEGER,
  status               TEXT        NOT NULL DEFAULT 'ACTIVE',
  display_order        INTEGER     NOT NULL DEFAULT 0,
  deactivated_at       TIMESTAMPTZ,
  deactivated_by       TEXT,
  lock_version         INTEGER     NOT NULL DEFAULT 1,
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assurance_requirements_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_requirements_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_requirements_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_requirements_deactivated_by_fkey FOREIGN KEY (deactivated_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_requirements_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT assurance_requirements_org_code_key UNIQUE (organisation_id, requirement_code),
  CONSTRAINT assurance_requirements_code_check CHECK (requirement_code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  CONSTRAINT assurance_requirements_name_not_blank_check CHECK (btrim(name) <> ''),
  CONSTRAINT assurance_requirements_description_not_blank_check CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT assurance_requirements_guidance_not_blank_check CHECK (evidence_guidance IS NULL OR btrim(evidence_guidance) <> ''),
  CONSTRAINT assurance_requirements_category_check CHECK (category IN (
    'INSURANCE','LICENCE','REGISTRATION','CERTIFICATION','ACCREDITATION','COMPETENCY','POLICY_DOCUMENT','OTHER')),
  CONSTRAINT assurance_requirements_notice_days_check CHECK (renewal_notice_days IS NULL OR renewal_notice_days BETWEEN 1 AND 365),
  CONSTRAINT assurance_requirements_status_check CHECK (status IN ('ACTIVE','INACTIVE')),
  CONSTRAINT assurance_requirements_deactivation_check CHECK (
    (status = 'ACTIVE' AND deactivated_at IS NULL AND deactivated_by IS NULL)
    OR (status = 'INACTIVE' AND deactivated_at IS NOT NULL)),
  CONSTRAINT assurance_requirements_lock_version_check CHECK (lock_version > 0)
);
CREATE INDEX IF NOT EXISTS idx_assurance_requirements_org_status
  ON assurance_requirements (organisation_id, status, display_order);

-- ============================================================================
-- 2. EXPLICIT ASSURANCE SCOPE FOR A SHARED EXTERNAL ORGANISATION
-- ============================================================================
CREATE TABLE IF NOT EXISTS assurance_external_organisation_scopes (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           TEXT        NOT NULL,
  external_organisation_id  UUID        NOT NULL,
  status                    TEXT        NOT NULL DEFAULT 'IN_SCOPE',
  responsible_user_id       TEXT,
  notes                     TEXT,
  status_changed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_changed_by         TEXT,
  lock_version              INTEGER     NOT NULL DEFAULT 1,
  created_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assurance_ext_org_scopes_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_ext_org_scopes_external_org_fkey FOREIGN KEY (organisation_id, external_organisation_id)
    REFERENCES external_organisations (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_ext_org_scopes_responsible_user_fkey FOREIGN KEY (responsible_user_id) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_ext_org_scopes_status_changed_by_fkey FOREIGN KEY (status_changed_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_ext_org_scopes_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_ext_org_scopes_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_ext_org_scopes_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT assurance_ext_org_scopes_org_external_org_key UNIQUE (organisation_id, external_organisation_id),
  CONSTRAINT assurance_ext_org_scopes_status_check CHECK (status IN ('IN_SCOPE','OUT_OF_SCOPE')),
  CONSTRAINT assurance_ext_org_scopes_notes_not_blank_check CHECK (notes IS NULL OR btrim(notes) <> ''),
  CONSTRAINT assurance_ext_org_scopes_lock_version_check CHECK (lock_version > 0)
);
CREATE INDEX IF NOT EXISTS idx_assurance_ext_org_scopes_org_status
  ON assurance_external_organisation_scopes (organisation_id, status);

-- ============================================================================
-- 3. REQUIREMENT ASSIGNMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS assurance_requirement_assignments (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           TEXT        NOT NULL,
  external_organisation_id  UUID        NOT NULL,
  requirement_id            UUID        NOT NULL,
  status                    TEXT        NOT NULL DEFAULT 'ACTIVE',
  required_from             DATE,
  due_date                  DATE,
  reviewer_user_id          TEXT,
  notes                     TEXT,
  cancelled_at              TIMESTAMPTZ,
  cancelled_by              TEXT,
  cancel_reason             TEXT,
  lock_version              INTEGER     NOT NULL DEFAULT 1,
  created_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assurance_req_assignments_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_assignments_external_org_fkey FOREIGN KEY (organisation_id, external_organisation_id)
    REFERENCES external_organisations (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_assignments_requirement_fkey FOREIGN KEY (organisation_id, requirement_id)
    REFERENCES assurance_requirements (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_assignments_reviewer_fkey FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_assignments_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_assignments_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_assignments_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT assurance_req_assignments_status_check CHECK (status IN ('ACTIVE','CANCELLED')),
  CONSTRAINT assurance_req_assignments_cancel_state_check CHECK (
    (status = 'ACTIVE' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
    OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND btrim(cancel_reason) <> '')),
  CONSTRAINT assurance_req_assignments_dates_check CHECK (required_from IS NULL OR due_date IS NULL OR due_date >= required_from),
  CONSTRAINT assurance_req_assignments_notes_not_blank_check CHECK (notes IS NULL OR btrim(notes) <> ''),
  CONSTRAINT assurance_req_assignments_lock_version_check CHECK (lock_version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_req_assignments_one_active
  ON assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_assurance_req_assignments_org_external
  ON assurance_requirement_assignments (organisation_id, external_organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_assurance_req_assignments_org_requirement
  ON assurance_requirement_assignments (organisation_id, requirement_id, status);

-- ============================================================================
-- 4. EVIDENCE SUBMISSIONS AND DECISIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS assurance_requirement_submissions (
  id                               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                  TEXT        NOT NULL,
  assignment_id                    UUID        NOT NULL,
  evidence_id                      UUID        NOT NULL,
  supplied_on                      DATE        NOT NULL,
  effective_from                   DATE,
  expires_on                       DATE,
  notes                            TEXT,
  recorded_by                      TEXT        NOT NULL,
  recorded_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                           TEXT        NOT NULL DEFAULT 'SUBMITTED',
  decided_by                       TEXT,
  decided_at                       TIMESTAMPTZ,
  decision_reason                  TEXT,
  superseded_by_submission_id      UUID,
  superseded_at                    TIMESTAMPTZ,
  -- Requirement as it stood when this submission was RECORDED (set by trigger).
  requirement_code_snapshot        TEXT        NOT NULL,
  requirement_name_snapshot        TEXT        NOT NULL,
  requirement_category_snapshot    TEXT        NOT NULL,
  requirement_description_snapshot TEXT,
  evidence_guidance_snapshot       TEXT,
  expiry_required_snapshot         BOOLEAN     NOT NULL,
  renewal_notice_days_snapshot     INTEGER,
  lock_version                     INTEGER     NOT NULL DEFAULT 1,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assurance_req_submissions_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_submissions_assignment_fkey FOREIGN KEY (organisation_id, assignment_id)
    REFERENCES assurance_requirement_assignments (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_submissions_evidence_fkey FOREIGN KEY (organisation_id, evidence_id)
    REFERENCES assurance_evidence (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_submissions_superseded_by_fkey FOREIGN KEY (organisation_id, superseded_by_submission_id)
    REFERENCES assurance_requirement_submissions (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_submissions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_submissions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_submissions_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT assurance_req_submissions_org_evidence_key UNIQUE (organisation_id, evidence_id),
  CONSTRAINT assurance_req_submissions_status_check CHECK (status IN ('SUBMITTED','ACCEPTED','REJECTED','WITHDRAWN','SUPERSEDED')),
  CONSTRAINT assurance_req_submissions_decision_state_check CHECK (
    (status = 'SUBMITTED' AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL
       AND superseded_by_submission_id IS NULL AND superseded_at IS NULL)
    OR (status = 'ACCEPTED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
       AND superseded_by_submission_id IS NULL AND superseded_at IS NULL)
    OR (status = 'REJECTED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
       AND decision_reason IS NOT NULL AND btrim(decision_reason) <> ''
       AND superseded_by_submission_id IS NULL AND superseded_at IS NULL)
    OR (status = 'WITHDRAWN' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
       AND superseded_by_submission_id IS NULL AND superseded_at IS NULL)
    OR (status = 'SUPERSEDED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
       AND superseded_by_submission_id IS NOT NULL AND superseded_at IS NOT NULL)),
  -- Recorder cannot accept or reject their own submission (withdrawal is not a decision).
  CONSTRAINT assurance_req_submissions_independent_decision_check CHECK (
    status NOT IN ('ACCEPTED','REJECTED','SUPERSEDED') OR decided_by <> recorded_by),
  CONSTRAINT assurance_req_submissions_not_self_superseded_check CHECK (superseded_by_submission_id IS NULL OR superseded_by_submission_id <> id),
  CONSTRAINT assurance_req_submissions_dates_check CHECK (
    (effective_from IS NULL OR expires_on IS NULL OR expires_on >= effective_from)),
  CONSTRAINT assurance_req_submissions_notes_not_blank_check CHECK (notes IS NULL OR btrim(notes) <> ''),
  CONSTRAINT assurance_req_submissions_lock_version_check CHECK (lock_version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_req_submissions_one_accepted
  ON assurance_requirement_submissions (organisation_id, assignment_id) WHERE status = 'ACCEPTED';
CREATE INDEX IF NOT EXISTS idx_assurance_req_submissions_org_assignment
  ON assurance_requirement_submissions (organisation_id, assignment_id, status);
CREATE INDEX IF NOT EXISTS idx_assurance_req_submissions_org_expiry
  ON assurance_requirement_submissions (organisation_id, expires_on) WHERE status = 'ACCEPTED' AND expires_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assurance_req_submissions_org_pending
  ON assurance_requirement_submissions (organisation_id, recorded_at) WHERE status = 'SUBMITTED';

-- ============================================================================
-- 5. EXPLICIT FINDING LINKS
-- ============================================================================
CREATE TABLE IF NOT EXISTS assurance_requirement_assignment_findings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  assignment_id    UUID        NOT NULL,
  finding_id       UUID        NOT NULL,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assurance_req_assignment_findings_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_assignment_findings_assignment_fkey FOREIGN KEY (organisation_id, assignment_id)
    REFERENCES assurance_requirement_assignments (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_assignment_findings_finding_fkey FOREIGN KEY (organisation_id, finding_id)
    REFERENCES assurance_findings (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_assignment_findings_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_req_assignment_findings_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT assurance_req_assignment_findings_link_key UNIQUE (organisation_id, assignment_id, finding_id)
);
CREATE INDEX IF NOT EXISTS idx_assurance_req_assignment_findings_org_finding
  ON assurance_requirement_assignment_findings (organisation_id, finding_id);

-- ============================================================================
-- GUARDS
-- ============================================================================

-- No hard deletes anywhere in Contractor Assurance.
CREATE OR REPLACE FUNCTION assurance_contractor_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Contractor assurance records are never deleted (%)', TG_TABLE_NAME USING ERRCODE = 'CA001';
END;
$$;

-- Shared UPDATE guard: listed identity columns never change and lock_version
-- advances by exactly one. Arguments: identity columns (comma-separated).
CREATE OR REPLACE FUNCTION assurance_contractor_update_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY string_to_array(TG_ARGV[0], ',') LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION '% identity (%) cannot change', TG_TABLE_NAME, col USING ERRCODE = 'CA001';
    END IF;
  END LOOP;
  IF NEW.lock_version IS DISTINCT FROM OLD.lock_version + 1 THEN
    RAISE EXCEPTION '% was changed by someone else', TG_TABLE_NAME USING ERRCODE = 'CA003';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Assignments: preconditions on create (race-safe), lifecycle on update.
CREATE OR REPLACE FUNCTION assurance_requirement_assignment_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  req_status text;
  ext_status text;
  scope_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Assignments are created ACTIVE' USING ERRCODE = 'CA001';
    END IF;
    -- FOR SHARE: a concurrent deactivation / scope change / org status change
    -- waits for this insert, or this insert re-reads the committed change.
    SELECT status INTO req_status FROM assurance_requirements
      WHERE organisation_id = NEW.organisation_id AND id = NEW.requirement_id FOR SHARE;
    IF req_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'Requirement is not active' USING ERRCODE = 'CA002';
    END IF;
    SELECT status INTO ext_status FROM external_organisations
      WHERE organisation_id = NEW.organisation_id AND id = NEW.external_organisation_id FOR SHARE;
    IF ext_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'External organisation is not active' USING ERRCODE = 'CA002';
    END IF;
    SELECT status INTO scope_status FROM assurance_external_organisation_scopes
      WHERE organisation_id = NEW.organisation_id AND external_organisation_id = NEW.external_organisation_id FOR SHARE;
    IF scope_status IS DISTINCT FROM 'IN_SCOPE' THEN
      RAISE EXCEPTION 'External organisation is not in Assurance scope' USING ERRCODE = 'CA002';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'A cancelled assignment cannot change' USING ERRCODE = 'CA001';
  END IF;
  RETURN NEW;
END;
$$;

-- Submissions: snapshot at record time; lifecycle, immutability, independence,
-- expiry-required acceptance and atomic supersession.
CREATE OR REPLACE FUNCTION assurance_requirement_submission_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  lifecycle_cols text[] := ARRAY['status','decided_by','decided_at','decision_reason',
    'superseded_by_submission_id','superseded_at','lock_version','updated_at'];
  assignment_status text;
  req record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'Submissions are recorded as SUBMITTED' USING ERRCODE = 'CA001';
    END IF;
    SELECT a.status INTO assignment_status FROM assurance_requirement_assignments a
      WHERE a.organisation_id = NEW.organisation_id AND a.id = NEW.assignment_id FOR SHARE;
    IF assignment_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'Assignment is not active' USING ERRCODE = 'CA002';
    END IF;
    -- Snapshot the live requirement as it stands NOW (callers cannot supply it).
    SELECT r.requirement_code, r.name, r.category, r.description, r.evidence_guidance,
           r.expiry_required, r.renewal_notice_days
      INTO req
      FROM assurance_requirement_assignments a
      JOIN assurance_requirements r ON r.organisation_id = a.organisation_id AND r.id = a.requirement_id
     WHERE a.organisation_id = NEW.organisation_id AND a.id = NEW.assignment_id;
    NEW.requirement_code_snapshot := req.requirement_code;
    NEW.requirement_name_snapshot := req.name;
    NEW.requirement_category_snapshot := req.category;
    NEW.requirement_description_snapshot := req.description;
    NEW.evidence_guidance_snapshot := req.evidence_guidance;
    NEW.expiry_required_snapshot := req.expiry_required;
    NEW.renewal_notice_days_snapshot := req.renewal_notice_days;
    NEW.recorded_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE: everything except the lifecycle columns is frozen.
  IF (to_jsonb(NEW) - lifecycle_cols) IS DISTINCT FROM (to_jsonb(OLD) - lifecycle_cols) THEN
    RAISE EXCEPTION 'Submission content is immutable once recorded' USING ERRCODE = 'CA001';
  END IF;

  IF OLD.status = 'SUBMITTED' AND NEW.status IN ('ACCEPTED','REJECTED','WITHDRAWN') THEN
    NULL;
  ELSIF OLD.status = 'ACCEPTED' AND NEW.status = 'SUPERSEDED' THEN
    IF NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
      RAISE EXCEPTION 'Superseding keeps the original decision' USING ERRCODE = 'CA001';
    END IF;
  ELSE
    RAISE EXCEPTION 'Submission cannot move from % to %', OLD.status, NEW.status USING ERRCODE = 'CA001';
  END IF;

  IF NEW.lock_version IS DISTINCT FROM OLD.lock_version + 1 THEN
    RAISE EXCEPTION 'Submission was changed by someone else' USING ERRCODE = 'CA003';
  END IF;
  NEW.updated_at := now();

  IF NEW.status = 'ACCEPTED' THEN
    SELECT a.status INTO assignment_status FROM assurance_requirement_assignments a
      WHERE a.organisation_id = NEW.organisation_id AND a.id = NEW.assignment_id FOR SHARE;
    IF assignment_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'Assignment is not active' USING ERRCODE = 'CA002';
    END IF;
    IF NEW.expiry_required_snapshot AND NEW.expires_on IS NULL THEN
      RAISE EXCEPTION 'This requirement needs an expiry date before evidence can be accepted' USING ERRCODE = 'CA002';
    END IF;
    -- Supersede the previous current evidence in the same statement.
    UPDATE assurance_requirement_submissions
       SET status = 'SUPERSEDED', superseded_by_submission_id = NEW.id, superseded_at = now(),
           lock_version = lock_version + 1
     WHERE organisation_id = NEW.organisation_id AND assignment_id = NEW.assignment_id
       AND status = 'ACCEPTED' AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- Findings links are append-only.
CREATE OR REPLACE FUNCTION assurance_contractor_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'CA001';
END;
$$;

DROP TRIGGER IF EXISTS trg_assurance_requirements_no_delete ON assurance_requirements;
CREATE TRIGGER trg_assurance_requirements_no_delete
BEFORE DELETE ON assurance_requirements FOR EACH ROW EXECUTE FUNCTION assurance_contractor_no_delete();
DROP TRIGGER IF EXISTS trg_assurance_requirements_update_guard ON assurance_requirements;
CREATE TRIGGER trg_assurance_requirements_update_guard
BEFORE UPDATE ON assurance_requirements FOR EACH ROW
EXECUTE FUNCTION assurance_contractor_update_guard('id,organisation_id,requirement_code,created_by,created_at');

DROP TRIGGER IF EXISTS trg_assurance_ext_org_scopes_no_delete ON assurance_external_organisation_scopes;
CREATE TRIGGER trg_assurance_ext_org_scopes_no_delete
BEFORE DELETE ON assurance_external_organisation_scopes FOR EACH ROW EXECUTE FUNCTION assurance_contractor_no_delete();
DROP TRIGGER IF EXISTS trg_assurance_ext_org_scopes_update_guard ON assurance_external_organisation_scopes;
CREATE TRIGGER trg_assurance_ext_org_scopes_update_guard
BEFORE UPDATE ON assurance_external_organisation_scopes FOR EACH ROW
EXECUTE FUNCTION assurance_contractor_update_guard('id,organisation_id,external_organisation_id,created_by,created_at');

DROP TRIGGER IF EXISTS trg_assurance_req_assignments_no_delete ON assurance_requirement_assignments;
CREATE TRIGGER trg_assurance_req_assignments_no_delete
BEFORE DELETE ON assurance_requirement_assignments FOR EACH ROW EXECUTE FUNCTION assurance_contractor_no_delete();
DROP TRIGGER IF EXISTS trg_assurance_req_assignments_update_guard ON assurance_requirement_assignments;
CREATE TRIGGER trg_assurance_req_assignments_update_guard
BEFORE UPDATE ON assurance_requirement_assignments FOR EACH ROW
EXECUTE FUNCTION assurance_contractor_update_guard('id,organisation_id,external_organisation_id,requirement_id,created_by,created_at');
DROP TRIGGER IF EXISTS trg_assurance_req_assignments_lifecycle ON assurance_requirement_assignments;
CREATE TRIGGER trg_assurance_req_assignments_lifecycle
BEFORE INSERT OR UPDATE ON assurance_requirement_assignments FOR EACH ROW EXECUTE FUNCTION assurance_requirement_assignment_guard();

DROP TRIGGER IF EXISTS trg_assurance_req_submissions_no_delete ON assurance_requirement_submissions;
CREATE TRIGGER trg_assurance_req_submissions_no_delete
BEFORE DELETE ON assurance_requirement_submissions FOR EACH ROW EXECUTE FUNCTION assurance_contractor_no_delete();
DROP TRIGGER IF EXISTS trg_assurance_req_submissions_lifecycle ON assurance_requirement_submissions;
CREATE TRIGGER trg_assurance_req_submissions_lifecycle
BEFORE INSERT OR UPDATE ON assurance_requirement_submissions FOR EACH ROW EXECUTE FUNCTION assurance_requirement_submission_guard();

DROP TRIGGER IF EXISTS trg_assurance_req_assignment_findings_append_only ON assurance_requirement_assignment_findings;
CREATE TRIGGER trg_assurance_req_assignment_findings_append_only
BEFORE UPDATE OR DELETE ON assurance_requirement_assignment_findings FOR EACH ROW EXECUTE FUNCTION assurance_contractor_append_only();

-- ============================================================================
-- POST-CONDITIONS
-- ============================================================================
DO $$
DECLARE
  missing text;
  wrong_delete integer;
  trigger_count integer;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
  FROM (VALUES ('assurance_requirements'), ('assurance_external_organisation_scopes'), ('assurance_requirement_assignments'),
               ('assurance_requirement_submissions'), ('assurance_requirement_assignment_findings')) AS x(t)
  WHERE to_regclass('public.' || x.t) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'A0.1G post-condition failed: missing tables: %', missing;
  END IF;

  SELECT count(*) INTO wrong_delete FROM pg_constraint c
  WHERE c.contype = 'f' AND c.confdeltype <> 'a'
    AND c.conrelid::regclass::text IN ('assurance_requirements','assurance_external_organisation_scopes','assurance_requirement_assignments',
                                       'assurance_requirement_submissions','assurance_requirement_assignment_findings');
  IF wrong_delete <> 0 THEN
    RAISE EXCEPTION 'A0.1G post-condition failed: % foreign keys are not ON DELETE NO ACTION', wrong_delete;
  END IF;

  SELECT count(*) INTO trigger_count FROM pg_trigger
  WHERE NOT tgisinternal AND tgname IN (
    'trg_assurance_requirements_no_delete','trg_assurance_requirements_update_guard',
    'trg_assurance_ext_org_scopes_no_delete','trg_assurance_ext_org_scopes_update_guard',
    'trg_assurance_req_assignments_no_delete','trg_assurance_req_assignments_update_guard','trg_assurance_req_assignments_lifecycle',
    'trg_assurance_req_submissions_no_delete','trg_assurance_req_submissions_lifecycle',
    'trg_assurance_req_assignment_findings_append_only');
  IF trigger_count <> 10 THEN
    RAISE EXCEPTION 'A0.1G post-condition failed: expected 10 guard triggers, found %', trigger_count;
  END IF;
END $$;

SELECT
  (SELECT count(*) FROM assurance_requirements) AS requirements,
  (SELECT count(*) FROM assurance_external_organisation_scopes) AS scopes,
  (SELECT count(*) FROM assurance_requirement_assignments) AS assignments,
  (SELECT count(*) FROM assurance_requirement_submissions) AS submissions,
  (SELECT count(*) FROM assurance_requirement_assignment_findings) AS finding_links;

COMMIT;
