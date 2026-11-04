-- STAGED ONLY. Restoration creates a new class identity. Historical occurrences,
-- cancellations, booking snapshots, markers and recurrence identities remain intact.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS scheduling_coaching_restorations (
  organisation_id text NOT NULL, original_offering_id text NOT NULL, restored_offering_id text NOT NULL,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organisation_id,original_offering_id), UNIQUE(organisation_id,restored_offering_id),
  FOREIGN KEY(organisation_id,original_offering_id) REFERENCES scheduling_offerings(organisation_id,id),
  FOREIGN KEY(organisation_id,restored_offering_id) REFERENCES scheduling_offerings(organisation_id,id),
  CHECK(original_offering_id<>restored_offering_id)
);
CREATE TABLE IF NOT EXISTS scheduling_coaching_restored_series (
  organisation_id text NOT NULL, original_series_id text NOT NULL, restored_series_id text NOT NULL,
  PRIMARY KEY(organisation_id,original_series_id), UNIQUE(organisation_id,restored_series_id),
  FOREIGN KEY(organisation_id,original_series_id) REFERENCES scheduling_series(organisation_id,id),
  FOREIGN KEY(organisation_id,restored_series_id) REFERENCES scheduling_series(organisation_id,id)
);
CREATE OR REPLACE TRIGGER scheduling_coaching_restorations_immutable BEFORE UPDATE OR DELETE ON scheduling_coaching_restorations
  FOR EACH ROW EXECUTE FUNCTION scheduling_coaching_command_immutable();
CREATE OR REPLACE TRIGGER scheduling_coaching_restored_series_immutable BEFORE UPDATE OR DELETE ON scheduling_coaching_restored_series
  FOR EACH ROW EXECUTE FUNCTION scheduling_coaching_command_immutable();

CREATE OR REPLACE TRIGGER scheduling_tennis_target_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_coaching_restorations FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_target_guard();
CREATE OR REPLACE TRIGGER scheduling_tennis_target_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling_coaching_restored_series FOR EACH ROW EXECUTE FUNCTION scheduling_tennis_target_guard();

CREATE OR REPLACE FUNCTION scheduling_coaching_archive_class(org text,class_id text,key text,actor text) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE body jsonb; result jsonb; protected_ids jsonb; cancelled_ids jsonb; offer scheduling_offerings%ROWTYPE;
BEGIN
  IF actor IS NULL OR btrim(actor)='' THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='STVAL'; END IF;
  body:=jsonb_build_object('kind','archive-class','offeringId',class_id);
  result:=scheduling_coaching_replay(org,key,body);IF result IS NOT NULL THEN RETURN result;END IF;
  PERFORM 1 FROM scheduling_tennis_cutover WHERE organisation_id=org AND phase='scheduling' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Archiving unavailable' USING ERRCODE='STOFF';END IF;
  PERFORM 1 FROM scheduling_schedules WHERE organisation_id=org AND id='tennis-coaching' AND archived_at IS NULL FOR SHARE;
  SELECT * INTO offer FROM scheduling_offerings WHERE organisation_id=org AND id=class_id AND schedule_id='tennis-coaching' FOR UPDATE;
  IF offer.id IS NULL OR offer.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Class unavailable' USING ERRCODE='STCLS';END IF;
  -- Drain marker/attendance writes before taking the fresh protection decision.
  PERFORM 1 FROM scheduling_reservations WHERE organisation_id=org AND offering_id=class_id AND starts_at>now() ORDER BY id FOR UPDATE;
  SELECT COALESCE(jsonb_agg(r.id),'[]') INTO protected_ids FROM scheduling_reservations r
    LEFT JOIN scheduling_coaching_markers m ON m.organisation_id=r.organisation_id AND m.reservation_id=r.id
    WHERE r.organisation_id=org AND r.offering_id=class_id AND r.starts_at>now() AND r.status<>'cancelled'
      AND (r.status<>'confirmed' OR r.attendance IS NOT NULL OR r.payment_status<>'unpaid' OR COALESCE(m.paid_marker,false));
  WITH changed AS(UPDATE scheduling_reservations r SET status='cancelled',cancelled_at=now()
    WHERE r.organisation_id=org AND r.offering_id=class_id AND r.starts_at>now() AND r.status='confirmed'
      AND NOT protected_ids ? r.id RETURNING id) SELECT COALESCE(jsonb_agg(id),'[]') INTO cancelled_ids FROM changed;
  UPDATE scheduling_occurrences o SET status='cancelled' WHERE o.organisation_id=org AND o.offering_id=class_id AND o.starts_at>now() AND o.status='scheduled'
    AND NOT EXISTS(SELECT 1 FROM scheduling_reservations r WHERE r.organisation_id=org AND r.occurrence_id=o.id AND r.status<>'cancelled');
  UPDATE scheduling_offerings SET archived_at=now() WHERE organisation_id=org AND id=class_id;
  result:=jsonb_build_object('offeringId',class_id,'cancelled',cancelled_ids,'protected',protected_ids);
  INSERT INTO scheduling_coaching_commands(organisation_id,command_key,request,result,actor_id) VALUES(org,key,body,result,actor);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION scheduling_coaching_restore_class(org text,class_id text,from_day date,expected text,plan jsonb,skipped jsonb,key text,actor text) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE body jsonb; result jsonb; offer scheduling_offerings%ROWTYPE; schedule scheduling_schedules%ROWTYPE;
  replacement scheduling_offerings%ROWTYPE; group_row scheduling_series%ROWTYPE; new_group scheduling_series%ROWTYPE;
  restored text:=gen_random_uuid()::text; token text; generated jsonb; fills jsonb:='[]'; filtered jsonb;
BEGIN
  IF actor IS NULL OR btrim(actor)='' OR from_day IS NULL OR jsonb_typeof(plan) IS DISTINCT FROM 'array' OR jsonb_array_length(plan)>100
    THEN RAISE EXCEPTION 'Invalid restoration' USING ERRCODE='STVAL'; END IF;
  body:=jsonb_build_object('kind','restore-class','offeringId',class_id,'from',from_day);
  result:=scheduling_coaching_replay(org,key,body); IF result IS NOT NULL THEN RETURN result; END IF;
  PERFORM 1 FROM scheduling_tennis_cutover WHERE organisation_id=org AND phase='scheduling' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restoration unavailable' USING ERRCODE='STOFF'; END IF;
  SELECT * INTO schedule FROM scheduling_schedules WHERE organisation_id=org AND id='tennis-coaching' AND archived_at IS NULL FOR SHARE;
  SELECT * INTO offer FROM scheduling_offerings WHERE organisation_id=org AND id=class_id AND schedule_id='tennis-coaching' FOR UPDATE;
  IF offer.id IS NULL OR offer.archived_at IS NULL OR schedule.id IS NULL THEN RAISE EXCEPTION 'Archived class unavailable' USING ERRCODE='STCLS'; END IF;
  token:=encode(sha256(convert_to(jsonb_build_array(to_jsonb(offer),schedule.timezone,schedule.archived_at)::text,'UTF8')),'hex');
  IF token IS DISTINCT FROM expected OR EXISTS(SELECT 1 FROM scheduling_coaching_restorations WHERE organisation_id=org AND original_offering_id=class_id)
    THEN RAISE EXCEPTION 'Class changed or already restored' USING ERRCODE='STCHG'; END IF;
  -- Imported Tennis classes have no inferred resource hold. If a coach has since
  -- configured resources or availability, restoration needs a reviewed plan.
  IF EXISTS(SELECT 1 FROM scheduling_offering_resources WHERE organisation_id=org AND offering_id=class_id)
    OR EXISTS(SELECT 1 FROM scheduling_availability_rules WHERE organisation_id=org AND offering_id=class_id)
    OR EXISTS(SELECT 1 FROM scheduling_availability_exceptions WHERE organisation_id=org AND offering_id=class_id)
    THEN RAISE EXCEPTION 'Resource configuration requires review before restoration' USING ERRCODE='STCFG'; END IF;
  replacement:=offer; replacement.id:=restored; replacement.archived_at:=NULL;
  replacement.created_by:=actor; replacement.created_at:=now(); replacement.updated_at:=now();
  INSERT INTO scheduling_offerings SELECT (replacement).*;
  INSERT INTO scheduling_coaching_restorations(organisation_id,original_offering_id,restored_offering_id,created_by) VALUES(org,class_id,restored,actor);
  -- Protected future dates stay with the original class. Never duplicate them.
  WITH RECURSIVE ancestors(id) AS (
    SELECT class_id UNION ALL SELECT r.original_offering_id FROM scheduling_coaching_restorations r JOIN ancestors a ON r.restored_offering_id=a.id WHERE r.organisation_id=org
  ) SELECT COALESCE(jsonb_agg(item||jsonb_build_object('offeringId',restored)),'[]') INTO filtered FROM jsonb_array_elements(plan) item
    WHERE NOT EXISTS(SELECT 1 FROM scheduling_occurrences o JOIN ancestors a ON a.id=o.offering_id
      WHERE o.organisation_id=org AND o.local_date=(item->>'date')::date AND o.status='scheduled');
  SELECT encode(sha256(convert_to(jsonb_build_array(to_jsonb(f),schedule.timezone,schedule.archived_at)::text,'UTF8')),'hex') INTO token
    FROM scheduling_offerings f WHERE organisation_id=org AND id=restored;
  generated:=scheduling_coaching_generate_classes(org,restored,from_day,token,filtered,skipped,encode(sha256(convert_to('restore-dates:'||key,'UTF8')),'hex'),actor);
  FOR group_row IN SELECT * FROM scheduling_series WHERE organisation_id=org AND offering_id=class_id AND status='active' ORDER BY id FOR UPDATE LOOP
    new_group:=group_row; new_group.id:=gen_random_uuid()::text;new_group.offering_id:=restored;new_group.created_by:=actor;new_group.created_at:=now();new_group.updated_at:=now();
    INSERT INTO scheduling_series SELECT (new_group).*;
    INSERT INTO scheduling_coaching_restored_series VALUES(org,group_row.id,new_group.id);
    INSERT INTO scheduling_series_pauses(id,organisation_id,series_id,pause_from,pause_until,reason,created_by)
      SELECT gen_random_uuid()::text,org,new_group.id,pause_from,pause_until,reason,actor FROM scheduling_series_pauses WHERE organisation_id=org AND series_id=group_row.id;
    fills:=fills||jsonb_build_object('seriesId',new_group.id,'result',scheduling_coaching_fill_series(org,new_group.id,from_day,from_day+70,
      encode(sha256(convert_to('restore-series:'||key||':'||group_row.id,'UTF8')),'hex'),actor));
  END LOOP;
  result:=jsonb_build_object('offeringId',restored,'originalOfferingId',class_id,'dates',generated,'enrolments',fills);
  INSERT INTO scheduling_coaching_commands(organisation_id,command_key,request,result,actor_id) VALUES(org,key,body,result,actor);
  RETURN result;
END $$;
COMMIT;
