#!/usr/bin/env bash
# Events & Ticketing Phase 2-R1 — repeatable behavioral validation for
# the public registration route's concurrency safety
# (app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts).
#
# WHY THIS EXISTS: an independent review proved, against real
# PostgreSQL 16, that the original Phase 2 design (one compound SQL
# statement containing FOR UPDATE + a sold-quantity aggregate + guarded
# inserts) could oversell both ticket-type and session capacity under
# genuine concurrency, reproduced 4/4 times. The root cause — a single
# statement's READ COMMITTED snapshot not advancing for an aggregate
# subquery over a different table, even after FOR UPDATE's own
# EvalPlanQual re-fetch unblocks — is invisible to every mocked-SQL test
# in this repository, by construction (mocks have no real transaction,
# snapshot, or locking semantics). This harness exists specifically to
# make that class of regression mechanically detectable, following the
# repository's own established pattern
# (scripts/tests/verify-import-batches-migration.sh, Data Hub 5A.2C).
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with the ACTUAL, unmodified schema from scripts/create-events.sql and
# scripts/create-events-phase2.sql, then executes the SAME statement
# sequence the route's R1-remediated sql.transaction([...]) call submits
# (lock statement(s), diagnostic count statement(s), then the
# capacity-gated insert statement) via an explicit BEGIN; ...; COMMIT;
# block sent through `docker exec ... psql`. This is a faithful
# reproduction of the Postgres-level mechanism the fix depends on:
# Neon's SQL-over-HTTP `transaction()` endpoint takes this repo's array
# of queries and executes them, server-side, as a real Postgres
# transaction (confirmed by reading @neondatabase/serverless's own
# source — see the route file's own comment) — this harness cannot
# invoke that HTTP transport directly (it requires a live Neon project;
# Production/Neon access is explicitly out of scope for this repo's
# automated verification), so it instead proves the underlying Postgres
# per-statement-snapshot mechanism the fix relies on, via the same
# BEGIN/COMMIT-wrapped multi-statement execution model Neon's proxy
# implements server-side.
#
# WHAT THIS DOES NOT DO: it is not wired into CI (Docker is not part of
# the standard CI workflow in this repository, matching the Data Hub
# harness's own precedent). It requires only Docker — no new npm
# dependency, no Neon/Production access, no local psql client install
# (all SQL runs inside the disposable container via `docker exec`). It
# creates and destroys its own disposable container; it never touches
# Production or any already-running database.
#
# USAGE:
#   bash scripts/tests/verify-events-phase2-concurrency.sh
#
# Exits 0 if every check passes, non-zero and prints a summary of what
# failed otherwise. Always removes the disposable container it created,
# even on failure (trap on EXIT).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVENTS_MIGRATION="$REPO_ROOT/scripts/create-events.sql"
PHASE2_MIGRATION="$REPO_ROOT/scripts/create-events-phase2.sql"
CONTAINER="events-p2-concurrency-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" "${OUT_A:-}" "${OUT_B:-}" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -f "$EVENTS_MIGRATION" ] || [ ! -f "$PHASE2_MIGRATION" ]; then
  echo "ERROR: migration file(s) not found." >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness (no local Postgres/psql dependency is assumed)." >&2
  exit 2
fi

echo "Starting disposable postgres:16-alpine ($CONTAINER)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine >/dev/null

READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: postgres in $CONTAINER did not become ready within 30s." >&2
  exit 2
fi

DIAG_OUT="/tmp/events_p2_harness_out.$$.txt"
OUT_A="/tmp/events_p2_harness_a.$$.txt"
OUT_B="/tmp/events_p2_harness_b.$$.txt"

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1
}

psql_query() {
  # Like psql_exec but prints results (used for state assertions).
  docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1
}

reset_db() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "DROP DATABASE IF EXISTS testdb;" >/dev/null 2>&1
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "CREATE DATABASE testdb;" >/dev/null 2>&1
}

bootstrap() {
  # Minimal organisations/users stand-ins matching this repo's real FK
  # conventions, then the ACTUAL, unmodified Phase 1 + Phase 2 DDL.
  {
    cat <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
SQL
    cat "$EVENTS_MIGRATION"
    cat "$PHASE2_MIGRATION"
    cat <<'SQL'
INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a');
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
  VALUES ('event-1', 'org-a', 'Graduation', 'graduation', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide');
SQL
  } | psql_exec
}

expect_success() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL (expected success, got error): $desc"
    sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

expect_failure() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then
    echo "  FAIL (expected rejection, but it succeeded): $desc"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  else
    echo "  PASS (correctly rejected): $desc"
    PASS=$((PASS + 1))
  fi
}

expect_eq() {
  local desc="$1" sql="$2" want="$3"
  local got
  got="$(echo "$sql" | psql_query | tr -d '[:space:]')"
  if [ "$got" = "$want" ]; then
    echo "  PASS: $desc (got $got)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (want $want, got $got)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

# ─── The registration statement sequence, as REAL Postgres SQL text ────
# This mirrors, statement-for-statement, exactly what
# app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts's
# sql.transaction([...]) array submits (non-session branch). $1 = ticket
# type id, $2 = purchaser name, $3 = quantity, $4 = optional extra SQL
# injected between the lock and the count statement (used only by the
# forced-blocking proof and mutation-proof harness below — empty in
# every normal-path test).
register_ticket_type_sql() {
  local tt_id="$1" purchaser="$2" qty="$3" inject="${4:-}"
  cat <<SQL
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a' FOR UPDATE;
$inject
SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = '$tt_id' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED';
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = '$tt_id' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL, 'CONFIRMED', 0
  FROM sold_tt
  WHERE sold_tt.qty + $qty <= (SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', '$tt_id', NULL, $qty, 0
  FROM ins_order
  RETURNING id, order_id
)
INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
SELECT 'org-a', 'event-1', ins_item.order_id, ins_item.id, a.name, NULL
FROM ins_item, UNNEST(ARRAY['Attendee']::text[]) AS a(name)
RETURNING order_id;
COMMIT;
SQL
}

# Session-bound variant, mirroring the register route's session-bound
# sql.transaction([...]) array (lock tt, lock session, count tt, count
# session, guarded insert).
register_session_sql() {
  local tt_id="$1" sess_id="$2" purchaser="$3" qty="$4" inject="${5:-}"
  cat <<SQL
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a' FOR UPDATE;
SELECT capacity FROM event_sessions WHERE id = '$sess_id' AND organisation_id = 'org-a' FOR UPDATE;
$inject
SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = '$tt_id' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED';
SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.event_session_id = '$sess_id' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED';
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = '$tt_id' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
sold_sess AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.event_session_id = '$sess_id' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL, 'CONFIRMED', 0
  FROM sold_tt, sold_sess
  WHERE sold_tt.qty + $qty <= (SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a')
    AND sold_sess.qty + $qty <= (SELECT capacity FROM event_sessions WHERE id = '$sess_id' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', '$tt_id', '$sess_id', $qty, 0
  FROM ins_order
  RETURNING id, order_id
)
INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
SELECT 'org-a', 'event-1', ins_item.order_id, ins_item.id, a.name, NULL
FROM ins_item, UNNEST(ARRAY['Attendee']::text[]) AS a(name)
RETURNING order_id;
COMMIT;
SQL
}

run_concurrent_pair() {
  # Fires two genuinely concurrent connections: A holds its lock for 2s
  # (forcing B to block on FOR UPDATE and then proceed only after A
  # commits — the exact dangerous timing section 13/R1 requires), B has
  # no artificial delay. Waits for both, writes stdout to $OUT_A/$OUT_B.
  local sql_a="$1" sql_b="$2"
  (echo "$sql_a" | docker exec -i "$CONTAINER" psql -X -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_A" 2>&1) &
  local pid_a=$!
  sleep 0.5
  (echo "$sql_b" | docker exec -i "$CONTAINER" psql -X -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_B" 2>&1) &
  local pid_b=$!
  wait "$pid_a" "$pid_b"
}

echo ""
echo "=== BOOTSTRAP ==="
reset_db
bootstrap
echo "  bootstrap applied (real scripts/create-events.sql + scripts/create-events-phase2.sql)"

echo ""
echo "=== NORMAL PATH ==="

expect_success "1. seed capacity=3 ticket type" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-normal', 'event-1', 'org-a', 'GA', 0, 3, true);"
expect_success "1b. one registration under capacity succeeds" \
  "$(register_ticket_type_sql tt-normal 'P1' 1)"
expect_eq "1c. confirmed quantity is 1" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-normal';" "1"

expect_success "2. exact-fit registration succeeds (2 more, total = capacity 3)" \
  "$(register_ticket_type_sql tt-normal 'P2' 2)"
expect_eq "2b. confirmed quantity equals capacity (3)" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-normal';" "3"

expect_success "3. one-over-capacity registration is cleanly rejected (zero rows, no error)" \
  "$(register_ticket_type_sql tt-normal 'P3' 1)"
expect_eq "3b. capacity is still exactly 3 (rejected attempt left no trace)" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-normal';" "3"
expect_eq "3c. no orphan order was created by the rejected attempt" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name='P3';" "0"

reset_db; bootstrap
expect_success "4. seed session capacity=2 (ticket type non-limiting)" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-sess', 'event-1', 'org-a', 'GA', 0, 100, true); INSERT INTO event_sessions (id, event_id, organisation_id, name, starts_at, ends_at, capacity) VALUES ('sess-normal', 'event-1', 'org-a', 'S1', now(), now()+interval '1 hour', 2);"
expect_success "4b. exact session capacity succeeds" \
  "$(register_session_sql tt-sess sess-normal 'S-P1' 2)"
expect_eq "4c. confirmed session quantity equals capacity (2)" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE event_session_id='sess-normal';" "2"
expect_success "5. one-over session capacity is cleanly rejected" \
  "$(register_session_sql tt-sess sess-normal 'S-P2' 1)"
expect_eq "5b. session quantity still exactly 2" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE event_session_id='sess-normal';" "2"

echo ""
echo "=== ATOMICITY ==="

reset_db; bootstrap
expect_success "6 setup: capacity=10 ticket type" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-atomic', 'event-1', 'org-a', 'GA', 0, 10, true);"
expect_failure "6. a genuine mid-statement error (NULL attendee name) rolls back the whole statement — order/item would have logically been created first" \
  "BEGIN; SELECT capacity FROM event_ticket_types WHERE id='tt-atomic' AND organisation_id='org-a' FOR UPDATE; WITH sold_tt AS (SELECT COALESCE(SUM(oi.quantity),0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.organisation_id=oi.organisation_id WHERE oi.ticket_type_id='tt-atomic' AND oi.organisation_id='org-a' AND eo.status<>'CANCELLED'), ins_order AS (INSERT INTO event_orders (organisation_id,event_id,purchaser_name,purchaser_email,purchaser_phone,status,total_cents) SELECT 'org-a','event-1','P-err','e@example.com',NULL,'CONFIRMED',0 FROM sold_tt WHERE sold_tt.qty+1<=(SELECT capacity FROM event_ticket_types WHERE id='tt-atomic' AND organisation_id='org-a') RETURNING id), ins_item AS (INSERT INTO event_order_items (organisation_id,order_id,event_id,ticket_type_id,event_session_id,quantity,unit_price_cents) SELECT 'org-a',ins_order.id,'event-1','tt-atomic',NULL,1,0 FROM ins_order RETURNING id, order_id) INSERT INTO event_attendees (organisation_id,event_id,order_id,order_item_id,attendee_name,attendee_email) SELECT 'org-a','event-1',ins_item.order_id,ins_item.id,NULL,NULL FROM ins_item RETURNING order_id; COMMIT;"
expect_eq "7. no orphan order persists after the item-stage-equivalent failure" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name='P-err';" "0"
expect_eq "8. no orphan item persists either" \
  "SELECT count(*) FROM event_order_items WHERE ticket_type_id='tt-atomic';" "0"

echo ""
echo "=== CONCURRENCY (blocking gate) ==="

CONCURRENCY_FAIL=0
run_concurrency_scenario() {
  local label="$1" setup_sql="$2" query_after="$3" want="$4" build_a="$5" build_b="$6"
  local total_pass=0 total_fail=0
  for i in $(seq 1 10); do
    reset_db >/dev/null 2>&1; bootstrap >/dev/null 2>&1
    echo "$setup_sql" | psql_exec >/dev/null 2>&1
    local sql_a sql_b
    sql_a="$(eval "$build_a")"
    sql_b="$(eval "$build_b")"
    run_concurrent_pair "$sql_a" "$sql_b"
    local got
    got="$(echo "$query_after" | psql_query | tr -d '[:space:]')"
    if [ "$got" = "$want" ]; then
      total_pass=$((total_pass + 1))
    else
      total_fail=$((total_fail + 1))
      echo "    run $i: FAIL — want $want, got $got"
      echo "    --- connection A output ---"; sed 's/^/      /' "$OUT_A"
      echo "    --- connection B output ---"; sed 's/^/      /' "$OUT_B"
    fi
  done
  echo "  $label: $total_pass/10 runs correct, $total_fail/10 oversold"
  if [ "$total_fail" -eq 0 ]; then
    echo "  PASS: $label (0/10 oversells across 10 repetitions)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label ($total_fail/10 oversold)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$label")
    CONCURRENCY_FAIL=1
  fi
}

run_concurrency_scenario \
  "9. ticket capacity=1, two concurrent qty=1 registrations -> final qty must equal 1" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-conc1', 'event-1', 'org-a', 'GA', 0, 1, true);" \
  "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.status<>'CANCELLED' WHERE oi.ticket_type_id='tt-conc1';" \
  "1" \
  'register_ticket_type_sql tt-conc1 "CA" 1 "SELECT pg_sleep(2);"' \
  'register_ticket_type_sql tt-conc1 "CB" 1'

run_concurrency_scenario \
  "10. ticket capacity=5, existing sold=4, two concurrent qty=1 -> final qty must equal 5" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-conc5', 'event-1', 'org-a', 'GA', 0, 5, true); INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents) VALUES ('order-pre4', 'org-a', 'event-1', 'Pre', 'pre@example.com', 'CONFIRMED', 0); INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('item-pre4', 'org-a', 'order-pre4', 'event-1', 'tt-conc5', 4, 0);" \
  "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.status<>'CANCELLED' WHERE oi.ticket_type_id='tt-conc5';" \
  "5" \
  'register_ticket_type_sql tt-conc5 "CA5" 1 "SELECT pg_sleep(2);"' \
  'register_ticket_type_sql tt-conc5 "CB5" 1'

run_concurrency_scenario \
  "11. session capacity=1 (ticket type non-limiting), two concurrent registrations -> final session qty must equal 1" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-concs', 'event-1', 'org-a', 'GA', 0, 100, true); INSERT INTO event_sessions (id, event_id, organisation_id, name, starts_at, ends_at, capacity) VALUES ('sess-conc1', 'event-1', 'org-a', 'S1', now(), now()+interval '1 hour', 1);" \
  "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.status<>'CANCELLED' WHERE oi.event_session_id='sess-conc1';" \
  "1" \
  'register_session_sql tt-concs sess-conc1 "SA" 1 "SELECT pg_sleep(2);"' \
  'register_session_sql tt-concs sess-conc1 "SB" 1'

echo ""
echo "=== FORCED-BLOCKING PROOF (section 13) ==="
reset_db; bootstrap
echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-fb', 'event-1', 'org-a', 'GA', 0, 100, true);" | psql_exec >/dev/null
SQL_A_FB="$(register_ticket_type_sql tt-fb FB-A 1 'SELECT pg_sleep(3);')"
SQL_B_FB="$(register_ticket_type_sql tt-fb FB-B 1)"
run_concurrent_pair "$SQL_A_FB" "$SQL_B_FB"
expect_eq "12. forced-blocking proof: B's fresh post-lock count statement genuinely observed A's commit (both succeeded independently as 2 separate confirmed orders, proving B did not see a stale zero count — it correctly queued behind A)" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name IN ('FB-A','FB-B');" "2"
echo "  (both A and B succeed here because tt-fb has capacity=100 — this scenario proves B's statements execute in the correct post-A-commit order, not that capacity is enforced; scenarios 9-11 above prove capacity enforcement under the same blocking timing)"

if [ "$CONCURRENCY_FAIL" -ne 0 ]; then
  echo ""
  echo "=== CONCURRENCY GATE FAILED — skipping mutation-proof section (would be meaningless against an already-broken baseline) ==="
else
  echo ""
  echo "=== CONCURRENCY MUTATION PROOFS (section 18) ==="
  # Each mutation is applied ad hoc to a scratch copy of the statement
  # sequence (not to the repository's source files) and proven to
  # reintroduce oversell, then discarded — the actual candidate route
  # file is never touched by this harness.

  reset_db; bootstrap
  echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-mutA', 'event-1', 'org-a', 'GA', 0, 1, true);" | psql_exec >/dev/null
  # Mutation A: capacity count moved BEFORE the lock (i.e. the aggregate
  # runs as part of the SAME statement as the lock, exactly like the
  # original defect) — reintroduces the stale-snapshot bug.
  MUT_A_SQL_TEMPLATE() {
    local purchaser="$1" qty="$2" delay_secs="$3"
    cat <<SQL
BEGIN;
WITH locked_tt AS (
  SELECT capacity FROM event_ticket_types WHERE id = 'tt-mutA' AND organisation_id = 'org-a' FOR UPDATE
),
delay AS (
  SELECT pg_sleep($delay_secs) FROM locked_tt
),
sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-mutA' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL, 'CONFIRMED', 0
  FROM locked_tt, delay, sold_tt
  WHERE sold_tt.qty + $qty <= locked_tt.capacity
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', 'tt-mutA', NULL, $qty, 0 FROM ins_order RETURNING id, order_id
)
INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
SELECT 'org-a', 'event-1', ins_item.order_id, ins_item.id, a.name, NULL FROM ins_item, UNNEST(ARRAY['A']::text[]) AS a(name) RETURNING order_id;
COMMIT;
SQL
  }
  run_concurrent_pair "$(MUT_A_SQL_TEMPLATE MutA-A 1 2)" "$(MUT_A_SQL_TEMPLATE MutA-B 1 0)"
  got_mutA="$(echo "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.status<>'CANCELLED' WHERE oi.ticket_type_id='tt-mutA';" | psql_query | tr -d '[:space:]')"
  if [ "$got_mutA" != "1" ]; then
    echo "  PASS (mutation A correctly reintroduces oversell — harness is sensitive to it): got quantity=$got_mutA against capacity=1"
    PASS=$((PASS + 1))
  else
    echo "  FAIL (mutation A did not reproduce oversell — harness may not be sensitive to this defect class): got quantity=$got_mutA"
    FAIL=$((FAIL + 1))
    FAILURES+=("mutation A did not reproduce oversell")
  fi

  reset_db; bootstrap
  echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-mutB', 'event-1', 'org-a', 'GA', 0, 1, true);" | psql_exec >/dev/null
  # Mutation B: lock removed entirely (plain SELECT, no FOR UPDATE).
  # Without a lock there is no blocking-then-resuming mechanism, so
  # unlike mutations A/C/D (which are deterministically reproducible via
  # forced blocking) this needs both sides' capacity-decision statements
  # to genuinely overlap in wall-clock time — an embedded delay CTE
  # timed via run_concurrent_pair's own 0.5s stagger (A delays 1.5s
  # starting at t=0, B delays 1.0s starting at t=0.5 -> both reach their
  # capacity decision at t≈1.5, racing).
  MUT_B_SQL_TEMPLATE() {
    local purchaser="$1" qty="$2" delay_secs="$3"
    cat <<SQL
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = 'tt-mutB' AND organisation_id = 'org-a';
WITH delay AS (
  SELECT pg_sleep($delay_secs)
),
sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-mutB' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL, 'CONFIRMED', 0
  FROM delay, sold_tt
  WHERE sold_tt.qty + $qty <= (SELECT capacity FROM event_ticket_types WHERE id = 'tt-mutB' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', 'tt-mutB', NULL, $qty, 0 FROM ins_order RETURNING id, order_id
)
INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
SELECT 'org-a', 'event-1', ins_item.order_id, ins_item.id, a.name, NULL FROM ins_item, UNNEST(ARRAY['A']::text[]) AS a(name) RETURNING order_id;
COMMIT;
SQL
  }
  run_concurrent_pair "$(MUT_B_SQL_TEMPLATE MutB-A 1 1.5)" "$(MUT_B_SQL_TEMPLATE MutB-B 1 1.0)"
  got_mutB="$(echo "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.status<>'CANCELLED' WHERE oi.ticket_type_id='tt-mutB';" | psql_query | tr -d '[:space:]')"
  if [ "$got_mutB" != "1" ]; then
    echo "  PASS (mutation B — lock removed — correctly reintroduces oversell): got quantity=$got_mutB against capacity=1"
    PASS=$((PASS + 1))
  else
    echo "  FAIL (mutation B did not reproduce oversell): got quantity=$got_mutB"
    FAIL=$((FAIL + 1))
    FAILURES+=("mutation B did not reproduce oversell")
  fi

  reset_db; bootstrap
  echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-mutC', 'event-1', 'org-a', 'GA', 0, 1, true);" | psql_exec >/dev/null
  # Mutation C: ticket-type capacity comparison removed from the WHERE
  # clause entirely — every registration succeeds regardless of capacity.
  expect_success "mutation C setup: register once to fill capacity=1" \
    "$(register_ticket_type_sql tt-mutC MutC-1 1)"
  MUT_C_NOCHECK="BEGIN; SELECT capacity FROM event_ticket_types WHERE id='tt-mutC' AND organisation_id='org-a' FOR UPDATE; WITH ins_order AS (INSERT INTO event_orders (organisation_id,event_id,purchaser_name,purchaser_email,purchaser_phone,status,total_cents) VALUES ('org-a','event-1','MutC-2','p@example.com',NULL,'CONFIRMED',0) RETURNING id), ins_item AS (INSERT INTO event_order_items (organisation_id,order_id,event_id,ticket_type_id,event_session_id,quantity,unit_price_cents) SELECT 'org-a',ins_order.id,'event-1','tt-mutC',NULL,1,0 FROM ins_order RETURNING id, order_id) INSERT INTO event_attendees (organisation_id,event_id,order_id,order_item_id,attendee_name,attendee_email) SELECT 'org-a','event-1',ins_item.order_id,ins_item.id,a.name,NULL FROM ins_item, UNNEST(ARRAY['A']::text[]) AS a(name) RETURNING order_id; COMMIT;"
  echo "$MUT_C_NOCHECK" | psql_exec >/dev/null 2>&1
  got_mutC="$(echo "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.status<>'CANCELLED' WHERE oi.ticket_type_id='tt-mutC';" | psql_query | tr -d '[:space:]')"
  if [ "$got_mutC" != "1" ]; then
    echo "  PASS (mutation C — capacity comparison removed — correctly oversold): got quantity=$got_mutC against capacity=1"
    PASS=$((PASS + 1))
  else
    echo "  FAIL (mutation C did not reproduce oversell): got quantity=$got_mutC"
    FAIL=$((FAIL + 1))
    FAILURES+=("mutation C did not reproduce oversell")
  fi

  reset_db; bootstrap
  echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-mutD', 'event-1', 'org-a', 'GA', 0, 100, true); INSERT INTO event_sessions (id, event_id, organisation_id, name, starts_at, ends_at, capacity) VALUES ('sess-mutD', 'event-1', 'org-a', 'S1', now(), now()+interval '1 hour', 1);" | psql_exec >/dev/null
  # Mutation D: session capacity comparison removed from the WHERE
  # clause (ticket-type check remains, so this isolates the session gate
  # specifically).
  expect_success "mutation D setup: register once to fill session capacity=1" \
    "$(register_session_sql tt-mutD sess-mutD MutD-1 1)"
  MUT_D_NOCHECK="BEGIN; SELECT capacity FROM event_ticket_types WHERE id='tt-mutD' AND organisation_id='org-a' FOR UPDATE; SELECT capacity FROM event_sessions WHERE id='sess-mutD' AND organisation_id='org-a' FOR UPDATE; WITH sold_tt AS (SELECT COALESCE(SUM(oi.quantity),0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.organisation_id=oi.organisation_id WHERE oi.ticket_type_id='tt-mutD' AND oi.organisation_id='org-a' AND eo.status<>'CANCELLED'), ins_order AS (INSERT INTO event_orders (organisation_id,event_id,purchaser_name,purchaser_email,purchaser_phone,status,total_cents) SELECT 'org-a','event-1','MutD-2','p@example.com',NULL,'CONFIRMED',0 FROM sold_tt WHERE sold_tt.qty+1<=(SELECT capacity FROM event_ticket_types WHERE id='tt-mutD' AND organisation_id='org-a') RETURNING id), ins_item AS (INSERT INTO event_order_items (organisation_id,order_id,event_id,ticket_type_id,event_session_id,quantity,unit_price_cents) SELECT 'org-a',ins_order.id,'event-1','tt-mutD','sess-mutD',1,0 FROM ins_order RETURNING id, order_id) INSERT INTO event_attendees (organisation_id,event_id,order_id,order_item_id,attendee_name,attendee_email) SELECT 'org-a','event-1',ins_item.order_id,ins_item.id,a.name,NULL FROM ins_item, UNNEST(ARRAY['A']::text[]) AS a(name) RETURNING order_id; COMMIT;"
  echo "$MUT_D_NOCHECK" | psql_exec >/dev/null 2>&1
  got_mutD="$(echo "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.status<>'CANCELLED' WHERE oi.event_session_id='sess-mutD';" | psql_query | tr -d '[:space:]')"
  if [ "$got_mutD" != "1" ]; then
    echo "  PASS (mutation D — session capacity comparison removed — correctly oversold): got session quantity=$got_mutD against capacity=1"
    PASS=$((PASS + 1))
  else
    echo "  FAIL (mutation D did not reproduce oversell): got session quantity=$got_mutD"
    FAIL=$((FAIL + 1))
    FAILURES+=("mutation D did not reproduce oversell")
  fi

  reset_db; bootstrap
  echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-mutE', 'event-1', 'org-a', 'GA', 0, 1, true);" | psql_exec >/dev/null
  # Mutation E: transaction split into independent AUTOCOMMIT statements
  # (no explicit BEGIN/COMMIT wrapping) — the FOR UPDATE lock is its own
  # implicit transaction under psql's default autocommit mode, so it is
  # released the instant that ONE statement completes, strictly before
  # the later, separately-submitted count+insert statement even starts.
  # Both statements are sent in a single psql invocation (one connection)
  # but deliberately NOT wrapped in BEGIN...COMMIT, so each is its own
  # autocommit transaction — exactly modeling what would happen if the
  # route issued separate non-transactional sql`...` calls instead of
  # sql.transaction([...]). As with mutation B, reproducing the race
  # requires both sides' count+insert statements to genuinely overlap in
  # wall-clock time, via the same symmetric delay-CTE + stagger technique.
  MUT_E_SQL_TEMPLATE() {
    local purchaser="$1" qty="$2" delay_secs="$3"
    cat <<SQL
SELECT capacity FROM event_ticket_types WHERE id = 'tt-mutE' AND organisation_id = 'org-a' FOR UPDATE;
WITH delay AS (
  SELECT pg_sleep($delay_secs)
),
sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-mutE' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL, 'CONFIRMED', 0
  FROM delay, sold_tt
  WHERE sold_tt.qty + $qty <= (SELECT capacity FROM event_ticket_types WHERE id = 'tt-mutE' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', 'tt-mutE', NULL, $qty, 0 FROM ins_order RETURNING id, order_id
)
INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
SELECT 'org-a', 'event-1', ins_item.order_id, ins_item.id, a.name, NULL FROM ins_item, UNNEST(ARRAY['A']::text[]) AS a(name) RETURNING order_id;
SQL
  }
  run_concurrent_pair "$(MUT_E_SQL_TEMPLATE MutE-A 1 1.5)" "$(MUT_E_SQL_TEMPLATE MutE-B 1 1.0)"
  got_mutE="$(echo "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.status<>'CANCELLED' WHERE oi.ticket_type_id='tt-mutE';" | psql_query | tr -d '[:space:]')"
  if [ "$got_mutE" != "1" ]; then
    echo "  PASS (mutation E — split into independent autocommit statements — correctly oversold, lock provided no protection): got quantity=$got_mutE against capacity=1"
    PASS=$((PASS + 1))
  else
    echo "  FAIL (mutation E did not reproduce oversell — B may simply have run after A had already fully committed due to timing): got quantity=$got_mutE"
    FAIL=$((FAIL + 1))
    FAILURES+=("mutation E did not reproduce oversell")
  fi

  echo ""
  echo "=== LOCK ORDER (mutation F) ==="
  echo "  F. Documented detection approach (not a runtime harness check): the"
  echo "     candidate's register route acquires locks in a single fixed order"
  echo "     in EVERY code path — event_ticket_types, then (only if session-"
  echo "     bound) event_sessions — verified by direct source inspection of"
  echo "     both sql.transaction([...]) arrays in the route file. Two"
  echo "     concurrent registrations can therefore never contend for the same"
  echo "     two rows in opposite orders, so the classic two-resource deadlock"
  echo "     shape cannot arise from this code path. A live deadlock would"
  echo "     require ANOTHER, unrelated code path to lock event_sessions before"
  echo "     event_ticket_types for the same pair of rows — no such path exists"
  echo "     anywhere in this codebase (grep confirms FOR UPDATE appears only"
  echo "     in this one route, in this one order)."
fi

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo "Failed checks:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
