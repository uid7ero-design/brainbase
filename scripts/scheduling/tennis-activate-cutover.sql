-- STAGED ONLY. Operator-owned cutover; no transition is executed on installation.
-- Apply only after public, staff and restore acceptance. Never called by an app route.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS scheduling_tennis_transitions (
  organisation_id text NOT NULL REFERENCES scheduling_tennis_cutover(organisation_id),
  transaction_id bigint NOT NULL,
  from_phase text NOT NULL CHECK(from_phase IN ('legacy','frozen','scheduling')),
  to_phase text NOT NULL CHECK(to_phase IN ('legacy','frozen','scheduling')),
  source_hash text NOT NULL,
  target_hash text NOT NULL,
  operator_note text NOT NULL CHECK(length(btrim(operator_note)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organisation_id,transaction_id)
);
CREATE OR REPLACE TRIGGER scheduling_tennis_transitions_immutable BEFORE UPDATE OR DELETE ON scheduling_tennis_transitions
  FOR EACH ROW EXECUTE FUNCTION scheduling_coaching_command_immutable();
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
      (OLD.phase='frozen' AND NEW.phase='legacy' AND OLD.captured_hash IS NULL) OR
      EXISTS(SELECT 1 FROM scheduling_tennis_transitions t WHERE t.organisation_id=OLD.organisation_id AND t.transaction_id=txid_current()
        AND t.from_phase=OLD.phase AND t.to_phase=NEW.phase AND t.source_hash=OLD.captured_hash)
    )) THEN
    -- Only the receipt-producing transition command may change writer authority.
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

CREATE OR REPLACE FUNCTION scheduling_tennis_target_manifest(org text) RETURNS text LANGUAGE sql STABLE SET timezone='UTC' AS $$
  SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(kind,id,payload) ORDER BY kind,id)::text,'[]'),'UTF8')),'hex') FROM (
    SELECT 'schedule' kind,id,to_jsonb(s) payload FROM scheduling_schedules s WHERE organisation_id=org AND id='tennis-coaching'
    UNION ALL SELECT 'offering',id,to_jsonb(f) FROM scheduling_offerings f WHERE organisation_id=org AND schedule_id='tennis-coaching'
    UNION ALL SELECT 'occurrence',o.id,to_jsonb(o) FROM scheduling_occurrences o JOIN scheduling_offerings f ON f.organisation_id=o.organisation_id AND f.id=o.offering_id WHERE o.organisation_id=org AND f.schedule_id='tennis-coaching'
    UNION ALL SELECT 'series',g.id,to_jsonb(g) FROM scheduling_series g JOIN scheduling_offerings f ON f.organisation_id=g.organisation_id AND f.id=g.offering_id WHERE g.organisation_id=org AND f.schedule_id='tennis-coaching'
    UNION ALL SELECT 'pause',p.id,to_jsonb(p) FROM scheduling_series_pauses p JOIN scheduling_series g ON g.organisation_id=p.organisation_id AND g.id=p.series_id JOIN scheduling_offerings f ON f.organisation_id=g.organisation_id AND f.id=g.offering_id WHERE p.organisation_id=org AND f.schedule_id='tennis-coaching'
    UNION ALL SELECT 'booking',id,to_jsonb(r) FROM scheduling_reservations r WHERE organisation_id=org AND schedule_id='tennis-coaching'
    UNION ALL SELECT 'origin',reservation_id,to_jsonb(b) FROM scheduling_tennis_booking_origins b WHERE organisation_id=org
    UNION ALL SELECT 'marker',m.reservation_id,to_jsonb(m) FROM scheduling_coaching_markers m JOIN scheduling_reservations r ON r.organisation_id=m.organisation_id AND r.id=m.reservation_id WHERE m.organisation_id=org AND r.schedule_id='tennis-coaching'
    UNION ALL SELECT 'series-link',l.reservation_id,to_jsonb(l) FROM scheduling_coaching_series_links l JOIN scheduling_reservations r ON r.organisation_id=l.organisation_id AND r.id=l.reservation_id WHERE l.organisation_id=org AND r.schedule_id='tennis-coaching'
    UNION ALL SELECT 'restoration',original_offering_id,to_jsonb(r) FROM scheduling_coaching_restorations r WHERE organisation_id=org
    UNION ALL SELECT 'restored-series',original_series_id,to_jsonb(r) FROM scheduling_coaching_restored_series r WHERE organisation_id=org
  ) rows
$$;

CREATE OR REPLACE FUNCTION scheduling_tennis_transition(org text,destination text,expected_source text,expected_target text,note text) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE state scheduling_tennis_cutover%ROWTYPE; imported scheduling_tennis_import_receipts%ROWTYPE; target text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Cutover requires read committed' USING ERRCODE='STISO'; END IF;
  IF org IS DISTINCT FROM '8ecd003b-583f-4616-a830-8dbf8aa51d2c' OR note IS NULL OR length(btrim(note)) NOT BETWEEN 1 AND 1000
    THEN RAISE EXCEPTION 'Invalid transition request' USING ERRCODE='STVAL'; END IF;
  -- Both source and canonical writers hold SHARE until commit. This drains
  -- their complete transactions before the fresh manifest below is read.
  SELECT * INTO state FROM scheduling_tennis_cutover WHERE organisation_id=org FOR UPDATE;
  SELECT * INTO imported FROM scheduling_tennis_import_receipts WHERE organisation_id=org;
  IF imported.organisation_id IS NULL OR state.captured_hash IS DISTINCT FROM expected_source OR imported.source_hash IS DISTINCT FROM expected_source
    OR scheduling_tennis_manifest(org) IS DISTINCT FROM expected_source
    OR NOT EXISTS(SELECT 1 FROM organisations n JOIN scheduling_settings s ON s.organisation_id=n.id
      WHERE n.id=org AND n.status='ACTIVE' AND n.slug='ld-tennis' AND n.timezone=state.captured_timezone AND s.currency=state.captured_currency)
    THEN RAISE EXCEPTION 'Cutover evidence changed' USING ERRCODE='STCHG'; END IF;
  target:=scheduling_tennis_target_manifest(org);
  IF destination='frozen' AND state.phase='scheduling' THEN NULL;
  ELSIF destination='scheduling' AND state.phase='frozen' THEN
    IF target IS DISTINCT FROM expected_target THEN RAISE EXCEPTION 'Target changed since review' USING ERRCODE='STCHG'; END IF;
    IF NOT EXISTS(SELECT 1 FROM scheduling_tennis_transitions WHERE organisation_id=org AND to_phase='scheduling') AND target<>imported.target_hash
      THEN RAISE EXCEPTION 'First activation must match import' USING ERRCODE='STCHG'; END IF;
  ELSIF destination='legacy' AND state.phase='frozen' THEN
    IF target IS DISTINCT FROM expected_target OR target<>imported.target_hash THEN
      RAISE EXCEPTION 'Scheduling has changed; reconcile before returning to legacy' USING ERRCODE='STNEW'; END IF;
  ELSE RAISE EXCEPTION 'Invalid writer transition' USING ERRCODE='STCTL'; END IF;
  INSERT INTO scheduling_tennis_transitions(organisation_id,transaction_id,from_phase,to_phase,source_hash,target_hash,operator_note)
    VALUES(org,txid_current(),state.phase,destination,expected_source,target,btrim(note));
  UPDATE scheduling_tennis_cutover SET phase=destination WHERE organisation_id=org;
  RETURN jsonb_build_object('from',state.phase,'phase',destination,'sourceHash',expected_source,'targetHash',target);
END $$;
COMMIT;
