-- Scheduling Phase 2A — VERIFICATION (read-only). Run AFTER 010_shared_schema.sql.
-- Every statement is a SELECT. Compare each result with "EXPECTED".

-- 1. Version marker.
SELECT version, applied_at FROM scheduling_schema_migrations ORDER BY version;
-- EXPECTED: one row, version 2a.1.

-- 2. The 13 tables exist and are empty (apart from the version marker).
SELECT t.table_name,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', t.table_name), false, true, '')))[1]::text AS row_count
  FROM information_schema.tables t
 WHERE t.table_schema = 'public' AND t.table_name LIKE 'scheduling\_%' ESCAPE '\'
 ORDER BY 1;
-- EXPECTED: 13 rows; row_count 0 everywhere except scheduling_schema_migrations = 1.

-- 3. Inventory delta against preflight step 8.
SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public')                    AS tables_after,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') AS functions_after,
       (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)                                           AS triggers_after;
-- EXPECTED: tables_before + 13, functions_before + 11, triggers_before + 16.

-- 4. The exclusion constraint exists, is partial, and covers organisation + resource + range.
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint WHERE conrelid = 'scheduling_resource_holds'::regclass AND contype = 'x';
-- EXPECTED: scheduling_holds_no_overlap ... EXCLUDE USING gist (organisation_id WITH =, resource_id WITH =, during WITH &&) WHERE (released_at IS NULL)

-- 5. btree_gist is installed.
SELECT e.extname, e.extversion, n.nspname AS schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'btree_gist';
-- EXPECTED: one row (schema scheduling_ext if this migration installed it).

-- 6. Triggers present and enabled.
SELECT c.relname AS on_table, t.tgname, t.tgenabled
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal AND c.relname LIKE 'scheduling\_%' ESCAPE '\' ORDER BY 1, 2;
-- EXPECTED: 16 rows, tgenabled = 'O' for all.

-- 7. Shared DDL has no foreign key to any host table (standalone check).
SELECT conrelid::regclass AS from_table, confrelid::regclass AS to_table
  FROM pg_constraint
 WHERE contype = 'f' AND conrelid::regclass::text LIKE 'scheduling\_%' ESCAPE '\'
   AND confrelid::regclass::text NOT LIKE 'scheduling\_%' ESCAPE '\';
-- EXPECTED: 0 rows after 010. After the BrainBase host file (110) you will see 3 rows, all to organisations.

-- 8. No scheduling table references an existing LD Tennis / CRM table.
SELECT count(*) AS legacy_dependencies FROM pg_constraint
 WHERE contype = 'f' AND conrelid::regclass::text LIKE 'scheduling\_%' ESCAPE '\'
   AND confrelid::regclass::text IN ('bookings','sessions','session_instances','contacts','crm_contacts');
-- EXPECTED: 0.
