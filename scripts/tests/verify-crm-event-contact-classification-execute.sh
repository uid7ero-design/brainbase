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
cat <<'SQL' | psql_exec
CREATE TABLE event_orders (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  crm_contact_id  UUID REFERENCES crm_contacts(id)
);
CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  user_id         TEXT REFERENCES users(id),
  action          TEXT NOT NULL,
  resource_type   TEXT,
  resource_id     UUID,
  detail          JSONB,
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

# Renders the extracted TS template literal into real SQL by substituting
# its ${...} interpolations positionally — the SAME values in the SAME
# order the real function passes them, never reordered or reinterpreted.
render_cte() {
  # Uses '#' as the sed delimiter throughout — the notes-marker value
  # ("Events / Event Booking") contains literal '/' characters, which
  # would otherwise be misparsed as extra delimiter boundaries in the
  # usual s/.../.../ form.
  local contact_id="$1" org_id="$2" actor_id="$3" notes_marker="$4"
  echo "$CTE_TEMPLATE" \
    | sed "s#\${EVENT_CONTACT_CLASSIFICATION}#'EVENT_CONTACT'#g" \
    | sed "s#\${r\.id}#'$contact_id'#g" \
    | sed "s#\${organisationId}#'$org_id'#g" \
    | sed "s#\${actorUserId}#'$actor_id'#g" \
    | sed "s#\${notesMarker}#'$notes_marker'#g"
}

echo ""
echo "=== SEED ONE ELIGIBLE CONTACT (classification NULL) ==="
CONTACT_ID="$(echo "INSERT INTO crm_contacts (organisation_id, first_name, last_name, notes) VALUES ('clx7q9k2e0000abcdorg1', 'Eligible', 'Contact', 'Events / Event Booking') RETURNING id;" | psql_query | tr -d '[:space:]')"
echo "INSERT INTO event_orders (id, organisation_id, crm_contact_id) VALUES ('order-1', 'clx7q9k2e0000abcdorg1', '$CONTACT_ID');" | psql_exec
echo "  seeded contact_id=$CONTACT_ID, linked to order-1"

echo ""
echo "=== FIRST RUN: guarded UPDATE+audit CTE against the eligible contact ==="
render_cte "$CONTACT_ID" "clx7q9k2e0000abcdorg1" "clx7q9k2e0001actoruser" "Events / Event Booking" | psql_exec

CLASSIFICATION_AFTER="$(echo "SELECT classification FROM crm_contacts WHERE id = '$CONTACT_ID';" | psql_query | tr -d '[:space:]')"
check "classification was set to EVENT_CONTACT" "$CLASSIFICATION_AFTER" "EVENT_CONTACT"

AUDIT_COUNT_AFTER_FIRST="$(echo "SELECT COUNT(*) FROM audit_logs WHERE resource_id = '$CONTACT_ID';" | psql_query | tr -d '[:space:]')"
check "exactly one audit_logs row was created" "$AUDIT_COUNT_AFTER_FIRST" "1"

AUDIT_ROW="$(echo "SELECT organisation_id || '|' || user_id || '|' || action || '|' || resource_type || '|' || (detail->>'new_classification') || '|' || (detail->>'notes_marker') || '|' || (detail->'matched_order_ids') FROM audit_logs WHERE resource_id = '$CONTACT_ID';" | psql_query)"
check "audit row content is exactly right (org|actor|action|resource_type|new_classification|notes_marker|matched_order_ids)" \
  "$AUDIT_ROW" \
  "clx7q9k2e0000abcdorg1|clx7q9k2e0001actoruser|crm_contact.historical_classification_backfill|crm_contact|EVENT_CONTACT|Events / Event Booking|[\"order-1\"]"

PREV_CLASSIFICATION_NULL="$(echo "SELECT (detail->'previous_classification') IS NULL FROM audit_logs WHERE resource_id = '$CONTACT_ID';" | psql_query | tr -d '[:space:]')"
# jsonb 'null' literal, not SQL NULL — detail->'previous_classification' returns the jsonb null, and (jsonb null) IS NULL is false in Postgres (it's a real JSON value, not absence)
DETAIL_HAS_NULL_PREV="$(echo "SELECT (detail->'previous_classification')::text FROM audit_logs WHERE resource_id = '$CONTACT_ID';" | psql_query | tr -d '[:space:]')"
check "audit detail.previous_classification is JSON null" "$DETAIL_HAS_NULL_PREV" "null"

echo ""
echo "=== SECOND RUN (same statement, same contact): stale/idempotency guard — the contact is NO LONGER classification IS NULL ==="
ROW_COUNT_BEFORE_SECOND="$(echo "SELECT COUNT(*) FROM crm_contacts;" | psql_query | tr -d '[:space:]')"
AUDIT_COUNT_BEFORE_SECOND="$(echo "SELECT COUNT(*) FROM audit_logs;" | psql_query | tr -d '[:space:]')"

render_cte "$CONTACT_ID" "clx7q9k2e0000abcdorg1" "clx7q9k2e0001actoruser" "Events / Event Booking" | psql_exec

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

render_cte "$CLIENT_CONTACT_ID" "clx7q9k2e0000abcdorg1" "clx7q9k2e0001actoruser" "Events / Event Booking" | psql_exec

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
