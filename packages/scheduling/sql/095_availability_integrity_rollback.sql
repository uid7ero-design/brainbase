-- Scheduling Phase 2B.3b — ROLLBACK of 034_availability_integrity.sql.
--
-- Removes the four availability triggers, the three functions and the two updated_at columns, and the 2b.3.1 version marker. No rule or
-- exception row is deleted or changed (the version tokens are derived data). After it the schema behaves as at version 2b.2.4/2a.2, and the
-- availability routes answer 503 AVAILABILITY_NOT_READY again. Idempotent.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS scheduling_availability_rules_integrity ON scheduling_availability_rules;
DROP TRIGGER IF EXISTS scheduling_availability_exceptions_integrity ON scheduling_availability_exceptions;
DROP TRIGGER IF EXISTS scheduling_availability_rules_touch ON scheduling_availability_rules;
DROP TRIGGER IF EXISTS scheduling_availability_exceptions_touch ON scheduling_availability_exceptions;
DROP FUNCTION IF EXISTS scheduling_availability_rule_integrity();
DROP FUNCTION IF EXISTS scheduling_availability_exception_integrity();
DROP FUNCTION IF EXISTS scheduling_availability_lock_owner(text, text, text);
ALTER TABLE scheduling_availability_rules DROP COLUMN IF EXISTS updated_at;
ALTER TABLE scheduling_availability_exceptions DROP COLUMN IF EXISTS updated_at;

DO $$
BEGIN
  IF to_regclass('public.scheduling_schema_migrations') IS NOT NULL THEN
    DELETE FROM scheduling_schema_migrations WHERE version = '2b.3.1';
  END IF;
END $$;

COMMIT;
