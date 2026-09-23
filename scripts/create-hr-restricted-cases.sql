-- HR-6 PR-1 - restricted HR case schema foundation: five new tables.
-- Run once, manually, against the database, AFTER
-- scripts/add-hr-people-tenant-unique.sql (hr_restricted_case_participants
-- composite-FKs onto the hr_people_organisation_id_id_key constraint that
-- script adds; the pre-flight block below refuses to create anything
-- until that constraint exists). NOT run automatically by this task.
-- Verified only against a local, disposable Postgres container by
-- scripts/tests/verify-hr-restricted-cases-migration.sh.
--
-- Purpose: the storage foundation for restricted HR case records
-- (grievance, disciplinary, investigation, other). PR-1 is schema only:
-- no route, helper, UI, capability, module-registry entry, seed row or AI
-- surface reads or writes these tables. Every access and lifecycle rule
-- for them is application work for later PRs (PR-2+).
--
-- Tables, in creation (dependency) order:
--   hr_restricted_cases              one row per case
--   hr_restricted_case_participants  hr_people records involved in a case
--   hr_restricted_case_access        per-user access grants to a case
--   hr_restricted_case_notes         case notes
--   hr_restricted_case_documents     document METADATA only (no file bytes)
--
-- Conventions matched to the current, real schema (see the headers of
-- scripts/create-hr-teams.sql and scripts/create-hr-people.sql): surrogate
-- UUID ids (gen_random_uuid()), organisation_id and every user reference
-- as TEXT (organisations.id and users.id are TEXT in the live database,
-- never UUID), TIMESTAMPTZ timestamps. No trigger maintains updated_at;
-- as with hr_people and hr_teams, later write paths must set it
-- explicitly.
--
-- Every CHECK, UNIQUE and composite FOREIGN KEY constraint is declared at
-- table level with an explicit, stable name (no anonymous inline CHECKs),
-- so later code, tests and error handling can rely on the names.
--
-- TENANT INTEGRITY - what the DATABASE enforces:
--   * hr_restricted_cases declares UNIQUE (organisation_id, id)
--     (hr_restricted_cases_organisation_id_id_key) so child tables can
--     composite-FK onto it.
--   * Every child table's case relation is
--       FOREIGN KEY (organisation_id, case_id)
--         REFERENCES hr_restricted_cases (organisation_id, id)
--     so a child row can only reference a case in its OWN organisation.
--   * hr_restricted_case_participants' person relation is
--       FOREIGN KEY (organisation_id, person_id)
--         REFERENCES hr_people (organisation_id, id)
--     so a participant can only be a person record of the SAME
--     organisation.
--   * Every column in those composite FKs is NOT NULL, so the default
--     MATCH SIMPLE semantics can never skip the check.
--
-- TENANT INTEGRITY - what the database does NOT enforce (a documented
-- limitation, proven by the harness rather than merely asserted):
--   opened_by, user_id, granted_by, revoked_by, author_id and uploaded_by
--   are single-column FKs to users(id). They prove the user EXISTS, not
--   that the user belongs to the case's organisation: users has no
--   (organisation_id, id) anchor, and adding one is outside PR-1's locked
--   scope. A direct SQL write can therefore reference a user from another
--   organisation and still satisfy every constraint in this file.
--   Same-organisation validation of these user references is
--   APPLICATION-ENFORCED, and must be implemented by the later PRs that
--   add write paths (the same model HR-1 uses for
--   hr_people.linked_user_id).
--
-- LIFECYCLE INVARIANTS - intended APPLICATION-LAYER rules for later PRs,
-- NOT enforced by this schema. Postgres permits UPDATE and DELETE on every
-- one of these tables; no trigger, rule or privilege change is added here
-- to prevent either:
--   * Cases are never hard-deleted; they are closed instead (status =
--     'closed' with closed_at set). Stated precisely: none of these
--     foreign keys declares an ON DELETE action (Postgres default: NO
--     ACTION), so a case that still has participant, access, note or
--     document rows cannot be deleted until those rows are removed first.
--     That is ordinary FK behaviour, NOT a no-delete guarantee: a case
--     with no child rows can be deleted by direct SQL.
--   * Access grants are revoked (revoked_at and revoked_by set), never
--     deleted or overwritten, so grant history is preserved. The database
--     only enforces that revoked_at and revoked_by are set together, and
--     that at most one LIVE grant exists per (case_id, user_id). It does
--     not stop a grant row being deleted or a revocation being cleared.
--   * Notes are append-only (no edit, no delete). This is a FUTURE
--     APPLICATION LIFECYCLE RULE, not schema-enforced.
--   * Documents are soft-deleted via deleted_at, never hard-deleted. This
--     is an application lifecycle rule, not a database prohibition.
--
-- AI containment: every table name starts with hr_, so
-- lib/hlna/dataEngine.ts's DENIED_TABLE_PATTERNS (/^hr_/i) already
-- rejects all five in assertTablesAllowed(). No ALLOWED_TABLES or
-- DB_SCHEMA change is made or needed; see
-- tests/containment/hrRestrictedAiContainment.test.ts.
--
-- Additive only: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT
-- EXISTS, plus one read-only pre-flight check. No DROP, no DELETE, no
-- TRUNCATE, no UPDATE, no ALTER of any existing table, no row written.
-- Safe to re-run.
--
-- Rollback: nothing to do for an application rollback (PR-1 ships no
-- application code). Removing these tables is deliberately NOT scripted
-- here: it would be a separate, explicitly approved migration, and once
-- rows exist it would permanently destroy restricted case records.

-- Pre-flight (read-only): refuse to create anything unless the hr_people
-- tenant anchor from scripts/add-hr-people-tenant-unique.sql exists, so a
-- wrong run order fails before any table is created, not part-way through
-- this file.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = to_regclass('hr_people')
      AND conname = 'hr_people_organisation_id_id_key'
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'hr_people_organisation_id_id_key is missing: run scripts/add-hr-people-tenant-unique.sql before scripts/create-hr-restricted-cases.sql';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. hr_restricted_cases - one row per restricted case.
--
-- status and closed_at must agree: status is 'closed' if and only if
-- closed_at is set (hr_restricted_cases_status_closed_at_check). The CHECK
-- only enforces that the pair is consistent; which status transitions are
-- allowed (for example whether a closed case may be reopened) is an
-- application decision for a later PR. reference is an optional
-- free-text external or file reference with no uniqueness rule in PR-1.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_restricted_cases (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL REFERENCES organisations(id),
  case_type        TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'open',
  title            TEXT        NOT NULL,
  reference        TEXT,
  opened_by        TEXT        NOT NULL REFERENCES users(id),
  closed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hr_restricted_cases_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT hr_restricted_cases_case_type_check
    CHECK (case_type IN ('grievance', 'disciplinary', 'investigation', 'other')),
  CONSTRAINT hr_restricted_cases_status_check
    CHECK (status IN ('open', 'closed')),
  CONSTRAINT hr_restricted_cases_status_closed_at_check
    CHECK ((status = 'closed' AND closed_at IS NOT NULL) OR (status <> 'closed' AND closed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_hr_restricted_cases_organisation_id ON hr_restricted_cases(organisation_id);
CREATE INDEX IF NOT EXISTS idx_hr_restricted_cases_opened_by ON hr_restricted_cases(opened_by);

-- ---------------------------------------------------------------------
-- 2. hr_restricted_case_participants - hr_people records involved in a
-- case (a participant is a person record, never a login user; a person
-- needs no BrainBase login to be involved in a case).
--
-- role_in_case vocabulary is locked for PR-1: subject, complainant,
-- respondent, witness, other. UNIQUE (organisation_id, case_id,
-- person_id) means a person appears at most once per case, so in PR-1 a
-- person holds exactly one role in a given case.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_restricted_case_participants (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL REFERENCES organisations(id),
  case_id          UUID        NOT NULL,
  person_id        UUID        NOT NULL,
  role_in_case     TEXT        NOT NULL DEFAULT 'subject',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hr_restricted_case_participants_org_case_fkey
    FOREIGN KEY (organisation_id, case_id) REFERENCES hr_restricted_cases (organisation_id, id),
  CONSTRAINT hr_restricted_case_participants_org_person_fkey
    FOREIGN KEY (organisation_id, person_id) REFERENCES hr_people (organisation_id, id),
  CONSTRAINT hr_restricted_case_participants_org_case_person_key
    UNIQUE (organisation_id, case_id, person_id),
  CONSTRAINT hr_restricted_case_participants_role_in_case_check
    CHECK (role_in_case IN ('subject', 'complainant', 'respondent', 'witness', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_hr_restricted_case_participants_organisation_id ON hr_restricted_case_participants(organisation_id);
CREATE INDEX IF NOT EXISTS idx_hr_restricted_case_participants_case_id ON hr_restricted_case_participants(case_id);
CREATE INDEX IF NOT EXISTS idx_hr_restricted_case_participants_person_id ON hr_restricted_case_participants(person_id);

-- ---------------------------------------------------------------------
-- 3. hr_restricted_case_access - per-user access grants to one case.
--
-- A grant is LIVE while revoked_at IS NULL.
-- hr_restricted_case_access_revoked_pair_check: revoked_at and revoked_by
-- are both NULL (live) or both non-NULL (revoked).
-- hr_restricted_case_access_one_live_grant (partial UNIQUE index, below):
-- at most one LIVE grant per (case_id, user_id). Any number of revoked
-- rows may accumulate as history, and a user can be granted again after a
-- revocation. The index is keyed on case_id rather than organisation_id:
-- case_id is a globally unique UUID, and the composite FK already pins
-- every row's organisation_id to its case's organisation.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_restricted_case_access (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL REFERENCES organisations(id),
  case_id          UUID        NOT NULL,
  user_id          TEXT        NOT NULL REFERENCES users(id),
  granted_by       TEXT        NOT NULL REFERENCES users(id),
  granted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT        REFERENCES users(id),
  CONSTRAINT hr_restricted_case_access_org_case_fkey
    FOREIGN KEY (organisation_id, case_id) REFERENCES hr_restricted_cases (organisation_id, id),
  CONSTRAINT hr_restricted_case_access_revoked_pair_check
    CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_hr_restricted_case_access_organisation_id ON hr_restricted_case_access(organisation_id);
CREATE INDEX IF NOT EXISTS idx_hr_restricted_case_access_case_id ON hr_restricted_case_access(case_id);
CREATE INDEX IF NOT EXISTS idx_hr_restricted_case_access_user_id ON hr_restricted_case_access(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS hr_restricted_case_access_one_live_grant
ON hr_restricted_case_access(case_id,user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- 4. hr_restricted_case_notes - case notes.
--
-- APPEND-ONLY / NO-DELETE IS A FUTURE APPLICATION LIFECYCLE RULE, NOT
-- SCHEMA-ENFORCED. Postgres permits UPDATE and DELETE on this table, and
-- PR-1 deliberately adds no trigger to prevent either. The later PR that
-- adds note write paths is expected to expose create-only operations.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_restricted_case_notes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL REFERENCES organisations(id),
  case_id          UUID        NOT NULL,
  author_id        TEXT        NOT NULL REFERENCES users(id),
  body             TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hr_restricted_case_notes_org_case_fkey
    FOREIGN KEY (organisation_id, case_id) REFERENCES hr_restricted_cases (organisation_id, id)
);

CREATE INDEX IF NOT EXISTS idx_hr_restricted_case_notes_organisation_id ON hr_restricted_case_notes(organisation_id);
CREATE INDEX IF NOT EXISTS idx_hr_restricted_case_notes_case_id ON hr_restricted_case_notes(case_id);

-- ---------------------------------------------------------------------
-- 5. hr_restricted_case_documents - document METADATA only; this table
-- never stores file content.
--
-- storage_key identifies the stored object in a storage backend that a
-- later PR will choose; hr_restricted_case_documents_storage_key_key
-- means each stored object belongs to at most one metadata row. byte_size
-- must be >= 0 (hr_restricted_case_documents_byte_size_check).
-- SOFT-DELETE / NO-HARD-DELETE IS AN APPLICATION LIFECYCLE RULE, NOT A
-- DATABASE PROHIBITION: deleted_at marks a soft-deleted document, but
-- Postgres permits a hard DELETE of the row and any UPDATE (including
-- clearing deleted_at); nothing here prevents either.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_restricted_case_documents (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    TEXT        NOT NULL REFERENCES organisations(id),
  case_id            UUID        NOT NULL,
  uploaded_by        TEXT        NOT NULL REFERENCES users(id),
  original_filename  TEXT        NOT NULL,
  content_type       TEXT        NOT NULL,
  byte_size          BIGINT      NOT NULL,
  storage_key        TEXT        NOT NULL,
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hr_restricted_case_documents_org_case_fkey
    FOREIGN KEY (organisation_id, case_id) REFERENCES hr_restricted_cases (organisation_id, id),
  CONSTRAINT hr_restricted_case_documents_storage_key_key
    UNIQUE (storage_key),
  CONSTRAINT hr_restricted_case_documents_byte_size_check
    CHECK (byte_size >= 0)
);

CREATE INDEX IF NOT EXISTS idx_hr_restricted_case_documents_organisation_id ON hr_restricted_case_documents(organisation_id);
CREATE INDEX IF NOT EXISTS idx_hr_restricted_case_documents_case_id ON hr_restricted_case_documents(case_id);
