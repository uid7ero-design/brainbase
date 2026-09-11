-- HR-1 People Foundation — hr_administrators table.
-- Run once, manually, against the database. Can run independently of
-- scripts/create-hr-teams.sql / scripts/create-hr-people.sql (this
-- table only references organisations and users, both of which already
-- exist). NOT run automatically by this task.
--
-- Purpose: the explicit, dedicated HR-administration entitlement lib/hr/
-- access.ts's HrAccessContext.isHrAdministrator resolves from. Platform
-- super_admin and organisation HR-administration are deliberately
-- different concepts (see lib/hr/access.ts's own header comment) — no
-- code path in this codebase derives isHrAdministrator from
-- users.role, and this table is the ONLY source of truth for it.
-- created_by is nullable to allow a genuinely system/script-initiated
-- grant (e.g. an initial bootstrap insert run directly by an operator,
-- with no acting BrainBase user in the loop) without inventing a
-- placeholder user id — never NULL for a grant made through the
-- application's own API.
--
-- UNIQUE(organisation_id, user_id): a user holds the HR-administrator
-- grant for a given organisation at most once — re-granting is a
-- no-op, not a duplicate row.
--
-- Additive only: creates one new table. Does not touch organisations,
-- users, modules, organisation_modules, hr_teams, hr_people, or any
-- other existing table. No row is inserted by this script.

CREATE TABLE IF NOT EXISTS hr_administrators (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL REFERENCES organisations(id),
  user_id          TEXT        NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT        REFERENCES users(id),
  CONSTRAINT hr_administrators_organisation_id_user_id_key UNIQUE (organisation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_administrators_organisation_id ON hr_administrators(organisation_id);
