-- BrainBase Assurance A0.1H — Evidence verification, replacement and item context.
-- DRAFT ONLY. DO NOT APPLY TO PRODUCTION UNTIL static review + disposable
-- PostgreSQL proof + isolated Neon behavioural proof + Production preflight
-- have passed and the Production handoff is explicitly approved.
--
-- Additive. Requires A0.1C (evidence), A0.1D-3 (inspections), A0.1E-1
-- (audits) and A0.1G (contractor submissions).
--   assurance_evidence              + verification lifecycle, decision,
--                                     replacement chain, supplier, lock_version
--   assurance_evidence_inspections  + item_key      (FK to the response row)
--   assurance_evidence_audits       + criterion_key (FK to the response row)
--
-- Rules enforced in the database (error codes):
--   CE001 lifecycle / immutability violation
--   CE002 precondition (replacement target, contractor authority, chain head)
--   CE003 stale write (lock_version must advance by exactly one)
--   * Lifecycle: UNVERIFIED <-> AWAITING_VERIFICATION -> ACCEPTED | REJECTED;
--     ACCEPTED -> SUPERSEDED only when its replacement is accepted.
--     REJECTED and SUPERSEDED are terminal; one terminal decision per row.
--   * The decider is never the person who recorded (created_by) or captured
--     (captured_by) the evidence. That is the independence the identity model
--     can prove; nothing stronger is claimed (an external supplier has no
--     individual identity here).
--   * Correction: descriptive content may change only while UNVERIFIED or
--     AWAITING_VERIFICATION. After a decision it is frozen; record a
--     replacement instead.
--   * Replacement (replaces_evidence_id, immutable): the predecessor must be
--     ACCEPTED or REJECTED and must be the chain head — every other row in its
--     replacement tree is REJECTED or SUPERSEDED. The tree root is locked, so
--     concurrent replacements serialise and at most one live (unverified,
--     awaiting or accepted) row exists per chain besides an accepted head.
--     Accepting a replacement supersedes an ACCEPTED predecessor in the same
--     statement; a REJECTED predecessor stays REJECTED; a rejected
--     replacement never changes its predecessor.
--   * Contractor authority: evidence referenced by a Contractor Assurance
--     submission is decided ONLY in Contractor Assurance. The generic
--     lifecycle refuses any change to it, it cannot be replaced generically,
--     and a submission can only reference untouched (UNVERIFIED, unchained)
--     evidence.
--   * No hard deletes of evidence.
--   * Item / criterion context on inspection and audit evidence links is a
--     structured FK to the response row and is fixed once the link exists
--     (soft unlink via removed_* still works).
--
-- Compatibility: every new column has a default or is nullable, and nothing
-- in the currently deployed application updates or deletes assurance_evidence,
-- so applying this before deploying the feature is safe.
--
-- Rollback: scripts/rollback-assurance-evidence-verification-a01h.sql —
-- DESTRUCTIVE once used (drops every evidence decision, replacement chain and
-- item context; evidence rows, links and audit rows remain).

BEGIN;

-- ============================================================================
-- PRE-FLIGHT
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.assurance_evidence') IS NULL OR to_regclass('public.assurance_evidence_inspections') IS NULL
     OR to_regclass('public.assurance_evidence_audits') IS NULL THEN
    RAISE EXCEPTION 'A0.1H preflight failed: A0.1C evidence tables missing';
  END IF;
  IF to_regclass('public.assurance_inspection_responses') IS NULL OR to_regclass('public.assurance_audit_responses') IS NULL THEN
    RAISE EXCEPTION 'A0.1H preflight failed: A0.1D-3 / A0.1E-1 response tables missing';
  END IF;
  IF to_regclass('public.assurance_requirement_submissions') IS NULL THEN
    RAISE EXCEPTION 'A0.1H preflight failed: A0.1G contractor submissions missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.assurance_inspection_responses'::regclass
                 AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (organisation_id, inspection_id, item_key)') THEN
    RAISE EXCEPTION 'A0.1H preflight failed: inspection responses lack UNIQUE (organisation_id, inspection_id, item_key)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.assurance_audit_responses'::regclass
                 AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (organisation_id, audit_id, criterion_key)') THEN
    RAISE EXCEPTION 'A0.1H preflight failed: audit responses lack UNIQUE (organisation_id, audit_id, criterion_key)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.external_organisations'::regclass
                 AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (organisation_id, id)') THEN
    RAISE EXCEPTION 'A0.1H preflight failed: external_organisations lacks its (organisation_id, id) tenant anchor';
  END IF;
END $$;

-- ============================================================================
-- 1. assurance_evidence — lifecycle, decision, replacement, supplier, version
-- ============================================================================
ALTER TABLE assurance_evidence
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS verification_requested_by TEXT,
  ADD COLUMN IF NOT EXISTS verification_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decided_by TEXT,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_reason TEXT,
  ADD COLUMN IF NOT EXISTS replaces_evidence_id UUID,
  ADD COLUMN IF NOT EXISTS superseded_by_evidence_id UUID,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS supplied_by_external_organisation_id UUID,
  ADD COLUMN IF NOT EXISTS lock_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE assurance_evidence_inspections ADD COLUMN IF NOT EXISTS item_key TEXT;
ALTER TABLE assurance_evidence_audits ADD COLUMN IF NOT EXISTS criterion_key TEXT;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('assurance_evidence', 'assurance_evidence_verification_status_check',
     $c$CHECK (verification_status IN ('UNVERIFIED','AWAITING_VERIFICATION','ACCEPTED','REJECTED','SUPERSEDED'))$c$),
    ('assurance_evidence', 'assurance_evidence_verification_state_check',
     $c$CHECK (
       (verification_status = 'UNVERIFIED'
          AND verification_requested_by IS NULL AND verification_requested_at IS NULL
          AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL
          AND superseded_by_evidence_id IS NULL AND superseded_at IS NULL)
       OR (verification_status = 'AWAITING_VERIFICATION'
          AND verification_requested_by IS NOT NULL AND verification_requested_at IS NOT NULL
          AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL
          AND superseded_by_evidence_id IS NULL AND superseded_at IS NULL)
       OR (verification_status = 'ACCEPTED'
          AND decided_by IS NOT NULL AND decided_at IS NOT NULL
          AND superseded_by_evidence_id IS NULL AND superseded_at IS NULL)
       OR (verification_status = 'REJECTED'
          AND decided_by IS NOT NULL AND decided_at IS NOT NULL
          AND decision_reason IS NOT NULL
          AND superseded_by_evidence_id IS NULL AND superseded_at IS NULL)
       OR (verification_status = 'SUPERSEDED'
          AND decided_by IS NOT NULL AND decided_at IS NOT NULL
          AND superseded_by_evidence_id IS NOT NULL AND superseded_at IS NOT NULL))$c$),
    ('assurance_evidence', 'assurance_evidence_independent_decision_check',
     $c$CHECK (verification_status NOT IN ('ACCEPTED','REJECTED','SUPERSEDED')
       OR (decided_by IS DISTINCT FROM created_by AND decided_by IS DISTINCT FROM captured_by))$c$),
    ('assurance_evidence', 'assurance_evidence_decision_reason_not_blank_check',
     $c$CHECK (decision_reason IS NULL OR btrim(decision_reason) <> '')$c$),
    ('assurance_evidence', 'assurance_evidence_not_self_replacing_check',
     $c$CHECK (replaces_evidence_id IS NULL OR replaces_evidence_id <> id)$c$),
    ('assurance_evidence', 'assurance_evidence_not_self_superseded_check',
     $c$CHECK (superseded_by_evidence_id IS NULL OR superseded_by_evidence_id <> id)$c$),
    ('assurance_evidence', 'assurance_evidence_lock_version_check',
     $c$CHECK (lock_version > 0)$c$),
    ('assurance_evidence', 'assurance_evidence_requested_by_fkey',
     $c$FOREIGN KEY (verification_requested_by) REFERENCES users(id) ON DELETE NO ACTION$c$),
    ('assurance_evidence', 'assurance_evidence_decided_by_fkey',
     $c$FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE NO ACTION$c$),
    ('assurance_evidence', 'assurance_evidence_replaces_fkey',
     $c$FOREIGN KEY (organisation_id, replaces_evidence_id) REFERENCES assurance_evidence (organisation_id, id) ON DELETE NO ACTION$c$),
    ('assurance_evidence', 'assurance_evidence_superseded_by_fkey',
     $c$FOREIGN KEY (organisation_id, superseded_by_evidence_id) REFERENCES assurance_evidence (organisation_id, id) ON DELETE NO ACTION$c$),
    ('assurance_evidence', 'assurance_evidence_supplier_fkey',
     $c$FOREIGN KEY (organisation_id, supplied_by_external_organisation_id) REFERENCES external_organisations (organisation_id, id) ON DELETE NO ACTION$c$),
    ('assurance_evidence_inspections', 'assurance_evidence_inspections_item_fkey',
     $c$FOREIGN KEY (organisation_id, inspection_id, item_key) REFERENCES assurance_inspection_responses (organisation_id, inspection_id, item_key) ON DELETE NO ACTION$c$),
    ('assurance_evidence_inspections', 'assurance_evidence_inspections_item_key_not_blank_check',
     $c$CHECK (item_key IS NULL OR btrim(item_key) <> '')$c$),
    ('assurance_evidence_audits', 'assurance_evidence_audits_criterion_fkey',
     $c$FOREIGN KEY (organisation_id, audit_id, criterion_key) REFERENCES assurance_audit_responses (organisation_id, audit_id, criterion_key) ON DELETE NO ACTION$c$),
    ('assurance_evidence_audits', 'assurance_evidence_audits_criterion_key_not_blank_check',
     $c$CHECK (criterion_key IS NULL OR btrim(criterion_key) <> '')$c$)
  ) AS t(tbl, name, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name AND conrelid = ('public.' || c.tbl)::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', c.tbl, c.name, c.def);
    END IF;
  END LOOP;
END $$;

-- At most one non-rejected successor per predecessor (defence in depth for
-- the chain-head rule below).
CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_evidence_one_live_replacement
  ON assurance_evidence (organisation_id, replaces_evidence_id)
  WHERE replaces_evidence_id IS NOT NULL AND verification_status <> 'REJECTED';

-- The verification queue.
CREATE INDEX IF NOT EXISTS idx_assurance_evidence_awaiting_verification
  ON assurance_evidence (organisation_id, verification_requested_at)
  WHERE verification_status = 'AWAITING_VERIFICATION';

CREATE INDEX IF NOT EXISTS idx_assurance_evidence_org_status
  ON assurance_evidence (organisation_id, verification_status);

-- ============================================================================
-- 2. Guard functions
-- ============================================================================

CREATE OR REPLACE FUNCTION assurance_evidence_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  identity_cols text[] := ARRAY['id','organisation_id','evidence_reference','created_by','created_at','replaces_evidence_id'];
  content_cols text[] := ARRAY['evidence_type','title','description','captured_by','captured_at','location_id','metadata',
    'supplied_by_external_organisation_id'];
  col text;
  content_changed boolean := false;
  root_id uuid;
  parent_id uuid;
  depth integer := 0;
  pred_status text;
  other_live integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.verification_status NOT IN ('UNVERIFIED','AWAITING_VERIFICATION') THEN
      RAISE EXCEPTION 'Evidence is recorded as UNVERIFIED or AWAITING_VERIFICATION' USING ERRCODE = 'CE001';
    END IF;
    IF NEW.lock_version <> 1 THEN
      RAISE EXCEPTION 'New evidence starts at lock_version 1' USING ERRCODE = 'CE001';
    END IF;
    IF NEW.replaces_evidence_id IS NOT NULL THEN
      -- Walk to the root of the replacement tree and lock it: every
      -- replacement in one tree serialises on that row.
      root_id := NEW.replaces_evidence_id;
      LOOP
        SELECT e.replaces_evidence_id INTO parent_id FROM assurance_evidence e
         WHERE e.organisation_id = NEW.organisation_id AND e.id = root_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'The evidence being replaced was not found' USING ERRCODE = 'CE002';
        END IF;
        EXIT WHEN parent_id IS NULL;
        root_id := parent_id;
        depth := depth + 1;
        IF depth > 1000 THEN
          RAISE EXCEPTION 'Replacement chain is too long' USING ERRCODE = 'CE002';
        END IF;
      END LOOP;
      PERFORM 1 FROM assurance_evidence WHERE organisation_id = NEW.organisation_id AND id = root_id FOR UPDATE;
      SELECT e.verification_status INTO pred_status FROM assurance_evidence e
       WHERE e.organisation_id = NEW.organisation_id AND e.id = NEW.replaces_evidence_id FOR UPDATE;
      IF pred_status NOT IN ('ACCEPTED','REJECTED') THEN
        RAISE EXCEPTION 'Only accepted or rejected evidence can be replaced (this evidence is %)', pred_status USING ERRCODE = 'CE002';
      END IF;
      IF EXISTS (SELECT 1 FROM assurance_requirement_submissions s
                 WHERE s.organisation_id = NEW.organisation_id AND s.evidence_id = NEW.replaces_evidence_id) THEN
        RAISE EXCEPTION 'Contractor assurance evidence is replaced in Contractor assurance' USING ERRCODE = 'CE002';
      END IF;
      WITH RECURSIVE tree AS (
        SELECT e.id, e.verification_status FROM assurance_evidence e
         WHERE e.organisation_id = NEW.organisation_id AND e.id = root_id
        UNION ALL
        SELECT c.id, c.verification_status FROM assurance_evidence c
          JOIN tree t ON c.replaces_evidence_id = t.id
         WHERE c.organisation_id = NEW.organisation_id
      )
      SELECT count(*) INTO other_live FROM tree
       WHERE id <> NEW.replaces_evidence_id
         AND verification_status IN ('UNVERIFIED','AWAITING_VERIFICATION','ACCEPTED');
      IF other_live > 0 THEN
        RAISE EXCEPTION 'This evidence is not the current evidence in its chain; replace the current evidence instead' USING ERRCODE = 'CE002';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE ------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM assurance_requirement_submissions s
             WHERE s.organisation_id = OLD.organisation_id AND s.evidence_id = OLD.id) THEN
    RAISE EXCEPTION 'Contractor assurance evidence is managed in Contractor assurance' USING ERRCODE = 'CE002';
  END IF;

  FOREACH col IN ARRAY identity_cols LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION 'Evidence identity (%) cannot change', col USING ERRCODE = 'CE001';
    END IF;
  END LOOP;

  FOREACH col IN ARRAY content_cols LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      content_changed := true;
    END IF;
  END LOOP;
  IF content_changed AND (OLD.verification_status NOT IN ('UNVERIFIED','AWAITING_VERIFICATION')
                          OR NEW.verification_status IS DISTINCT FROM OLD.verification_status) THEN
    RAISE EXCEPTION 'Evidence can only be corrected before a decision; record a replacement instead' USING ERRCODE = 'CE001';
  END IF;

  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    IF (OLD.verification_status = 'UNVERIFIED' AND NEW.verification_status = 'AWAITING_VERIFICATION')
       OR (OLD.verification_status = 'AWAITING_VERIFICATION' AND NEW.verification_status IN ('UNVERIFIED','ACCEPTED','REJECTED')) THEN
      NULL;
    ELSIF OLD.verification_status = 'ACCEPTED' AND NEW.verification_status = 'SUPERSEDED' THEN
      IF current_setting('assurance.evidence_superseding', true) IS DISTINCT FROM NEW.superseded_by_evidence_id::text THEN
        RAISE EXCEPTION 'Evidence is superseded only by accepting its replacement' USING ERRCODE = 'CE001';
      END IF;
      IF NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
         OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
         OR NEW.verification_requested_by IS DISTINCT FROM OLD.verification_requested_by
         OR NEW.verification_requested_at IS DISTINCT FROM OLD.verification_requested_at THEN
        RAISE EXCEPTION 'Superseding keeps the original decision' USING ERRCODE = 'CE001';
      END IF;
    ELSE
      RAISE EXCEPTION 'Evidence cannot move from % to %', OLD.verification_status, NEW.verification_status USING ERRCODE = 'CE001';
    END IF;
  ELSIF OLD.verification_status IN ('ACCEPTED','REJECTED','SUPERSEDED')
     AND ((to_jsonb(NEW) - 'updated_at' - 'lock_version') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'lock_version')) THEN
    RAISE EXCEPTION 'A decided evidence record cannot change' USING ERRCODE = 'CE001';
  END IF;

  IF NEW.lock_version IS DISTINCT FROM OLD.lock_version + 1 THEN
    RAISE EXCEPTION 'Evidence was changed by someone else' USING ERRCODE = 'CE003';
  END IF;
  NEW.updated_at := now();

  -- Accepting a replacement supersedes an ACCEPTED predecessor atomically.
  IF NEW.verification_status = 'ACCEPTED' AND OLD.verification_status = 'AWAITING_VERIFICATION'
     AND NEW.replaces_evidence_id IS NOT NULL THEN
    SELECT e.verification_status INTO pred_status FROM assurance_evidence e
     WHERE e.organisation_id = NEW.organisation_id AND e.id = NEW.replaces_evidence_id FOR UPDATE;
    IF pred_status = 'ACCEPTED' THEN
      PERFORM set_config('assurance.evidence_superseding', NEW.id::text, true);
      UPDATE assurance_evidence
         SET verification_status = 'SUPERSEDED', superseded_by_evidence_id = NEW.id, superseded_at = now(),
             lock_version = lock_version + 1
       WHERE organisation_id = NEW.organisation_id AND id = NEW.replaces_evidence_id;
      PERFORM set_config('assurance.evidence_superseding', '', true);
    ELSIF pred_status IS DISTINCT FROM 'REJECTED' THEN
      RAISE EXCEPTION 'The evidence being replaced is no longer current' USING ERRCODE = 'CE002';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION assurance_evidence_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Assurance evidence is never deleted' USING ERRCODE = 'CE001';
END;
$$;

-- Evidence link identity (including item / criterion context) is fixed once
-- the link exists; only the soft-unlink columns may change.
CREATE OR REPLACE FUNCTION assurance_evidence_link_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY string_to_array(TG_ARGV[0], ',') LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION '% link (%) cannot be retargeted', TG_TABLE_NAME, col USING ERRCODE = 'CE001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- A contractor submission may only reference untouched evidence, so the
-- generic lifecycle and Contractor Assurance never both own one row.
CREATE OR REPLACE FUNCTION assurance_submission_evidence_authority_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ev record;
BEGIN
  SELECT e.verification_status, e.replaces_evidence_id INTO ev FROM assurance_evidence e
   WHERE e.organisation_id = NEW.organisation_id AND e.id = NEW.evidence_id FOR SHARE;
  IF FOUND AND (ev.verification_status <> 'UNVERIFIED' OR ev.replaces_evidence_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM assurance_evidence c
                WHERE c.organisation_id = NEW.organisation_id AND c.replaces_evidence_id = NEW.evidence_id)) THEN
    RAISE EXCEPTION 'Evidence in the general verification lifecycle cannot be used for a contractor submission' USING ERRCODE = 'CE002';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 3. Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS trg_assurance_evidence_lifecycle ON assurance_evidence;
CREATE TRIGGER trg_assurance_evidence_lifecycle
BEFORE INSERT OR UPDATE ON assurance_evidence FOR EACH ROW EXECUTE FUNCTION assurance_evidence_lifecycle_guard();

DROP TRIGGER IF EXISTS trg_assurance_evidence_no_delete ON assurance_evidence;
CREATE TRIGGER trg_assurance_evidence_no_delete
BEFORE DELETE ON assurance_evidence FOR EACH ROW EXECUTE FUNCTION assurance_evidence_no_delete();

DROP TRIGGER IF EXISTS trg_assurance_evidence_inspections_identity ON assurance_evidence_inspections;
CREATE TRIGGER trg_assurance_evidence_inspections_identity
BEFORE UPDATE ON assurance_evidence_inspections FOR EACH ROW
EXECUTE FUNCTION assurance_evidence_link_identity_guard('id,organisation_id,evidence_id,inspection_id,item_key,purpose,created_by,created_at');

DROP TRIGGER IF EXISTS trg_assurance_evidence_audits_identity ON assurance_evidence_audits;
CREATE TRIGGER trg_assurance_evidence_audits_identity
BEFORE UPDATE ON assurance_evidence_audits FOR EACH ROW
EXECUTE FUNCTION assurance_evidence_link_identity_guard('id,organisation_id,evidence_id,audit_id,criterion_key,purpose,created_by,created_at');

DROP TRIGGER IF EXISTS trg_assurance_req_submissions_evidence_authority ON assurance_requirement_submissions;
CREATE TRIGGER trg_assurance_req_submissions_evidence_authority
BEFORE INSERT ON assurance_requirement_submissions FOR EACH ROW EXECUTE FUNCTION assurance_submission_evidence_authority_guard();

-- ============================================================================
-- POST-CONDITIONS
-- ============================================================================
DO $$
DECLARE
  missing text;
  trigger_count integer;
  wrong_delete integer;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(ARRAY['verification_status','verification_requested_by','verification_requested_at','decided_by','decided_at',
                    'decision_reason','replaces_evidence_id','superseded_by_evidence_id','superseded_at',
                    'supplied_by_external_organisation_id','lock_version']) AS c
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'assurance_evidence' AND column_name = c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'A0.1H post-condition failed: assurance_evidence is missing %', missing;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'assurance_evidence_inspections' AND column_name = 'item_key')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'assurance_evidence_audits' AND column_name = 'criterion_key') THEN
    RAISE EXCEPTION 'A0.1H post-condition failed: item / criterion context columns missing';
  END IF;
  SELECT count(*) INTO wrong_delete FROM pg_constraint
  WHERE contype = 'f' AND confdeltype <> 'a' AND conname IN (
    'assurance_evidence_requested_by_fkey','assurance_evidence_decided_by_fkey','assurance_evidence_replaces_fkey',
    'assurance_evidence_superseded_by_fkey','assurance_evidence_supplier_fkey',
    'assurance_evidence_inspections_item_fkey','assurance_evidence_audits_criterion_fkey');
  IF wrong_delete <> 0 THEN
    RAISE EXCEPTION 'A0.1H post-condition failed: % foreign keys are not ON DELETE NO ACTION', wrong_delete;
  END IF;
  SELECT count(*) INTO trigger_count FROM pg_trigger
  WHERE NOT tgisinternal AND tgenabled = 'O' AND tgname IN (
    'trg_assurance_evidence_lifecycle','trg_assurance_evidence_no_delete',
    'trg_assurance_evidence_inspections_identity','trg_assurance_evidence_audits_identity',
    'trg_assurance_req_submissions_evidence_authority');
  IF trigger_count <> 5 THEN
    RAISE EXCEPTION 'A0.1H post-condition failed: expected 5 enabled guard triggers, found %', trigger_count;
  END IF;
END $$;

SELECT
  (SELECT count(*) FROM assurance_evidence) AS evidence_rows,
  (SELECT count(*) FROM assurance_evidence WHERE verification_status <> 'UNVERIFIED') AS evidence_in_lifecycle;

COMMIT;
