-- Scheduling Phase 2A — BrainBase HOST migration (version 2a.1-brainbase)
--
-- STATUS: NOT APPLIED ANYWHERE. Run only AFTER packages/scheduling/sql/010_shared_schema.sql.
--
-- WHAT: adds exactly THREE foreign keys, from the three root scheduling tables to
--       organisations(id). Nothing else. Every other scheduling table is tied to its tenant
--       through composite (id, organisation_id) foreign keys inside the shared DDL, so these
--       three are sufficient to guarantee that every scheduling row belongs to a real
--       BrainBase organisation.
--
-- WHY IT IS SEPARATE: the shared DDL must run in a standalone deployment that has no
--   `organisations` table. A standalone host supplies its own tenant table and its own
--   equivalent of this file (or none).
--
-- DELIBERATELY NOT HERE:
--   * no foreign key from customer_id to crm_contacts OR contacts (LD Tennis) - customer_id
--     holds either, plus any standalone id; integrity is the adapter's organisation-scoped
--     lookup plus the immutable booking snapshot;
--   * no reference to bookings / sessions / session_instances (LD Tennis tables are untouched);
--   * no data is read, copied, migrated or backfilled.
--
-- ON DELETE: NO ACTION (the default). An organisation that still has scheduling data cannot
--   be deleted by accident; offboarding must remove its scheduling rows first.
--
-- IDEMPOTENT: each constraint is added only if absent. The tables are empty on first apply,
--   so VALIDATE is immediate; NOT VALID + VALIDATE is used anyway so the same file is safe
--   if it is ever re-run after data exists (VALIDATE takes only a SHARE UPDATE EXCLUSIVE lock).
--
-- ROLLBACK: scripts/scheduling/190_brainbase_host_rollback.sql
--
-- REQUIRES: organisations(id) of type TEXT (preflight step 5).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.scheduling_settings') IS NULL THEN
    RAISE EXCEPTION 'run packages/scheduling/sql/010_shared_schema.sql first';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_settings_organisation_fk') THEN
    ALTER TABLE scheduling_settings
      ADD CONSTRAINT scheduling_settings_organisation_fk FOREIGN KEY (organisation_id) REFERENCES organisations (id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_schedules_organisation_fk') THEN
    ALTER TABLE scheduling_schedules
      ADD CONSTRAINT scheduling_schedules_organisation_fk FOREIGN KEY (organisation_id) REFERENCES organisations (id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_resources_organisation_fk') THEN
    ALTER TABLE scheduling_resources
      ADD CONSTRAINT scheduling_resources_organisation_fk FOREIGN KEY (organisation_id) REFERENCES organisations (id) NOT VALID;
  END IF;
END $$;

ALTER TABLE scheduling_settings  VALIDATE CONSTRAINT scheduling_settings_organisation_fk;
ALTER TABLE scheduling_schedules VALIDATE CONSTRAINT scheduling_schedules_organisation_fk;
ALTER TABLE scheduling_resources VALIDATE CONSTRAINT scheduling_resources_organisation_fk;

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2a.1-brainbase', 'BrainBase host: organisation foreign keys on settings, schedules and resources')
ON CONFLICT (version) DO NOTHING;

COMMIT;
