-- STAGED ONLY. Atomic public booking plus the existing client pipeline handover.
-- Does not enable an organisation or change the source of truth.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION scheduling_tennis_public_book(org text,occurrence text,person_name text,email text,phone text,key text) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE body jsonb; result jsonb; basis record; booking_id text:=gen_random_uuid()::text; pipeline_id uuid:=gen_random_uuid();
BEGIN
  IF org IS DISTINCT FROM '8ecd003b-583f-4616-a830-8dbf8aa51d2c' OR person_name IS NULL OR btrim(person_name)='' OR length(person_name)>200
    OR email IS NULL OR length(email)>320 OR email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(phone)>80
    THEN RAISE EXCEPTION 'Invalid public booking' USING ERRCODE='STVAL'; END IF;
  body:=jsonb_build_object('kind','public-book','occurrenceId',occurrence,'name',btrim(person_name),'email',lower(btrim(email)),'phone',phone);
  result:=scheduling_coaching_replay(org,key,body); IF result IS NOT NULL THEN RETURN result; END IF;
  -- Shares the cutover row lock with every canonical writer. A freeze drains
  -- this entire transaction, including its pipeline handover and receipt.
  PERFORM 1 FROM scheduling_tennis_cutover c JOIN scheduling_tennis_import_receipts r ON r.organisation_id=c.organisation_id AND r.source_hash=c.captured_hash
    JOIN organisations n ON n.id=c.organisation_id AND n.slug='ld-tennis' AND n.status='ACTIVE'
    JOIN organisation_modules om ON om.organisation_id=n.id AND om.module_key='scheduling' AND om.enabled=true
    JOIN modules m ON m.key=om.module_key AND m.active=true
    WHERE c.organisation_id=org AND c.phase='scheduling' FOR SHARE OF c,n,om,m;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking handover unavailable' USING ERRCODE='STOFF'; END IF;
  SELECT o.*,f.name,f.type_key,f.price_cents,f.currency,s.preset_version INTO basis FROM scheduling_occurrences o
    JOIN scheduling_offerings f ON f.organisation_id=o.organisation_id AND f.id=o.offering_id
    JOIN scheduling_schedules s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id
    WHERE o.organisation_id=org AND o.id=occurrence AND s.id='tennis-coaching' AND s.preset_key='classes_coaching'
      AND o.status='scheduled' AND o.starts_at>now() AND s.archived_at IS NULL AND f.archived_at IS NULL FOR SHARE OF s,f,o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class unavailable' USING ERRCODE='STCLS'; END IF;
  INSERT INTO scheduling_reservations(id,organisation_id,schedule_id,preset_key,preset_version,offering_id,span_kind,occurrence_id,
    customer_name,customer_email,customer_email_normalised,customer_phone,timezone,local_start_date,local_start_time,local_end_date,local_end_time,
    starts_at,ends_at,party_size,status,price_cents,currency,idempotency_key)
    VALUES(booking_id,org,'tennis-coaching','classes_coaching',basis.preset_version,basis.offering_id,'occurrence',basis.id,
      btrim(person_name),lower(btrim(email)),lower(btrim(email)),phone,basis.timezone,basis.local_date,basis.local_start_time,
      (basis.ends_at AT TIME ZONE basis.timezone)::date,(basis.ends_at AT TIME ZONE basis.timezone)::time,
      basis.starts_at,basis.ends_at,1,'confirmed',basis.price_cents,basis.currency,key);
  INSERT INTO client_pipeline(id,organisation_id,type,title,description,status,priority)
    VALUES(pipeline_id,org,'request',basis.name||' — '||basis.local_date::text,
      'Booked by '||btrim(person_name)||' via website · '||COALESCE(basis.type_key,'coaching')||' · '||basis.local_start_time::text||COALESCE(' · '||phone,''),'new','medium');
  INSERT INTO pipeline_messages(pipeline_id,organisation_id,author_type,body)
    VALUES(pipeline_id,org,'client','Booked online: '||basis.name||' on '||basis.local_date::text||' at '||basis.local_start_time::text||' · Booking '||booking_id);
  result:=jsonb_build_object('success',true,'booking',jsonb_build_object('id',booking_id,'session_name',basis.name,'date',basis.local_date,'start_time',basis.local_start_time));
  INSERT INTO scheduling_coaching_commands(organisation_id,command_key,request,result,actor_id) VALUES(org,key,body,result,'public');
  RETURN result;
END $$;
COMMIT;
