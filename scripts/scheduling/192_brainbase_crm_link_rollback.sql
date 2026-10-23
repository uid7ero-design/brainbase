-- Scheduling Phase 2B.0 — rollback of 130_brainbase_crm_link.sql.
-- Drops only the host function and the 2b.0-crm-link marker. Contacts the function created are ordinary CRM rows
-- (classification LEAD) and are NOT deleted; remove them through the CRM if they were test data.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS brainbase_scheduling_find_or_create_contact(text, text, text, text, text, text);

DO $$
BEGIN
  IF to_regclass('public.scheduling_schema_migrations') IS NOT NULL THEN
    DELETE FROM scheduling_schema_migrations WHERE version = '2b.0-crm-link';
  END IF;
END $$;

COMMIT;
