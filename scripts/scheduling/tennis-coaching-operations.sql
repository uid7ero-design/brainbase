-- STAGED ONLY: canonical coaching commands. Requires shared Scheduling schema.
-- No organisation is enabled and no command is executed by installation.
BEGIN;
SET LOCAL lock_timeout='5s';
-- Attendance revisions also advance for other canonical writers. A changed-back
-- value must not make a stale screen look current again.
ALTER TABLE scheduling_reservations ADD COLUMN IF NOT EXISTS coaching_attendance_version integer NOT NULL DEFAULT 0 CHECK(coaching_attendance_version>=0);
CREATE OR REPLACE FUNCTION scheduling_coaching_attendance_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN NEW.coaching_attendance_version:=0;
  ELSIF NEW.attendance IS DISTINCT FROM OLD.attendance THEN NEW.coaching_attendance_version:=OLD.coaching_attendance_version+1;
  ELSE NEW.coaching_attendance_version:=OLD.coaching_attendance_version;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER scheduling_coaching_attendance_revision BEFORE INSERT OR UPDATE ON scheduling_reservations
  FOR EACH ROW EXECUTE FUNCTION scheduling_coaching_attendance_revision();
CREATE TABLE IF NOT EXISTS scheduling_coaching_commands (
  organisation_id text NOT NULL,
  command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9_-]{16,80}$'),
  request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  actor_id text NOT NULL CHECK(btrim(actor_id)<>''),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organisation_id,command_key)
);
CREATE TABLE IF NOT EXISTS scheduling_coaching_markers (
  organisation_id text NOT NULL,
  reservation_id text NOT NULL,
  paid_marker boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organisation_id,reservation_id),
  FOREIGN KEY(organisation_id,reservation_id) REFERENCES scheduling_reservations(organisation_id,id)
);
-- Converting Once to Weekly adds lineage without rewriting an immutable booking snapshot.
CREATE TABLE IF NOT EXISTS scheduling_coaching_series_links (
  organisation_id text NOT NULL,
  reservation_id text NOT NULL,
  series_id text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organisation_id,reservation_id),
  FOREIGN KEY(organisation_id,reservation_id) REFERENCES scheduling_reservations(organisation_id,id),
  FOREIGN KEY(organisation_id,series_id) REFERENCES scheduling_series(organisation_id,id)
);
CREATE OR REPLACE FUNCTION scheduling_coaching_command_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Coaching command history is immutable' USING ERRCODE='STHIS'; END $$;
CREATE OR REPLACE TRIGGER scheduling_coaching_command_immutable BEFORE UPDATE OR DELETE ON scheduling_coaching_commands
  FOR EACH ROW EXECUTE FUNCTION scheduling_coaching_command_immutable();
CREATE OR REPLACE TRIGGER scheduling_coaching_link_immutable BEFORE UPDATE OR DELETE ON scheduling_coaching_series_links
  FOR EACH ROW EXECUTE FUNCTION scheduling_coaching_command_immutable();

CREATE OR REPLACE FUNCTION scheduling_coaching_replay(org text,key text,body jsonb) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='5s' AS $$
DECLARE saved scheduling_coaching_commands%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Coaching requires read committed' USING ERRCODE='STISO'; END IF;
  IF key IS NULL OR key !~ '^[A-Za-z0-9_-]{16,80}$' THEN RAISE EXCEPTION 'Invalid command key' USING ERRCODE='STVAL'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('coaching-command:'||org||':'||key,0));
  SELECT * INTO saved FROM scheduling_coaching_commands WHERE organisation_id=org AND command_key=key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF saved.request IS DISTINCT FROM body THEN RAISE EXCEPTION 'Command key reused with different request' USING ERRCODE='STKEY'; END IF;
  RETURN saved.result;
END $$;

CREATE OR REPLACE FUNCTION scheduling_coaching_fill_series(org text,group_id text,from_day date,until_day date,key text,actor text) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE body jsonb; result jsonb; series scheduling_series%ROWTYPE; offer scheduling_offerings%ROWTYPE;
  occ scheduling_occurrences%ROWTYPE; new_id text; created jsonb:='[]'; full_dates jsonb:='[]'; paused_dates jsonb:='[]'; already int:=0;
BEGIN
  IF from_day IS NULL OR until_day IS NULL OR until_day<from_day OR until_day-from_day>70 OR actor IS NULL OR btrim(actor)=''
    THEN RAISE EXCEPTION 'Invalid coaching range' USING ERRCODE='STVAL'; END IF;
  body:=jsonb_build_object('kind','fill-series','seriesId',group_id,'from',from_day,'until',until_day);
  result:=scheduling_coaching_replay(org,key,body); IF result IS NOT NULL THEN RETURN result; END IF;
  -- Parent -> series -> occurrence order. Pause and refill share the series lock.
  PERFORM 1 FROM scheduling_series g JOIN scheduling_offerings f ON f.organisation_id=g.organisation_id AND f.id=g.offering_id
    JOIN scheduling_schedules s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id
    WHERE g.organisation_id=org AND g.id=group_id AND s.preset_key='classes_coaching' AND s.archived_at IS NULL AND f.archived_at IS NULL FOR SHARE OF s,f;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coaching series unavailable' USING ERRCODE='STCLS'; END IF;
  SELECT * INTO series FROM scheduling_series WHERE organisation_id=org AND id=group_id FOR UPDATE;
  IF series.status<>'active' THEN RAISE EXCEPTION 'Coaching series stopped' USING ERRCODE='STCLS'; END IF;
  SELECT * INTO offer FROM scheduling_offerings WHERE organisation_id=org AND id=series.offering_id;
  IF (SELECT count(*) FROM scheduling_occurrences WHERE organisation_id=org AND offering_id=offer.id AND local_date BETWEEN from_day AND until_day)>100
    THEN RAISE EXCEPTION 'Coaching range is too large' USING ERRCODE='STVAL'; END IF;
  FOR occ IN SELECT * FROM scheduling_occurrences WHERE organisation_id=org AND offering_id=offer.id AND local_date BETWEEN from_day AND until_day
    AND status='scheduled' AND starts_at>now() ORDER BY starts_at,id LOOP
    IF EXISTS(SELECT 1 FROM scheduling_series_pauses WHERE organisation_id=org AND series_id=group_id AND occ.local_date BETWEEN pause_from AND pause_until) THEN
      paused_dates:=paused_dates||to_jsonb(occ.local_date); CONTINUE;
    END IF;
    IF EXISTS(SELECT 1 FROM scheduling_reservations r WHERE r.organisation_id=org AND r.occurrence_id=occ.id AND r.status<>'cancelled'
      AND (r.series_id=group_id OR EXISTS(SELECT 1 FROM scheduling_coaching_series_links l WHERE l.organisation_id=org AND l.reservation_id=r.id AND l.series_id=group_id))) THEN
      already:=already+1; CONTINUE;
    END IF;
    BEGIN
      new_id:=gen_random_uuid()::text;
      INSERT INTO scheduling_reservations(id,organisation_id,schedule_id,preset_key,preset_version,offering_id,span_kind,occurrence_id,series_id,
        customer_id,customer_name,customer_email,customer_email_normalised,customer_phone,timezone,local_start_date,local_start_time,local_end_date,local_end_time,
        starts_at,ends_at,party_size,status,price_cents,currency,idempotency_key,created_by)
      SELECT new_id,org,s.id,s.preset_key,s.preset_version,offer.id,'occurrence',occ.id,group_id,series.customer_id,series.customer_name,series.customer_email,
        series.customer_email_normalised,series.customer_phone,occ.timezone,occ.local_date,occ.local_start_time,(occ.ends_at AT TIME ZONE occ.timezone)::date,
        (occ.ends_at AT TIME ZONE occ.timezone)::time,occ.starts_at,occ.ends_at,1,'confirmed',offer.price_cents,offer.currency,
        encode(sha256(convert_to(jsonb_build_array(key,group_id,occ.id)::text,'UTF8')),'hex'),actor
        FROM scheduling_schedules s WHERE s.organisation_id=org AND s.id=offer.schedule_id;
      created:=created||jsonb_build_object('id',new_id,'date',occ.local_date);
    EXCEPTION WHEN SQLSTATE 'SCCAP' THEN full_dates:=full_dates||to_jsonb(occ.local_date);
      WHEN unique_violation THEN
        IF EXISTS(SELECT 1 FROM scheduling_reservations WHERE organisation_id=org AND occurrence_id=occ.id AND status<>'cancelled'
          AND (series_id=group_id OR customer_email_normalised=series.customer_email_normalised OR customer_id=series.customer_id)) THEN already:=already+1;
        ELSE RAISE; END IF;
    END;
  END LOOP;
  result:=jsonb_build_object('created',created,'fullDates',full_dates,'pausedDates',paused_dates,'alreadyPresent',already);
  INSERT INTO scheduling_coaching_commands(organisation_id,command_key,request,result,actor_id) VALUES(org,key,body,result,actor);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION scheduling_coaching_pause_series(org text,group_id text,from_day date,until_day date,reason_text text,key text,actor text) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE body jsonb; result jsonb; group_row scheduling_series%ROWTYPE; pause_id text; cancelled jsonb; protected jsonb;
BEGIN
  IF from_day IS NULL OR until_day IS NULL OR until_day<from_day OR until_day-from_day>366 OR length(reason_text)>1000 OR actor IS NULL OR btrim(actor)=''
    THEN RAISE EXCEPTION 'Invalid coaching pause' USING ERRCODE='STVAL'; END IF;
  body:=jsonb_build_object('kind','pause-series','seriesId',group_id,'from',from_day,'until',until_day,'reason',reason_text);
  result:=scheduling_coaching_replay(org,key,body); IF result IS NOT NULL THEN RETURN result; END IF;
  PERFORM 1 FROM scheduling_series g JOIN scheduling_offerings f ON f.organisation_id=g.organisation_id AND f.id=g.offering_id
    JOIN scheduling_schedules s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id
    WHERE g.organisation_id=org AND g.id=group_id AND s.preset_key='classes_coaching' FOR SHARE OF s,f;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coaching series unavailable' USING ERRCODE='STCLS'; END IF;
  SELECT * INTO group_row FROM scheduling_series WHERE organisation_id=org AND id=group_id FOR UPDATE;
  IF group_row.status<>'active' THEN RAISE EXCEPTION 'Coaching series stopped' USING ERRCODE='STCLS'; END IF;
  -- Lock first, then read marker state in a fresh statement. A paid-marker write
  -- which committed while this waited must protect its booking from cancellation.
  PERFORM 1 FROM scheduling_reservations r WHERE r.organisation_id=org
    AND (r.series_id=group_id OR EXISTS(SELECT 1 FROM scheduling_coaching_series_links l WHERE l.organisation_id=org AND l.reservation_id=r.id AND l.series_id=group_id))
    AND r.local_start_date BETWEEN from_day AND until_day AND r.status IN ('pending','confirmed') AND r.starts_at>now() ORDER BY r.id FOR UPDATE;
  pause_id:=gen_random_uuid()::text;
  INSERT INTO scheduling_series_pauses(id,organisation_id,series_id,pause_from,pause_until,reason,created_by) VALUES(pause_id,org,group_id,from_day,until_day,reason_text,actor);
  SELECT COALESCE(jsonb_agg(r.id ORDER BY r.id),'[]') INTO protected FROM scheduling_reservations r
    WHERE r.organisation_id=org AND (r.series_id=group_id OR EXISTS(SELECT 1 FROM scheduling_coaching_series_links l WHERE l.organisation_id=org AND l.reservation_id=r.id AND l.series_id=group_id))
    AND r.local_start_date BETWEEN from_day AND until_day AND r.status IN ('pending','confirmed') AND r.starts_at>now()
    AND (r.attendance IS NOT NULL OR r.payment_status<>'unpaid' OR EXISTS(SELECT 1 FROM scheduling_coaching_markers m WHERE m.organisation_id=org AND m.reservation_id=r.id AND m.paid_marker));
  WITH changes AS (UPDATE scheduling_reservations r SET status='cancelled',cancelled_at=now(),cancelled_by='staff',cancel_reason='Coaching pause'
    WHERE r.organisation_id=org AND (r.series_id=group_id OR EXISTS(SELECT 1 FROM scheduling_coaching_series_links l WHERE l.organisation_id=org AND l.reservation_id=r.id AND l.series_id=group_id))
    AND r.local_start_date BETWEEN from_day AND until_day AND r.status IN ('pending','confirmed') AND r.starts_at>now()
      AND r.attendance IS NULL AND r.payment_status='unpaid' AND NOT EXISTS(SELECT 1 FROM scheduling_coaching_markers m WHERE m.organisation_id=org AND m.reservation_id=r.id AND m.paid_marker)
    RETURNING r.id) SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]') INTO cancelled FROM changes;
  result:=jsonb_build_object('pauseId',pause_id,'cancelled',cancelled,'protected',protected);
  INSERT INTO scheduling_coaching_commands(organisation_id,command_key,request,result,actor_id) VALUES(org,key,body,result,actor);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION scheduling_coaching_set_paid_marker(org text,booking_id text,paid boolean,expected_version int,key text,actor text) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='5s' AS $$
DECLARE body jsonb; result jsonb; current_version int; next_version int;
BEGIN
  IF paid IS NULL OR expected_version IS NULL OR expected_version<0 OR actor IS NULL OR btrim(actor)='' THEN RAISE EXCEPTION 'Invalid coaching marker' USING ERRCODE='STVAL'; END IF;
  body:=jsonb_build_object('kind','paid-marker','bookingId',booking_id,'paid',paid,'expectedVersion',expected_version);
  result:=scheduling_coaching_replay(org,key,body); IF result IS NOT NULL THEN RETURN result; END IF;
  PERFORM 1 FROM scheduling_reservations WHERE organisation_id=org AND id=booking_id AND preset_key='classes_coaching' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coaching booking unavailable' USING ERRCODE='STCLS'; END IF;
  SELECT version INTO current_version FROM scheduling_coaching_markers WHERE organisation_id=org AND reservation_id=booking_id;
  IF COALESCE(current_version,0)<>expected_version THEN RAISE EXCEPTION 'Coaching marker changed' USING ERRCODE='STCHG'; END IF;
  next_version:=expected_version+1;
  INSERT INTO scheduling_coaching_markers(organisation_id,reservation_id,paid_marker,version,updated_by) VALUES(org,booking_id,paid,next_version,actor)
    ON CONFLICT(organisation_id,reservation_id) DO UPDATE SET paid_marker=excluded.paid_marker,version=excluded.version,updated_by=excluded.updated_by,updated_at=now();
  result:=jsonb_build_object('paidMarker',paid,'version',next_version);
  INSERT INTO scheduling_coaching_commands(organisation_id,command_key,request,result,actor_id) VALUES(org,key,body,result,actor);
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION scheduling_coaching_resume_series(org text,group_id text,pause_id text,from_day date,until_day date,key text,actor text) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE body jsonb; result jsonb; removed scheduling_series_pauses%ROWTYPE; status text; refill jsonb;
BEGIN
  IF from_day IS NULL OR until_day IS NULL OR until_day<from_day OR until_day-from_day>70 OR actor IS NULL OR btrim(actor)=''
    THEN RAISE EXCEPTION 'Invalid coaching resume' USING ERRCODE='STVAL'; END IF;
  body:=jsonb_build_object('kind','resume-series','seriesId',group_id,'pauseId',pause_id,'from',from_day,'until',until_day);
  result:=scheduling_coaching_replay(org,key,body); IF result IS NOT NULL THEN RETURN result; END IF;
  PERFORM 1 FROM scheduling_series g JOIN scheduling_offerings f ON f.organisation_id=g.organisation_id AND f.id=g.offering_id
    JOIN scheduling_schedules s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id
    WHERE g.organisation_id=org AND g.id=group_id AND s.preset_key='classes_coaching' AND s.archived_at IS NULL AND f.archived_at IS NULL FOR SHARE OF s,f;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coaching series unavailable' USING ERRCODE='STCLS'; END IF;
  SELECT g.status INTO status FROM scheduling_series g WHERE g.organisation_id=org AND g.id=group_id FOR UPDATE;
  IF status<>'active' THEN RAISE EXCEPTION 'Coaching series stopped' USING ERRCODE='STCLS'; END IF;
  DELETE FROM scheduling_series_pauses WHERE organisation_id=org AND series_id=group_id AND id=pause_id RETURNING * INTO removed;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coaching pause unavailable' USING ERRCODE='STCLS'; END IF;
  refill:=scheduling_coaching_fill_series(org,group_id,from_day,until_day,encode(sha256(convert_to('resume-fill:'||key,'UTF8')),'hex'),actor);
  -- Keep the complete removed pause in immutable command history. Cancelled
  -- reservations remain cancelled; refill creates new identities where permitted.
  result:=jsonb_build_object('removedPause',to_jsonb(removed),'refill',refill);
  INSERT INTO scheduling_coaching_commands(organisation_id,command_key,request,result,actor_id) VALUES(org,key,body,result,actor);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION scheduling_coaching_start_weekly(org text,booking_id text,from_day date,until_day date,key text,actor text) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE body jsonb; result jsonb; booking scheduling_reservations%ROWTYPE; group_id text; refill jsonb;
BEGIN
  IF from_day IS NULL OR until_day IS NULL OR until_day<from_day OR until_day-from_day>70 OR actor IS NULL OR btrim(actor)=''
    THEN RAISE EXCEPTION 'Invalid weekly range' USING ERRCODE='STVAL'; END IF;
  body:=jsonb_build_object('kind','start-weekly','bookingId',booking_id,'from',from_day,'until',until_day);
  result:=scheduling_coaching_replay(org,key,body); IF result IS NOT NULL THEN RETURN result; END IF;
  SELECT * INTO booking FROM scheduling_reservations WHERE organisation_id=org AND id=booking_id AND preset_key='classes_coaching';
  IF NOT FOUND THEN RAISE EXCEPTION 'Coaching booking unavailable' USING ERRCODE='STCLS'; END IF;
  PERFORM 1 FROM scheduling_offerings f JOIN scheduling_schedules s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id
    WHERE f.organisation_id=org AND f.id=booking.offering_id AND f.archived_at IS NULL AND s.archived_at IS NULL FOR SHARE OF s,f;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coaching offering unavailable' USING ERRCODE='STCLS'; END IF;
  group_id:=booking.series_id;
  IF group_id IS NULL THEN
    SELECT series_id INTO group_id FROM scheduling_coaching_series_links WHERE organisation_id=org AND reservation_id=booking_id;
  END IF;
  IF group_id IS NULL THEN
    group_id:='weekly-'||encode(sha256(convert_to(jsonb_build_array(org,booking_id)::text,'UTF8')),'hex');
    INSERT INTO scheduling_series(id,organisation_id,offering_id,customer_id,customer_name,customer_email,customer_email_normalised,customer_phone,timezone,created_by)
      VALUES(group_id,org,booking.offering_id,booking.customer_id,booking.customer_name,booking.customer_email,booking.customer_email_normalised,booking.customer_phone,booking.timezone,actor)
      ON CONFLICT(organisation_id,id) DO NOTHING;
  END IF;
  PERFORM 1 FROM scheduling_series WHERE organisation_id=org AND id=group_id AND offering_id=booking.offering_id
    AND customer_name=booking.customer_name AND customer_email IS NOT DISTINCT FROM booking.customer_email FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coaching lineage mismatch' USING ERRCODE='STHIS'; END IF;
  SELECT * INTO booking FROM scheduling_reservations WHERE organisation_id=org AND id=booking_id FOR UPDATE;
  IF booking.status NOT IN ('pending','confirmed') OR booking.starts_at<=now() OR from_day<booking.local_start_date
    THEN RAISE EXCEPTION 'Coaching booking cannot start a weekly series' USING ERRCODE='STCLS'; END IF;
  IF booking.series_id IS NULL THEN
    INSERT INTO scheduling_coaching_series_links(organisation_id,reservation_id,series_id,created_by) VALUES(org,booking_id,group_id,actor)
      ON CONFLICT(organisation_id,reservation_id) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM scheduling_coaching_series_links WHERE organisation_id=org AND reservation_id=booking_id AND series_id=group_id)
      THEN RAISE EXCEPTION 'Coaching lineage changed' USING ERRCODE='STCHG'; END IF;
  END IF;
  UPDATE scheduling_series SET status='active' WHERE organisation_id=org AND id=group_id;
  refill:=scheduling_coaching_fill_series(org,group_id,from_day,until_day,encode(sha256(convert_to('start-weekly-fill:'||key,'UTF8')),'hex'),actor);
  result:=jsonb_build_object('seriesId',group_id,'refill',refill);
  INSERT INTO scheduling_coaching_commands(organisation_id,command_key,request,result,actor_id) VALUES(org,key,body,result,actor);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION scheduling_coaching_stop_weekly(org text,group_id text,after_day date,key text,actor text) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE body jsonb; result jsonb; cancelled jsonb; protected jsonb;
BEGIN
  IF after_day IS NULL OR actor IS NULL OR btrim(actor)='' THEN RAISE EXCEPTION 'Invalid weekly stop' USING ERRCODE='STVAL'; END IF;
  body:=jsonb_build_object('kind','stop-weekly','seriesId',group_id,'after',after_day);
  result:=scheduling_coaching_replay(org,key,body); IF result IS NOT NULL THEN RETURN result; END IF;
  PERFORM 1 FROM scheduling_series g JOIN scheduling_offerings f ON f.organisation_id=g.organisation_id AND f.id=g.offering_id
    JOIN scheduling_schedules s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id
    WHERE g.organisation_id=org AND g.id=group_id AND s.preset_key='classes_coaching' FOR SHARE OF s,f;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coaching series unavailable' USING ERRCODE='STCLS'; END IF;
  PERFORM 1 FROM scheduling_series WHERE organisation_id=org AND id=group_id FOR UPDATE;
  PERFORM 1 FROM scheduling_reservations r WHERE r.organisation_id=org
    AND (r.series_id=group_id OR EXISTS(SELECT 1 FROM scheduling_coaching_series_links l WHERE l.organisation_id=org AND l.reservation_id=r.id AND l.series_id=group_id))
    AND r.local_start_date>after_day AND r.status IN ('pending','confirmed') AND r.starts_at>now() ORDER BY r.id FOR UPDATE;
  UPDATE scheduling_series SET status='ended' WHERE organisation_id=org AND id=group_id;
  SELECT COALESCE(jsonb_agg(r.id ORDER BY r.id),'[]') INTO protected FROM scheduling_reservations r
    WHERE r.organisation_id=org AND (r.series_id=group_id OR EXISTS(SELECT 1 FROM scheduling_coaching_series_links l WHERE l.organisation_id=org AND l.reservation_id=r.id AND l.series_id=group_id))
    AND r.local_start_date>after_day AND r.status IN ('pending','confirmed') AND r.starts_at>now()
    AND (r.attendance IS NOT NULL OR r.payment_status<>'unpaid' OR EXISTS(SELECT 1 FROM scheduling_coaching_markers m WHERE m.organisation_id=org AND m.reservation_id=r.id AND m.paid_marker));
  WITH changes AS (UPDATE scheduling_reservations r SET status='cancelled',cancelled_at=now(),cancelled_by='staff',cancel_reason='Weekly enrolment stopped'
    WHERE r.organisation_id=org AND (r.series_id=group_id OR EXISTS(SELECT 1 FROM scheduling_coaching_series_links l WHERE l.organisation_id=org AND l.reservation_id=r.id AND l.series_id=group_id))
      AND r.local_start_date>after_day AND r.status IN ('pending','confirmed') AND r.starts_at>now() AND r.attendance IS NULL AND r.payment_status='unpaid'
      AND NOT EXISTS(SELECT 1 FROM scheduling_coaching_markers m WHERE m.organisation_id=org AND m.reservation_id=r.id AND m.paid_marker)
    RETURNING r.id) SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]') INTO cancelled FROM changes;
  result:=jsonb_build_object('seriesId',group_id,'cancelled',cancelled,'protected',protected);
  INSERT INTO scheduling_coaching_commands(organisation_id,command_key,request,result,actor_id) VALUES(org,key,body,result,actor);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION scheduling_coaching_booking_json(r scheduling_reservations) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('id',r.id,'occurrence_id',r.occurrence_id,'customer_name',r.customer_name,'customer_email',r.customer_email,
    'customer_phone',r.customer_phone,'notes',r.notes,'status',r.status,'attendance',r.attendance,'payment_status',r.payment_status,
    'coaching_attendance_version',r.coaching_attendance_version)
$$;
CREATE OR REPLACE FUNCTION scheduling_coaching_set_attendance(org text,booking_id text,value text,expected_version int,key text,actor text) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='5s' AS $$
DECLARE body jsonb; result jsonb; booking scheduling_reservations%ROWTYPE;
BEGIN
  IF (value IS NOT NULL AND value NOT IN ('attended','absent')) OR expected_version IS NULL OR expected_version<0 OR actor IS NULL OR btrim(actor)=''
    THEN RAISE EXCEPTION 'Invalid coaching attendance' USING ERRCODE='STVAL'; END IF;
  body:=jsonb_build_object('kind','attendance','bookingId',booking_id,'value',value,'expectedVersion',expected_version);
  result:=scheduling_coaching_replay(org,key,body); IF result IS NOT NULL THEN RETURN result; END IF;
  SELECT * INTO booking FROM scheduling_reservations WHERE organisation_id=org AND id=booking_id AND preset_key='classes_coaching' AND status='confirmed' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('booking',NULL); END IF;
  IF booking.coaching_attendance_version<>expected_version THEN RAISE EXCEPTION 'Coaching attendance changed' USING ERRCODE='STCHG'; END IF;
  UPDATE scheduling_reservations SET attendance=value WHERE organisation_id=org AND id=booking_id RETURNING * INTO booking;
  result:=jsonb_build_object('booking',scheduling_coaching_booking_json(booking));
  INSERT INTO scheduling_coaching_commands(organisation_id,command_key,request,result,actor_id) VALUES(org,key,body,result,actor);
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION scheduling_coaching_cancel_booking(org text,booking_id text) RETURNS jsonb LANGUAGE plpgsql SET lock_timeout='5s' AS $$
DECLARE booking scheduling_reservations%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Coaching requires read committed' USING ERRCODE='STISO'; END IF;
  SELECT * INTO booking FROM scheduling_reservations WHERE organisation_id=org AND id=booking_id AND preset_key='classes_coaching' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF booking.status='cancelled' THEN RETURN jsonb_build_object('ok',true,'replayed',true,'booking',scheduling_coaching_booking_json(booking)); END IF;
  IF booking.status NOT IN ('pending','confirmed') OR booking.starts_at<=now() OR booking.attendance IS NOT NULL OR booking.payment_status<>'unpaid'
    OR EXISTS(SELECT 1 FROM scheduling_coaching_markers WHERE organisation_id=org AND reservation_id=booking_id AND paid_marker)
    THEN RETURN jsonb_build_object('ok',false,'code','PROTECTED_HISTORY'); END IF;
  UPDATE scheduling_reservations SET status='cancelled',cancelled_at=now(),cancelled_by='staff',cancel_reason='Staff cancellation'
    WHERE organisation_id=org AND id=booking_id RETURNING * INTO booking;
  RETURN jsonb_build_object('ok',true,'replayed',false,'booking',scheduling_coaching_booking_json(booking));
END $$;
COMMIT;
