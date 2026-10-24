-- Scheduling Phase 2A — PREFLIGHT (read-only). Run BEFORE 010_shared_schema.sql.
--
-- Every statement is a SELECT. Nothing is created, changed or locked beyond a normal read.
-- Run all of it in the Neon SQL Editor against the TARGET branch/database and compare each
-- result with the "EXPECTED" note. If any STOP condition is hit, do not continue.
-- See docs/architecture/scheduling-phase2a-migration-package.md for the full sequence.

-- 1. Where am I? (confirm this is the branch you intend: Preview/disposable first)
SELECT current_database() AS db, current_user AS role, version() AS server_version,
       current_setting('server_version_num')::int AS version_num;
-- EXPECTED: version_num >= 140000 (CREATE OR REPLACE TRIGGER). Neon is 16/17.
-- STOP if version_num < 140000.

-- 2. Nothing from scheduling exists yet (or only an earlier 2a.* install).
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name LIKE 'scheduling\_%' ESCAPE '\' ORDER BY 1;
-- EXPECTED (first run): 0 rows. EXPECTED (re-run): the 13 scheduling_* tables.
-- STOP if you see scheduling_* tables you did not create (name clash).

-- 3. btree_gist is available, and is it already installed?
SELECT name, default_version, installed_version
  FROM pg_available_extensions WHERE name = 'btree_gist';
-- EXPECTED: one row, default_version 1.7 or later. installed_version NULL (first run) or a version.
-- STOP if 0 rows (extension unavailable on this plan).

-- 4. Can this role create the extension and objects?
SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema,
       has_schema_privilege(current_user, 'public', 'CREATE')              AS can_create_in_public,
       (SELECT rolsuper OR pg_has_role(current_user, 'neon_superuser', 'member')
          FROM pg_roles WHERE rolname = current_user)                      AS can_create_extension;
-- EXPECTED: true, true, true. STOP if any is false.
-- (On a plain Postgres without the neon_superuser role, pg_has_role raises an error: run the
-- statement without the third column there.)

-- 5. Host dependency (BrainBase host file only): the tenant table exists and its id is TEXT.
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'organisations' AND column_name = 'id';
-- EXPECTED: one row, data_type = text. (Standalone deployments skip this check.)
-- STOP if data_type is not text: the host foreign keys assume TEXT.

-- 6. No clashing function names.
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND proname LIKE 'scheduling\_%' ESCAPE '\' ORDER BY 1;
-- EXPECTED (first run): 0 rows.

-- 7. No long-running transaction that could make the migration wait on a lock.
SELECT pid, state, now() - xact_start AS xact_age, left(query, 80) AS query
  FROM pg_stat_activity
 WHERE datname = current_database() AND pid <> pg_backend_pid()
   AND xact_start IS NOT NULL AND now() - xact_start > interval '1 minute';
-- EXPECTED: 0 rows. (The migration only touches new tables, so this is a courtesy check.)

-- 8. Baseline inventory, to compare with 020_verify.sql afterwards (record these numbers).
SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public')                    AS tables_before,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') AS functions_before,
       (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)                                           AS triggers_before;
-- EXPECTED: record the three numbers. After 010: tables +13, functions +11, triggers +16.
