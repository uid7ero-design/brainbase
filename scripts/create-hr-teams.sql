-- HR-1 People Foundation — hr_teams table.
-- Run once, manually, against the database, BEFORE
-- scripts/create-hr-people.sql (hr_people.team_id references this
-- table). NOT run automatically by this task.
--
-- Purpose: the smallest organisation-scoped team concept HR-1's People
-- directory needs — a name a person can belong to, nothing more. No
-- org-chart, no team hierarchy, no team-level settings beyond an
-- optional description and an optional team-manager link.
--
-- Conventions matched to the current, real schema (verified directly
-- against app/api/admin/migrate/route.ts's own organiser_boards/
-- organiser_groups steps, the most recent precedent for a new
-- organisation-scoped table in this codebase): a surrogate UUID id
-- (gen_random_uuid()), organisation_id as TEXT REFERENCES organisations
-- (id) — organisations.id is a Prisma cuid()-based TEXT column, never
-- UUID — and TIMESTAMPTZ timestamps.
--
-- manager_person_id is added as a plain nullable FK to hr_people.id. It
-- cannot be validated for organisation match by the FK alone (Postgres
-- has no cross-table composite-FK primitive for "this row's
-- organisation_id must equal the referenced row's organisation_id");
-- cross-org validation is enforced in the API layer instead, matching
-- every other organisation-scoped cross-reference check already in
-- this codebase (CRM, Organiser) — none of which uses a DB trigger for
-- this either. Declared here, but the actual FK constraint linking it
-- to hr_people(id) is added by scripts/create-hr-people.sql instead
-- (hr_people does not exist yet when this script runs), via a separate
-- ALTER TABLE at the end of that script.
--
-- Additive only: creates one new table. Does not touch organisations,
-- users, modules, organisation_modules, or any existing table.

CREATE TABLE IF NOT EXISTS hr_teams (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL REFERENCES organisations(id),
  name             TEXT        NOT NULL,
  description      TEXT,
  manager_person_id UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_teams_organisation_id ON hr_teams(organisation_id);
