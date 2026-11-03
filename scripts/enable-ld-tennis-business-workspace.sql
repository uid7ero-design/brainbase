-- Approved LD Tennis business rollout, 2026-11-03. Run after capacity code/SQL.
-- One transaction. Preserves existing modules, grants, roles and settings.
-- Execute on Preview first; use the verified production branch only after release.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  target text;
  before_snapshot jsonb;
  after_snapshot jsonb;
BEGIN
  SELECT id INTO STRICT target FROM organisations WHERE slug = 'ld-tennis' AND status = 'ACTIVE';
  IF target <> '8ecd003b-583f-4616-a830-8dbf8aa51d2c' THEN
    RAISE EXCEPTION 'Unexpected LD Tennis organisation';
  END IF;
  PERFORM 1 FROM organisations WHERE id=target FOR UPDATE;
  IF (SELECT count(*) FROM modules WHERE key IN ('scheduling','crm','invoicing','purchasing','budgeting') AND active=true) <> 5 THEN
    RAISE EXCEPTION 'Required module registry is incomplete';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['2b.2.1','2b.2.2','2b.2.3','2b.2.4','2b.3.1','2b.3.2','2b.3.3','2c.3.1']) v
    WHERE NOT EXISTS(SELECT 1 FROM scheduling_schema_migrations m WHERE m.version=v)) THEN
    RAISE EXCEPTION 'Scheduling integrity migrations missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND tgname IN
      ('scheduling_resources_guard','scheduling_holds_resource_state','scheduling_offering_resources_guard',
       'scheduling_offering_resources_release_guard','scheduling_reservations_integrity',
       'scheduling_occurrences_integrity','scheduling_resources_capacity_guard')) <> 7 THEN
    RAISE EXCEPTION 'Scheduling integrity triggers missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.bookings'::regclass
    AND tgname='bookings_capacity_guard' AND tgenabled='O' AND tgtype=7) THEN
    RAISE EXCEPTION 'Booking capacity prerequisite missing';
  END IF;
  SELECT jsonb_build_object('timezone',o.timezone,'modules',
    (SELECT jsonb_agg(jsonb_build_object('key',module_key,'enabled',enabled) ORDER BY module_key) FROM organisation_modules WHERE organisation_id=target),
    'scheduling_currency',(SELECT currency FROM scheduling_settings WHERE organisation_id=target))
    INTO before_snapshot FROM organisations o WHERE o.id=target;
  UPDATE organisations SET timezone='Australia/Adelaide' WHERE id=target AND timezone IS NULL;
  INSERT INTO scheduling_settings(organisation_id,currency) VALUES(target,'AUD') ON CONFLICT(organisation_id) DO NOTHING;
  INSERT INTO organisation_modules(organisation_id,module_key,enabled,config)
    SELECT target,key,true,'{}'::jsonb FROM modules WHERE key IN ('scheduling','crm','invoicing','purchasing','budgeting')
    ON CONFLICT(organisation_id,module_key) DO UPDATE SET enabled=true,updated_at=now()
      WHERE organisation_modules.enabled IS DISTINCT FROM true;
  SELECT jsonb_build_object('timezone',o.timezone,'modules',
    (SELECT jsonb_agg(jsonb_build_object('key',module_key,'enabled',enabled) ORDER BY module_key) FROM organisation_modules WHERE organisation_id=target),
    'scheduling_currency',(SELECT currency FROM scheduling_settings WHERE organisation_id=target))
    INTO after_snapshot FROM organisations o WHERE o.id=target;
  IF before_snapshot IS DISTINCT FROM after_snapshot THEN
    INSERT INTO audit_logs(id,organisation_id,action,resource_type,resource_id,before_state,after_state)
      VALUES(gen_random_uuid()::text,target,'ld_tennis.business_workspace_enabled','organisation',target,before_snapshot,after_snapshot);
  END IF;
END $$;
COMMIT;
