-- BrainBase Assurance — remove the SYNTHETIC demo fixture. DISPOSABLE ENVIRONMENTS ONLY.
--
-- Deletes ONLY rows belonging to organisation 'assurance-demo-org' created by
-- scripts/assurance-demo/seed-assurance-demo.sql. Never run against Production.
--
-- Assurance history is deliberately hard to delete: verification history is
-- append-only and inspection/audit template versions are immutable (row
-- triggers reject UPDATE/DELETE). To remove the synthetic rows, this script
-- disables those three triggers for the duration of this ONE transaction and re-enables them
-- before COMMIT. ALTER TABLE takes an ACCESS EXCLUSIVE lock, so concurrent
-- writers wait rather than slipping through; the triggers are never left
-- disabled (any error rolls the whole transaction back, including the
-- DISABLE). Requires the table owner role.
--
-- REQUIRED GUARD — run this in the SAME session first, deliberately:
--   SET assurance.demo_fixture = 'disposable-only';

BEGIN;

DO $$
BEGIN
  IF current_setting('assurance.demo_fixture', true) IS DISTINCT FROM 'disposable-only' THEN
    RAISE EXCEPTION 'Refusing to delete. Run "SET assurance.demo_fixture = ''disposable-only'';" first, and ONLY in a disposable environment.';
  END IF;
END $$;

ALTER TABLE assurance_verifications DISABLE TRIGGER trg_assurance_verifications_append_only;
-- Template-version history triggers: the A0.1D-3/A0.1E-1 always-immutable
-- ones, or (after A0.1F) the lifecycle guards — whichever exist.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tgname, tgrelid::regclass::text AS tbl FROM pg_trigger
           WHERE NOT tgisinternal AND tgname IN (
             'trg_assurance_inspection_template_versions_immutable', 'trg_assurance_audit_template_versions_immutable',
             'trg_assurance_inspection_template_versions_lifecycle', 'trg_assurance_audit_template_versions_lifecycle')
  LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER %I', r.tbl, r.tgname);
  END LOOP;
END $$;

-- Children before parents (every Assurance FK is ON DELETE NO ACTION).
DELETE FROM assurance_evidence_verifications WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_evidence_actions       WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_evidence_findings      WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_evidence_inspections   WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_evidence_audits        WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_evidence_investigations WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_evidence_incidents     WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_evidence_cases         WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_verifications          WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_escalations            WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_timeframe_extensions   WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_timeframes             WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_action_tasks           WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_action_findings        WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_inspection_findings    WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_audit_findings         WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_investigation_findings WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_incident_findings      WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_investigation_people   WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_investigation_incidents WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_incident_people        WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_case_people            WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_inspection_responses   WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_audit_responses        WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_evidence               WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_actions                WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_findings               WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_inspections            WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_audits                 WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_inspection_template_versions WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_inspection_templates   WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_audit_template_versions WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_audit_templates        WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_investigations         WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_incidents              WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_cases                  WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assurance_risk_levels            WHERE organisation_id = 'assurance-demo-org';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tgname, tgrelid::regclass::text AS tbl FROM pg_trigger
           WHERE NOT tgisinternal AND tgname IN (
             'trg_assurance_inspection_template_versions_immutable', 'trg_assurance_audit_template_versions_immutable',
             'trg_assurance_inspection_template_versions_lifecycle', 'trg_assurance_audit_template_versions_lifecycle')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER %I', r.tbl, r.tgname);
  END LOOP;
END $$;
ALTER TABLE assurance_verifications ENABLE TRIGGER trg_assurance_verifications_append_only;

DELETE FROM organiser_items    WHERE organisation_id = 'assurance-demo-org';
DELETE FROM organiser_groups   WHERE organisation_id = 'assurance-demo-org';
DELETE FROM organiser_boards   WHERE organisation_id = 'assurance-demo-org';
DELETE FROM external_organisations WHERE organisation_id = 'assurance-demo-org';
DELETE FROM assets             WHERE organisation_id = 'assurance-demo-org';
DELETE FROM locations          WHERE organisation_id = 'assurance-demo-org';
DELETE FROM hr_people          WHERE organisation_id = 'assurance-demo-org';
DELETE FROM audit_logs         WHERE organisation_id = 'assurance-demo-org';
DELETE FROM organisation_modules WHERE organisation_id = 'assurance-demo-org';
DELETE FROM users              WHERE organisation_id = 'assurance-demo-org';
DELETE FROM organisations      WHERE id = 'assurance-demo-org';
-- The 'assurance' modules registry row is left in place (it grants nothing
-- by itself and may be shared with other organisations).

-- Fail loudly if anything demo-scoped survived, or if a trigger is still off.
DO $$
DECLARE
  leftover integer;
BEGIN
  SELECT (SELECT count(*) FROM assurance_incidents WHERE organisation_id = 'assurance-demo-org')
       + (SELECT count(*) FROM assurance_verifications WHERE organisation_id = 'assurance-demo-org')
       + (SELECT count(*) FROM assurance_audits WHERE organisation_id = 'assurance-demo-org')
       + (SELECT count(*) FROM assurance_audit_template_versions WHERE organisation_id = 'assurance-demo-org')
       + (SELECT count(*) FROM organisations WHERE id = 'assurance-demo-org')
    INTO leftover;
  IF leftover <> 0 THEN
    RAISE EXCEPTION 'Assurance demo cleanup incomplete (% rows remain)', leftover;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname IN ('trg_assurance_verifications_append_only', 'trg_assurance_inspection_template_versions_immutable',
                     'trg_assurance_audit_template_versions_immutable', 'trg_assurance_inspection_template_versions_lifecycle',
                     'trg_assurance_audit_template_versions_lifecycle')
      AND tgenabled = 'D'
  ) THEN
    RAISE EXCEPTION 'An Assurance history trigger is still disabled';
  END IF;
END $$;

COMMIT;
