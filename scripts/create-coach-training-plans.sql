-- Apply separately from the squads release. No existing session is assigned a plan.
BEGIN;
CREATE TABLE IF NOT EXISTS scheduling_coach_training_plans (
  organisation_id text NOT NULL,
  occurrence_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  drills jsonb NOT NULL CHECK (jsonb_typeof(drills)='array'),
  PRIMARY KEY (organisation_id, occurrence_id),
  FOREIGN KEY (organisation_id, occurrence_id) REFERENCES scheduling_occurrences(organisation_id,id)
);
CREATE TABLE IF NOT EXISTS scheduling_coach_training_templates (
  organisation_id text NOT NULL REFERENCES organisations(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  drills jsonb NOT NULL CHECK (jsonb_typeof(drills)='array'),
  PRIMARY KEY (organisation_id,name)
);
COMMIT;
