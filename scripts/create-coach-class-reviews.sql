BEGIN;
CREATE TABLE IF NOT EXISTS scheduling_coach_class_reviews (
  organisation_id text NOT NULL,
  occurrence_id text NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 1500),
  version integer NOT NULL CHECK (version > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, occurrence_id),
  FOREIGN KEY (organisation_id, occurrence_id) REFERENCES scheduling_occurrences(organisation_id,id)
);
COMMIT;
