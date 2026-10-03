-- Rollback for BrainBase Assurance A0.1I (finding provenance, closure reason,
-- reopen history).
--
-- DESTRUCTIVE once A0.1I has been used: it drops every Finding closure
-- reason, the whole reopening history (previous closure records and reopen
-- reasons) and all structured inspection item / audit criterion provenance.
-- Findings, source links and audit_logs rows remain (audit rows keep the
-- closure / reopen history as text). Take a branch / snapshot first and
-- confirm the loss is intended.
--
-- Must run BEFORE any A0.1H rollback: the four source-link identity triggers
-- reuse A0.1H's assurance_evidence_link_identity_guard, which this script
-- leaves in place.

BEGIN;

DROP TRIGGER IF EXISTS trg_assurance_audit_findings_identity ON assurance_audit_findings;
DROP TRIGGER IF EXISTS trg_assurance_inspection_findings_identity ON assurance_inspection_findings;
DROP TRIGGER IF EXISTS trg_assurance_investigation_findings_identity ON assurance_investigation_findings;
DROP TRIGGER IF EXISTS trg_assurance_incident_findings_identity ON assurance_incident_findings;
DROP TRIGGER IF EXISTS trg_assurance_findings_lifecycle ON assurance_findings;

DROP TABLE IF EXISTS assurance_finding_reopenings;

DROP FUNCTION IF EXISTS assurance_finding_reopening_append_only();
DROP FUNCTION IF EXISTS assurance_finding_reopening_insert_guard();
DROP FUNCTION IF EXISTS assurance_finding_lifecycle_guard();

ALTER TABLE assurance_findings
  DROP CONSTRAINT IF EXISTS assurance_findings_closure_reason_terminal_check,
  DROP CONSTRAINT IF EXISTS assurance_findings_closure_reason_not_blank_check,
  DROP COLUMN IF EXISTS closure_reason;

ALTER TABLE assurance_audit_findings
  DROP CONSTRAINT IF EXISTS assurance_audit_findings_criterion_fkey,
  DROP CONSTRAINT IF EXISTS assurance_audit_findings_criterion_key_not_blank_check,
  DROP COLUMN IF EXISTS criterion_key;

ALTER TABLE assurance_inspection_findings
  DROP CONSTRAINT IF EXISTS assurance_inspection_findings_item_fkey,
  DROP CONSTRAINT IF EXISTS assurance_inspection_findings_item_key_not_blank_check,
  DROP COLUMN IF EXISTS item_key;

COMMIT;
