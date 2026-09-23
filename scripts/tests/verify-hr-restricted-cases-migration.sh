#!/usr/bin/env bash
# HR-6 PR-1 Restricted Case Schema Foundation - real-Postgres migration
# proof for scripts/add-hr-people-tenant-unique.sql and
# scripts/create-hr-restricted-cases.sql. Same disposable-container
# harness pattern as scripts/tests/verify-hr-people-foundation-migration.sh
# (real postgres:16 in Docker, never a mock, never Neon; the container is
# removed on exit).
#
# WHAT THIS PROVES:
#   (S) both migration files are additive-only text: no DROP/DELETE/
#       TRUNCATE/UPDATE/INSERT/GRANT/REVOKE and no trigger/rule/function
#       outside comments; every CREATE uses IF NOT EXISTS; the one ADD
#       CONSTRAINT sits inside the DO $$ / pg_constraint guard;
#   (1) the hr_people anchor adds exactly one UNIQUE constraint (and its
#       index) over exactly (organisation_id, id), adds no column and
#       changes no row;
#   (2) all five hr_restricted_* tables have the exact intended column
#       list/order, types, nullability and defaults, every named
#       CHECK/UNIQUE/FK constraint by exact definition, every index by
#       exact definition, and no user-defined trigger;
#   (3) SAME-organisation composite-FK inserts succeed for every
#       relationship BEFORE any negative test runs;
#   (4) CROSS-organisation references are rejected by the database itself
#       (SQLSTATE 23503 + exact constraint name) for participant->case,
#       participant->person, access->case, notes->case, documents->case;
#   (5) DOCUMENTED LIMITATION, proven not asserted: single-column user FKs
#       accept a user from ANOTHER organisation at the DB level - expected,
#       and app-layer-enforced by later PRs;
#   (6) partial-unique live-grant behaviour, the revoked pair CHECK, the
#       status/closed_at CHECK, the participant UNIQUE, the storage_key
#       UNIQUE, the byte_size CHECK and every vocabulary CHECK, each by
#       exact SQLSTATE and exact constraint/index name;
#   (7) DOCUMENTED LIFECYCLE LIMITATIONS: notes/documents/access/case rows
#       can still be UPDATEd/DELETEd at the DB level (append-only,
#       soft-delete, grant history and case no-delete are application
#       rules for later PRs), so the migration comments are verified as
#       honest rather than assumed;
#   (8) script guards, in separate throwaway databases: the creation script
#       run BEFORE the anchor script creates nothing (no partial
#       application), and the anchor script refuses a same-named hr_people
#       constraint over the wrong columns;
#   (9) both migrations applied a SECOND time (first apply was one
#       BEGIN/COMMIT transaction - the Production handoff shape; second is
#       plain per-file runs, with data present) exit cleanly and leave the
#       schema fingerprint, constraint/index counts and row counts
#       unchanged.
#
# USAGE (from anywhere; the script cds to the repository root):
#   bash scripts/tests/verify-hr-restricted-cases-migration.sh
# Requires a running Docker daemon. Exit 0 = every check passed; 1 = at
# least one check failed; 2 = the harness could not run (no Docker, no
# daemon, Postgres never became ready, or a setup/apply step failed).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

CONTAINER="hr6-restricted-cases-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: the Docker daemon is not reachable - start Docker, then re-run this harness." >&2
  exit 2
fi

record_pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
record_fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); FAILURES+=("$1"); }

check() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $label (got '$actual')"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label - expected '$expected', got '$actual'"
    FAIL=$((FAIL + 1))
    FAILURES+=("$label - expected '$expected', got '$actual'")
  fi
}

# Strip -- comments (the migration files use no block comments, and no
# string literal in them contains "--").
code_only() { sed -e 's/--.*$//' "$1"; }

echo ""
echo "=== STATIC: both migration files are additive-only text ==="
for f in scripts/add-hr-people-tenant-unique.sql scripts/create-hr-restricted-cases.sql; do
  if [ ! -f "$f" ]; then
    echo "ERROR: $f not found under $REPO_ROOT." >&2
    exit 2
  fi
  FORBIDDEN_WORDS="$(code_only "$f" | grep -n -i -w -E 'DROP|DELETE|TRUNCATE|UPDATE|INSERT|GRANT|REVOKE' || true)"
  check "$f: no DROP/DELETE/TRUNCATE/UPDATE/INSERT/GRANT/REVOKE outside comments" "$FORBIDDEN_WORDS" ""
  FORBIDDEN_DDL="$(code_only "$f" | grep -n -i -E 'CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?(TRIGGER|RULE|FUNCTION|PROCEDURE)' || true)"
  check "$f: no trigger/rule/function/procedure DDL outside comments" "$FORBIDDEN_DDL" ""
done
CREATE_TABLE_LIST="$(code_only scripts/create-hr-restricted-cases.sql | grep -o -i -E 'CREATE TABLE IF NOT EXISTS [a-z_]+' | awk '{print $6}' | LC_ALL=C sort | paste -sd, -)"
check "create-hr-restricted-cases.sql creates exactly the five hr_restricted_* tables via CREATE TABLE IF NOT EXISTS" \
  "$CREATE_TABLE_LIST" "hr_restricted_case_access,hr_restricted_case_documents,hr_restricted_case_notes,hr_restricted_case_participants,hr_restricted_cases"
BARE_CREATE="$(code_only scripts/create-hr-restricted-cases.sql | grep -i -E 'CREATE[[:space:]]+(UNIQUE[[:space:]]+)?(TABLE|INDEX)' | grep -i -v 'IF NOT EXISTS' || true)"
check "every CREATE TABLE/INDEX in create-hr-restricted-cases.sql uses IF NOT EXISTS" "$BARE_CREATE" ""
CREATE_ALTERS="$(code_only scripts/create-hr-restricted-cases.sql | grep -n -i -w 'ALTER' || true)"
check "create-hr-restricted-cases.sql alters no existing table" "$CREATE_ALTERS" ""
ADD_CONSTRAINT_COUNT="$(code_only scripts/add-hr-people-tenant-unique.sql | grep -o -i 'ADD CONSTRAINT' | wc -l | tr -d '[:space:]')"
GUARDED_ADD="IF NOT EXISTS ( SELECT 1 FROM pg_constraint WHERE conrelid = 'hr_people'::regclass AND conname = 'hr_people_organisation_id_id_key' ) THEN ALTER TABLE hr_people ADD CONSTRAINT hr_people_organisation_id_id_key UNIQUE (organisation_id, id); END IF;"
GUARDED_ADD_COUNT="$(code_only scripts/add-hr-people-tenant-unique.sql | tr -s '[:space:]' ' ' | grep -o -F "$GUARDED_ADD" | wc -l | tr -d '[:space:]')"
check "add-hr-people-tenant-unique.sql: exactly one ADD CONSTRAINT, and it is inside the DO \$\$ / pg_constraint IF NOT EXISTS guard" \
  "$ADD_CONSTRAINT_COUNT/$GUARDED_ADD_COUNT" "1/1"

echo ""
echo "Starting disposable postgres:16 ($CONTAINER)..."
if ! docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16 >/dev/null; then
  echo "ERROR: could not start the postgres:16 container." >&2
  exit 2
fi

READY=0
for i in $(seq 1 60); do
  # pg_isready can briefly succeed during the image's init-time restart,
  # so require a real query round-trip.
  if echo "SELECT 1;" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: postgres did not accept queries within 60s." >&2
  exit 2
fi

psql_exec_db() { local db="$1"; shift; docker exec -i "$CONTAINER" psql -X -q -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"; }
psql_exec() { psql_exec_db testdb "$@"; }
psql_query_db() { docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d "$1" -v ON_ERROR_STOP=1; }
psql_query() { psql_query_db testdb; }
q() { echo "$1" | psql_query | tr -d '[:space:]'; }
q_db() { echo "$2" | psql_query_db "$1" | tr -d '[:space:]'; }

echo "  server: $(echo "SHOW server_version;" | psql_query)"

# try_sql "<one SQL statement>" -> "OK" if it succeeded (and committed), or
# "ERR:<SQLSTATE>:<constraint-or-index name>" if it failed. The statement
# is passed as a psql variable (:'stmt' is interpolated as a correctly
# quoted literal) and run by harness.try_sql(), which reads SQLSTATE and
# CONSTRAINT_NAME via GET STACKED DIAGNOSTICS - exact fields, not a grep of
# a human-readable message.
try_sql() {
  echo "SELECT harness.try_sql(:'stmt');" \
    | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v stmt="$1" 2>&1 \
    | tr -d '[:space:]'
}
expect_ok() { check "$1" "$(try_sql "$2")" "OK"; }
expect_err() { check "$1" "$(try_sql "$2")" "ERR:$3:$4"; }

RESTRICTED_RELS="SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'hr\\_restricted\\_%'"
HR_PEOPLE_REL="SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = 'hr_people'"

# Full-shape fingerprint of the five tables plus hr_people: columns
# (name/type/nullability/default), constraint definitions, index
# definitions, and non-internal triggers on any hr_* table.
SCHEMA_FINGERPRINT_SQL="
SELECT md5(string_agg(item, E'\n' ORDER BY item COLLATE \"C\")) FROM (
  SELECT 'col ' || table_name || '.' || lpad(ordinal_position::text, 3, '0') || ' ' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-') AS item
  FROM information_schema.columns
  WHERE table_schema = 'public' AND (table_name LIKE 'hr\\_restricted\\_%' OR table_name = 'hr_people')
  UNION ALL
  SELECT 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conrelid IN ($RESTRICTED_RELS UNION ALL $HR_PEOPLE_REL)
  UNION ALL
  SELECT 'idx ' || indexdef
  FROM pg_indexes WHERE schemaname = 'public' AND (tablename LIKE 'hr\\_restricted\\_%' OR tablename = 'hr_people')
  UNION ALL
  SELECT 'trg ' || tgrelid::regclass::text || ' ' || tgname
  FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'hr\\_%')
) s;"

# tables | constraints on the five tables | indexes on the five tables |
# constraints on hr_people | indexes on hr_people
SCHEMA_COUNTS_SQL="
SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname LIKE 'hr\\_restricted\\_%')
  || '|' || (SELECT count(*) FROM pg_constraint WHERE conrelid IN ($RESTRICTED_RELS))
  || '|' || (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'hr\\_restricted\\_%')
  || '|' || (SELECT count(*) FROM pg_constraint WHERE conrelid IN ($HR_PEOPLE_REL))
  || '|' || (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'hr_people');"

ROW_COUNTS_SQL="
SELECT (SELECT count(*) FROM hr_people) || '|' || (SELECT count(*) FROM hr_restricted_cases)
  || '|' || (SELECT count(*) FROM hr_restricted_case_participants) || '|' || (SELECT count(*) FROM hr_restricted_case_access)
  || '|' || (SELECT count(*) FROM hr_restricted_case_notes) || '|' || (SELECT count(*) FROM hr_restricted_case_documents);"

PEOPLE_DATA_SQL="SELECT md5(string_agg(p::text, '|' ORDER BY p.id)) FROM hr_people p;"

# Column name list, in ordinal order, for one table.
cols() { q "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$1';"; }
# name:type:nullable:default for every column of one table, in ordinal order.
shape() {
  echo "SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$1';" \
    | psql_query
}

FIXTURE_SQL="
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, name TEXT);
INSERT INTO organisations (id, name) VALUES ('org-a', 'Org A'), ('org-b', 'Org B');
INSERT INTO users (id, organisation_id, name) VALUES
  ('user-a1', 'org-a', 'Org A User 1'), ('user-a2', 'org-a', 'Org A User 2'), ('user-a3', 'org-a', 'Org A User 3'),
  ('user-b1', 'org-b', 'Org B User 1');
"
# Minimal organisations/users fixtures plus the REAL HR-1 hr_teams/hr_people
# scripts, applied to one database.
setup_hr1_db() {
  echo "$FIXTURE_SQL" | psql_exec_db "$1" \
    && psql_exec_db "$1" < scripts/create-hr-teams.sql \
    && psql_exec_db "$1" < scripts/create-hr-people.sql
}

echo ""
echo "=== SETUP: fixtures + the real HR-1 scripts (hr_teams, hr_people) + pre-existing hr_people rows ==="
if ! setup_hr1_db testdb; then
  echo "ERROR: fixture/HR-1 setup failed." >&2
  exit 2
fi
# Pre-existing hr_people rows (one per org, one linked to a user) so the
# anchor is added over real data and "changes no row" is provable.
PERSON_A="$(q "INSERT INTO hr_people (organisation_id, first_name, last_name) VALUES ('org-a', 'Ada', 'Participant') RETURNING id;")"
PERSON_A2="$(q "INSERT INTO hr_people (organisation_id, first_name, last_name, linked_user_id) VALUES ('org-a', 'Grace', 'Witness', 'user-a2') RETURNING id;")"
PERSON_B="$(q "INSERT INTO hr_people (organisation_id, first_name, last_name) VALUES ('org-b', 'Bea', 'OtherOrg') RETURNING id;")"
if [ -z "$PERSON_A" ] || [ -z "$PERSON_A2" ] || [ -z "$PERSON_B" ]; then
  echo "ERROR: could not seed hr_people fixture rows." >&2
  exit 2
fi
# The helper lives in its own schema, so it never appears in any
# public-schema fingerprint/count below.
if ! psql_exec <<'SQL'
CREATE SCHEMA harness;
CREATE FUNCTION harness.try_sql(stmt text) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  v_state text;
  v_constraint text;
BEGIN
  EXECUTE stmt;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
  RETURN 'ERR:' || v_state || ':' || coalesce(nullif(v_constraint, ''), '-');
END;
$fn$;
SQL
then
  echo "ERROR: could not create the harness.try_sql helper." >&2
  exit 2
fi

echo ""
echo "=== APPLY #1: both scripts in ONE BEGIN/COMMIT transaction (the Production handoff shape) ==="
PEOPLE_COLS_0="$(cols hr_people)"
PEOPLE_DATA_0="$(q "$PEOPLE_DATA_SQL")"
PEOPLE_CONS_0="$(q "SELECT string_agg(conname, ',' ORDER BY conname COLLATE \"C\") FROM pg_constraint WHERE conrelid = 'hr_people'::regclass;")"
PEOPLE_IDX_0="$(q "SELECT string_agg(indexname, ',' ORDER BY indexname COLLATE \"C\") FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'hr_people';")"
PEOPLE_CON_N0="$(q "SELECT count(*) FROM pg_constraint WHERE conrelid = 'hr_people'::regclass;")"
PEOPLE_IDX_N0="$(q "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'hr_people';")"
FIRST_RUN_OUTPUT="$( { echo "BEGIN;"; cat scripts/add-hr-people-tenant-unique.sql scripts/create-hr-restricted-cases.sql; echo "COMMIT;"; } | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$FIRST_RUN_OUTPUT" | grep -q "EXIT:0" && ! echo "$FIRST_RUN_OUTPUT" | grep -q "ERROR"; then
  record_pass "first apply of both scripts (single BEGIN/COMMIT) succeeded with zero errors"
else
  echo "$FIRST_RUN_OUTPUT" | tail -30
  echo "ERROR: first apply failed - nothing further can be verified." >&2
  exit 2
fi

echo ""
echo "=== hr_people ANCHOR: exactly one new UNIQUE (organisation_id, id); no column or row change ==="
check "hr_people_organisation_id_id_key is a UNIQUE constraint (contype u) on hr_people" \
  "$(q "SELECT contype FROM pg_constraint WHERE conrelid = 'hr_people'::regclass AND conname = 'hr_people_organisation_id_id_key';")" "u"
check "hr_people_organisation_id_id_key covers exactly organisation_id,id, in that order" \
  "$(q "SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum WHERE c.conrelid = 'hr_people'::regclass AND c.conname = 'hr_people_organisation_id_id_key';")" \
  "organisation_id,id"
check "hr_people_organisation_id_id_key definition" \
  "$(echo "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'hr_people'::regclass AND conname = 'hr_people_organisation_id_id_key';" | psql_query)" \
  "UNIQUE (organisation_id, id)"
check "hr_people_organisation_id_id_key is NOT deferrable (an FK can only target a non-deferrable unique)" \
  "$(q "SELECT condeferrable FROM pg_constraint WHERE conrelid = 'hr_people'::regclass AND conname = 'hr_people_organisation_id_id_key';")" "f"
check "hr_people columns unchanged" "$(cols hr_people)" "$PEOPLE_COLS_0"
check "hr_people row data byte-identical" "$(q "$PEOPLE_DATA_SQL")" "$PEOPLE_DATA_0"
check "hr_people constraints = the previous set plus exactly hr_people_organisation_id_id_key" \
  "$(q "SELECT count(*) || ':' || string_agg(conname, ',' ORDER BY conname COLLATE \"C\") FILTER (WHERE conname <> 'hr_people_organisation_id_id_key') FROM pg_constraint WHERE conrelid = 'hr_people'::regclass;")" \
  "$((PEOPLE_CON_N0 + 1)):$PEOPLE_CONS_0"
check "hr_people indexes = the previous set plus exactly hr_people_organisation_id_id_key" \
  "$(q "SELECT count(*) || ':' || string_agg(indexname, ',' ORDER BY indexname COLLATE \"C\") FILTER (WHERE indexname <> 'hr_people_organisation_id_id_key') FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'hr_people';")" \
  "$((PEOPLE_IDX_N0 + 1)):$PEOPLE_IDX_0"

echo ""
echo "=== SCHEMA SHAPE: exact column lists/order for all five tables ==="
check "hr_restricted_cases columns" "$(cols hr_restricted_cases)" \
  "id,organisation_id,case_type,status,title,reference,opened_by,closed_at,created_at,updated_at"
check "hr_restricted_case_participants columns" "$(cols hr_restricted_case_participants)" \
  "id,organisation_id,case_id,person_id,role_in_case,created_at"
check "hr_restricted_case_access columns" "$(cols hr_restricted_case_access)" \
  "id,organisation_id,case_id,user_id,granted_by,granted_at,revoked_at,revoked_by"
check "hr_restricted_case_notes columns" "$(cols hr_restricted_case_notes)" \
  "id,organisation_id,case_id,author_id,body,created_at"
check "hr_restricted_case_documents columns" "$(cols hr_restricted_case_documents)" \
  "id,organisation_id,case_id,uploaded_by,original_filename,content_type,byte_size,storage_key,deleted_at,created_at"

echo ""
echo "=== SCHEMA SHAPE: exact type / nullability / default for every column ==="
check "hr_restricted_cases full shape" "$(shape hr_restricted_cases)" \
  "id:uuid:NO:gen_random_uuid(),organisation_id:text:NO:-,case_type:text:NO:-,status:text:NO:'open'::text,title:text:NO:-,reference:text:YES:-,opened_by:text:NO:-,closed_at:timestamp with time zone:YES:-,created_at:timestamp with time zone:NO:now(),updated_at:timestamp with time zone:NO:now()"
check "hr_restricted_case_participants full shape" "$(shape hr_restricted_case_participants)" \
  "id:uuid:NO:gen_random_uuid(),organisation_id:text:NO:-,case_id:uuid:NO:-,person_id:uuid:NO:-,role_in_case:text:NO:'subject'::text,created_at:timestamp with time zone:NO:now()"
check "hr_restricted_case_access full shape" "$(shape hr_restricted_case_access)" \
  "id:uuid:NO:gen_random_uuid(),organisation_id:text:NO:-,case_id:uuid:NO:-,user_id:text:NO:-,granted_by:text:NO:-,granted_at:timestamp with time zone:NO:now(),revoked_at:timestamp with time zone:YES:-,revoked_by:text:YES:-"
check "hr_restricted_case_notes full shape" "$(shape hr_restricted_case_notes)" \
  "id:uuid:NO:gen_random_uuid(),organisation_id:text:NO:-,case_id:uuid:NO:-,author_id:text:NO:-,body:text:NO:-,created_at:timestamp with time zone:NO:now()"
check "hr_restricted_case_documents full shape" "$(shape hr_restricted_case_documents)" \
  "id:uuid:NO:gen_random_uuid(),organisation_id:text:NO:-,case_id:uuid:NO:-,uploaded_by:text:NO:-,original_filename:text:NO:-,content_type:text:NO:-,byte_size:bigint:NO:-,storage_key:text:NO:-,deleted_at:timestamp with time zone:YES:-,created_at:timestamp with time zone:NO:now()"

echo ""
echo "=== SCHEMA SHAPE: every constraint on the five tables, by exact name and definition ==="
# One line per constraint (table|name|definition), compared as a whole: a
# missing, extra, renamed or redefined constraint all fail this check.
CONSTRAINTS_ACTUAL="$(echo "
SELECT string_agg(conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid), E'\n' ORDER BY conrelid::regclass::text COLLATE \"C\", conname COLLATE \"C\")
FROM pg_constraint WHERE conrelid IN ($RESTRICTED_RELS);" | psql_query)"
CONSTRAINTS_EXPECTED="hr_restricted_case_access|hr_restricted_case_access_granted_by_fkey|FOREIGN KEY (granted_by) REFERENCES users(id)
hr_restricted_case_access|hr_restricted_case_access_org_case_fkey|FOREIGN KEY (organisation_id, case_id) REFERENCES hr_restricted_cases(organisation_id, id)
hr_restricted_case_access|hr_restricted_case_access_organisation_id_fkey|FOREIGN KEY (organisation_id) REFERENCES organisations(id)
hr_restricted_case_access|hr_restricted_case_access_pkey|PRIMARY KEY (id)
hr_restricted_case_access|hr_restricted_case_access_revoked_by_fkey|FOREIGN KEY (revoked_by) REFERENCES users(id)
hr_restricted_case_access|hr_restricted_case_access_revoked_pair_check|CHECK ((((revoked_at IS NULL) AND (revoked_by IS NULL)) OR ((revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL))))
hr_restricted_case_access|hr_restricted_case_access_user_id_fkey|FOREIGN KEY (user_id) REFERENCES users(id)
hr_restricted_case_documents|hr_restricted_case_documents_byte_size_check|CHECK ((byte_size >= 0))
hr_restricted_case_documents|hr_restricted_case_documents_org_case_fkey|FOREIGN KEY (organisation_id, case_id) REFERENCES hr_restricted_cases(organisation_id, id)
hr_restricted_case_documents|hr_restricted_case_documents_organisation_id_fkey|FOREIGN KEY (organisation_id) REFERENCES organisations(id)
hr_restricted_case_documents|hr_restricted_case_documents_pkey|PRIMARY KEY (id)
hr_restricted_case_documents|hr_restricted_case_documents_storage_key_key|UNIQUE (storage_key)
hr_restricted_case_documents|hr_restricted_case_documents_uploaded_by_fkey|FOREIGN KEY (uploaded_by) REFERENCES users(id)
hr_restricted_case_notes|hr_restricted_case_notes_author_id_fkey|FOREIGN KEY (author_id) REFERENCES users(id)
hr_restricted_case_notes|hr_restricted_case_notes_org_case_fkey|FOREIGN KEY (organisation_id, case_id) REFERENCES hr_restricted_cases(organisation_id, id)
hr_restricted_case_notes|hr_restricted_case_notes_organisation_id_fkey|FOREIGN KEY (organisation_id) REFERENCES organisations(id)
hr_restricted_case_notes|hr_restricted_case_notes_pkey|PRIMARY KEY (id)
hr_restricted_case_participants|hr_restricted_case_participants_org_case_fkey|FOREIGN KEY (organisation_id, case_id) REFERENCES hr_restricted_cases(organisation_id, id)
hr_restricted_case_participants|hr_restricted_case_participants_org_case_person_key|UNIQUE (organisation_id, case_id, person_id)
hr_restricted_case_participants|hr_restricted_case_participants_org_person_fkey|FOREIGN KEY (organisation_id, person_id) REFERENCES hr_people(organisation_id, id)
hr_restricted_case_participants|hr_restricted_case_participants_organisation_id_fkey|FOREIGN KEY (organisation_id) REFERENCES organisations(id)
hr_restricted_case_participants|hr_restricted_case_participants_pkey|PRIMARY KEY (id)
hr_restricted_case_participants|hr_restricted_case_participants_role_in_case_check|CHECK ((role_in_case = ANY (ARRAY['subject'::text, 'complainant'::text, 'respondent'::text, 'witness'::text, 'other'::text])))
hr_restricted_cases|hr_restricted_cases_case_type_check|CHECK ((case_type = ANY (ARRAY['grievance'::text, 'disciplinary'::text, 'investigation'::text, 'other'::text])))
hr_restricted_cases|hr_restricted_cases_opened_by_fkey|FOREIGN KEY (opened_by) REFERENCES users(id)
hr_restricted_cases|hr_restricted_cases_organisation_id_fkey|FOREIGN KEY (organisation_id) REFERENCES organisations(id)
hr_restricted_cases|hr_restricted_cases_organisation_id_id_key|UNIQUE (organisation_id, id)
hr_restricted_cases|hr_restricted_cases_pkey|PRIMARY KEY (id)
hr_restricted_cases|hr_restricted_cases_status_check|CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
hr_restricted_cases|hr_restricted_cases_status_closed_at_check|CHECK ((((status = 'closed'::text) AND (closed_at IS NOT NULL)) OR ((status <> 'closed'::text) AND (closed_at IS NULL))))"
if [ "$CONSTRAINTS_ACTUAL" = "$CONSTRAINTS_EXPECTED" ]; then
  record_pass "all 30 constraints on the five tables match by exact name and definition"
else
  record_fail "constraint set differs from the locked contract (diff of expected vs actual follows)"
  diff <(echo "$CONSTRAINTS_EXPECTED") <(echo "$CONSTRAINTS_ACTUAL") | sed 's/^/      /'
fi
check "every CHECK constraint on the five tables is one of the six explicitly named ones (no anonymous CHECK)" \
  "$(q "SELECT string_agg(conname, ',' ORDER BY conname COLLATE \"C\") FROM pg_constraint WHERE contype = 'c' AND conrelid IN ($RESTRICTED_RELS);")" \
  "hr_restricted_case_access_revoked_pair_check,hr_restricted_case_documents_byte_size_check,hr_restricted_case_participants_role_in_case_check,hr_restricted_cases_case_type_check,hr_restricted_cases_status_check,hr_restricted_cases_status_closed_at_check"

echo ""
echo "=== SCHEMA SHAPE: every index on the five tables, by exact definition ==="
INDEXES_ACTUAL="$(echo "SELECT string_agg(indexdef, E'\n' ORDER BY indexname COLLATE \"C\") FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'hr\\_restricted\\_%';" | psql_query)"
INDEXES_EXPECTED="CREATE UNIQUE INDEX hr_restricted_case_access_one_live_grant ON public.hr_restricted_case_access USING btree (case_id, user_id) WHERE (revoked_at IS NULL)
CREATE UNIQUE INDEX hr_restricted_case_access_pkey ON public.hr_restricted_case_access USING btree (id)
CREATE UNIQUE INDEX hr_restricted_case_documents_pkey ON public.hr_restricted_case_documents USING btree (id)
CREATE UNIQUE INDEX hr_restricted_case_documents_storage_key_key ON public.hr_restricted_case_documents USING btree (storage_key)
CREATE UNIQUE INDEX hr_restricted_case_notes_pkey ON public.hr_restricted_case_notes USING btree (id)
CREATE UNIQUE INDEX hr_restricted_case_participants_org_case_person_key ON public.hr_restricted_case_participants USING btree (organisation_id, case_id, person_id)
CREATE UNIQUE INDEX hr_restricted_case_participants_pkey ON public.hr_restricted_case_participants USING btree (id)
CREATE UNIQUE INDEX hr_restricted_cases_organisation_id_id_key ON public.hr_restricted_cases USING btree (organisation_id, id)
CREATE UNIQUE INDEX hr_restricted_cases_pkey ON public.hr_restricted_cases USING btree (id)
CREATE INDEX idx_hr_restricted_case_access_case_id ON public.hr_restricted_case_access USING btree (case_id)
CREATE INDEX idx_hr_restricted_case_access_organisation_id ON public.hr_restricted_case_access USING btree (organisation_id)
CREATE INDEX idx_hr_restricted_case_access_user_id ON public.hr_restricted_case_access USING btree (user_id)
CREATE INDEX idx_hr_restricted_case_documents_case_id ON public.hr_restricted_case_documents USING btree (case_id)
CREATE INDEX idx_hr_restricted_case_documents_organisation_id ON public.hr_restricted_case_documents USING btree (organisation_id)
CREATE INDEX idx_hr_restricted_case_notes_case_id ON public.hr_restricted_case_notes USING btree (case_id)
CREATE INDEX idx_hr_restricted_case_notes_organisation_id ON public.hr_restricted_case_notes USING btree (organisation_id)
CREATE INDEX idx_hr_restricted_case_participants_case_id ON public.hr_restricted_case_participants USING btree (case_id)
CREATE INDEX idx_hr_restricted_case_participants_organisation_id ON public.hr_restricted_case_participants USING btree (organisation_id)
CREATE INDEX idx_hr_restricted_case_participants_person_id ON public.hr_restricted_case_participants USING btree (person_id)
CREATE INDEX idx_hr_restricted_cases_opened_by ON public.hr_restricted_cases USING btree (opened_by)
CREATE INDEX idx_hr_restricted_cases_organisation_id ON public.hr_restricted_cases USING btree (organisation_id)"
if [ "$INDEXES_ACTUAL" = "$INDEXES_EXPECTED" ]; then
  record_pass "all 21 indexes on the five tables match by exact definition (incl. the partial live-grant index)"
else
  record_fail "index set differs from the locked contract (diff of expected vs actual follows)"
  diff <(echo "$INDEXES_EXPECTED") <(echo "$INDEXES_ACTUAL") | sed 's/^/      /'
fi
check "no user-defined trigger on any hr_* table (lifecycle rules are NOT DB-enforced in PR-1)" \
  "$(q "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'hr\\_%');")" "0"

SCHEMA_FP_1="$(q "$SCHEMA_FINGERPRINT_SQL")"
SCHEMA_COUNTS_1="$(q "$SCHEMA_COUNTS_SQL")"
check "schema object counts after apply #1 (tables|constraints|indexes on the five tables|hr_people constraints|hr_people indexes)" \
  "$SCHEMA_COUNTS_1" "5|30|21|$((PEOPLE_CON_N0 + 1))|$((PEOPLE_IDX_N0 + 1))"

echo ""
echo "=== POSITIVE: SAME-organisation inserts succeed for every composite-FK relationship (before any negative test) ==="
CASE_A="$(q "INSERT INTO hr_restricted_cases (organisation_id, case_type, title, opened_by) VALUES ('org-a', 'grievance', 'Org A case', 'user-a1') RETURNING id;")"
check "case insert (org-a) succeeds, defaulting status to open with closed_at NULL" \
  "$([ -n "$CASE_A" ] && q "SELECT status || '|' || (closed_at IS NULL) FROM hr_restricted_cases WHERE id = '$CASE_A';")" "open|true"
CASE_B="$(q "INSERT INTO hr_restricted_cases (organisation_id, case_type, title, opened_by) VALUES ('org-b', 'investigation', 'Org B case', 'user-b1') RETURNING id;")"
check "case insert (org-b) succeeds" "$([ -n "$CASE_B" ] && echo ok)" "ok"
PARTICIPANT_A="$(q "INSERT INTO hr_restricted_case_participants (organisation_id, case_id, person_id) VALUES ('org-a', '$CASE_A', '$PERSON_A') RETURNING id;")"
check "participant insert (org-a case + org-a person) succeeds - participant->case AND participant->person; role_in_case defaults to subject" \
  "$([ -n "$PARTICIPANT_A" ] && q "SELECT role_in_case FROM hr_restricted_case_participants WHERE id = '$PARTICIPANT_A';")" "subject"
expect_ok "participant insert (org-a case + second org-a person, role witness) succeeds" \
  "INSERT INTO hr_restricted_case_participants (organisation_id, case_id, person_id, role_in_case) VALUES ('org-a', '$CASE_A', '$PERSON_A2', 'witness')"
expect_ok "participant insert (org-b case + org-b person, role respondent) succeeds" \
  "INSERT INTO hr_restricted_case_participants (organisation_id, case_id, person_id, role_in_case) VALUES ('org-b', '$CASE_B', '$PERSON_B', 'respondent')"
ACCESS_A="$(q "INSERT INTO hr_restricted_case_access (organisation_id, case_id, user_id, granted_by) VALUES ('org-a', '$CASE_A', 'user-a2', 'user-a1') RETURNING id;")"
check "access insert (org-a case, live grant) succeeds - access->case" "$([ -n "$ACCESS_A" ] && echo ok)" "ok"
NOTE_A="$(q "INSERT INTO hr_restricted_case_notes (organisation_id, case_id, author_id, body) VALUES ('org-a', '$CASE_A', 'user-a1', 'First note') RETURNING id;")"
check "note insert (org-a case) succeeds - notes->case" "$([ -n "$NOTE_A" ] && echo ok)" "ok"
DOC_A="$(q "INSERT INTO hr_restricted_case_documents (organisation_id, case_id, uploaded_by, original_filename, content_type, byte_size, storage_key) VALUES ('org-a', '$CASE_A', 'user-a1', 'statement.pdf', 'application/pdf', 1024, 'hr-restricted/org-a/doc-1') RETURNING id;")"
check "document insert (org-a case) succeeds - documents->case" "$([ -n "$DOC_A" ] && echo ok)" "ok"
expect_ok "document insert with byte_size = 0 (the boundary of the >= 0 CHECK) succeeds" \
  "INSERT INTO hr_restricted_case_documents (organisation_id, case_id, uploaded_by, original_filename, content_type, byte_size, storage_key) VALUES ('org-a', '$CASE_A', 'user-a1', 'empty.txt', 'text/plain', 0, 'hr-restricted/org-a/doc-empty')"
expect_ok "a consistent closed case (status closed + closed_at set) is accepted" \
  "INSERT INTO hr_restricted_cases (organisation_id, case_type, status, title, opened_by, closed_at) VALUES ('org-a', 'disciplinary', 'closed', 'Closed case', 'user-a1', now())"

echo ""
echo "=== CROSS-ORG: the database itself rejects every cross-organisation composite reference (SQLSTATE 23503) ==="
expect_err "participant->case: an org-b row pointing at an org-a case is rejected" \
  "INSERT INTO hr_restricted_case_participants (organisation_id, case_id, person_id) VALUES ('org-b', '$CASE_A', '$PERSON_B')" \
  23503 hr_restricted_case_participants_org_case_fkey
expect_err "participant->person: an org-a row (org-a case) pointing at an org-b person is rejected" \
  "INSERT INTO hr_restricted_case_participants (organisation_id, case_id, person_id) VALUES ('org-a', '$CASE_A', '$PERSON_B')" \
  23503 hr_restricted_case_participants_org_person_fkey
expect_err "participant->person: an org-b row (org-b case) pointing at an org-a person is rejected" \
  "INSERT INTO hr_restricted_case_participants (organisation_id, case_id, person_id) VALUES ('org-b', '$CASE_B', '$PERSON_A')" \
  23503 hr_restricted_case_participants_org_person_fkey
expect_err "access->case: an org-b grant pointing at an org-a case is rejected" \
  "INSERT INTO hr_restricted_case_access (organisation_id, case_id, user_id, granted_by) VALUES ('org-b', '$CASE_A', 'user-b1', 'user-b1')" \
  23503 hr_restricted_case_access_org_case_fkey
expect_err "notes->case: an org-b note pointing at an org-a case is rejected" \
  "INSERT INTO hr_restricted_case_notes (organisation_id, case_id, author_id, body) VALUES ('org-b', '$CASE_A', 'user-b1', 'Cross-org note')" \
  23503 hr_restricted_case_notes_org_case_fkey
expect_err "documents->case: an org-b document pointing at an org-a case is rejected" \
  "INSERT INTO hr_restricted_case_documents (organisation_id, case_id, uploaded_by, original_filename, content_type, byte_size, storage_key) VALUES ('org-b', '$CASE_A', 'user-b1', 'x.pdf', 'application/pdf', 1, 'hr-restricted/org-b/cross')" \
  23503 hr_restricted_case_documents_org_case_fkey
expect_err "re-pointing an existing org-a participant row at org-b (UPDATE organisation_id + person_id) is rejected on the case FK" \
  "UPDATE hr_restricted_case_participants SET organisation_id = 'org-b', person_id = '$PERSON_B' WHERE id = '$PARTICIPANT_A'" \
  23503 hr_restricted_case_participants_org_case_fkey
MOVE_CASE="$(q "INSERT INTO hr_restricted_cases (organisation_id, case_type, title, opened_by) VALUES ('org-a', 'other', 'Case with one note', 'user-a1') RETURNING id;")"
MOVE_NOTE="$(q "INSERT INTO hr_restricted_case_notes (organisation_id, case_id, author_id, body) VALUES ('org-a', '$MOVE_CASE', 'user-a1', 'Only child row') RETURNING id;")"
check "fixture: a case whose only child row is one note" "$([ -n "$MOVE_CASE" ] && [ -n "$MOVE_NOTE" ] && echo ok)" "ok"
expect_err "moving a case that has a child row to another organisation (UPDATE organisation_id) is rejected" \
  "UPDATE hr_restricted_cases SET organisation_id = 'org-b' WHERE id = '$MOVE_CASE'" \
  23503 hr_restricted_case_notes_org_case_fkey
check "no child row anywhere disagrees with its case's (or person's) organisation" \
  "$(q "SELECT (SELECT count(*) FROM hr_restricted_case_participants p JOIN hr_restricted_cases c ON c.id = p.case_id WHERE c.organisation_id <> p.organisation_id) + (SELECT count(*) FROM hr_restricted_case_participants p JOIN hr_people h ON h.id = p.person_id WHERE h.organisation_id <> p.organisation_id) + (SELECT count(*) FROM hr_restricted_case_access a JOIN hr_restricted_cases c ON c.id = a.case_id WHERE c.organisation_id <> a.organisation_id) + (SELECT count(*) FROM hr_restricted_case_notes n JOIN hr_restricted_cases c ON c.id = n.case_id WHERE c.organisation_id <> n.organisation_id) + (SELECT count(*) FROM hr_restricted_case_documents d JOIN hr_restricted_cases c ON c.id = d.case_id WHERE c.organisation_id <> d.organisation_id);")" \
  "0"

echo ""
echo "=== DOCUMENTED LIMITATION (EXPECTED - not a failure): single-column user FKs do NOT check the user's organisation ==="
echo "    opened_by / user_id / granted_by / revoked_by / author_id / uploaded_by reference users(id) only. Each write below"
echo "    references an ORG-B user from an ORG-A row and is EXPECTED to SUCCEED at the DB level. Same-organisation validation"
echo "    of these user references is APP-LAYER-ENFORCED in later PRs (PR-2+), exactly as the migration header documents."
LIMIT_CASE="$(q "INSERT INTO hr_restricted_cases (organisation_id, case_type, title, opened_by) VALUES ('org-a', 'other', 'Limitation case', 'user-b1') RETURNING id;")"
check "DOCUMENTED LIMITATION (expected; app-layer-enforced later): org-a case with opened_by = an org-b user is accepted by the DB" \
  "$([ -n "$LIMIT_CASE" ] && echo accepted)" "accepted"
expect_ok "DOCUMENTED LIMITATION (expected; app-layer-enforced later): org-a access grant with user_id and granted_by = an org-b user is accepted by the DB" \
  "INSERT INTO hr_restricted_case_access (organisation_id, case_id, user_id, granted_by) VALUES ('org-a', '$LIMIT_CASE', 'user-b1', 'user-b1')"
expect_ok "DOCUMENTED LIMITATION (expected; app-layer-enforced later): org-a revocation with revoked_by = an org-b user is accepted by the DB" \
  "UPDATE hr_restricted_case_access SET revoked_at = now(), revoked_by = 'user-b1' WHERE case_id = '$LIMIT_CASE' AND user_id = 'user-b1' AND revoked_at IS NULL"
expect_ok "DOCUMENTED LIMITATION (expected; app-layer-enforced later): org-a note with author_id = an org-b user is accepted by the DB" \
  "INSERT INTO hr_restricted_case_notes (organisation_id, case_id, author_id, body) VALUES ('org-a', '$LIMIT_CASE', 'user-b1', 'Cross-org author')"
expect_ok "DOCUMENTED LIMITATION (expected; app-layer-enforced later): org-a document with uploaded_by = an org-b user is accepted by the DB" \
  "INSERT INTO hr_restricted_case_documents (organisation_id, case_id, uploaded_by, original_filename, content_type, byte_size, storage_key) VALUES ('org-a', '$LIMIT_CASE', 'user-b1', 'l.pdf', 'application/pdf', 5, 'hr-restricted/org-a/limitation')"
expect_err "a NON-EXISTENT user is still rejected by the single-column user FK (the limitation is organisation matching only)" \
  "INSERT INTO hr_restricted_case_notes (organisation_id, case_id, author_id, body) VALUES ('org-a', '$CASE_A', 'no-such-user', 'Ghost author')" \
  23503 hr_restricted_case_notes_author_id_fkey

echo ""
echo "=== PARTIAL UNIQUE: at most one LIVE grant per (case_id, user_id) - hr_restricted_case_access_one_live_grant ==="
GRANT_CASE="$(q "INSERT INTO hr_restricted_cases (organisation_id, case_type, title, opened_by) VALUES ('org-a', 'investigation', 'Grant lifecycle case', 'user-a1') RETURNING id;")"
expect_ok "first live grant (case, user-a3) succeeds" \
  "INSERT INTO hr_restricted_case_access (organisation_id, case_id, user_id, granted_by) VALUES ('org-a', '$GRANT_CASE', 'user-a3', 'user-a1')"
expect_err "a duplicate live grant for the same (case, user-a3) is rejected with 23505 by hr_restricted_case_access_one_live_grant" \
  "INSERT INTO hr_restricted_case_access (organisation_id, case_id, user_id, granted_by) VALUES ('org-a', '$GRANT_CASE', 'user-a3', 'user-a2')" \
  23505 hr_restricted_case_access_one_live_grant
check "revoking the first grant updates exactly one row" \
  "$(q "WITH r AS (UPDATE hr_restricted_case_access SET revoked_at = now(), revoked_by = 'user-a1' WHERE case_id = '$GRANT_CASE' AND user_id = 'user-a3' AND revoked_at IS NULL RETURNING 1) SELECT count(*) FROM r;")" "1"
expect_ok "re-granting (case, user-a3) after the revocation succeeds" \
  "INSERT INTO hr_restricted_case_access (organisation_id, case_id, user_id, granted_by) VALUES ('org-a', '$GRANT_CASE', 'user-a3', 'user-a1')"
check "exactly one revoked + one live row remain for (case, user-a3) (revoked|live)" \
  "$(q "SELECT count(*) FILTER (WHERE revoked_at IS NOT NULL) || '|' || count(*) FILTER (WHERE revoked_at IS NULL) FROM hr_restricted_case_access WHERE case_id = '$GRANT_CASE' AND user_id = 'user-a3';")" "1|1"
expect_ok "the same user may hold a live grant on a DIFFERENT case (the rule is per case)" \
  "INSERT INTO hr_restricted_case_access (organisation_id, case_id, user_id, granted_by) VALUES ('org-a', '$CASE_A', 'user-a3', 'user-a1')"

echo ""
echo "=== CHECK: revoked_at and revoked_by are set together - hr_restricted_case_access_revoked_pair_check ==="
expect_err "revoked_at set with revoked_by NULL is rejected" \
  "INSERT INTO hr_restricted_case_access (organisation_id, case_id, user_id, granted_by, revoked_at) VALUES ('org-a', '$CASE_A', 'user-a1', 'user-a1', now())" \
  23514 hr_restricted_case_access_revoked_pair_check
expect_err "revoked_by set with revoked_at NULL is rejected" \
  "INSERT INTO hr_restricted_case_access (organisation_id, case_id, user_id, granted_by, revoked_by) VALUES ('org-a', '$CASE_A', 'user-a1', 'user-a1', 'user-a1')" \
  23514 hr_restricted_case_access_revoked_pair_check
expect_err "revoking an existing live grant with revoked_at only (UPDATE, no revoked_by) is rejected" \
  "UPDATE hr_restricted_case_access SET revoked_at = now() WHERE id = '$ACCESS_A'" \
  23514 hr_restricted_case_access_revoked_pair_check

echo ""
echo "=== CHECK: status is 'closed' if and only if closed_at is set - hr_restricted_cases_status_closed_at_check ==="
expect_err "status closed with closed_at NULL is rejected" \
  "INSERT INTO hr_restricted_cases (organisation_id, case_type, status, title, opened_by) VALUES ('org-a', 'grievance', 'closed', 'Bad closed', 'user-a1')" \
  23514 hr_restricted_cases_status_closed_at_check
expect_err "status open with closed_at set is rejected" \
  "INSERT INTO hr_restricted_cases (organisation_id, case_type, status, title, opened_by, closed_at) VALUES ('org-a', 'grievance', 'open', 'Bad open', 'user-a1', now())" \
  23514 hr_restricted_cases_status_closed_at_check
expect_err "closing an existing case without setting closed_at (UPDATE) is rejected" \
  "UPDATE hr_restricted_cases SET status = 'closed' WHERE id = '$CASE_A'" \
  23514 hr_restricted_cases_status_closed_at_check

echo ""
echo "=== UNIQUE: one participant row per (organisation_id, case_id, person_id) - hr_restricted_case_participants_org_case_person_key ==="
expect_err "a duplicate participant (same org, case and person) is rejected, even with a different role" \
  "INSERT INTO hr_restricted_case_participants (organisation_id, case_id, person_id, role_in_case) VALUES ('org-a', '$CASE_A', '$PERSON_A', 'complainant')" \
  23505 hr_restricted_case_participants_org_case_person_key

echo ""
echo "=== UNIQUE: storage_key - hr_restricted_case_documents_storage_key_key ==="
expect_err "a duplicate storage_key is rejected" \
  "INSERT INTO hr_restricted_case_documents (organisation_id, case_id, uploaded_by, original_filename, content_type, byte_size, storage_key) VALUES ('org-a', '$CASE_A', 'user-a1', 'copy.pdf', 'application/pdf', 2048, 'hr-restricted/org-a/doc-1')" \
  23505 hr_restricted_case_documents_storage_key_key
expect_err "a duplicate storage_key is rejected even for another organisation's case (the key is globally unique)" \
  "INSERT INTO hr_restricted_case_documents (organisation_id, case_id, uploaded_by, original_filename, content_type, byte_size, storage_key) VALUES ('org-b', '$CASE_B', 'user-b1', 'copy.pdf', 'application/pdf', 2048, 'hr-restricted/org-a/doc-1')" \
  23505 hr_restricted_case_documents_storage_key_key

echo ""
echo "=== CHECK: byte_size >= 0 - hr_restricted_case_documents_byte_size_check ==="
expect_err "a negative byte_size is rejected" \
  "INSERT INTO hr_restricted_case_documents (organisation_id, case_id, uploaded_by, original_filename, content_type, byte_size, storage_key) VALUES ('org-a', '$CASE_A', 'user-a1', 'neg.pdf', 'application/pdf', -1, 'hr-restricted/org-a/negative')" \
  23514 hr_restricted_case_documents_byte_size_check

echo ""
echo "=== CHECK: locked vocabularies ==="
expect_err "an out-of-vocabulary case_type is rejected by hr_restricted_cases_case_type_check" \
  "INSERT INTO hr_restricted_cases (organisation_id, case_type, title, opened_by) VALUES ('org-a', 'performance', 'Bad type', 'user-a1')" \
  23514 hr_restricted_cases_case_type_check
expect_err "an out-of-vocabulary status is rejected by hr_restricted_cases_status_check" \
  "INSERT INTO hr_restricted_cases (organisation_id, case_type, status, title, opened_by) VALUES ('org-a', 'grievance', 'archived', 'Bad status', 'user-a1')" \
  23514 hr_restricted_cases_status_check
ROLE_PERSON_B="$(q "INSERT INTO hr_people (organisation_id, first_name, last_name) VALUES ('org-b', 'Role', 'Probe') RETURNING id;")"
expect_err "an out-of-vocabulary role_in_case is rejected by hr_restricted_case_participants_role_in_case_check" \
  "INSERT INTO hr_restricted_case_participants (organisation_id, case_id, person_id, role_in_case) VALUES ('org-b', '$CASE_B', '$ROLE_PERSON_B', 'manager')" \
  23514 hr_restricted_case_participants_role_in_case_check
for v in grievance disciplinary investigation other; do
  expect_ok "case_type '$v' is accepted" \
    "INSERT INTO hr_restricted_cases (organisation_id, case_type, title, opened_by) VALUES ('org-b', '$v', 'Vocab $v', 'user-b1')"
done
VOCAB_CASE="$(q "INSERT INTO hr_restricted_cases (organisation_id, case_type, title, opened_by) VALUES ('org-a', 'other', 'Role vocabulary case', 'user-a1') RETURNING id;")"
for v in subject complainant respondent witness other; do
  VOCAB_PERSON="$(q "INSERT INTO hr_people (organisation_id, first_name, last_name) VALUES ('org-a', 'Role', '$v') RETURNING id;")"
  expect_ok "role_in_case '$v' is accepted" \
    "INSERT INTO hr_restricted_case_participants (organisation_id, case_id, person_id, role_in_case) VALUES ('org-a', '$VOCAB_CASE', '$VOCAB_PERSON', '$v')"
done

echo ""
echo "=== DOCUMENTED LIFECYCLE LIMITATIONS (EXPECTED): append-only / soft-delete / grant history / case no-delete are NOT schema-enforced ==="
echo "    These are APPLICATION-LAYER lifecycle invariants for later PRs. Each write below is EXPECTED to succeed at the DB"
echo "    level, proving the migration comments do not overclaim what Postgres enforces."
LIFE_CASE="$(q "INSERT INTO hr_restricted_cases (organisation_id, case_type, title, opened_by) VALUES ('org-a', 'other', 'Lifecycle case', 'user-a1') RETURNING id;")"
LIFE_NOTE="$(q "INSERT INTO hr_restricted_case_notes (organisation_id, case_id, author_id, body) VALUES ('org-a', '$LIFE_CASE', 'user-a1', 'Original') RETURNING id;")"
LIFE_DOC="$(q "INSERT INTO hr_restricted_case_documents (organisation_id, case_id, uploaded_by, original_filename, content_type, byte_size, storage_key) VALUES ('org-a', '$LIFE_CASE', 'user-a1', 'life.pdf', 'application/pdf', 9, 'hr-restricted/org-a/life') RETURNING id;")"
LIFE_GRANT="$(q "INSERT INTO hr_restricted_case_access (organisation_id, case_id, user_id, granted_by, revoked_at, revoked_by) VALUES ('org-a', '$LIFE_CASE', 'user-a2', 'user-a1', now(), 'user-a1') RETURNING id;")"
check "fixture: lifecycle case with one note, one document and one revoked grant" \
  "$([ -n "$LIFE_CASE" ] && [ -n "$LIFE_NOTE" ] && [ -n "$LIFE_DOC" ] && [ -n "$LIFE_GRANT" ] && echo ok)" "ok"
expect_ok "DOCUMENTED (expected): a note body can be UPDATEd at the DB level (append-only is an app rule)" \
  "UPDATE hr_restricted_case_notes SET body = 'Edited' WHERE id = '$LIFE_NOTE'"
expect_ok "DOCUMENTED (expected): a note can be DELETEd at the DB level (no-delete is an app rule)" \
  "DELETE FROM hr_restricted_case_notes WHERE id = '$LIFE_NOTE'"
expect_ok "DOCUMENTED (expected): a document row can be hard-DELETEd at the DB level (soft-delete is an app rule)" \
  "DELETE FROM hr_restricted_case_documents WHERE id = '$LIFE_DOC'"
expect_ok "DOCUMENTED (expected): a revocation can be cleared at the DB level (grant-history preservation is an app rule)" \
  "UPDATE hr_restricted_case_access SET revoked_at = NULL, revoked_by = NULL WHERE id = '$LIFE_GRANT'"
expect_ok "DOCUMENTED (expected): a grant row can be DELETEd at the DB level (grant-history preservation is an app rule)" \
  "DELETE FROM hr_restricted_case_access WHERE id = '$LIFE_GRANT'"
expect_ok "DOCUMENTED (expected): a case with no child rows can be DELETEd at the DB level (case no-delete is an app rule)" \
  "DELETE FROM hr_restricted_cases WHERE id = '$LIFE_CASE'"
expect_err "FK side effect, NOT a no-delete guarantee: a case that still has a child row cannot be deleted (default NO ACTION)" \
  "DELETE FROM hr_restricted_cases WHERE id = '$MOVE_CASE'" \
  23503 hr_restricted_case_notes_org_case_fkey

echo ""
echo "=== SCRIPT GUARDS (separate throwaway databases) ==="
if echo "CREATE DATABASE guarddb;" | psql_exec && setup_hr1_db guarddb; then
  WRONG_ORDER_OUT="$(psql_exec_db guarddb < scripts/create-hr-restricted-cases.sql 2>&1; echo "EXIT:$?")"
  if echo "$WRONG_ORDER_OUT" | grep -q "hr_people_organisation_id_id_key is missing" && ! echo "$WRONG_ORDER_OUT" | grep -q "EXIT:0"; then
    record_pass "creation script run BEFORE the anchor script is refused by its pre-flight check (non-zero exit)"
  else
    record_fail "creation script did not fail closed without the anchor: $WRONG_ORDER_OUT"
  fi
  check "no hr_restricted_* table exists after the refused run (no partial application)" \
    "$(q_db guarddb "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'hr\\_restricted\\_%';")" "0"
else
  record_fail "could not create/set up the throwaway guard database"
fi
DRIFT_SETUP="
CREATE TABLE organisations (id TEXT PRIMARY KEY);
CREATE TABLE hr_people (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id));
ALTER TABLE hr_people ADD CONSTRAINT hr_people_organisation_id_id_key UNIQUE (id, organisation_id);
"
if echo "CREATE DATABASE driftdb;" | psql_exec && echo "$DRIFT_SETUP" | psql_exec_db driftdb; then
  DRIFT_OUT="$(psql_exec_db driftdb < scripts/add-hr-people-tenant-unique.sql 2>&1; echo "EXIT:$?")"
  if echo "$DRIFT_OUT" | grep -q 'Migration drift: hr_people.hr_people_organisation_id_id_key is "UNIQUE (id, organisation_id)"' && ! echo "$DRIFT_OUT" | grep -q "EXIT:0"; then
    record_pass "anchor script raises on a same-named hr_people constraint over different columns instead of silently accepting it"
  else
    record_fail "anchor script did not refuse the drifted constraint: $DRIFT_OUT"
  fi
else
  record_fail "could not create/set up the throwaway drift database"
fi

echo ""
echo "=== IDEMPOTENCY: apply both scripts a SECOND time (separate plain psql runs, data present) ==="
ROW_COUNTS_BEFORE="$(q "$ROW_COUNTS_SQL")"
PEOPLE_DATA_BEFORE="$(q "$PEOPLE_DATA_SQL")"
SECOND_RUN_OUTPUT="$( (psql_exec < scripts/add-hr-people-tenant-unique.sql && psql_exec < scripts/create-hr-restricted-cases.sql) 2>&1; echo "EXIT:$?")"
if echo "$SECOND_RUN_OUTPUT" | grep -q "EXIT:0" && ! echo "$SECOND_RUN_OUTPUT" | grep -q "ERROR"; then
  record_pass "second apply of both scripts exited 0 with zero errors ($(echo "$SECOND_RUN_OUTPUT" | grep -c 'NOTICE') already-exists NOTICEs)"
else
  echo "$SECOND_RUN_OUTPUT" | tail -30
  record_fail "second apply failed - see output above"
fi
check "schema fingerprint (columns, constraint defs, index defs, triggers) unchanged after re-apply" "$(q "$SCHEMA_FINGERPRINT_SQL")" "$SCHEMA_FP_1"
check "schema object counts unchanged after re-apply" "$(q "$SCHEMA_COUNTS_SQL")" "$SCHEMA_COUNTS_1"
check "row counts unchanged after re-apply (hr_people|cases|participants|access|notes|documents)" "$(q "$ROW_COUNTS_SQL")" "$ROW_COUNTS_BEFORE"
check "hr_people row data byte-identical after re-apply" "$(q "$PEOPLE_DATA_SQL")" "$PEOPLE_DATA_BEFORE"
check "still exactly one hr_people_organisation_id_id_key after re-apply" \
  "$(q "SELECT count(*) FROM pg_constraint WHERE conrelid = 'hr_people'::regclass AND conname = 'hr_people_organisation_id_id_key';")" "1"

echo ""
echo "=== SUMMARY ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
exit 0
