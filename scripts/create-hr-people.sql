-- HR-1 People Foundation — hr_people table.
-- Run once, manually, against the database, AFTER
-- scripts/create-hr-teams.sql (this table's team_id/manager_person_id
-- foreign keys require that table to already exist). NOT run
-- automatically by this task.
--
-- Purpose: the dedicated worker/employment-relationship record for
-- HR-1's People module. Deliberately NOT crm_contacts/contacts — those
-- represent external/customer relationships and remain untouched by
-- this phase (see the HR-1 report's Domain Boundary section). A
-- BrainBase login user MAY optionally be linked to a person record
-- (linked_user_id); a person record never requires a login.
--
-- Conventions matched to the current, real schema — see
-- scripts/create-hr-teams.sql's own header for the organisation_id/
-- timestamp rationale, shared here.
--
-- linked_user_id: nullable TEXT REFERENCES users(id). NEVER
-- auto-matched by email/name/phone — every link is created only by an
-- explicit API call naming both ids. UNIQUE(organisation_id,
-- linked_user_id) prevents the SAME user from being linked to two
-- person records in the SAME organisation at once (a plain UNIQUE
-- constraint already permits unlimited rows with linked_user_id = NULL,
-- since Postgres never considers NULL equal to NULL for uniqueness
-- purposes — every unlinked person record is already unaffected by this
-- constraint). This does not prevent one user from having a person
-- record in a DIFFERENT organisation, and does not by itself preclude a
-- later phase modelling multiple concurrent employment relationships
-- within one organisation — that would need this constraint reworked
-- (e.g. dropped, or narrowed to a specific relationship-type column
-- that does not exist yet), which is an explicit, separate decision for
-- that later phase, not assumed here. Cross-organisation validation
-- (the referenced user must belong to THIS organisation) cannot be
-- expressed by the FK alone and is enforced in the API layer, same as
-- team_id/manager_person_id below.
--
-- team_id: nullable UUID REFERENCES hr_teams(id). A person belongs to
-- zero or one team in HR-1.
--
-- manager_person_id: nullable UUID REFERENCES hr_people(id) (self-
-- referencing). CHECK (manager_person_id IS DISTINCT FROM id) blocks
-- self-management at the database level (a same-table, single-row
-- check — no cross-table query needed, unlike the cross-org checks
-- above). No hierarchy/tree feature beyond this single link is built in
-- HR-1.
--
-- worker_type / employment_status: plain inline CHECK constraints
-- (not the guarded DO $$ ... END $$ pattern used elsewhere in this
-- codebase to ADD a constraint to an ALREADY-EXISTING table without
-- erroring on re-run) — this table is created fresh behind CREATE
-- TABLE IF NOT EXISTS, so no such idempotency concern applies; a plain
-- CHECK clause in the CREATE TABLE statement is standard and correct
-- here. No pre-existing worker-type/employment-status vocabulary was
-- found anywhere else in this codebase (verified by direct search), so
-- HR-1 introduces its own minimal, product-friendly set, per the HR-1
-- brief's own suggested values — no employment-law modelling attempted.
--
-- Deliberately excluded from this table (see the HR-1 brief's own
-- exclusion list): no bank details, salary, tax file numbers, super,
-- medical/disability data, grievance/disciplinary records, background/
-- police checks, visa/passport data, leave balances, payroll,
-- timesheets, contracts, documents, or any freeform "notes" column. No
-- speculative JSON blob for "future HR data" either.
--
-- Additive only: creates one new table, then (via the ALTER TABLE at
-- the end of this script) completes hr_teams.manager_person_id's
-- deferred foreign key, which could not be added when hr_teams was
-- created because hr_people did not exist yet. Does not touch
-- organisations, users, modules, organisation_modules, or any other
-- existing table/constraint.

CREATE TABLE IF NOT EXISTS hr_people (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    TEXT        NOT NULL REFERENCES organisations(id),
  linked_user_id     TEXT        REFERENCES users(id),
  first_name         TEXT        NOT NULL,
  last_name          TEXT        NOT NULL,
  preferred_name     TEXT,
  work_email         TEXT,
  work_phone         TEXT,
  job_title          TEXT,
  worker_type        TEXT        NOT NULL DEFAULT 'employee'
    CHECK (worker_type IN ('employee', 'contractor', 'casual', 'volunteer', 'other')),
  employment_status  TEXT        NOT NULL DEFAULT 'active'
    CHECK (employment_status IN ('active', 'inactive', 'onboarding', 'ended')),
  team_id            UUID        REFERENCES hr_teams(id),
  manager_person_id  UUID        REFERENCES hr_people(id)
    CHECK (manager_person_id IS DISTINCT FROM id),
  start_date         DATE,
  end_date           DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hr_people_organisation_id_linked_user_id_key UNIQUE (organisation_id, linked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_people_organisation_id ON hr_people(organisation_id);
CREATE INDEX IF NOT EXISTS idx_hr_people_team_id ON hr_people(team_id);
CREATE INDEX IF NOT EXISTS idx_hr_people_manager_person_id ON hr_people(manager_person_id);
CREATE INDEX IF NOT EXISTS idx_hr_people_linked_user_id ON hr_people(linked_user_id);

-- Completes hr_teams.manager_person_id's foreign key, deferred from
-- scripts/create-hr-teams.sql because hr_people did not exist yet.
-- Guarded so re-running this script (or running it against a database
-- where the constraint was already added) does not error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hr_teams_manager_person_id_fkey'
  ) THEN
    ALTER TABLE hr_teams
      ADD CONSTRAINT hr_teams_manager_person_id_fkey
      FOREIGN KEY (manager_person_id) REFERENCES hr_people(id);
  END IF;
END $$;
