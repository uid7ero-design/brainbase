#!/usr/bin/env bash
# app/api/admin/migrate/route.ts — organisation_id/user-ID type repair
# (Phase D.4.6H-R2) — real-Postgres proof.
#
# WHY A BASH+PSQL HARNESS AND NOT A VITEST INTEGRATION TEST: this
# repository's lib/db.ts uses @neondatabase/serverless's neon() tagged-
# template driver, which speaks Neon's proprietary HTTPS "/sql" endpoint
# protocol, not the plain Postgres wire protocol — it cannot connect to
# an ordinary local/disposable postgres:16 container, and `pg` is not a
# project dependency. This follows this repo's OWN established, working
# pattern for exactly this class of problem (see scripts/tests/
# verify-crm-contact-classification-migration.sh's own header comment
# for the full rationale): extract the REAL route's statements verbatim,
# byte-for-byte, never rewritten, and run them via psql against a
# genuinely disposable, unique, throwaway postgres:16 container. Not
# wired into CI. Creates and destroys its own container; never touches
# Production, DEV, or any shared/persistent database.
#
# WHAT THIS PROVES: app/api/admin/migrate/route.ts previously could not
# progress past step 4 (waste_records) on any environment where that
# table did not already exist — organisations.id, and dozens of
# downstream organisation_id/user-ID columns, were declared UUID while
# referencing organisations(id)/users(id), which are TEXT (see D.4.6H-R1/
# R2's own audit reports for the full history). A first version of this
# repair (organisation_id family + 7 co-located Classification-A
# columns, 43 declarations) was run through this exact harness and
# empirically proved a SECOND, independent occurrence of the identical
# defect class: email_tokens.user_id, previously Classification B
# (excluded as "standalone, not co-located with any organisation_id
# column"), turned out to be the very next hard blocker on a truly
# fresh schema, preventing progression to every table after it —
# including every organiser_* table and the final crm_contacts step.
# That fix (the 44th and final declaration) was subsequently authorized
# and applied. This harness runs the REAL, REPAIRED file's statements —
# extracted with the exact same technique already used by
# verify-crm-contact-classification-migration.sh — against a schema
# starting from nothing but a minimal `users` table (the one genuine
# external precondition: this route only ever ALTERs users, never
# creates it — Prisma's own `model User` is the actual bootstrap for
# that table in every real environment), and proves the full sequence
# now reaches the final step (crm_contacts.classification) with zero
# errors, that every one of the 44 repaired columns is actually TEXT
# afterward, that a real org->user->organiser_board->organiser_activity
# FK chain can be inserted end-to-end, and that re-running the whole
# sequence a second time is fully idempotent with zero data loss.
#
# USAGE:
#   bash scripts/tests/verify-migrate-organisation-id-type-repair.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then
  REPO_ROOT_NODE="$(cygpath -w "$REPO_ROOT")"
else
  REPO_ROOT_NODE="$REPO_ROOT"
fi
CONTAINER="migrate-orgid-repair-harness-$$"
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

extract_route_statements() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.join(process.argv[1], "app", "api", "admin", "migrate", "route.ts"), "utf-8");
    const stmts = [...src.matchAll(/await sql`([\s\S]*?)`/g)].map(m => m[1]);
    process.stdout.write(stmts.join(";\n") + ";\n");
  ' "$REPO_ROOT_NODE"
}

echo ""
echo "=== BOOTSTRAP: the two genuine external preconditions this route never"
echo "    creates itself — users (Prisma's own model User's real bootstrap in"
echo "    every actual environment, id TEXT per prisma/schema.prisma) and"
echo "    crm_contacts (created by the separate scripts/crm-migrate.mjs — step 42"
echo "    only ever ALTERs it, exactly the same relationship as users). organisations"
echo "    is deliberately NOT pre-created here — it remains the route's own step 1,"
echo "    proving that CREATE TABLE also succeeds fresh, not just as a no-op."
cat <<'SQL' | psql_exec
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, username TEXT);
-- Minimal crm_contacts: step 42 only ever ALTERs this table (ADD
-- COLUMN classification + an index) — it never creates it, exactly
-- the same relationship as users above. Real shape is
-- scripts/crm-migrate.mjs's own CREATE TABLE crm_contacts (organisation_id
-- TEXT NOT NULL REFERENCES organisations(id), ...) — the FK isn't
-- needed for step 42's own ALTER to succeed, so it's omitted here to
-- avoid an organisations-table ordering dependency in this bootstrap.
CREATE TABLE crm_contacts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL);
SQL
echo "  users + crm_contacts tables bootstrapped"

echo ""
echo "=== FRESH-SCHEMA RUN: apply the REAL, REPAIRED app/api/admin/migrate/route.ts"
echo "    statements, extracted verbatim, never rewritten, from a schema that has"
echo "    NOTHING else pre-created (organisations, waste_records, fleet_metrics,"
echo "    every downstream table — all created fresh by this one run) ==="
RUN1_OUTPUT="$(extract_route_statements | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$RUN1_OUTPUT" | grep -q "EXIT:0"; then
  echo "  PASS: full migration sequence executed with ZERO errors, start to finish"
  PASS=$((PASS + 1))
else
  echo "  FAIL: migration sequence failed"
  echo "$RUN1_OUTPUT" | tail -30
  FAIL=$((FAIL + 1))
  FAILURES+=("fresh-schema run failed — see output above")
fi

echo ""
echo "=== MIGRATION PROGRESSION — every logical milestone reached ==="
for TABLE in organisations uploaded_files waste_records fleet_metrics service_requests reports import_mappings kpi_rules audit_logs integrations sync_jobs data_snapshots email_tokens organisation_modules metric_snapshots wste_vehicles wste_runs wste_gps_points wste_waste_tickets wste_service_verifications wste_exceptions wste_assets wste_planned_services wste_service_events wste_evidence_items onboarding_progress agent_runs tennis_leads saved_briefings social_accounts social_posts social_comments social_insights contacts contact_journal client_pipeline pipeline_messages organiser_boards organiser_groups organiser_items organiser_columns organiser_item_files organiser_item_updates organiser_activity crm_contacts; do
  EXISTS="$(echo "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='$TABLE';" | psql_query | tr -d '[:space:]')"
  check "milestone reached: $TABLE exists" "$EXISTS" "1"
done
FUNC_EXISTS="$(echo "SELECT COUNT(*) FROM pg_proc WHERE proname='organiser_activity_sanitise_scalar';" | psql_query | tr -d '[:space:]')"
check "milestone reached: organiser_activity_sanitise_scalar function exists (step 41)" "$FUNC_EXISTS" "1"
CLASSIFICATION_COL="$(echo "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='crm_contacts' AND column_name='classification';" | psql_query | tr -d '[:space:]')"
check "final milestone reached: crm_contacts.classification exists (step 42, the last step)" "$CLASSIFICATION_COL" "1"

echo ""
echo "=== REPAIRED COLUMN TYPES — every organisation_id/user-ID column this phase"
echo "    targeted is now genuinely TEXT, not merely 'no error was thrown' ==="
declare -a REPAIRED=(
  "organisations:id"
  "users:organisation_id"
  "waste_records:organisation_id"
  "fleet_metrics:organisation_id"
  "service_requests:organisation_id"
  "reports:organisation_id"
  "reports:created_by"
  "import_mappings:organisation_id"
  "import_mappings:created_by"
  "kpi_rules:organisation_id"
  "audit_logs:organisation_id"
  "audit_logs:user_id"
  "integrations:organisation_id"
  "sync_jobs:organisation_id"
  "data_snapshots:organisation_id"
  "organisation_modules:organisation_id"
  "metric_snapshots:organisation_id"
  "wste_vehicles:organisation_id"
  "onboarding_progress:organisation_id"
  "onboarding_progress:user_id"
  "agent_runs:organisation_id"
  "agent_runs:user_id"
  "tennis_leads:organisation_id"
  "saved_briefings:organisation_id"
  "saved_briefings:user_id"
  "social_accounts:organisation_id"
  "contacts:organisation_id"
  "client_pipeline:organisation_id"
  "client_pipeline:submitted_by"
  "pipeline_messages:organisation_id"
  "email_tokens:user_id"
)
for PAIR in "${REPAIRED[@]}"; do
  TABLE="${PAIR%%:*}"
  COLUMN="${PAIR##*:}"
  TYPE="$(echo "SELECT data_type FROM information_schema.columns WHERE table_name='$TABLE' AND column_name='$COLUMN';" | psql_query | tr -d '[:space:]')"
  check "$TABLE.$COLUMN is text" "$TYPE" "text"
done

echo ""
echo "=== ALREADY-CORRECT TABLES UNTOUCHED — organiser_* / crm_contacts (correct"
echo "    before this phase) are unaffected by the repair ==="
ORGANISER_BOARDS_TYPE="$(echo "SELECT data_type FROM information_schema.columns WHERE table_name='organiser_boards' AND column_name='organisation_id';" | psql_query | tr -d '[:space:]')"
check "organiser_boards.organisation_id remains text (was already correct)" "$ORGANISER_BOARDS_TYPE" "text"

echo ""
echo "=== REAL DATA PROOF — a genuine org -> user -> organiser_board ->"
echo "    organiser_activity FK chain can actually be inserted end-to-end ==="
ORG_ID="$(echo "INSERT INTO organisations (name, slug) VALUES ('Test Org', 'test-org-r2') RETURNING id;" | psql_query | tr -d '[:space:]')"
echo "  organisation inserted, id=$ORG_ID"
echo "INSERT INTO users (id, name, username, organisation_id) VALUES ('user-r2-1', 'Test User', 'testuser-r2', '$ORG_ID');" | psql_exec >/dev/null
BOARD_ID="$(echo "INSERT INTO organiser_boards (organisation_id, name) VALUES ('$ORG_ID', 'Board') RETURNING id;" | psql_query | tr -d '[:space:]')"
echo "INSERT INTO organiser_activity (organisation_id, board_id, actor_user_id, actor_name, event_type, entity_type, entity_id) VALUES ('$ORG_ID', '$BOARD_ID', 'user-r2-1', 'Test User', 'board.created', 'board', '$BOARD_ID');" | psql_exec >/dev/null
ACTIVITY_COUNT="$(echo "SELECT COUNT(*) FROM organiser_activity WHERE organisation_id='$ORG_ID';" | psql_query | tr -d '[:space:]')"
check "full org->user->board->activity FK chain inserted successfully" "$ACTIVITY_COUNT" "1"

echo ""
echo "=== IDEMPOTENCY RUN: apply the exact same statements a SECOND time ==="
ORG_COUNT_BEFORE="$(echo "SELECT COUNT(*) FROM organisations;" | psql_query | tr -d '[:space:]')"
ACTIVITY_COUNT_BEFORE="$(echo "SELECT COUNT(*) FROM organiser_activity;" | psql_query | tr -d '[:space:]')"

RUN2_OUTPUT="$(extract_route_statements | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$RUN2_OUTPUT" | grep -q "EXIT:0"; then
  echo "  PASS: second application succeeded with ZERO errors (no duplicate-table/column/FK failure)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: second application failed"
  echo "$RUN2_OUTPUT" | tail -30
  FAIL=$((FAIL + 1))
  FAILURES+=("idempotency (second) run failed — see output above")
fi

ORG_COUNT_AFTER="$(echo "SELECT COUNT(*) FROM organisations;" | psql_query | tr -d '[:space:]')"
check "no data loss: organisations row count unchanged after re-apply" "$ORG_COUNT_AFTER" "$ORG_COUNT_BEFORE"
ACTIVITY_COUNT_AFTER="$(echo "SELECT COUNT(*) FROM organiser_activity;" | psql_query | tr -d '[:space:]')"
check "no data loss: organiser_activity row count unchanged after re-apply" "$ACTIVITY_COUNT_AFTER" "$ACTIVITY_COUNT_BEFORE"

echo ""
echo "=== ALREADY-CORRECT-ENVIRONMENT CHECK: repeated column types are byte-for-byte"
echo "    identical after the second run — no destructive conversion occurred ==="
for PAIR in "${REPAIRED[@]}"; do
  TABLE="${PAIR%%:*}"
  COLUMN="${PAIR##*:}"
  TYPE="$(echo "SELECT data_type FROM information_schema.columns WHERE table_name='$TABLE' AND column_name='$COLUMN';" | psql_query | tr -d '[:space:]')"
  check "$TABLE.$COLUMN still text after re-apply (no-op confirmed)" "$TYPE" "text"
done

echo ""
echo "=== NO DESTRUCTIVE CONVERSION — the extracted statements never contain a"
echo "    type rewrite, USING cast, DROP COLUMN, or DROP TABLE ==="
STATEMENTS_TEXT="$(extract_route_statements)"
if echo "$STATEMENTS_TEXT" | grep -qiE "ALTER COLUMN [a-z_]+ TYPE|USING [a-z_]+::|DROP COLUMN|DROP TABLE"; then
  echo "  FAIL: a destructive statement was found in the extracted SQL"
  FAIL=$((FAIL + 1))
  FAILURES+=("destructive statement found in extracted SQL")
else
  echo "  PASS: no destructive statement anywhere in the extracted SQL"
  PASS=$((PASS + 1))
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
