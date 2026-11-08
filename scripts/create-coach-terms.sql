-- Apply before deploying Coach term scheduling. Existing single dates have no term membership.
BEGIN;
CREATE TABLE IF NOT EXISTS scheduling_coach_terms (
  organisation_id text NOT NULL,
  offering_id text NOT NULL,
  id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, offering_id, id),
  FOREIGN KEY (organisation_id, offering_id) REFERENCES scheduling_offerings(organisation_id,id)
);
CREATE TABLE IF NOT EXISTS scheduling_coach_term_dates (
  organisation_id text NOT NULL,
  offering_id text NOT NULL,
  term_id uuid NOT NULL,
  occurrence_id text NOT NULL,
  PRIMARY KEY (organisation_id, occurrence_id),
  FOREIGN KEY (organisation_id, offering_id, term_id) REFERENCES scheduling_coach_terms(organisation_id,offering_id,id),
  FOREIGN KEY (occurrence_id, offering_id, organisation_id) REFERENCES scheduling_occurrences(id,offering_id,organisation_id)
);
CREATE INDEX IF NOT EXISTS scheduling_coach_dates_term_idx
  ON scheduling_coach_term_dates(organisation_id,offering_id,term_id);
COMMIT;
