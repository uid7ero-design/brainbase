-- Scheduling Phase 2B.0 — dedicated INTERNAL TEST organisation, step 2 of 2: ENABLE the Scheduling capability.
--
-- STATUS: DEFINED, NOT RUN ANYWHERE. Manual, separately approved, Preview first. Run only after
-- 120_brainbase_capability.sql and internal-test-org-1-create.sql.
--
-- WHAT: inserts exactly ONE organisation_modules row: (internal test organisation, 'scheduling', enabled = true).
--   It is the only entitlement Phase 2B grants. Every other organisation keeps NO row and stays denied.
--
-- GUARDS (any failure aborts and rolls back; nothing is written):
--   * the 'scheduling' capability is registered and active (120 applied);
--   * exactly one organisation has the slug below;
--   * exactly one row was written;
--   * afterwards exactly one organisation in the whole database is entitled to Scheduling.
--
-- IDEMPOTENT: a second run leaves the same single enabled row.
-- DISABLE (instant, no deploy): UPDATE organisation_modules SET enabled = false WHERE module_key = 'scheduling'
--   AND organisation_id = (SELECT id FROM organisations WHERE slug = 'zz-scheduling-internal-test');

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  org_id text;
  n bigint;
  entitled bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM modules WHERE key = 'scheduling' AND active = true) THEN
    RAISE EXCEPTION 'the scheduling capability is not registered and active; run 120_brainbase_capability.sql first';
  END IF;

  SELECT count(*) INTO n FROM organisations WHERE slug = 'zz-scheduling-internal-test';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one internal test organisation, found %', n;
  END IF;
  SELECT id INTO org_id FROM organisations WHERE slug = 'zz-scheduling-internal-test';

  INSERT INTO organisation_modules (organisation_id, module_key, enabled, config)
  VALUES (org_id, 'scheduling', true, '{}'::jsonb)
  ON CONFLICT (organisation_id, module_key) DO UPDATE SET enabled = true, updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected to write exactly one entitlement row, wrote %', n;
  END IF;

  SELECT count(*) INTO entitled FROM organisation_modules WHERE module_key = 'scheduling' AND enabled = true;
  IF entitled <> 1 THEN
    RAISE EXCEPTION 'exactly one organisation may be entitled to scheduling in Phase 2B, found %', entitled;
  END IF;
END $$;

COMMIT;
