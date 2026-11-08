-- Apply after create-coach-terms.sql. No existing classes or bookings are enrolled.
BEGIN;
CREATE TABLE IF NOT EXISTS scheduling_coach_squads (
  organisation_id text NOT NULL REFERENCES organisations(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  PRIMARY KEY (organisation_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS scheduling_coach_squad_names
  ON scheduling_coach_squads(organisation_id,lower(btrim(name)));

CREATE TABLE IF NOT EXISTS scheduling_coach_squad_members (
  organisation_id text NOT NULL,
  squad_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  email text NOT NULL CHECK (email=lower(btrim(email)) AND length(email) BETWEEN 3 AND 320),
  first_day date NOT NULL,
  last_day date CHECK (last_day >= first_day-1),
  PRIMARY KEY (organisation_id,squad_id,id),
  FOREIGN KEY (organisation_id,squad_id) REFERENCES scheduling_coach_squads
);
CREATE INDEX IF NOT EXISTS scheduling_coach_squad_email
  ON scheduling_coach_squad_members(organisation_id,squad_id,email);

CREATE TABLE IF NOT EXISTS scheduling_coach_squad_terms (
  organisation_id text NOT NULL,
  squad_id uuid NOT NULL,
  offering_id text NOT NULL,
  term_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organisation_id,offering_id,term_id),
  FOREIGN KEY (organisation_id,squad_id) REFERENCES scheduling_coach_squads,
  FOREIGN KEY (organisation_id,offering_id,term_id) REFERENCES scheduling_coach_terms
);
CREATE INDEX IF NOT EXISTS scheduling_coach_squad_training
  ON scheduling_coach_squad_terms(organisation_id,squad_id);

-- Call only for a newly attached term or newly added membership, under the squad lock.
CREATE OR REPLACE FUNCTION coach_book_squad_training(
  org text, squad uuid, actor text, member_filter uuid, term_filter uuid
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO scheduling_reservations (
    id,organisation_id,schedule_id,preset_key,preset_version,offering_id,occurrence_id,span_kind,
    customer_name,customer_email,customer_email_normalised,timezone,local_start_date,local_start_time,
    local_end_date,local_end_time,starts_at,ends_at,party_size,status,price_cents,currency,idempotency_key,created_by)
  SELECT gen_random_uuid()::text,org,s.id,s.preset_key,s.preset_version,f.id,o.id,'occurrence',
    m.name,m.email,m.email,o.timezone,o.local_date,o.local_start_time,(o.ends_at AT TIME ZONE o.timezone)::date,
    (o.ends_at AT TIME ZONE o.timezone)::time,o.starts_at,o.ends_at,1,'confirmed',f.price_cents,f.currency,
    'squad:'||m.id||':'||o.id,actor
  FROM scheduling_coach_squad_members m
  JOIN scheduling_coach_squad_terms st USING (organisation_id,squad_id)
  JOIN scheduling_coach_term_dates d USING (organisation_id,offering_id,term_id)
  JOIN scheduling_occurrences o ON (o.organisation_id,o.offering_id,o.id)=(d.organisation_id,d.offering_id,d.occurrence_id)
  JOIN scheduling_offerings f ON (f.organisation_id,f.id)=(o.organisation_id,o.offering_id)
  JOIN scheduling_schedules s ON (s.organisation_id,s.id)=(f.organisation_id,f.schedule_id)
  WHERE m.organisation_id=org AND m.squad_id=squad AND (member_filter IS NULL OR m.id=member_filter)
    AND (term_filter IS NULL OR st.term_id=term_filter) AND s.preset_key='classes_coaching'
    AND s.id<>'tennis-coaching' AND s.archived_at IS NULL AND f.archived_at IS NULL
    AND o.status='scheduled' AND o.starts_at>now()
    AND o.starts_at>=st.assigned_at AND o.local_date >= m.first_day AND (m.last_day IS NULL OR o.local_date<=m.last_day)
  ORDER BY o.starts_at,o.id,m.id;
$$;

CREATE OR REPLACE FUNCTION coach_add_squad_member(
  org text,squad uuid,actor text,player text,address text,first_date date
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE member uuid;
BEGIN
  PERFORM 1 FROM scheduling_coach_squads WHERE organisation_id=org AND id=squad FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Squad unavailable' USING ERRCODE='CS404'; END IF;
  IF EXISTS (SELECT 1 FROM scheduling_coach_squad_members WHERE organisation_id=org AND squad_id=squad
    AND email=address AND (last_day IS NULL OR last_day>=first_date)) THEN
    RAISE EXCEPTION 'Overlapping membership' USING ERRCODE='CS409';
  END IF;
  INSERT INTO scheduling_coach_squad_members(organisation_id,squad_id,name,email,first_day)
    VALUES(org,squad,player,address,first_date) RETURNING id INTO member;
  PERFORM coach_book_squad_training(org,squad,actor,member,NULL);
END;
$$;

CREATE OR REPLACE FUNCTION coach_assign_squad_term(
  org text,squad uuid,actor text,offering text,term uuid,expected_fee integer,expected_currency text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM scheduling_coach_squads WHERE organisation_id=org AND id=squad FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Squad unavailable' USING ERRCODE='CS404'; END IF;
  PERFORM 1 FROM scheduling_coach_terms t JOIN scheduling_offerings f ON f.id=t.offering_id AND f.organisation_id=t.organisation_id
    JOIN scheduling_schedules s ON s.id=f.schedule_id AND s.organisation_id=f.organisation_id
    WHERE t.organisation_id=org AND t.offering_id=offering AND t.id=term AND s.id<>'tennis-coaching'
      AND s.preset_key='classes_coaching' AND s.archived_at IS NULL AND f.archived_at IS NULL
      AND f.price_cents=expected_fee AND f.currency=expected_currency
      AND EXISTS (SELECT 1 FROM scheduling_coach_term_dates d JOIN scheduling_occurrences o
        ON o.organisation_id=d.organisation_id AND o.id=d.occurrence_id
        WHERE d.organisation_id=org AND d.offering_id=offering AND d.term_id=term AND o.starts_at>now() AND o.status='scheduled')
    FOR SHARE OF f,s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Term unavailable' USING ERRCODE='CS404'; END IF;
  INSERT INTO scheduling_coach_squad_terms(organisation_id,squad_id,offering_id,term_id) VALUES(org,squad,offering,term);
  PERFORM coach_book_squad_training(org,squad,actor,NULL,term);
END;
$$;

-- The effective date is the first day outside the old team. A failed transfer rolls back both sides.
CREATE OR REPLACE FUNCTION coach_leave_squad(
  org text,squad uuid,actor text,member uuid,effective date,destination uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE old scheduling_coach_squad_members%ROWTYPE;
DECLARE booking scheduling_reservations%ROWTYPE;
BEGIN
  IF squad=destination THEN RAISE EXCEPTION 'Choose a different squad' USING ERRCODE='CS409'; END IF;
  PERFORM 1 FROM scheduling_coach_squads WHERE organisation_id=org AND id IN (squad,destination) ORDER BY id FOR UPDATE;
  SELECT * INTO old FROM scheduling_coach_squad_members
    WHERE organisation_id=org AND squad_id=squad AND id=member AND last_day IS NULL FOR UPDATE;
  IF NOT FOUND OR effective<old.first_day THEN RAISE EXCEPTION 'Review effective dates' USING ERRCODE='CS409'; END IF;
  FOR booking IN SELECT r.* FROM scheduling_coach_squad_terms st
    JOIN scheduling_coach_term_dates d USING (organisation_id,offering_id,term_id)
    JOIN scheduling_reservations r ON r.organisation_id=d.organisation_id AND r.occurrence_id=d.occurrence_id
      AND r.idempotency_key='squad:'||member||':'||d.occurrence_id
    WHERE st.organisation_id=org AND st.squad_id=squad AND r.status<>'cancelled' AND r.local_start_date>=effective
    ORDER BY r.starts_at,r.id FOR UPDATE OF r
  LOOP
    IF booking.starts_at<=now() OR booking.attendance IS NOT NULL OR booking.payment_status<>'unpaid' OR booking.status<>'confirmed' THEN
      RAISE EXCEPTION 'Booking requires individual review' USING ERRCODE='CSHIS';
    END IF;
    UPDATE scheduling_reservations SET status='cancelled',cancelled_at=now(),cancelled_by='staff',
      cancel_reason='Squad membership ended',updated_at=now() WHERE organisation_id=org AND id=booking.id;
  END LOOP;
  UPDATE scheduling_coach_squad_members SET last_day=effective-1 WHERE organisation_id=org AND squad_id=squad AND id=member;
  IF destination IS NOT NULL THEN PERFORM coach_add_squad_member(org,destination,actor,old.name,old.email,effective); END IF;
END;
$$;
COMMIT;
