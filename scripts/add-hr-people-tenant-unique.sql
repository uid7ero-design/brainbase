-- HR-6 PR-1 - tenant-integrity anchor on the EXISTING hr_people table.
-- Run once, manually, against the database, BEFORE
-- scripts/create-hr-restricted-cases.sql (that script's
-- hr_restricted_case_participants table composite-FKs onto the constraint
-- added here, and its own pre-flight check refuses to create anything
-- until this constraint exists). NOT run automatically by this task.
-- Verified only against a local, disposable Postgres container by
-- scripts/tests/verify-hr-restricted-cases-migration.sh.
--
-- Adds exactly one object: the named UNIQUE constraint
-- hr_people_organisation_id_id_key on hr_people (organisation_id, id).
--
-- Why: a composite foreign key can only reference columns covered by a
-- UNIQUE or PRIMARY KEY constraint. hr_people currently has PRIMARY KEY
-- (id) plus the unrelated hr_people_organisation_id_linked_user_id_key, so
-- without this anchor no table can declare
--   FOREIGN KEY (organisation_id, person_id)
--     REFERENCES hr_people (organisation_id, id)
-- which is the structural rule that makes a cross-organisation person
-- reference impossible at the database level, rather than relying on an
-- application check alone. Same retrofit pattern as
-- scripts/create-commercial-quotes.sql Section 0
-- (commercial_customers_id_organisation_id_key), with the column order
-- locked for HR-6 as (organisation_id, id).
--
-- Cannot fail against existing data: id is already hr_people's PRIMARY
-- KEY, so every existing (organisation_id, id) pair is already unique.
-- Adds no column, changes no column, and reads or writes no row data (no
-- UPDATE, no DELETE, no backfill). ALTER TABLE ... ADD CONSTRAINT ...
-- UNIQUE builds a new index while holding an ACCESS EXCLUSIVE lock on
-- hr_people; the lock lasts only for that index build, whose duration is
-- proportional to hr_people's row count.
--
-- Idempotent: ADD CONSTRAINT IF NOT EXISTS is not valid PostgreSQL syntax,
-- so the first DO block existence-checks pg_constraint first - the repo's
-- established guard idiom (see scripts/create-commercial-quotes.sql and
-- scripts/create-hr-people.sql). The second DO block is a fail-loud
-- post-condition: if a constraint with this name exists on hr_people but
-- is not exactly UNIQUE (organisation_id, id) (for example a hand-made
-- constraint of the same name over different columns), the script raises
-- instead of silently accepting drift.
--
-- No DROP, no DELETE, no TRUNCATE, no UPDATE anywhere in this file.
-- Rollback: nothing to do for an application rollback (PR-1 ships no
-- application code that depends on this constraint). Removing it would
-- first require removing the hr_restricted_case_participants composite
-- foreign key that depends on it; any such removal is a separate,
-- explicitly approved migration and is deliberately not scripted here.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'hr_people'::regclass AND conname = 'hr_people_organisation_id_id_key'
  ) THEN
    ALTER TABLE hr_people
      ADD CONSTRAINT hr_people_organisation_id_id_key UNIQUE (organisation_id, id);
  END IF;
END $$;

DO $$
DECLARE
  actual_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'hr_people'::regclass AND conname = 'hr_people_organisation_id_id_key';

  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'Migration drift: hr_people.hr_people_organisation_id_id_key is "%" but "UNIQUE (organisation_id, id)" was expected', actual_def;
  END IF;
END $$;
