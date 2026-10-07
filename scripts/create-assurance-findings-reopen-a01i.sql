-- BrainBase Assurance A0.1I — Finding provenance, closure reason and reopen history.
-- DRAFT ONLY. DO NOT APPLY TO PRODUCTION UNTIL static review + disposable
-- PostgreSQL proof + isolated Neon behavioural proof + Production preflight
-- have passed and the Production handoff is explicitly approved.
--
-- Additive. Requires A0.1C (findings), A0.1D-1/2/3 and A0.1E-1 (source link
-- tables and response rows) and A0.1H (the generic link identity guard,
-- reused here unchanged).
--   assurance_inspection_findings  + item_key      (FK to the response row)
--   assurance_audit_findings       + criterion_key (FK to the response row)
--   assurance_findings             + closure_reason
--   assurance_finding_reopenings   (new, append-only)
--
-- Rules enforced in the database (error codes):
--   CE001 source link retargeted (reused A0.1H guard)
--   CF001 lifecycle / immutability violation
--   CF002 precondition (closure reason, reopening record)
--   * Source provenance: once a Finding is linked to an Incident,
--     Investigation, Inspection or Audit, no column of that link row can
--     change. Inspection item / audit criterion context is a structured FK to
--     the response row of the SAME inspection / audit in the SAME organisation.
--     Existing links keep NULL context (it was never captured structurally).
--   * Closure reason: every NEW transition into CLOSED or CANCELLED (and any
--     new row inserted as terminal) must carry a non-blank closure_reason.
--     Legacy terminal rows closed before A0.1I keep NULL — no reason is
--     fabricated. A terminal row's closure record (reason, closed_at,
--     closed_by) is never rewritten while it stays terminal.
--   * Reopen: CLOSED -> UNDER_REVIEW only, and only in the same transaction
--     as an assurance_finding_reopenings row that preserves the previous
--     status / closed_at / closed_by / closure_reason. The reopening insert
--     locks the Finding, so concurrent reopens serialise and exactly one wins.
--     CANCELLED is terminal. No other exit from CLOSED exists.
--   * Reopening history is append-only (UPDATE and DELETE refused).
--   * The database propagates nothing: reopening touches no Action,
--     verification, evidence, source record, timeframe or risk.
--
-- Compatibility: closure_reason is nullable and only required on NEW
-- terminal transitions. The currently deployed application closes or
-- cancels Findings without a reason, so once A0.1I is applied those two
-- transitions are refused (CF002) until the A0.1I feature is deployed.
-- Every other deployed write (create, link, non-terminal transitions,
-- Actions) is unaffected. Production holds 0 Findings at the time of writing.
--
-- Rollback: scripts/rollback-assurance-findings-reopen-a01i.sql —
-- DESTRUCTIVE once used (drops every closure reason, the whole reopening
-- history and all structured item / criterion provenance; Findings, source
-- links and audit rows remain).

BEGIN;

-- ============================================================================
-- PRE-FLIGHT
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.assurance_findings') IS NULL THEN
    RAISE EXCEPTION 'A0.1I preflight failed: A0.1C assurance_findings missing';
  END IF;
  IF to_regclass('public.assurance_incident_findings') IS NULL OR to_regclass('public.assurance_investigation_findings') IS NULL
     OR to_regclass('public.assurance_inspection_findings') IS NULL OR to_regclass('public.assurance_audit_findings') IS NULL THEN
    RAISE EXCEPTION 'A0.1I preflight failed: source finding link tables missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.assurance_inspection_responses'::regclass
                 AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (organisation_id, inspection_id, item_key)') THEN
    RAISE EXCEPTION 'A0.1I preflight failed: inspection responses lack UNIQUE (organisation_id, inspection_id, item_key)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.assurance_audit_responses'::regclass
                 AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (organisation_id, audit_id, criterion_key)') THEN
    RAISE EXCEPTION 'A0.1I preflight failed: audit responses lack UNIQUE (organisation_id, audit_id, criterion_key)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.assurance_findings'::regclass
                 AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (organisation_id, id)') THEN
    RAISE EXCEPTION 'A0.1I preflight failed: assurance_findings lacks its (organisation_id, id) tenant anchor';
  END IF;
  IF to_regprocedure('public.assurance_evidence_link_identity_guard()') IS NULL THEN
    RAISE EXCEPTION 'A0.1I preflight failed: A0.1H assurance_evidence_link_identity_guard missing';
  END IF;
END $$;

-- ============================================================================
-- 1. Structured source provenance
-- ============================================================================
ALTER TABLE assurance_inspection_findings ADD COLUMN IF NOT EXISTS item_key TEXT;
ALTER TABLE assurance_audit_findings ADD COLUMN IF NOT EXISTS criterion_key TEXT;

-- ============================================================================
-- 2. Closure reason
-- ============================================================================
ALTER TABLE assurance_findings ADD COLUMN IF NOT EXISTS closure_reason TEXT;

-- ============================================================================
-- 3. Reopening history
-- ============================================================================
CREATE TABLE IF NOT EXISTS assurance_finding_reopenings (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          TEXT        NOT NULL,
  finding_id               UUID        NOT NULL,
  reopen_number            INTEGER     NOT NULL,
  previous_status          TEXT        NOT NULL,
  previous_closed_at       TIMESTAMPTZ NOT NULL,
  previous_closed_by       TEXT,
  previous_closure_reason  TEXT,
  reason                   TEXT        NOT NULL,
  reopened_by              TEXT        NOT NULL,
  reopened_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assurance_finding_reopenings_organisation_id_fkey
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_finding_reopenings_finding_org_fkey
    FOREIGN KEY (organisation_id, finding_id) REFERENCES assurance_findings (organisation_id, id) ON DELETE NO ACTION,
  CONSTRAINT assurance_finding_reopenings_previous_closed_by_fkey
    FOREIGN KEY (previous_closed_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_finding_reopenings_reopened_by_fkey
    FOREIGN KEY (reopened_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT assurance_finding_reopenings_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT assurance_finding_reopenings_number_key
    UNIQUE (organisation_id, finding_id, reopen_number),
  CONSTRAINT assurance_finding_reopenings_number_check
    CHECK (reopen_number > 0),
  CONSTRAINT assurance_finding_reopenings_previous_status_check
    CHECK (previous_status = 'CLOSED'),
  CONSTRAINT assurance_finding_reopenings_reason_not_blank_check
    CHECK (btrim(reason) <> ''),
  CONSTRAINT assurance_finding_reopenings_previous_reason_not_blank_check
    CHECK (previous_closure_reason IS NULL OR btrim(previous_closure_reason) <> '')
);

CREATE INDEX IF NOT EXISTS idx_assurance_finding_reopenings_org_finding
  ON assurance_finding_reopenings (organisation_id, finding_id);

-- ============================================================================
-- 4. Constraints on existing tables (idempotent)
-- ============================================================================
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('assurance_inspection_findings', 'assurance_inspection_findings_item_fkey',
     $c$FOREIGN KEY (organisation_id, inspection_id, item_key) REFERENCES assurance_inspection_responses (organisation_id, inspection_id, item_key) ON DELETE NO ACTION$c$),
    ('assurance_inspection_findings', 'assurance_inspection_findings_item_key_not_blank_check',
     $c$CHECK (item_key IS NULL OR btrim(item_key) <> '')$c$),
    ('assurance_audit_findings', 'assurance_audit_findings_criterion_fkey',
     $c$FOREIGN KEY (organisation_id, audit_id, criterion_key) REFERENCES assurance_audit_responses (organisation_id, audit_id, criterion_key) ON DELETE NO ACTION$c$),
    ('assurance_audit_findings', 'assurance_audit_findings_criterion_key_not_blank_check',
     $c$CHECK (criterion_key IS NULL OR btrim(criterion_key) <> '')$c$),
    ('assurance_findings', 'assurance_findings_closure_reason_not_blank_check',
     $c$CHECK (closure_reason IS NULL OR btrim(closure_reason) <> '')$c$),
    ('assurance_findings', 'assurance_findings_closure_reason_terminal_check',
     $c$CHECK (closure_reason IS NULL OR status IN ('CLOSED', 'CANCELLED'))$c$)
  ) AS t(tbl, name, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name AND conrelid = ('public.' || c.tbl)::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', c.tbl, c.name, c.def);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- 5. Guard functions
-- ============================================================================

-- Finding lifecycle: closure reason on every new terminal transition, frozen
-- closure record, CLOSED -> UNDER_REVIEW only with a reopening record,
-- CANCELLED terminal.
CREATE OR REPLACE FUNCTION assurance_finding_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('CLOSED', 'CANCELLED') AND (NEW.closure_reason IS NULL OR btrim(NEW.closure_reason) = '') THEN
      RAISE EXCEPTION 'A finding cannot be recorded as % without a closure reason', NEW.status USING ERRCODE = 'CF002';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('CLOSED', 'CANCELLED')
       AND (NEW.closure_reason IS DISTINCT FROM OLD.closure_reason
            OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
            OR NEW.closed_by IS DISTINCT FROM OLD.closed_by) THEN
      RAISE EXCEPTION 'The closure record of a % finding cannot be rewritten', OLD.status USING ERRCODE = 'CF001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'A cancelled finding cannot change status' USING ERRCODE = 'CF001';
  END IF;

  IF OLD.status = 'CLOSED' THEN
    IF NEW.status <> 'UNDER_REVIEW' THEN
      RAISE EXCEPTION 'A closed finding can only be reopened to UNDER_REVIEW' USING ERRCODE = 'CF001';
    END IF;
    IF NEW.closed_by IS NOT NULL OR NEW.closure_reason IS NOT NULL THEN
      RAISE EXCEPTION 'A reopened finding must clear its closure record' USING ERRCODE = 'CF001';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM assurance_finding_reopenings r
      WHERE r.organisation_id = OLD.organisation_id AND r.finding_id = OLD.id
        AND r.reopened_at = now()
        AND r.previous_closed_at = OLD.closed_at
        AND r.previous_closed_by IS NOT DISTINCT FROM OLD.closed_by
        AND r.previous_closure_reason IS NOT DISTINCT FROM OLD.closure_reason) THEN
      RAISE EXCEPTION 'A closed finding can only be reopened together with its reopening record' USING ERRCODE = 'CF002';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('CLOSED', 'CANCELLED') AND (NEW.closure_reason IS NULL OR btrim(NEW.closure_reason) = '') THEN
    RAISE EXCEPTION 'A closure reason is required to move a finding to %', NEW.status USING ERRCODE = 'CF002';
  END IF;
  RETURN NEW;
END;
$$;

-- Reopening insert: the Finding is locked, must be CLOSED right now, the
-- previous_* columns must be its current closure record and the number must
-- be the next one. reopened_at is always the transaction time.
CREATE OR REPLACE FUNCTION assurance_finding_reopening_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  f record;
  next_number integer;
BEGIN
  SELECT status, closed_at, closed_by, closure_reason INTO f
  FROM assurance_findings
  WHERE organisation_id = NEW.organisation_id AND id = NEW.finding_id
  FOR UPDATE;
  IF NOT FOUND OR f.status <> 'CLOSED' THEN
    RAISE EXCEPTION 'Only a closed finding can be reopened' USING ERRCODE = 'CF002';
  END IF;
  IF NEW.previous_status IS DISTINCT FROM f.status
     OR NEW.previous_closed_at IS DISTINCT FROM f.closed_at
     OR NEW.previous_closed_by IS DISTINCT FROM f.closed_by
     OR NEW.previous_closure_reason IS DISTINCT FROM f.closure_reason THEN
    RAISE EXCEPTION 'A reopening record must preserve the current closure record' USING ERRCODE = 'CF002';
  END IF;
  SELECT coalesce(max(reopen_number), 0) + 1 INTO next_number
  FROM assurance_finding_reopenings
  WHERE organisation_id = NEW.organisation_id AND finding_id = NEW.finding_id;
  IF NEW.reopen_number IS DISTINCT FROM next_number THEN
    RAISE EXCEPTION 'Reopen number must be %', next_number USING ERRCODE = 'CF002';
  END IF;
  NEW.reopened_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION assurance_finding_reopening_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Finding reopening history is append-only (% refused)', TG_OP USING ERRCODE = 'CF001';
END;
$$;

-- ============================================================================
-- 6. Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS trg_assurance_findings_lifecycle ON assurance_findings;
CREATE TRIGGER trg_assurance_findings_lifecycle
BEFORE INSERT OR UPDATE ON assurance_findings FOR EACH ROW
EXECUTE FUNCTION assurance_finding_lifecycle_guard();

DROP TRIGGER IF EXISTS trg_assurance_finding_reopenings_insert ON assurance_finding_reopenings;
CREATE TRIGGER trg_assurance_finding_reopenings_insert
BEFORE INSERT ON assurance_finding_reopenings FOR EACH ROW
EXECUTE FUNCTION assurance_finding_reopening_insert_guard();

DROP TRIGGER IF EXISTS trg_assurance_finding_reopenings_append_only ON assurance_finding_reopenings;
CREATE TRIGGER trg_assurance_finding_reopenings_append_only
BEFORE UPDATE OR DELETE ON assurance_finding_reopenings FOR EACH ROW
EXECUTE FUNCTION assurance_finding_reopening_append_only();

DROP TRIGGER IF EXISTS trg_assurance_incident_findings_identity ON assurance_incident_findings;
CREATE TRIGGER trg_assurance_incident_findings_identity
BEFORE UPDATE ON assurance_incident_findings FOR EACH ROW
EXECUTE FUNCTION assurance_evidence_link_identity_guard('id,organisation_id,incident_id,finding_id,created_by,created_at');

DROP TRIGGER IF EXISTS trg_assurance_investigation_findings_identity ON assurance_investigation_findings;
CREATE TRIGGER trg_assurance_investigation_findings_identity
BEFORE UPDATE ON assurance_investigation_findings FOR EACH ROW
EXECUTE FUNCTION assurance_evidence_link_identity_guard('id,organisation_id,investigation_id,finding_id,created_by,created_at');

DROP TRIGGER IF EXISTS trg_assurance_inspection_findings_identity ON assurance_inspection_findings;
CREATE TRIGGER trg_assurance_inspection_findings_identity
BEFORE UPDATE ON assurance_inspection_findings FOR EACH ROW
EXECUTE FUNCTION assurance_evidence_link_identity_guard('id,organisation_id,inspection_id,finding_id,item_key,created_by,created_at');

DROP TRIGGER IF EXISTS trg_assurance_audit_findings_identity ON assurance_audit_findings;
CREATE TRIGGER trg_assurance_audit_findings_identity
BEFORE UPDATE ON assurance_audit_findings FOR EACH ROW
EXECUTE FUNCTION assurance_evidence_link_identity_guard('id,organisation_id,audit_id,finding_id,criterion_key,created_by,created_at');

-- ============================================================================
-- POST-CONDITIONS
-- ============================================================================
DO $$
DECLARE
  trigger_count integer;
  wrong_delete integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'assurance_inspection_findings' AND column_name = 'item_key')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'assurance_audit_findings' AND column_name = 'criterion_key')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'assurance_findings' AND column_name = 'closure_reason') THEN
    RAISE EXCEPTION 'A0.1I post-condition failed: provenance / closure reason columns missing';
  END IF;
  IF to_regclass('public.assurance_finding_reopenings') IS NULL THEN
    RAISE EXCEPTION 'A0.1I post-condition failed: assurance_finding_reopenings missing';
  END IF;
  SELECT count(*) INTO wrong_delete FROM pg_constraint
  WHERE contype = 'f' AND confdeltype <> 'a' AND conname IN (
    'assurance_inspection_findings_item_fkey','assurance_audit_findings_criterion_fkey',
    'assurance_finding_reopenings_organisation_id_fkey','assurance_finding_reopenings_finding_org_fkey',
    'assurance_finding_reopenings_previous_closed_by_fkey','assurance_finding_reopenings_reopened_by_fkey');
  IF wrong_delete <> 0 THEN
    RAISE EXCEPTION 'A0.1I post-condition failed: % foreign keys are not ON DELETE NO ACTION', wrong_delete;
  END IF;
  SELECT count(*) INTO trigger_count FROM pg_trigger
  WHERE NOT tgisinternal AND tgenabled = 'O' AND tgname IN (
    'trg_assurance_findings_lifecycle','trg_assurance_finding_reopenings_insert',
    'trg_assurance_finding_reopenings_append_only','trg_assurance_incident_findings_identity',
    'trg_assurance_investigation_findings_identity','trg_assurance_inspection_findings_identity',
    'trg_assurance_audit_findings_identity');
  IF trigger_count <> 7 THEN
    RAISE EXCEPTION 'A0.1I post-condition failed: expected 7 enabled guard triggers, found %', trigger_count;
  END IF;
END $$;

SELECT
  (SELECT count(*) FROM assurance_findings) AS findings,
  (SELECT count(*) FROM assurance_findings WHERE status IN ('CLOSED', 'CANCELLED') AND closure_reason IS NULL) AS legacy_terminal_without_reason,
  (SELECT count(*) FROM assurance_finding_reopenings) AS reopenings;

COMMIT;
