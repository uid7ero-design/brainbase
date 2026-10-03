-- BrainBase Assurance A0.1G — ROLLBACK of Contractor Assurance.
--
-- DESTRUCTIVE ONCE A0.1G HAS BEEN USED. This DROPS all Contractor Assurance
-- relational data: requirement library, Assurance scope records, requirement
-- assignments, evidence submissions with their decisions and requirement
-- snapshots, and explicit Finding links. It is NOT data-preserving.
--
-- Left in place (shared records A0.1G only referenced):
--   * assurance_evidence rows recorded through Contractor Assurance remain,
--     but lose their requirement / external organisation context;
--   * assurance_findings raised from an assignment remain (with their
--     responsible external organisation), but lose the assignment link;
--   * audit_logs rows remain (history of what happened).
--
-- Take a Neon branch snapshot before running this anywhere that holds real
-- data. Idempotent: safe to run twice, and safe where A0.1G never ran.

BEGIN;

DROP TABLE IF EXISTS assurance_requirement_assignment_findings;
DROP TABLE IF EXISTS assurance_requirement_submissions;
DROP TABLE IF EXISTS assurance_requirement_assignments;
DROP TABLE IF EXISTS assurance_external_organisation_scopes;
DROP TABLE IF EXISTS assurance_requirements;

DROP FUNCTION IF EXISTS assurance_requirement_submission_guard();
DROP FUNCTION IF EXISTS assurance_requirement_assignment_guard();
DROP FUNCTION IF EXISTS assurance_contractor_update_guard();
DROP FUNCTION IF EXISTS assurance_contractor_no_delete();
DROP FUNCTION IF EXISTS assurance_contractor_append_only();

DO $$
DECLARE leftover integer;
BEGIN
  SELECT count(*) INTO leftover FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN (
    'assurance_requirements','assurance_external_organisation_scopes','assurance_requirement_assignments',
    'assurance_requirement_submissions','assurance_requirement_assignment_findings');
  IF leftover <> 0 THEN
    RAISE EXCEPTION 'A0.1G rollback post-condition failed: % tables remain', leftover;
  END IF;
  SELECT count(*) INTO leftover FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname IN (
    'assurance_requirement_submission_guard','assurance_requirement_assignment_guard',
    'assurance_contractor_update_guard','assurance_contractor_no_delete','assurance_contractor_append_only');
  IF leftover <> 0 THEN
    RAISE EXCEPTION 'A0.1G rollback post-condition failed: % functions remain', leftover;
  END IF;
END $$;

COMMIT;
