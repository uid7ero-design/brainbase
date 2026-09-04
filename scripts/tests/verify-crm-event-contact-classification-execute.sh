#!/usr/bin/env bash
# lib/crm/eventContactClassificationBackfill.ts's executeEventContactClassification
# — real-Postgres proof of the guarded UPDATE + audit_logs INSERT CTE.
#
# WHY A BASH+PSQL HARNESS: same reason as
# scripts/tests/verify-crm-contact-classification-migration.sh — this
# repo's own lib/db.ts uses @neondatabase/serverless's neon() driver,
# which speaks Neon's proprietary HTTPS protocol and cannot connect to
# an ordinary local/disposable postgres:16-alpine container. See that
# script's own header comment for the full explanation (Neon Local was
# tried and rejected as requiring real cloud credentials).
#
# WHAT THIS PROVES, specifically: the ONE genuinely new, novel SQL
# pattern this phase introduces — a single compound CTE statement that
# (a) UPDATEs crm_contacts.classification only WHERE it is still NULL
# at that exact moment, (b) computes the contact's matched event_orders
# ids, and (c) INSERTs one audit_logs row, chained FROM the UPDATE's own
# RETURNING — so the INSERT structurally cannot fire unless the UPDATE
# actually changed a row. A mock can assert the JS-level branching
# around this (already covered in tests/containment/
# crmEventContactClassificationBackfill.test.ts), but only a real
# Postgres instance can prove the CTE chaining itself behaves
# atomically and the guard genuinely blocks a stale write — this
# harness extracts that exact statement verbatim from the real library
# file (never rewritten) and runs it against a disposable database.
#
# Requires only Docker + Node. Not wired into CI. Creates and destroys
# its own disposable container; never touches Production, DEV, or any
# shared/persistent database.
#
# USAGE:
#   bash scripts/tests/verify-crm-event-contact-classification-execute.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then
  REPO_ROOT_NODE="$(cygpath -w "$REPO_ROOT")"
else
  REPO_ROOT_NODE="$REPO_ROOT"
fi

CONTAINER="crm-event-classification-execute-harness-$$"
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
echo "=== BOOTSTRAP: minimal schema (organisations/users TEXT ids, matching prisma/schema.prisma) ==="
cat <<'SQL' | psql_exec
CREATE TABLE organisations (id TEXT PRIMARY KEY);
CREATE TABLE users (id TEXT PRIMARY KEY);
INSERT INTO organisations (id) VALUES ('clx7q9k2e0000abcdorg1');
INSERT INTO users (id) VALUES ('clx7q9k2e0001actoruser');
SQL
echo "  organisations + users created, seeded"

echo ""
echo "=== APPLY THE REAL scripts/crm-migrate.mjs STATEMENTS + classification migration (verbatim, never rewritten) ==="
node -e '
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(process.argv[1], "scripts", "crm-migrate.mjs"), "utf-8");
const stmts = [...src.matchAll(/await sql\.query\(`([\s\S]*?)`\)/g)].map(m => m[1]);
process.stdout.write(stmts.join(";\n") + ";\n");
' "$REPO_ROOT_NODE" | psql_exec
cat "$REPO_ROOT/scripts/add-crm-contact-classification.sql" | psql_exec
echo "  crm_contacts (with classification) ready"

echo ""
echo "=== event_orders + audit_logs (minimal, matching real FK targets and TEXT org/user ids) ==="
# audit_logs here matches prisma/schema.prisma's AuditLog model exactly
# (id/organisation_id/user_id/resource_id all TEXT, before_state/
# after_state JSONB, no `detail` column, no DB-level default on id —
# cuid() is a Prisma client-side default only). An earlier version of
# this harness invented its own audit_logs shape (UUID ids, a `detail`
# column that has never existed) that happened to match what the
# library's SQL used to write — self-consistent, but never checked
# against the real schema, so it passed 9/9 while the identical SQL
# failed every write in Production against the real table. See
# lib/crm/eventContactClassificationBackfill.ts's own header comment
# on the audit INSERT for the full incident.
cat <<'SQL' | psql_exec
CREATE TABLE event_orders (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  crm_contact_id  UUID REFERENCES crm_contacts(id)
);
CREATE TABLE audit_logs (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  user_id         TEXT REFERENCES users(id),
  action          TEXT NOT NULL,
  resource_type   TEXT,
  resource_id     TEXT,
  before_state    JSONB,
  after_state     JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
SQL
echo "  event_orders + audit_logs created"

echo ""
echo "=== EXTRACT THE EXACT GUARDED UPDATE+AUDIT CTE FROM THE REAL LIBRARY FILE (verbatim, never rewritten) ==="
CTE_TEMPLATE="$(node -e '
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(process.argv[1], "lib", "crm", "eventContactClassificationBackfill.ts"), "utf-8");
const start = src.indexOf("WITH upd AS (");
const end = src.indexOf("AS updated_id", start) + "AS updated_id".length;
if (start < 0 || end < 0) { console.error("EXTRACTION_FAILED"); process.exit(1); }
process.stdout.write(src.slice(start, end));
' "$REPO_ROOT_NODE")"
if [ -z "$CTE_TEMPLATE" ]; then
  echo "ERROR: failed to extract the guarded UPDATE+audit CTE from the library file." >&2
  exit 2
fi
echo "  extracted ($(echo "$CTE_TEMPLATE" | wc -l) lines)"

# Renders the extracted TS template literal into GENUINELY PARAMETERIZED
# SQL — each distinct ${...} occurrence becomes $1, $2, $3... in strict
# textual order, exactly how the Neon driver's tagged-template sql
# function numbers its own bound parameters. This is a deliberate
# departure from this harness's own earlier approach (substituting
# literal values via sed): that approach proved the CTE's atomicity/
# guard logic, but is structurally incapable of catching a
# "could not determine data type of parameter $N" class of bug —
# Postgres only raises that error during PARSE ANALYSIS of a query with
# unresolved bound-parameter types, which never happens when the SQL
# text already contains a literal like 'EVENT_CONTACT' instead of a
# placeholder. That gap is exactly how the ${EVENT_CONTACT_CLASSIFICATION}/
# ${notesMarker} arguments to jsonb_build_object(...) (a VARIADIC "any"
# function, which gives the parser no type to resolve a bare parameter
# against) passed this harness at 10/10 while failing every real
# Production write. PREPARE (with no explicit parameter type list) is
# the exact server-side equivalent of the extended query protocol's
# Parse step with an unspecified parameter-type array, which is what a
# driver sending bound parameters over Neon's HTTP protocol does — so a
# PREPARE failure here reproduces the real error, and a PREPARE success
# here is real proof the fix resolves it, not just a plausible guess.
# Any ::text (or other) cast immediately after a closing '}' is part of
# the surrounding SQL text, not the matched ${...} span, so it is
# preserved automatically — the replacement only ever touches the
# placeholder itself.
POSITIONAL_SQL="$(node -e '
const template = process.argv[1];
let i = 0;
process.stdout.write(template.replace(/\$\{[^}]*\}/g, () => { i += 1; return `$${i}`; }));
' "$CTE_TEMPLATE")"
echo "  positional SQL built — \$1..\$9 substituted for each \${...} occurrence, in order"

echo ""
echo "=== PARAMETER MAP (ground truth — extracted, not hand-counted) ==="
node -e '
const template = process.argv[1];
const matches = [...template.matchAll(/\$\{[^}]*\}/g)];
matches.forEach((m, idx) => console.log(`  $${idx + 1} = ${m[0]}`));
' "$CTE_TEMPLATE"

# EXECUTE args are positional per the map above:
# $1=classification $2=contact_id $3=org_id $4=org_id $5=audit_id
# $6=org_id $7=actor_id $8=classification $9=notes_marker
run_cte() {
  local contact_id="$1" org_id="$2" actor_id="$3" notes_marker="$4" audit_id="$5"
  {
    echo "PREPARE classify_cte AS $POSITIONAL_SQL;"
    echo "EXECUTE classify_cte('EVENT_CONTACT', '$contact_id', '$org_id', '$org_id', '$audit_id', '$org_id', '$actor_id', 'EVENT_CONTACT', '$notes_marker');"
    echo "DEALLOCATE classify_cte;"
  } | psql_exec
  RUN_CTE_EXIT=$?
}

echo ""
echo "=== NEGATIVE-PATH MICRO-REPRO: proves THIS HARNESS can actually catch this bug class ==="
# Isolated reproduction of the exact mechanism (not extracted from the
# library file, since that file is now fixed) — a bare bound parameter
# passed directly to jsonb_build_object(...), a VARIADIC "any" function,
# gives Postgres's parser no type to resolve it against under the
# extended query protocol (which PREPARE with no explicit type list
# reproduces server-side). This is a general Postgres behavior, not
# specific to this codebase — proving it here, independent of the real
# statement, confirms the harness's own PREPARE/EXECUTE mechanism would
# catch a regression of this exact class if one were ever reintroduced.
UNCAST_STDERR="$(echo "PREPARE bad_stmt AS SELECT jsonb_build_object('k', \$1);" | docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb 2>&1)"
echo "$UNCAST_STDERR" | grep -q 'could not determine data type of parameter \$1'
check "an uncast bound parameter inside jsonb_build_object(...) fails PREPARE with 'could not determine data type of parameter \$1' — the exact error class Production hit" "$?" "0"

echo "PREPARE good_stmt AS SELECT jsonb_build_object('k', \$1::text); DEALLOCATE good_stmt;" \
  | docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >/dev/null 2>&1
check "adding an explicit ::text cast to the same bound parameter resolves it — PREPARE succeeds (proves the fix mechanism itself, not just a plausible guess)" "$?" "0"

echo ""
echo "=== SEED ONE ELIGIBLE CONTACT (classification NULL) ==="
CONTACT_ID="$(echo "INSERT INTO crm_contacts (organisation_id, first_name, last_name, notes) VALUES ('clx7q9k2e0000abcdorg1', 'Eligible', 'Contact', 'Events / Event Booking') RETURNING id;" | psql_query | tr -d '[:space:]')"
echo "INSERT INTO event_orders (id, organisation_id, crm_contact_id) VALUES ('order-1', 'clx7q9k2e0000abcdorg1', '$CONTACT_ID');" | psql_exec
echo "  seeded contact_id=$CONTACT_ID, linked to order-1"

echo ""
echo "=== FIRST RUN: guarded UPDATE+audit CTE against the eligible contact (via real PREPARE/EXECUTE — genuine bound parameters) ==="
run_cte "$CONTACT_ID" "clx7q9k2e0000abcdorg1" "clx7q9k2e0001actoruser" "Events / Event Booking" "test-audit-00000000000000000001"
check "PREPARE/EXECUTE of the REAL extracted statement succeeds — no 'could not determine data type of parameter' error, using genuine bound parameters (not literal substitution)" "$RUN_CTE_EXIT" "0"

CLASSIFICATION_AFTER="$(echo "SELECT classification FROM crm_contacts WHERE id = '$CONTACT_ID';" | psql_query | tr -d '[:space:]')"
check "classification was set to EVENT_CONTACT" "$CLASSIFICATION_AFTER" "EVENT_CONTACT"

AUDIT_COUNT_AFTER_FIRST="$(echo "SELECT COUNT(*) FROM audit_logs WHERE resource_id = '$CONTACT_ID';" | psql_query | tr -d '[:space:]')"
check "exactly one audit_logs row was created" "$AUDIT_COUNT_AFTER_FIRST" "1"

AUDIT_ROW="$(echo "SELECT organisation_id || '|' || user_id || '|' || action || '|' || resource_type || '|' || (after_state->>'new_classification') || '|' || (after_state->>'notes_marker') || '|' || (after_state->'matched_order_ids') FROM audit_logs WHERE resource_id = '$CONTACT_ID';" | psql_query)"
check "audit row content is exactly right (org|actor|action|resource_type|new_classification|notes_marker|matched_order_ids)" \
  "$AUDIT_ROW" \
  "clx7q9k2e0000abcdorg1|clx7q9k2e0001actoruser|crm_contact.historical_classification_backfill|crm_contact|EVENT_CONTACT|Events / Event Booking|[\"order-1\"]"

AUDIT_ID_NOT_NULL="$(echo "SELECT id IS NOT NULL FROM audit_logs WHERE resource_id = '$CONTACT_ID';" | psql_query | tr -d '[:space:]')"
check "audit row's id was supplied by the app itself — this table has no DB-level default, matching Production" "$AUDIT_ID_NOT_NULL" "t"

BEFORE_STATE_IS_NULL="$(echo "SELECT before_state IS NULL FROM audit_logs WHERE resource_id = '$CONTACT_ID';" | psql_query | tr -d '[:space:]')"
check "audit before_state is SQL NULL (nothing worth recording before — the guard already proves classification was NULL)" "$BEFORE_STATE_IS_NULL" "t"

echo ""
echo "=== SECOND RUN (same statement, same contact): stale/idempotency guard — the contact is NO LONGER classification IS NULL ==="
ROW_COUNT_BEFORE_SECOND="$(echo "SELECT COUNT(*) FROM crm_contacts;" | psql_query | tr -d '[:space:]')"
AUDIT_COUNT_BEFORE_SECOND="$(echo "SELECT COUNT(*) FROM audit_logs;" | psql_query | tr -d '[:space:]')"

run_cte "$CONTACT_ID" "clx7q9k2e0000abcdorg1" "clx7q9k2e0001actoruser" "Events / Event Booking" "test-audit-00000000000000000002"
check "PREPARE/EXECUTE succeeds again on the second (stale-guard) run — the guard blocks the write, it does not error" "$RUN_CTE_EXIT" "0"

CLASSIFICATION_STILL="$(echo "SELECT classification FROM crm_contacts WHERE id = '$CONTACT_ID';" | psql_query | tr -d '[:space:]')"
check "classification is unchanged (still EVENT_CONTACT, not touched again)" "$CLASSIFICATION_STILL" "EVENT_CONTACT"

AUDIT_COUNT_AFTER_SECOND="$(echo "SELECT COUNT(*) FROM audit_logs WHERE resource_id = '$CONTACT_ID';" | psql_query | tr -d '[:space:]')"
check "NO second audit_logs row was created — the guard blocked the UPDATE, so the audit INSERT (chained FROM it) structurally could not fire" "$AUDIT_COUNT_AFTER_SECOND" "1"

ROW_COUNT_AFTER_SECOND="$(echo "SELECT COUNT(*) FROM crm_contacts;" | psql_query | tr -d '[:space:]')"
check "crm_contacts row count unchanged" "$ROW_COUNT_AFTER_SECOND" "$ROW_COUNT_BEFORE_SECOND"

echo ""
echo "=== A SEPARATE contact already CLIENT-classified: proves the guard blocks a pre-classified row identically to a just-classified one ==="
CLIENT_CONTACT_ID="$(echo "INSERT INTO crm_contacts (organisation_id, first_name, last_name, notes, classification) VALUES ('clx7q9k2e0000abcdorg1', 'Already', 'Client', 'Events / Event Booking', 'CLIENT') RETURNING id;" | psql_query | tr -d '[:space:]')"
echo "INSERT INTO event_orders (id, organisation_id, crm_contact_id) VALUES ('order-2', 'clx7q9k2e0000abcdorg1', '$CLIENT_CONTACT_ID');" | psql_exec

run_cte "$CLIENT_CONTACT_ID" "clx7q9k2e0000abcdorg1" "clx7q9k2e0001actoruser" "Events / Event Booking" "test-audit-00000000000000000003"
check "PREPARE/EXECUTE succeeds for the already-classified contact too — the guard blocks it, it does not error" "$RUN_CTE_EXIT" "0"

CLIENT_CLASSIFICATION_AFTER="$(echo "SELECT classification FROM crm_contacts WHERE id = '$CLIENT_CONTACT_ID';" | psql_query | tr -d '[:space:]')"
check "an existing CLIENT classification is never overwritten by the guarded statement" "$CLIENT_CLASSIFICATION_AFTER" "CLIENT"

CLIENT_AUDIT_COUNT="$(echo "SELECT COUNT(*) FROM audit_logs WHERE resource_id = '$CLIENT_CONTACT_ID';" | psql_query | tr -d '[:space:]')"
check "no audit row was created for the already-classified contact" "$CLIENT_AUDIT_COUNT" "0"

echo ""
echo "=== SUMMARY ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
exit 0
