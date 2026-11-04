-- STAGED ONLY: local rehearsal. Applying this to a hosted database needs release approval.
-- Install while legacy is authoritative; it never enables the Scheduling writer.
-- All source tables must exist. Transactional trigger installation drains existing
-- writers before the control row becomes visible; later writes share-lock that row.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS scheduling_tennis_cutover (
  organisation_id text PRIMARY KEY REFERENCES organisations(id),
  phase text NOT NULL DEFAULT 'legacy' CHECK(phase IN ('legacy','frozen','scheduling')),
  captured_hash text,
  captured_at timestamptz,
  captured_timezone text,
  captured_currency text,
  CHECK((captured_hash IS NULL)=(captured_at IS NULL)),
  CHECK((captured_hash IS NULL)=(captured_timezone IS NULL)),
  CHECK((captured_hash IS NULL)=(captured_currency IS NULL))
);
CREATE TABLE IF NOT EXISTS scheduling_tennis_history (
  organisation_id text NOT NULL REFERENCES scheduling_tennis_cutover(organisation_id),
  source_table text NOT NULL CHECK(source_table IN ('sessions','session_instances','bookings','booking_recurrence_pauses','session_types')),
  source_id text NOT NULL,
  source_row jsonb NOT NULL CHECK(jsonb_typeof(source_row)='object'),
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organisation_id,source_table,source_id),
  CHECK(source_row->>'id'=source_id AND source_row->>'organisation_id'=organisation_id)
);

CREATE OR REPLACE FUNCTION scheduling_tennis_control_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.organisation_id<>'8ecd003b-583f-4616-a830-8dbf8aa51d2c' OR NEW.phase<>'legacy' OR NEW.captured_hash IS NOT NULL OR NOT EXISTS(
      SELECT 1 FROM organisations WHERE id=NEW.organisation_id AND slug='ld-tennis' AND status='ACTIVE'
    ) THEN RAISE EXCEPTION 'invalid tennis cutover control' USING ERRCODE='STCTL'; END IF;
    IF (SELECT count(DISTINCT relation) FROM pg_locks WHERE pid=pg_backend_pid() AND granted
      AND mode IN ('ShareRowExclusiveLock','AccessExclusiveLock') AND relation IN
      ('sessions'::regclass,'session_instances'::regclass,'bookings'::regclass,'booking_recurrence_pauses'::regclass,'session_types'::regclass))<>5
    THEN RAISE EXCEPTION 'source barrier preparation must drain writers' USING ERRCODE='STCTL'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'cutover control cannot be deleted' USING ERRCODE='STCTL'; END IF;
  IF NEW.organisation_id<>OLD.organisation_id OR
    (NEW.phase<>OLD.phase AND NOT(
      (OLD.phase='legacy' AND NEW.phase='frozen') OR
      (OLD.phase='frozen' AND NEW.phase='legacy' AND OLD.captured_hash IS NULL)
    )) THEN
    -- Live activation intentionally unavailable until canonical import and all
    -- writers are verified. This staged barrier cannot be used to shortcut them.
    RAISE EXCEPTION 'cutover transition not enabled' USING ERRCODE='STCTL';
  END IF;
  IF OLD.captured_hash IS NOT NULL AND
    (NEW.captured_hash IS DISTINCT FROM OLD.captured_hash OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
      OR NEW.captured_timezone IS DISTINCT FROM OLD.captured_timezone OR NEW.captured_currency IS DISTINCT FROM OLD.captured_currency) THEN
    RAISE EXCEPTION 'history receipt is immutable' USING ERRCODE='STCTL';
  END IF;
  IF NEW.captured_hash IS DISTINCT FROM OLD.captured_hash AND NEW.phase<>'frozen' THEN
    RAISE EXCEPTION 'history capture requires frozen source' USING ERRCODE='STCTL';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER scheduling_tennis_control_guard
BEFORE INSERT OR UPDATE OR DELETE ON scheduling_tennis_cutover FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_control_guard();

CREATE OR REPLACE FUNCTION scheduling_tennis_source_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE old_org text; new_org text; state record;
BEGIN
  IF TG_OP<>'INSERT' THEN old_org:=OLD.organisation_id; END IF;
  IF TG_OP<>'DELETE' THEN new_org:=NEW.organisation_id; END IF;
  -- A transaction with an old repeatable-read snapshot might not see a newly
  -- prepared control row. Pin the LD tenant so that case is refused as well.
  IF '8ecd003b-583f-4616-a830-8dbf8aa51d2c' IN(old_org,new_org)
    AND current_setting('transaction_isolation')<>'read committed'
  THEN RAISE EXCEPTION 'tennis source requires read committed' USING ERRCODE='STISO'; END IF;
  -- Both old/new tenants are checked so moving a row cannot bypass the barrier.
  FOR state IN SELECT organisation_id,phase FROM scheduling_tennis_cutover
    WHERE organisation_id IN(old_org,new_org) ORDER BY organisation_id FOR SHARE
  LOOP
    IF current_setting('transaction_isolation')<>'read committed' THEN
      RAISE EXCEPTION 'tennis source requires read committed' USING ERRCODE='STISO';
    END IF;
    IF state.phase<>'legacy' THEN RAISE EXCEPTION 'tennis source is frozen' USING ERRCODE='STFRZ'; END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE OR REPLACE TRIGGER scheduling_tennis_source_guard BEFORE INSERT OR UPDATE OR DELETE ON sessions
FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_source_guard();
CREATE OR REPLACE TRIGGER scheduling_tennis_source_guard BEFORE INSERT OR UPDATE OR DELETE ON session_instances
FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_source_guard();
CREATE OR REPLACE TRIGGER scheduling_tennis_source_guard BEFORE INSERT OR UPDATE OR DELETE ON bookings
FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_source_guard();
CREATE OR REPLACE TRIGGER scheduling_tennis_source_guard BEFORE INSERT OR UPDATE OR DELETE ON booking_recurrence_pauses
FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_source_guard();
CREATE OR REPLACE TRIGGER scheduling_tennis_source_guard BEFORE INSERT OR UPDATE OR DELETE ON session_types
FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_source_guard();

CREATE OR REPLACE FUNCTION scheduling_tennis_prepare_history(org text) RETURNS void
LANGUAGE plpgsql SET lock_timeout='5s' AS $$
BEGIN
  LOCK TABLE sessions,session_instances,bookings,booking_recurrence_pauses,session_types IN SHARE ROW EXCLUSIVE MODE;
  IF org<>'8ecd003b-583f-4616-a830-8dbf8aa51d2c' THEN RAISE EXCEPTION 'wrong tennis tenant' USING ERRCODE='STCTL'; END IF;
  IF NOT EXISTS(SELECT 1 FROM scheduling_tennis_cutover WHERE organisation_id=org) THEN
    INSERT INTO scheduling_tennis_cutover(organisation_id) VALUES(org);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION scheduling_tennis_source_rows(org text)
RETURNS TABLE(source_table text,source_id text,source_row jsonb)
LANGUAGE sql STABLE SET timezone='UTC' AS $$
  SELECT 'sessions',id,to_jsonb(s) FROM sessions s WHERE organisation_id=org
  UNION ALL SELECT 'session_instances',id,to_jsonb(i) FROM session_instances i WHERE organisation_id=org
  UNION ALL SELECT 'bookings',id,to_jsonb(b) FROM bookings b WHERE organisation_id=org
  UNION ALL SELECT 'booking_recurrence_pauses',id,to_jsonb(p) FROM booking_recurrence_pauses p WHERE organisation_id=org
  UNION ALL SELECT 'session_types',id,to_jsonb(t) FROM session_types t WHERE organisation_id=org
$$;

CREATE OR REPLACE FUNCTION scheduling_tennis_manifest(org text) RETURNS text
LANGUAGE sql STABLE SET timezone='UTC' AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    (SELECT timezone FROM organisations WHERE id=org),
    (SELECT currency FROM scheduling_settings WHERE organisation_id=org),
    COALESCE(jsonb_agg(jsonb_build_array(source_table,source_id,source_row) ORDER BY source_table,source_id),'[]'::jsonb))::text,'UTF8')),'hex')
    FROM scheduling_tennis_source_rows(org)
$$;

CREATE OR REPLACE FUNCTION scheduling_tennis_history_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'tennis history is immutable' USING ERRCODE='STHIS'; END IF;
  IF NOT EXISTS(SELECT 1 FROM scheduling_tennis_cutover WHERE organisation_id=NEW.organisation_id AND phase='frozen')
    OR NOT EXISTS(SELECT 1 FROM scheduling_tennis_source_rows(NEW.organisation_id) s
      WHERE s.source_table=NEW.source_table AND s.source_id=NEW.source_id AND s.source_row=NEW.source_row)
  THEN RAISE EXCEPTION 'history must match frozen source' USING ERRCODE='STHIS'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER scheduling_tennis_history_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_tennis_history
FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_history_guard();

CREATE OR REPLACE FUNCTION scheduling_tennis_capture_history(org text, expected_hash text)
RETURNS TABLE(manifest text,row_count bigint)
LANGUAGE plpgsql SET timezone='UTC' SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE state scheduling_tennis_cutover%ROWTYPE; actual text; archived text; tz text; currency_code text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'history capture requires read committed' USING ERRCODE='STISO';
  END IF;
  SELECT * INTO state FROM scheduling_tennis_cutover WHERE organisation_id=org FOR UPDATE;
  IF NOT FOUND OR state.phase<>'frozen' THEN RAISE EXCEPTION 'source not frozen' USING ERRCODE='STFRZ'; END IF;
  SELECT timezone INTO tz FROM organisations WHERE id=org AND slug='ld-tennis' AND status='ACTIVE' FOR SHARE;
  SELECT currency INTO currency_code FROM scheduling_settings WHERE organisation_id=org FOR SHARE;
  IF tz IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=tz) OR currency_code IS NULL OR currency_code!~'^[A-Z]{3}$'
    THEN RAISE EXCEPTION 'source configuration unavailable' USING ERRCODE='STCHG'; END IF;
  actual:=scheduling_tennis_manifest(org);
  IF expected_hash IS NULL OR expected_hash<>actual OR (state.captured_hash IS NOT NULL AND state.captured_hash<>actual) THEN
    RAISE EXCEPTION 'source changed since review' USING ERRCODE='STCHG';
  END IF;
  INSERT INTO scheduling_tennis_history(organisation_id,source_table,source_id,source_row)
    SELECT org,s.source_table,s.source_id,s.source_row FROM scheduling_tennis_source_rows(org) s
    ON CONFLICT(organisation_id,source_table,source_id) DO NOTHING;
  SELECT encode(sha256(convert_to(jsonb_build_array(tz,currency_code,COALESCE(jsonb_agg(jsonb_build_array(h.source_table,h.source_id,h.source_row)
    ORDER BY h.source_table,h.source_id),'[]'::jsonb))::text,'UTF8')),'hex') INTO archived
    FROM scheduling_tennis_history h WHERE h.organisation_id=org;
  IF archived<>actual THEN RAISE EXCEPTION 'history does not match source' USING ERRCODE='STHIS'; END IF;
  UPDATE scheduling_tennis_cutover SET captured_hash=actual,captured_at=COALESCE(captured_at,now()),captured_timezone=tz,captured_currency=currency_code WHERE organisation_id=org;
  RETURN QUERY SELECT actual,count(*) FROM scheduling_tennis_history h WHERE h.organisation_id=org;
END $$;

-- No organisation is enabled or frozen by installation. A reviewed control row
-- must be inserted while source tables are locked, in the activation transaction.
COMMIT;
