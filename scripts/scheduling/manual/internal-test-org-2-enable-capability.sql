-- Scheduling Phase 2B.0 — dedicated INTERNAL TEST organisation, step 2 of 2: ENABLE the Scheduling capability.
--
-- STATUS: DEFINED, NOT RUN ANYWHERE. Manual, separately approved, Preview first. Run only after
-- 120_brainbase_capability.sql and internal-test-org-1-create.sql.
--
-- WHAT (one transaction, so BOTH rows exist or NEITHER does):
--   1. one organisation_modules row: (internal test organisation, 'scheduling', enabled = true). It is the only
--      entitlement Phase 2B grants. Every other organisation keeps NO row and stays denied.
--   2. one scheduling_settings row for the same organisation, currency 'AUD'. The application never creates settings
--      (Phase 2B.1): an entitled organisation without this row is refused with 503 SCHEDULING_NOT_CONFIGURED, so the
--      row is part of enabling an organisation, chosen here, explicitly.
--
-- GUARDS (any failure aborts and rolls back; nothing is written):
--   * the 'scheduling' capability is registered and active (120 applied) and the settings table exists (110 applied);
--   * the Scheduling INTEGRITY migrations are applied: versions 2b.2.1 (030 resource concurrency), 2b.2.2 (031 reservation
--     integrity) and 2b.2.3 (032 schedule archive ordering) are recorded AND their seven guard triggers are enabled. An
--     organisation is never entitled on a schema that lacks the booking guards. (033 occurrence integrity is not required
--     here: no route writes occurrences yet; add 2b.2.4 to the list below before the first occurrence-writing route.)
--   * the test organisation's timezone is Australia/Adelaide (internal-test-org-1-create.sql sets it);
--   * exactly one organisation has the slug below;
--   * exactly one entitlement row was written;
--   * afterwards exactly one organisation in the whole database is entitled to Scheduling, and it is this one;
--   * every entitled organisation has a settings row with a valid currency (an entitlement without settings fails closed).
--
-- IDEMPOTENT: a second run leaves the same single enabled row and the same settings row. An existing settings row is
--   never overwritten (a currency chosen since is kept).
-- DISABLE (instant, no deploy): UPDATE organisation_modules SET enabled = false WHERE module_key = 'scheduling'
--   AND organisation_id = (SELECT id FROM organisations WHERE slug = 'zz-scheduling-internal-test');

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  org_id text;
  n bigint;
  entitled bigint;
  unconfigured bigint;
  missing text;
  guards bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM modules WHERE key = 'scheduling' AND active = true) THEN
    RAISE EXCEPTION 'the scheduling capability is not registered and active; run 120_brainbase_capability.sql first';
  END IF;
  IF to_regclass('public.scheduling_settings') IS NULL THEN
    RAISE EXCEPTION 'scheduling_settings does not exist; apply the Scheduling schema first';
  END IF;

  IF to_regclass('public.scheduling_schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'scheduling_schema_migrations does not exist; apply the Scheduling schema first';
  END IF;
  SELECT string_agg(v, ', ' ORDER BY v) INTO missing
    FROM unnest(ARRAY['2b.2.1', '2b.2.2', '2b.2.3']) AS v
   WHERE NOT EXISTS (SELECT 1 FROM scheduling_schema_migrations m WHERE m.version = v);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'the Scheduling integrity migrations are not applied (missing: %); apply 030, 031 and 032 first', missing;
  END IF;
  SELECT count(*) INTO guards FROM pg_trigger
   WHERE NOT tgisinternal AND tgenabled = 'O'
     AND tgname IN ('scheduling_resources_guard', 'scheduling_holds_resource_state', 'scheduling_offering_resources_guard',
                    'scheduling_offering_resources_release_guard', 'scheduling_reservations_integrity',
                    'scheduling_occurrences_integrity', 'scheduling_resources_capacity_guard');
  IF guards <> 7 THEN
    RAISE EXCEPTION 'expected the 7 Scheduling integrity triggers to be enabled, found % enabled', guards;
  END IF;

  SELECT count(*) INTO n FROM organisations WHERE slug = 'zz-scheduling-internal-test';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one internal test organisation, found %', n;
  END IF;
  SELECT id INTO org_id FROM organisations WHERE slug = 'zz-scheduling-internal-test';
  IF NOT EXISTS (SELECT 1 FROM organisations WHERE id = org_id AND timezone = 'Australia/Adelaide') THEN
    RAISE EXCEPTION 'the internal test organisation timezone is not Australia/Adelaide; run the current internal-test-org-1-create.sql or fix it by a reviewed statement';
  END IF;

  INSERT INTO organisation_modules (organisation_id, module_key, enabled, config)
  VALUES (org_id, 'scheduling', true, '{}'::jsonb)
  ON CONFLICT (organisation_id, module_key) DO UPDATE SET enabled = true, updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected to write exactly one entitlement row, wrote %', n;
  END IF;

  INSERT INTO scheduling_settings (organisation_id, currency)
  VALUES (org_id, 'AUD')
  ON CONFLICT (organisation_id) DO NOTHING;

  SELECT count(*) INTO entitled FROM organisation_modules WHERE module_key = 'scheduling' AND enabled = true;
  IF entitled <> 1 THEN
    RAISE EXCEPTION 'exactly one organisation may be entitled to scheduling in Phase 2B, found %', entitled;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organisation_modules WHERE module_key = 'scheduling' AND enabled = true AND organisation_id = org_id) THEN
    RAISE EXCEPTION 'the entitled organisation is not the internal test organisation';
  END IF;

  SELECT count(*) INTO unconfigured
    FROM organisation_modules m
   WHERE m.module_key = 'scheduling' AND m.enabled = true
     AND NOT EXISTS (SELECT 1 FROM scheduling_settings s WHERE s.organisation_id = m.organisation_id AND s.currency ~ '^[A-Z]{3}$');
  IF unconfigured <> 0 THEN
    RAISE EXCEPTION '% entitled organisation(s) have no valid scheduling_settings row', unconfigured;
  END IF;
END $$;

COMMIT;
