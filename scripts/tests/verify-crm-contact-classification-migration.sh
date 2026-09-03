#!/usr/bin/env bash
# scripts/add-crm-contact-classification.sql — real-Postgres proof.
#
# WHY A BASH+PSQL HARNESS AND NOT THE VITEST INTEGRATION TEST: this
# repository's own lib/db.ts uses @neondatabase/serverless's neon()
# tagged-template driver, which speaks Neon's proprietary HTTPS "/sql"
# endpoint protocol (see node_modules/@neondatabase/serverless's
# fetchEndpoint — a literal "https://" + host + "/sql" URL), NOT the
# plain Postgres wire protocol. It cannot connect to an ordinary local/
# disposable postgres:16-alpine container. The official local-dev proxy
# for this driver (neondatabase/neon_local) was tried and confirmed to
# require a real NEON_PROJECT_ID / Neon Cloud account to create a branch
# against — it is not a fully offline, credential-free, disposable-only
# tool, so it was rejected as out of scope for a same-session, zero-
# credential proof. tests/containment/crmContactClassificationMigration.
# integration.test.ts and its sibling crmMigrationSchema.integration.
# test.ts are therefore both, as written, only runnable against a real
# Neon-hosted (or Neon-Local-proxied) endpoint — not a bare local
# container — a pre-existing structural fact about this repo's chosen
# driver, not something introduced by this phase.
#
# This harness instead follows this repo's OWN established, working
# pattern for exactly this class of problem — see
# scripts/tests/verify-events-crm-sync-concurrency.sh's own header
# comment: "does not invoke the actual TypeScript function... proves the
# underlying SQL PATTERN... the same separation-of-concerns already
# established by every other verify-*.sh harness in this repository."
# It applies the REAL migration files — scripts/crm-migrate.mjs's own
# statements (same extraction technique as the vitest integration test)
# and scripts/add-crm-contact-classification.sql verbatim, byte-for-byte,
# never rewritten — against a genuinely disposable, unique, throwaway
# postgres:16-alpine Docker container, and proves the requested schema/
# constraint/index/backwards-compatibility/idempotency behaviour via
# direct psql queries. Requires only Docker + Node (both already used by
# this repo's other verify-*.sh harnesses and tooling). Not wired into
# CI. Creates and destroys its own disposable container; never touches
# Production, DEV, or any shared/persistent database.
#
# USAGE:
#   bash scripts/tests/verify-crm-contact-classification-migration.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# On Git Bash for Windows, Node (a native Windows binary) does not
# understand POSIX-style /c/... paths the way bash/cygpath do — convert
# to a Windows-style path for anything handed to `node -e`.
if command -v cygpath >/dev/null 2>&1; then
  REPO_ROOT_NODE="$(cygpath -w "$REPO_ROOT")"
else
  REPO_ROOT_NODE="$REPO_ROOT"
fi
CONTAINER="crm-classification-migration-harness-$$"
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

echo "Starting disposable postgres:16-alpine ($CONTAINER)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine >/dev/null

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

echo ""
echo "=== BOOTSTRAP: minimal parent tables (matching the real FK targets crm-migrate.mjs expects) ==="
cat <<'SQL' | psql_exec
CREATE TABLE organisations (id TEXT PRIMARY KEY);
CREATE TABLE users (id TEXT PRIMARY KEY);
INSERT INTO organisations (id) VALUES ('clx7q9k2e0000abcdorg1');
SQL
echo "  organisations + users created, one organisation seeded"

echo ""
echo "=== APPLY THE REAL scripts/crm-migrate.mjs STATEMENTS (extracted verbatim, never rewritten) ==="
node -e '
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(process.argv[1], "scripts", "crm-migrate.mjs"), "utf-8");
const stmts = [...src.matchAll(/await sql\.query\(`([\s\S]*?)`\)/g)].map(m => m[1]);
process.stdout.write(stmts.join(";\n") + ";\n");
' "$REPO_ROOT_NODE" | psql_exec
echo "  base CRM schema applied (crm_companies, crm_contacts, crm_deals, crm_activities + indexes)"

echo ""
echo "=== SEED ONE PRE-EXISTING crm_contacts ROW BEFORE THE CLASSIFICATION MIGRATION RUNS ==="
cat <<'SQL' | psql_exec
INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, phone, job_title, notes)
VALUES ('clx7q9k2e0000abcdorg1', 'Pre', 'Existing', 'pre-existing@example.invalid', '+61400000000', 'Legacy Title', 'Pre-migration note');
SQL
PRE_ID="$(echo "SELECT id::text FROM crm_contacts WHERE first_name='Pre' AND last_name='Existing';" | psql_query | tr -d '[:space:]')"
echo "  seeded pre-existing contact id=$PRE_ID"

echo ""
echo "=== APPLY THE REAL scripts/add-crm-contact-classification.sql (verbatim file, byte-for-byte, unmodified) ==="
psql_exec < "$REPO_ROOT/scripts/add-crm-contact-classification.sql"
echo "  classification migration applied"

echo ""
echo "=== SECTION 4: DIRECT DATABASE PROOF ==="

echo ""
echo "--- SCHEMA ---"
COL_INFO="$(echo "SELECT data_type || '|' || is_nullable || '|' || COALESCE(column_default, 'NULL') FROM information_schema.columns WHERE table_name='crm_contacts' AND column_name='classification';" | psql_query)"
check "classification column: data_type|is_nullable|default" "$COL_INFO" "text|YES|NULL"

echo ""
echo "--- CHECK CONSTRAINT ---"
CONSTRAINT_EXISTS="$(echo "SELECT COUNT(*) FROM pg_constraint WHERE conname='crm_contacts_classification_check';" | psql_query | tr -d '[:space:]')"
check "crm_contacts_classification_check exists" "$CONSTRAINT_EXISTS" "1"

for VAL in CLIENT LEAD EVENT_CONTACT SUPPLIER PARTNER OTHER; do
  RESULT="$(echo "INSERT INTO crm_contacts (organisation_id, first_name, last_name, classification) VALUES ('clx7q9k2e0000abcdorg1', 'Check', '$VAL', '$VAL') RETURNING classification;" | psql_query 2>&1)"
  check "CHECK constraint accepts '$VAL'" "$RESULT" "$VAL"
done
NULL_RESULT="$(echo "INSERT INTO crm_contacts (organisation_id, first_name, last_name, classification) VALUES ('clx7q9k2e0000abcdorg1', 'Check', 'NullVal', NULL) RETURNING COALESCE(classification, 'WAS_NULL');" | psql_query 2>&1)"
check "CHECK constraint accepts NULL" "$NULL_RESULT" "WAS_NULL"

INVALID_ERR="$(echo "INSERT INTO crm_contacts (organisation_id, first_name, last_name, classification) VALUES ('clx7q9k2e0000abcdorg1', 'Bad', 'Value', 'INVALID');" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$INVALID_ERR" | grep -q "crm_contacts_classification_check"; then
  echo "  PASS: CHECK constraint rejects 'INVALID' (violates crm_contacts_classification_check)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: CHECK constraint did not reject 'INVALID' as expected"
  FAIL=$((FAIL + 1))
  FAILURES+=("CHECK constraint did not reject INVALID: $INVALID_ERR")
fi

echo ""
echo "--- INDEX ---"
IDX_EXISTS="$(echo "SELECT COUNT(*) FROM pg_indexes WHERE indexname='idx_crm_contacts_classification';" | psql_query | tr -d '[:space:]')"
check "idx_crm_contacts_classification exists" "$IDX_EXISTS" "1"
IDX_COLS="$(echo "
SELECT string_agg(a.attname, ',' ORDER BY k.ord)
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
WHERE c.relname = 'idx_crm_contacts_classification';
" | psql_query | tr -d '[:space:]')"
check "index column order is organisation_id,classification" "$IDX_COLS" "organisation_id,classification"

echo ""
echo "--- BACKWARDS COMPATIBILITY (pre-existing row) ---"
PRE_ROW="$(echo "SELECT first_name || '|' || last_name || '|' || email || '|' || phone || '|' || job_title || '|' || notes || '|' || COALESCE(classification, 'WAS_NULL') FROM crm_contacts WHERE id = '$PRE_ID';" | psql_query)"
check "pre-existing row unchanged (name/email/phone/job_title/notes) + classification IS NULL" "$PRE_ROW" "Pre|Existing|pre-existing@example.invalid|+61400000000|Legacy Title|Pre-migration note|WAS_NULL"

echo ""
echo "--- VALID WRITE (insert + update) ---"
INS_ID="$(echo "INSERT INTO crm_contacts (organisation_id, first_name, last_name, classification) VALUES ('clx7q9k2e0000abcdorg1', 'Insert', 'Test', 'EVENT_CONTACT') RETURNING id::text;" | psql_query | tr -d '[:space:]')"
INS_CHECK="$(echo "SELECT classification FROM crm_contacts WHERE id='$INS_ID';" | psql_query | tr -d '[:space:]')"
check "insert with classification=EVENT_CONTACT reads back correctly" "$INS_CHECK" "EVENT_CONTACT"
UPD_CHECK="$(echo "UPDATE crm_contacts SET classification='EVENT_CONTACT' WHERE id='$PRE_ID' RETURNING classification;" | psql_query | tr -d '[:space:]')"
check "update sets classification=EVENT_CONTACT correctly" "$UPD_CHECK" "EVENT_CONTACT"
# Revert the pre-existing row back to NULL so the idempotency section
# below still finds it in its original post-migration state.
echo "UPDATE crm_contacts SET classification=NULL WHERE id='$PRE_ID';" | psql_exec >/dev/null

echo ""
echo "=== SECTION: IDEMPOTENCY (apply the migration file a second time) ==="
CONSTRAINT_COUNT_BEFORE="$(echo "SELECT COUNT(*) FROM pg_constraint WHERE conname='crm_contacts_classification_check';" | psql_query | tr -d '[:space:]')"
INDEX_COUNT_BEFORE="$(echo "SELECT COUNT(*) FROM pg_indexes WHERE indexname='idx_crm_contacts_classification';" | psql_query | tr -d '[:space:]')"
PRE_ROW_BEFORE="$(echo "SELECT first_name || '|' || last_name || '|' || COALESCE(classification, 'WAS_NULL') FROM crm_contacts WHERE id = '$PRE_ID';" | psql_query)"
TOTAL_ROWS_BEFORE="$(echo "SELECT COUNT(*) FROM crm_contacts;" | psql_query | tr -d '[:space:]')"

SECOND_APPLY_OUTPUT="$(psql_exec < "$REPO_ROOT/scripts/add-crm-contact-classification.sql" 2>&1; echo "EXIT:$?")"
if echo "$SECOND_APPLY_OUTPUT" | grep -q "EXIT:0"; then
  echo "  PASS: second application of the migration file succeeded (no error)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: second application of the migration file failed: $SECOND_APPLY_OUTPUT"
  FAIL=$((FAIL + 1))
  FAILURES+=("second migration application failed: $SECOND_APPLY_OUTPUT")
fi

CONSTRAINT_COUNT_AFTER="$(echo "SELECT COUNT(*) FROM pg_constraint WHERE conname='crm_contacts_classification_check';" | psql_query | tr -d '[:space:]')"
check "no duplicate CHECK constraint after re-apply" "$CONSTRAINT_COUNT_AFTER" "$CONSTRAINT_COUNT_BEFORE"
INDEX_COUNT_AFTER="$(echo "SELECT COUNT(*) FROM pg_indexes WHERE indexname='idx_crm_contacts_classification';" | psql_query | tr -d '[:space:]')"
check "no duplicate index after re-apply" "$INDEX_COUNT_AFTER" "$INDEX_COUNT_BEFORE"
PRE_ROW_AFTER="$(echo "SELECT first_name || '|' || last_name || '|' || COALESCE(classification, 'WAS_NULL') FROM crm_contacts WHERE id = '$PRE_ID';" | psql_query)"
check "pre-existing row unchanged after re-apply" "$PRE_ROW_AFTER" "$PRE_ROW_BEFORE"
TOTAL_ROWS_AFTER="$(echo "SELECT COUNT(*) FROM crm_contacts;" | psql_query | tr -d '[:space:]')"
check "row count unchanged after re-apply (no rows added/removed by the migration itself)" "$TOTAL_ROWS_AFTER" "$TOTAL_ROWS_BEFORE"

echo ""
echo "=== SECTION: TARGETED ENDPOINT SQL — extracted verbatim from the real"
echo "    route file, applied on TOP of the already-migrated state above ==="
# app/api/admin/migrate/crm-contact-classification/route.ts is a THIRD
# representation of this same migration (alongside the standalone .sql
# file already proven above, and legacy step 42 in
# app/api/admin/migrate/route.ts). tests/containment/
# adminMigrateContactClassificationStep.test.ts already proves all three
# are textually equivalent (same guard query, same six values, same
# index) — this section additionally proves the ENDPOINT's own exact
# statements, extracted from the real file, execute cleanly against a
# real Postgres database that has already had the STANDALONE file's
# version applied — i.e. that the two representations are not just
# textually equivalent but genuinely cross-compatible/idempotent with
# each other regardless of which one runs against Production first.
CONSTRAINT_COUNT_BEFORE_ENDPOINT="$(echo "SELECT COUNT(*) FROM pg_constraint WHERE conname='crm_contacts_classification_check';" | psql_query | tr -d '[:space:]')"
INDEX_COUNT_BEFORE_ENDPOINT="$(echo "SELECT COUNT(*) FROM pg_indexes WHERE indexname='idx_crm_contacts_classification';" | psql_query | tr -d '[:space:]')"
TOTAL_ROWS_BEFORE_ENDPOINT="$(echo "SELECT COUNT(*) FROM crm_contacts;" | psql_query | tr -d '[:space:]')"

ENDPOINT_OUTPUT="$(node -e '
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(process.argv[1], "app", "api", "admin", "migrate", "crm-contact-classification", "route.ts"), "utf-8");
const stmts = [...src.matchAll(/await sql`([\s\S]*?)`/g)].map(m => m[1]);
process.stdout.write(stmts.join(";\n") + ";\n");
' "$REPO_ROOT_NODE" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$ENDPOINT_OUTPUT" | grep -q "EXIT:0"; then
  echo "  PASS: targeted endpoint's exact extracted SQL applied cleanly on top of the standalone file's already-migrated state"
  PASS=$((PASS + 1))
else
  echo "  FAIL: targeted endpoint SQL failed to apply: $ENDPOINT_OUTPUT"
  FAIL=$((FAIL + 1))
  FAILURES+=("targeted endpoint SQL failed: $ENDPOINT_OUTPUT")
fi

CONSTRAINT_COUNT_AFTER_ENDPOINT="$(echo "SELECT COUNT(*) FROM pg_constraint WHERE conname='crm_contacts_classification_check';" | psql_query | tr -d '[:space:]')"
check "no duplicate CHECK constraint after applying the endpoint's SQL" "$CONSTRAINT_COUNT_AFTER_ENDPOINT" "$CONSTRAINT_COUNT_BEFORE_ENDPOINT"
INDEX_COUNT_AFTER_ENDPOINT="$(echo "SELECT COUNT(*) FROM pg_indexes WHERE indexname='idx_crm_contacts_classification';" | psql_query | tr -d '[:space:]')"
check "no duplicate index after applying the endpoint's SQL" "$INDEX_COUNT_AFTER_ENDPOINT" "$INDEX_COUNT_BEFORE_ENDPOINT"
TOTAL_ROWS_AFTER_ENDPOINT="$(echo "SELECT COUNT(*) FROM crm_contacts;" | psql_query | tr -d '[:space:]')"
check "row count unchanged after applying the endpoint's SQL" "$TOTAL_ROWS_AFTER_ENDPOINT" "$TOTAL_ROWS_BEFORE_ENDPOINT"

# One final, independent proof specifically for the endpoint's own SQL:
# a fresh valid value and a fresh invalid value, run through the exact
# same live table the endpoint's statements just touched.
ENDPOINT_VALID="$(echo "INSERT INTO crm_contacts (organisation_id, first_name, last_name, classification) VALUES ('clx7q9k2e0000abcdorg1', 'Endpoint', 'Valid', 'SUPPLIER') RETURNING classification;" | psql_query 2>&1)"
check "endpoint-migrated CHECK constraint accepts a valid value (SUPPLIER)" "$ENDPOINT_VALID" "SUPPLIER"
ENDPOINT_INVALID="$(echo "INSERT INTO crm_contacts (organisation_id, first_name, last_name, classification) VALUES ('clx7q9k2e0000abcdorg1', 'Endpoint', 'Invalid', 'NOT_REAL');" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$ENDPOINT_INVALID" | grep -q "crm_contacts_classification_check"; then
  echo "  PASS: endpoint-migrated CHECK constraint rejects an invalid value"
  PASS=$((PASS + 1))
else
  echo "  FAIL: endpoint-migrated CHECK constraint did not reject an invalid value as expected"
  FAIL=$((FAIL + 1))
  FAILURES+=("endpoint-migrated CHECK constraint did not reject NOT_REAL: $ENDPOINT_INVALID")
fi

echo ""
echo "=== SUMMARY ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
exit 0
