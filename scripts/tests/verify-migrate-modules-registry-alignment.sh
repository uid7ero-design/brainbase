#!/usr/bin/env bash
# app/api/admin/migrate/route.ts — modules/organisation_modules canonical
# registry alignment (Phase D.4.6H-R4A) — real-Postgres proof.
#
# WHY A BASH+PSQL HARNESS: same rationale as scripts/tests/
# verify-migrate-organisation-id-type-repair.sh (R2) — @neondatabase/
# serverless cannot connect to a bare local Postgres, and `pg` is not a
# project dependency. Extracts the REAL route's statements verbatim.
#
# WHAT THIS PROVES: app/api/admin/migrate/route.ts's steps 18/19 (modules,
# organisation_modules) previously described a pre-"Modular Platform
# Foundation" registry (modules: id UUID PK, industry TEXT, status TEXT;
# organisation_modules: module_id UUID REFERENCES modules(id)) that no
# longer matches the canonical schema (scripts/create-modules.sql,
# scripts/create-organisation-modules.sql, prisma/schema.prisma) every
# live capability-gating call site already depends on — this is what
# blocked PR #153's Preview migration at "seed modules" once R2's
# organisation_id/user-ID repair got past waste_records/email_tokens.
# This harness proves: (STATE A) a genuinely fresh bootstrap creates both
# tables in the canonical shape and seeds crm+organiser correctly; (STATE
# B) an environment that already has both tables in the canonical shape
# (matching what PR #153's actual Preview branch is believed to have)
# safely no-ops with zero data loss; and that the broader migration
# sequence now progresses past "seed modules" toward organiser_activity
# and the final step.
#
# USAGE:
#   bash scripts/tests/verify-migrate-modules-registry-alignment.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then
  REPO_ROOT_NODE="$(cygpath -w "$REPO_ROOT")"
else
  REPO_ROOT_NODE="$REPO_ROOT"
fi
CONTAINER="migrate-modules-alignment-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 2
fi

check() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $label (got '$actual')"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label — expected '$expected', got '$actual'"
    FAIL=$((FAIL + 1))
    FAILURES+=("$label — expected '$expected', got '$actual'")
  fi
}

echo "Starting disposable postgres:16 ($CONTAINER)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16 >/dev/null

READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: postgres did not become ready within 30s." >&2
  exit 2
fi

psql_exec() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1; }
psql_query() { docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1; }

extract_block() {
  # $1 = start marker (exact text), $2 = literal end marker
  node -e '
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.join(process.argv[1], "app", "api", "admin", "migrate", "route.ts"), "utf-8");
    const start = src.indexOf(process.argv[2]);
    if (start === -1) { console.error("marker not found: " + process.argv[2]); process.exit(1); }
    const end = src.indexOf("`;", start);
    process.stdout.write(src.slice(start, end));
  ' "$REPO_ROOT_NODE" "$1"
}

extract_route_statements() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.join(process.argv[1], "app", "api", "admin", "migrate", "route.ts"), "utf-8");
    const stmts = [...src.matchAll(/await sql`([\s\S]*?)`/g)].map(m => m[1]);
    process.stdout.write(stmts.join(";\n") + ";\n");
  ' "$REPO_ROOT_NODE"
}

MODULES_STMT_FILE="$(mktemp)"
ORG_MODULES_STMT_FILE="$(mktemp)"
SEED_STMT_FILE="$(mktemp)"
extract_block "CREATE TABLE IF NOT EXISTS modules (" > "$MODULES_STMT_FILE"
extract_block "CREATE TABLE IF NOT EXISTS organisation_modules (" > "$ORG_MODULES_STMT_FILE"
extract_block "INSERT INTO modules (key, name, description, active) VALUES" > "$SEED_STMT_FILE"

echo ""
echo "=== STATE A — FRESH: both tables absent ==="
cat <<'SQL' | psql_exec
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT);
SQL
psql_exec < "$MODULES_STMT_FILE"
psql_exec < "$ORG_MODULES_STMT_FILE"
psql_exec < "$SEED_STMT_FILE"

MOD_COLS="$(echo "SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='modules';" | psql_query)"
check "STATE A: modules columns are exactly canonical (key:text,name:text,description:text,active:boolean,created_at:timestamp with time zone,updated_at:timestamp with time zone)" "$MOD_COLS" "key:text,name:text,description:text,active:boolean,created_at:timestamp with time zone,updated_at:timestamp with time zone"

MOD_PK="$(echo "SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = 'modules'::regclass AND i.indisprimary;" | psql_query | tr -d '[:space:]')"
check "STATE A: modules PK is key" "$MOD_PK" "key"

OM_COLS="$(echo "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='organisation_modules';" | psql_query)"
check "STATE A: organisation_modules columns are exactly canonical" "$OM_COLS" "id,organisation_id,module_key,enabled,config,created_at,updated_at"

OM_FK_MODULE="$(echo "
SELECT ccu.table_name || '.' || ccu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_name='organisation_modules' AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='module_key';
" | psql_query | tr -d '[:space:]')"
check "STATE A: organisation_modules.module_key FK targets modules.key" "$OM_FK_MODULE" "modules.key"

SEED_ROWS="$(echo "SELECT string_agg(key, ',' ORDER BY key) FROM modules;" | psql_query)"
check "STATE A: canonical seed registers exactly crm,organiser" "$SEED_ROWS" "crm,organiser"

# Real FK behaviour proof: insert org + entitlement row using module_key.
echo "INSERT INTO organisations (id, name) VALUES ('org-a', 'Test Org');" | psql_exec >/dev/null
INSERT_OK="$(echo "INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('org-a', 'organiser', true) RETURNING module_key;" | psql_query | tr -d '[:space:]')"
check "STATE A: entitlement row inserts successfully via module_key FK" "$INSERT_OK" "organiser"
FK_REJECT="$(echo "INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('org-a', 'not-a-real-module', true);" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$FK_REJECT" | grep -q "violates foreign key constraint"; then
  echo "  PASS: FK correctly rejects a non-existent module_key"
  PASS=$((PASS + 1))
else
  echo "  FAIL: FK did not reject a non-existent module_key: $FK_REJECT"
  FAIL=$((FAIL + 1))
  FAILURES+=("FK did not reject invalid module_key")
fi

echo ""
echo "=== STATE B — EXISTING CANONICAL PAIR: pre-created in canonical shape, with marker rows ==="
cat <<'SQL' | psql_exec
DROP TABLE organisation_modules;
DROP TABLE modules;
CREATE TABLE modules (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE organisation_modules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id TEXT NOT NULL, module_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false, config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organisation_modules_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE RESTRICT,
  CONSTRAINT organisation_modules_module_key_fkey FOREIGN KEY (module_key) REFERENCES modules(key) ON DELETE RESTRICT,
  CONSTRAINT organisation_modules_organisation_id_module_key_key UNIQUE (organisation_id, module_key)
);
INSERT INTO modules (key, name, description, active) VALUES ('crm', 'CRM', 'Customer relationship management for companies, contacts, deals and activities.', true), ('organiser', 'Organiser', 'Organisation-scoped board and task management.', true);
INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('org-a', 'organiser', true);
SQL
MARKER_BEFORE="$(echo "SELECT enabled FROM organisation_modules WHERE organisation_id='org-a' AND module_key='organiser';" | psql_query | tr -d '[:space:]')"
MOD_COUNT_BEFORE="$(echo "SELECT COUNT(*) FROM modules;" | psql_query | tr -d '[:space:]')"

RUN_B_OUTPUT="$( (cat "$MODULES_STMT_FILE"; echo ';'; cat "$ORG_MODULES_STMT_FILE"; echo ';'; cat "$SEED_STMT_FILE"; echo ';') | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$RUN_B_OUTPUT" | grep -q "EXIT:0"; then
  echo "  PASS: corrected blocks no-op cleanly against an already-canonical pair"
  PASS=$((PASS + 1))
else
  echo "  FAIL: corrected blocks failed against an already-canonical pair"
  echo "$RUN_B_OUTPUT" | tail -20
  FAIL=$((FAIL + 1))
  FAILURES+=("STATE B run failed — see output above")
fi

MARKER_AFTER="$(echo "SELECT enabled FROM organisation_modules WHERE organisation_id='org-a' AND module_key='organiser';" | psql_query | tr -d '[:space:]')"
check "STATE B: marker entitlement row survives untouched" "$MARKER_AFTER" "$MARKER_BEFORE"
MOD_COUNT_AFTER="$(echo "SELECT COUNT(*) FROM modules;" | psql_query | tr -d '[:space:]')"
check "STATE B: no duplicate modules rows after re-apply (ON CONFLICT DO NOTHING honoured)" "$MOD_COUNT_AFTER" "$MOD_COUNT_BEFORE"
OM_COUNT_AFTER="$(echo "SELECT COUNT(*) FROM organisation_modules;" | psql_query | tr -d '[:space:]')"
check "STATE B: no duplicate organisation_modules rows created" "$OM_COUNT_AFTER" "1"

echo ""
echo "=== BROADER MIGRATION PROGRESSION: full sequence from a genuinely clean, fresh disposable database ==="
docker rm -f "$CONTAINER" >/dev/null 2>&1
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16 >/dev/null
READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
cat <<'SQL' | psql_exec
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, username TEXT);
CREATE TABLE crm_contacts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL);
SQL

FULL_RUN_OUTPUT="$(extract_route_statements | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$FULL_RUN_OUTPUT" | grep -q "EXIT:0"; then
  echo "  PASS: full migration sequence executed with ZERO errors, start to finish (past seed modules, through organiser_activity, to the final step)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: full migration sequence failed"
  echo "$FULL_RUN_OUTPUT" | tail -30
  FAIL=$((FAIL + 1))
  FAILURES+=("broader migration progression failed — see output above")
fi

for TABLE in modules organisation_modules organiser_boards organiser_activity crm_contacts; do
  EXISTS="$(echo "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='$TABLE';" | psql_query | tr -d '[:space:]')"
  check "milestone reached: $TABLE exists" "$EXISTS" "1"
done
CLASSIFICATION_COL="$(echo "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='crm_contacts' AND column_name='classification';" | psql_query | tr -d '[:space:]')"
check "final milestone reached: crm_contacts.classification exists (the last step in the file)" "$CLASSIFICATION_COL" "1"
SEED_ROWS_FULL="$(echo "SELECT string_agg(key, ',' ORDER BY key) FROM modules;" | psql_query)"
check "canonical seed present in full-sequence run too" "$SEED_ROWS_FULL" "crm,organiser"

echo ""
echo "=== IDEMPOTENCY: run the full sequence a SECOND time against the same database ==="
ORG_COUNT_BEFORE="$(echo "SELECT COUNT(*) FROM modules;" | psql_query | tr -d '[:space:]')"
SECOND_RUN_OUTPUT="$(extract_route_statements | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$SECOND_RUN_OUTPUT" | grep -q "EXIT:0"; then
  echo "  PASS: second full-sequence run succeeded with ZERO errors"
  PASS=$((PASS + 1))
else
  echo "  FAIL: second full-sequence run failed"
  echo "$SECOND_RUN_OUTPUT" | tail -20
  FAIL=$((FAIL + 1))
  FAILURES+=("idempotency (second) run failed — see output above")
fi
ORG_COUNT_AFTER="$(echo "SELECT COUNT(*) FROM modules;" | psql_query | tr -d '[:space:]')"
check "no data loss/duplication: modules row count unchanged after re-apply" "$ORG_COUNT_AFTER" "$ORG_COUNT_BEFORE"

echo ""
echo "=== SUMMARY ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  rm -f "$MODULES_STMT_FILE" "$ORG_MODULES_STMT_FILE" "$SEED_STMT_FILE"
  exit 1
fi
rm -f "$MODULES_STMT_FILE" "$ORG_MODULES_STMT_FILE" "$SEED_STMT_FILE"
exit 0
