-- Rollback for BrainBase Assurance A0.1H (evidence verification, replacement,
-- item context).
--
-- DESTRUCTIVE once A0.1H has been used: it drops every evidence decision
-- (verification status, requester, decider, reason), every replacement /
-- supersession chain, every supplier reference and every item / criterion
-- context on inspection and audit evidence links. Evidence rows, evidence
-- links and audit_logs rows remain (audit rows keep the decision history as
-- text). Take a branch / snapshot first and confirm the loss is intended.

BEGIN;

DROP TRIGGER IF EXISTS trg_assurance_req_submissions_evidence_authority ON assurance_requirement_submissions;
DROP TRIGGER IF EXISTS trg_assurance_evidence_audits_identity ON assurance_evidence_audits;
DROP TRIGGER IF EXISTS trg_assurance_evidence_inspections_identity ON assurance_evidence_inspections;
DROP TRIGGER IF EXISTS trg_assurance_evidence_no_delete ON assurance_evidence;
DROP TRIGGER IF EXISTS trg_assurance_evidence_lifecycle ON assurance_evidence;

DROP FUNCTION IF EXISTS assurance_submission_evidence_authority_guard();
DROP FUNCTION IF EXISTS assurance_evidence_link_identity_guard();
DROP FUNCTION IF EXISTS assurance_evidence_no_delete();
DROP FUNCTION IF EXISTS assurance_evidence_lifecycle_guard();

DROP INDEX IF EXISTS idx_assurance_evidence_org_status;
DROP INDEX IF EXISTS idx_assurance_evidence_awaiting_verification;
DROP INDEX IF EXISTS uq_assurance_evidence_one_live_replacement;

ALTER TABLE assurance_evidence_audits
  DROP CONSTRAINT IF EXISTS assurance_evidence_audits_criterion_fkey,
  DROP CONSTRAINT IF EXISTS assurance_evidence_audits_criterion_key_not_blank_check,
  DROP COLUMN IF EXISTS criterion_key;

ALTER TABLE assurance_evidence_inspections
  DROP CONSTRAINT IF EXISTS assurance_evidence_inspections_item_fkey,
  DROP CONSTRAINT IF EXISTS assurance_evidence_inspections_item_key_not_blank_check,
  DROP COLUMN IF EXISTS item_key;

ALTER TABLE assurance_evidence
  DROP CONSTRAINT IF EXISTS assurance_evidence_verification_status_check,
  DROP CONSTRAINT IF EXISTS assurance_evidence_verification_state_check,
  DROP CONSTRAINT IF EXISTS assurance_evidence_independent_decision_check,
  DROP CONSTRAINT IF EXISTS assurance_evidence_decision_reason_not_blank_check,
  DROP CONSTRAINT IF EXISTS assurance_evidence_not_self_replacing_check,
  DROP CONSTRAINT IF EXISTS assurance_evidence_not_self_superseded_check,
  DROP CONSTRAINT IF EXISTS assurance_evidence_lock_version_check,
  DROP CONSTRAINT IF EXISTS assurance_evidence_requested_by_fkey,
  DROP CONSTRAINT IF EXISTS assurance_evidence_decided_by_fkey,
  DROP CONSTRAINT IF EXISTS assurance_evidence_replaces_fkey,
  DROP CONSTRAINT IF EXISTS assurance_evidence_superseded_by_fkey,
  DROP CONSTRAINT IF EXISTS assurance_evidence_supplier_fkey,
  DROP COLUMN IF EXISTS lock_version,
  DROP COLUMN IF EXISTS supplied_by_external_organisation_id,
  DROP COLUMN IF EXISTS superseded_at,
  DROP COLUMN IF EXISTS superseded_by_evidence_id,
  DROP COLUMN IF EXISTS replaces_evidence_id,
  DROP COLUMN IF EXISTS decision_reason,
  DROP COLUMN IF EXISTS decided_at,
  DROP COLUMN IF EXISTS decided_by,
  DROP COLUMN IF EXISTS verification_requested_at,
  DROP COLUMN IF EXISTS verification_requested_by,
  DROP COLUMN IF EXISTS verification_status;

COMMIT;
