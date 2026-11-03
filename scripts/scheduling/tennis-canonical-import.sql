-- STAGED ONLY. Requires the shared Scheduling schema and tennis-history-cutover.sql.
-- Run only in an owned rehearsal database until explicit hosted release approval.
-- Installs the importer; does not import, activate, or modify any source record.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS scheduling_tennis_import_receipts (
  organisation_id text PRIMARY KEY REFERENCES scheduling_tennis_cutover(organisation_id),
  source_hash text NOT NULL,
  target_hash text NOT NULL,
  counts jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scheduling_tennis_booking_origins (
  organisation_id text NOT NULL,
  reservation_id text NOT NULL,
  source_table text NOT NULL DEFAULT 'bookings' CHECK(source_table='bookings'),
  source_id text NOT NULL,
  original_paid_marker boolean NOT NULL,
  PRIMARY KEY(organisation_id,reservation_id),
  UNIQUE(organisation_id,source_id),
  CHECK(reservation_id=source_id),
  FOREIGN KEY(organisation_id,reservation_id) REFERENCES scheduling_reservations(organisation_id,id),
  FOREIGN KEY(organisation_id,source_table,source_id) REFERENCES scheduling_tennis_history(organisation_id,source_table,source_id)
);
-- Unknown original prices are NULL, not today's offering price and not zero.
-- The deferred guard below permits NULL only with matching captured provenance.
ALTER TABLE scheduling_reservations ALTER COLUMN price_cents DROP NOT NULL;

CREATE OR REPLACE FUNCTION scheduling_tennis_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original jsonb; reservation scheduling_reservations%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Tennis origin is immutable' USING ERRCODE='STHIS'; END IF;
  IF NOT EXISTS(SELECT 1 FROM scheduling_tennis_cutover WHERE organisation_id=NEW.organisation_id AND phase='frozen' AND captured_hash IS NOT NULL)
    THEN RAISE EXCEPTION 'Tennis source is not captured and frozen' USING ERRCODE='STFRZ'; END IF;
  SELECT source_row INTO original FROM scheduling_tennis_history WHERE organisation_id=NEW.organisation_id AND source_table='bookings' AND source_id=NEW.source_id;
  SELECT * INTO reservation FROM scheduling_reservations WHERE organisation_id=NEW.organisation_id AND id=NEW.reservation_id;
  IF original IS NULL OR reservation.id IS NULL OR reservation.price_cents IS NOT NULL
    OR reservation.schedule_id<>'tennis-coaching' OR reservation.preset_key<>'classes_coaching'
    OR reservation.occurrence_id IS DISTINCT FROM original->>'session_instance_id'
    OR reservation.offering_id IS DISTINCT FROM original->>'session_id'
    OR reservation.customer_name IS DISTINCT FROM original->>'client_name'
    OR reservation.customer_email IS DISTINCT FROM original->>'client_email'
    OR reservation.status IS DISTINCT FROM (CASE original->>'status' WHEN 'confirmed' THEN 'confirmed' WHEN 'pending_confirmation' THEN 'pending' ELSE NULL END)
    OR NEW.original_paid_marker IS DISTINCT FROM (original->>'paid')::boolean
  THEN RAISE EXCEPTION 'Tennis origin does not match captured booking' USING ERRCODE='STHIS'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER scheduling_tennis_origin_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_tennis_booking_origins
  FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_origin_guard();

CREATE OR REPLACE FUNCTION scheduling_tennis_unknown_price_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.price_cents IS NULL AND NOT EXISTS(SELECT 1 FROM scheduling_tennis_booking_origins WHERE organisation_id=NEW.organisation_id AND reservation_id=NEW.id)
    THEN RAISE EXCEPTION 'Unknown booking price requires captured provenance' USING ERRCODE='STPRC'; END IF;
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='scheduling_tennis_unknown_price_guard' AND tgrelid='scheduling_reservations'::regclass) THEN
    CREATE CONSTRAINT TRIGGER scheduling_tennis_unknown_price_guard AFTER INSERT OR UPDATE ON scheduling_reservations
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_unknown_price_guard();
  END IF;
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
  ) rows
$$;

CREATE OR REPLACE FUNCTION scheduling_tennis_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE captured text; phase text;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Import receipt is immutable' USING ERRCODE='STHIS'; END IF;
  SELECT captured_hash,c.phase INTO captured,phase FROM scheduling_tennis_cutover c WHERE organisation_id=NEW.organisation_id FOR SHARE;
  IF phase IS DISTINCT FROM 'frozen' OR captured IS DISTINCT FROM NEW.source_hash OR NEW.target_hash IS DISTINCT FROM scheduling_tennis_target_manifest(NEW.organisation_id)
    OR NOT EXISTS(SELECT 1 FROM scheduling_schedules WHERE organisation_id=NEW.organisation_id AND id='tennis-coaching' AND preset_key='classes_coaching')
    OR (SELECT count(*) FROM scheduling_offerings WHERE organisation_id=NEW.organisation_id AND schedule_id='tennis-coaching')<>
       (SELECT count(*) FROM scheduling_tennis_history WHERE organisation_id=NEW.organisation_id AND source_table='sessions')
    OR (SELECT count(*) FROM scheduling_tennis_booking_origins WHERE organisation_id=NEW.organisation_id)<>
       (SELECT count(*) FROM scheduling_tennis_history WHERE organisation_id=NEW.organisation_id AND source_table='bookings' AND source_row->>'status'<>'cancelled')
    THEN RAISE EXCEPTION 'Import receipt does not match captured state' USING ERRCODE='STHIS'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER scheduling_tennis_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_tennis_import_receipts
  FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_receipt_guard();

CREATE OR REPLACE FUNCTION scheduling_tennis_target_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payload jsonb; target_org text; target_schedule text; phase text;
BEGIN
  FOR payload IN SELECT value FROM jsonb_array_elements(CASE TG_OP
    WHEN 'INSERT' THEN jsonb_build_array(to_jsonb(NEW)) WHEN 'DELETE' THEN jsonb_build_array(to_jsonb(OLD))
    ELSE jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) END) LOOP
    target_org:=payload->>'organisation_id'; target_schedule:=NULL;
    IF NOT EXISTS(SELECT 1 FROM scheduling_tennis_import_receipts WHERE organisation_id=target_org) THEN CONTINUE; END IF;
    IF TG_TABLE_NAME='scheduling_schedules' THEN target_schedule:=payload->>'id';
    ELSIF TG_TABLE_NAME IN ('scheduling_offerings','scheduling_reservations') THEN target_schedule:=payload->>'schedule_id';
    ELSIF TG_TABLE_NAME IN ('scheduling_occurrences','scheduling_series') THEN
      SELECT schedule_id INTO target_schedule FROM scheduling_offerings WHERE organisation_id=target_org AND id=payload->>'offering_id';
    ELSIF TG_TABLE_NAME='scheduling_series_pauses' THEN
      SELECT f.schedule_id INTO target_schedule FROM scheduling_series g JOIN scheduling_offerings f ON f.organisation_id=g.organisation_id AND f.id=g.offering_id
        WHERE g.organisation_id=target_org AND g.id=payload->>'series_id';
    ELSIF TG_TABLE_NAME IN ('scheduling_coaching_markers','scheduling_coaching_series_links') THEN
      SELECT schedule_id INTO target_schedule FROM scheduling_reservations WHERE organisation_id=target_org AND id=payload->>'reservation_id';
    END IF;
    IF target_schedule='tennis-coaching' THEN
      SELECT c.phase INTO phase FROM scheduling_tennis_cutover c WHERE organisation_id=target_org FOR SHARE;
      IF phase IS DISTINCT FROM 'scheduling' THEN RAISE EXCEPTION 'Imported Tennis target awaits activation' USING ERRCODE='STFRZ'; END IF;
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE OR REPLACE TRIGGER scheduling_tennis_target_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_schedules FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_target_guard();
CREATE OR REPLACE TRIGGER scheduling_tennis_target_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_offerings FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_target_guard();
CREATE OR REPLACE TRIGGER scheduling_tennis_target_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_occurrences FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_target_guard();
CREATE OR REPLACE TRIGGER scheduling_tennis_target_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_reservations FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_target_guard();
CREATE OR REPLACE TRIGGER scheduling_tennis_target_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_series FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_target_guard();
CREATE OR REPLACE TRIGGER scheduling_tennis_target_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_series_pauses FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_target_guard();
CREATE OR REPLACE TRIGGER scheduling_tennis_target_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_coaching_markers FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_target_guard();
CREATE OR REPLACE TRIGGER scheduling_tennis_target_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_coaching_series_links FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_target_guard();

CREATE OR REPLACE FUNCTION scheduling_tennis_import_history(org text, expected_hash text, expected_timezone text, expected_currency text)
RETURNS TABLE(source_hash text,target_hash text,counts jsonb)
LANGUAGE plpgsql SET timezone='UTC' SET lock_timeout='5s' SET statement_timeout='120s' AS $$
DECLARE state scheduling_tennis_cutover%ROWTYPE; receipt scheduling_tennis_import_receipts%ROWTYPE;
  tz text; currency_code text; row record; data jsonb; start_at timestamptz; finish_at timestamptz;
  source_count bigint; active_count bigint; imported_count bigint; digest text; totals jsonb;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Import requires read committed' USING ERRCODE='STISO'; END IF;
  SELECT * INTO state FROM scheduling_tennis_cutover WHERE organisation_id=org FOR UPDATE;
  IF org<>'8ecd003b-583f-4616-a830-8dbf8aa51d2c' OR NOT FOUND OR state.phase<>'frozen' OR state.captured_hash IS NULL
    THEN RAISE EXCEPTION 'Source must be captured and frozen' USING ERRCODE='STFRZ'; END IF;
  IF expected_hash IS DISTINCT FROM state.captured_hash OR expected_hash IS DISTINCT FROM scheduling_tennis_manifest(org)
    THEN RAISE EXCEPTION 'Source changed since review' USING ERRCODE='STCHG'; END IF;
  SELECT timezone INTO tz FROM organisations WHERE id=org AND slug='ld-tennis' AND status='ACTIVE' FOR SHARE;
  SELECT currency INTO currency_code FROM scheduling_settings WHERE organisation_id=org FOR SHARE;
  IF tz IS DISTINCT FROM expected_timezone OR currency_code IS DISTINCT FROM expected_currency
    OR tz IS DISTINCT FROM state.captured_timezone OR currency_code IS DISTINCT FROM state.captured_currency OR tz IS NULL OR currency_code IS NULL
    THEN RAISE EXCEPTION 'Import configuration changed' USING ERRCODE='STCHG'; END IF;
  SELECT * INTO receipt FROM scheduling_tennis_import_receipts WHERE organisation_id=org;
  IF FOUND THEN
    IF receipt.source_hash<>expected_hash OR receipt.target_hash<>scheduling_tennis_target_manifest(org)
      THEN RAISE EXCEPTION 'Imported target changed' USING ERRCODE='STCHG'; END IF;
    RETURN QUERY SELECT receipt.source_hash,receipt.target_hash,receipt.counts; RETURN;
  END IF;
  -- No ON CONFLICT shortcuts: target collisions abort the entire transaction.
  INSERT INTO scheduling_schedules(id,organisation_id,name,preset_key,preset_version,cancellation_policy,timezone)
    VALUES('tennis-coaching',org,'Tennis coaching','classes_coaching',1,'{}',tz);
  FOR row IN SELECT source_row FROM scheduling_tennis_history WHERE organisation_id=org AND source_table='sessions' ORDER BY source_id LOOP
    data:=row.source_row;
    IF (data->>'price_per_session')::numeric*100<>trunc((data->>'price_per_session')::numeric*100)
      THEN RAISE EXCEPTION 'Source price requires review' USING ERRCODE='STHIS'; END IF;
    INSERT INTO scheduling_offerings(id,organisation_id,schedule_id,name,type_key,colour_key,duration_minutes,capacity,price_cents,currency,start_time,
      recurrence_kind,recurrence_day_of_week,recurrence_start_date,recurrence_end_mode,recurrence_end_count,recurrence_end_date)
    VALUES(data->>'id',org,'tennis-coaching',data->>'name',data->>'session_type',data->>'session_colour_key',(data->>'duration_minutes')::int,
      (data->>'max_capacity')::int,((data->>'price_per_session')::numeric*100)::int,currency_code,(data->>'start_time')::time,
      'weekly',(data->>'day_of_week')::int,(data->>'start_date')::date,
      CASE data->>'end_mode' WHEN 'ongoing' THEN 'ongoing' WHEN 'after_weeks' THEN 'after_occurrences' WHEN 'on_date' THEN 'on_date' ELSE 'INVALID' END,
      CASE WHEN data->>'end_mode'='after_weeks' THEN (data->>'end_after_weeks')::int END,
      CASE WHEN data->>'end_mode'='on_date' THEN (data->>'end_date')::date END);
  END LOOP;
  FOR row IN SELECT source_row FROM scheduling_tennis_history WHERE organisation_id=org AND source_table='session_instances' ORDER BY source_id LOOP
    data:=row.source_row;
    IF data->>'status' NOT IN ('scheduled','cancelled') THEN RAISE EXCEPTION 'Unknown source occurrence status' USING ERRCODE='STHIS'; END IF;
    start_at:=((data->>'date')::date+(data->>'start_time')::time) AT TIME ZONE tz;
    finish_at:=start_at+make_interval(mins=>(data->>'duration_minutes')::int);
    IF start_at AT TIME ZONE tz<>((data->>'date')::date+(data->>'start_time')::time)
      THEN RAISE EXCEPTION 'Source local time does not exist' USING ERRCODE='STHIS'; END IF;
    INSERT INTO scheduling_occurrences(id,organisation_id,offering_id,local_date,local_start_time,timezone,starts_at,ends_at,capacity)
      VALUES(data->>'id',org,data->>'session_id',(data->>'date')::date,(data->>'start_time')::time,tz,start_at,finish_at,(data->>'max_capacity')::int);
  END LOOP;
  -- Identity is the explicit recurring group only; never group by name/email.
  FOR row IN SELECT source_row->>'recurring_group_id' group_id,
      jsonb_agg(source_row ORDER BY source_id)->0 sample,
      count(DISTINCT jsonb_build_array(source_row->>'session_id',source_row->>'client_name',source_row->>'client_email')) identities,
      bool_or((source_row->>'is_recurring')::boolean AND source_row->>'status'<>'cancelled') active
    FROM scheduling_tennis_history WHERE organisation_id=org AND source_table='bookings' AND source_row->>'recurring_group_id' IS NOT NULL
    GROUP BY source_row->>'recurring_group_id' ORDER BY source_row->>'recurring_group_id' LOOP
    IF row.identities<>1 THEN RAISE EXCEPTION 'Source lineage requires review' USING ERRCODE='STHIS'; END IF;
    data:=row.sample;
    INSERT INTO scheduling_series(id,organisation_id,offering_id,customer_name,customer_email,customer_email_normalised,customer_phone,timezone,status)
      VALUES(row.group_id,org,data->>'session_id',data->>'client_name',data->>'client_email',lower(btrim(data->>'client_email')),data->>'client_phone',tz,CASE WHEN row.active THEN 'active' ELSE 'ended' END);
  END LOOP;
  FOR row IN SELECT source_row FROM scheduling_tennis_history WHERE organisation_id=org AND source_table='booking_recurrence_pauses' ORDER BY source_id LOOP
    data:=row.source_row;
    INSERT INTO scheduling_series_pauses(id,organisation_id,series_id,pause_from,pause_until,reason,created_by)
      VALUES(data->>'id',org,data->>'recurring_group_id',(data->>'pause_from')::date,(data->>'pause_until')::date,data->>'reason',data->>'created_by');
  END LOOP;
  FOR row IN SELECT source_row FROM scheduling_tennis_history WHERE organisation_id=org AND source_table='bookings' ORDER BY source_id LOOP
    data:=row.source_row;
    IF data->>'status'='cancelled' THEN CONTINUE; END IF; -- Complete original row remains in immutable history; no invented cancellation timestamp.
    IF data->>'status' NOT IN ('confirmed','pending_confirmation') OR (data->>'attendance_status' IS NOT NULL AND data->>'attendance_status' NOT IN ('attending','absent'))
      THEN RAISE EXCEPTION 'Unknown source booking status' USING ERRCODE='STHIS'; END IF;
    IF NOT EXISTS(SELECT 1 FROM scheduling_tennis_history WHERE organisation_id=org AND source_table='session_instances'
      AND source_id=data->>'session_instance_id' AND source_row->>'status'='scheduled') THEN RAISE EXCEPTION 'Live booking needs open source occurrence' USING ERRCODE='STHIS'; END IF;
    INSERT INTO scheduling_reservations(id,organisation_id,schedule_id,preset_key,preset_version,offering_id,span_kind,occurrence_id,series_id,
      customer_name,customer_email,customer_email_normalised,customer_phone,timezone,local_start_date,local_start_time,local_end_date,local_end_time,
      starts_at,ends_at,party_size,status,attendance,price_cents,currency,notes,idempotency_key)
    SELECT data->>'id',org,'tennis-coaching','classes_coaching',1,data->>'session_id','occurrence',o.id,data->>'recurring_group_id',
      data->>'client_name',data->>'client_email',lower(btrim(data->>'client_email')),data->>'client_phone',tz,o.local_date,o.local_start_time,
      (o.ends_at AT TIME ZONE tz)::date,(o.ends_at AT TIME ZONE tz)::time,o.starts_at,o.ends_at,1,
      CASE data->>'status' WHEN 'confirmed' THEN 'confirmed' ELSE 'pending' END,
      CASE data->>'attendance_status' WHEN 'attending' THEN 'attended' WHEN 'absent' THEN 'absent' END,NULL,currency_code,data->>'notes','tennis-import-'||(data->>'id')
      FROM scheduling_occurrences o WHERE o.organisation_id=org AND o.id=data->>'session_instance_id';
    GET DIAGNOSTICS imported_count=ROW_COUNT;
    IF imported_count<>1 THEN RAISE EXCEPTION 'Missing source booking occurrence' USING ERRCODE='STHIS'; END IF;
    INSERT INTO scheduling_tennis_booking_origins(organisation_id,reservation_id,source_id,original_paid_marker)
      VALUES(org,data->>'id',data->>'id',(data->>'paid')::boolean);
    INSERT INTO scheduling_coaching_markers(organisation_id,reservation_id,paid_marker,updated_by)
      VALUES(org,data->>'id',(data->>'paid')::boolean,'tennis-history-import');
  END LOOP;
  UPDATE scheduling_occurrences o SET status='cancelled' FROM scheduling_tennis_history h
    WHERE h.organisation_id=org AND h.source_table='session_instances' AND h.source_row->>'status'='cancelled' AND o.organisation_id=org AND o.id=h.source_id;
  UPDATE scheduling_offerings f SET archived_at=(h.source_row->>'archived_at')::timestamptz FROM scheduling_tennis_history h
    WHERE h.organisation_id=org AND h.source_table='sessions' AND h.source_row->>'archived_at' IS NOT NULL AND f.organisation_id=org AND f.id=h.source_id;
  SELECT count(*),count(*) FILTER(WHERE source_row->>'status'<>'cancelled') INTO source_count,active_count FROM scheduling_tennis_history WHERE organisation_id=org AND source_table='bookings';
  SELECT count(*) INTO imported_count FROM scheduling_reservations WHERE organisation_id=org AND schedule_id='tennis-coaching';
  IF active_count<>imported_count THEN RAISE EXCEPTION 'Booking import count mismatch' USING ERRCODE='STHIS'; END IF;
  digest:=scheduling_tennis_target_manifest(org);
  totals:=jsonb_build_object('sourceBookings',source_count,'canonicalBookings',imported_count,'cancelledHistory',source_count-active_count);
  INSERT INTO scheduling_tennis_import_receipts(organisation_id,source_hash,target_hash,counts) VALUES(org,expected_hash,digest,totals);
  RETURN QUERY SELECT expected_hash,digest,totals;
END $$;
COMMIT;
