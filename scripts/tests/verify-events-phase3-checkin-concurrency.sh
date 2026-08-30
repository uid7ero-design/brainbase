#!/usr/bin/env bash
# Events & Ticketing Phase 3 — repeatable behavioral validation for the
# check-in duplicate-scan-prevention mechanism
# (lib/events/checkIn.ts's confirmCheckIn(), the atomic
# UPDATE ... WHERE checked_in_at IS NULL ... RETURNING statement).
#
# WHY THIS EXISTS: the Phase 3 brief explicitly requires proof against
# real PostgreSQL, not mocked tests, that two devices scanning the same
# ticket concurrently cannot both record a first check-in — following
# the same discipline scripts/tests/verify-events-phase2-concurrency.sh
# already established for capacity (an independent review there proved
# mocked-SQL tests cannot detect this class of regression, by
# construction: mocks have no real transaction/lock/MVCC semantics).
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with the ACTUAL, unmodified schema from scripts/create-events.sql,
# scripts/create-events-phase2.sql, and scripts/add-events-ticketing.sql,
# then executes the SAME single-statement conditional UPDATE
# confirmCheckIn() submits, via `docker exec ... psql`, including firing
# two genuinely concurrent connections against the same row.
#
# WHAT THIS DOES NOT DO: not wired into CI (Docker is not part of the
# standard CI workflow here, matching every other disposable-Postgres
# harness's own precedent). Requires only Docker — no Neon/Production
# access, no local psql install. Creates and destroys its own disposable
# container; never touches Production or any already-running database.
#
# USAGE:
#   bash scripts/tests/verify-events-phase3-checkin-concurrency.sh
#
# Exits 0 if every check passes, non-zero and prints a summary of what
# failed otherwise. Always removes the disposable container (trap on EXIT).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVENTS_MIGRATION="$REPO_ROOT/scripts/create-events.sql"
PHASE2_MIGRATION="$REPO_ROOT/scripts/create-events-phase2.sql"
TICKETING_MIGRATION="$REPO_ROOT/scripts/add-events-ticketing.sql"
CONTAINER="events-p3-checkin-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" "${OUT_A:-}" "${OUT_B:-}" 2>/dev/null || true
}
trap cleanup EXIT

for f in "$EVENTS_MIGRATION" "$PHASE2_MIGRATION" "$TICKETING_MIGRATION"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: migration file not found: $f" >&2
    exit 2
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
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

DIAG_OUT="/tmp/events_p3_harness_out.$$.txt"
OUT_A="/tmp/events_p3_harness_a.$$.txt"
OUT_B="/tmp/events_p3_harness_b.$$.txt"

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1
}
psql_query() {
  docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1
}
reset_db() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "DROP DATABASE IF EXISTS testdb;" >/dev/null 2>&1
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "CREATE DATABASE testdb;" >/dev/null 2>&1
}

bootstrap() {
  # Minimal organisations/users stand-ins matching this repo's real FK
  # conventions, then the ACTUAL, unmodified Phase 1 + Phase 2 + Phase 3
  # ticketing DDL, then one minimal org/user/event/ticket-type/order/
  # order-item — every test seeds its own event_attendees row(s) on top
  # of this fixed base.
  {
    cat <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
SQL
    cat "$EVENTS_MIGRATION"
    cat "$PHASE2_MIGRATION"
    cat "$TICKETING_MIGRATION"
    cat <<'SQL'
INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a');
INSERT INTO users (id, organisation_id, username, name) VALUES ('staff-1', 'org-a', 'staff1', 'Staff One'), ('staff-2', 'org-a', 'staff2', 'Staff Two');
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
  VALUES ('event-1', 'org-a', 'Graduation', 'graduation', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide');
INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active)
  VALUES ('tt-1', 'event-1', 'org-a', 'GA', 0, 1000, true);
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents)
  VALUES ('order-1', 'org-a', 'event-1', 'Purchaser', 'p@example.com', 'CONFIRMED', 0);
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents)
  VALUES ('item-1', 'org-a', 'order-1', 'event-1', 'tt-1', 1, 0);
SQL
  } | psql_exec
}

seed_attendee() {
  # $1 = attendee id, $2 = ticket token, $3 = checked-in ('true' seeds
  # an already-checked-in row for duplicate/undo tests, anything else
  # seeds a fresh unchecked-in row).
  local aid="$1" token="$2" checked="${3:-false}"
  if [ "$checked" = "true" ]; then
    echo "INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token, checked_in_at, checked_in_by_user_id) VALUES ('$aid', 'org-a', 'event-1', 'order-1', 'item-1', 'Attendee', '$token', now() - interval '5 minutes', 'staff-1');" | psql_exec
  else
    echo "INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token) VALUES ('$aid', 'org-a', 'event-1', 'order-1', 'item-1', 'Attendee', '$token');" | psql_exec
  fi
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

# ─── THE atomic statement, as real Postgres SQL text ──────────────────
# Mirrors confirmCheckIn()'s UPDATE exactly (lib/events/checkIn.ts) —
# no delay, no wrapping transaction; a single autocommit statement,
# exactly as the application issues it.
checkin_sql() {
  local token="$1" staff="$2"
  cat <<SQL
UPDATE event_attendees ea
SET checked_in_at = now(), checked_in_by_user_id = '$staff'
FROM event_order_items oi, event_orders eo
WHERE ea.order_item_id = oi.id AND oi.organisation_id = ea.organisation_id
  AND eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
  AND ea.ticket_token = '$token' AND ea.organisation_id = 'org-a' AND ea.event_id = 'event-1'
  AND ea.checked_in_at IS NULL
  AND eo.status <> 'CANCELLED'
RETURNING ea.id;
SQL
}

# Forced-blocking variant used ONLY by the forced-blocking proof below —
# NOT a different statement shape under test, just a way to hold the row
# lock open long enough to force a real wait. A CTE-embedded pg_sleep
# referenced via the UPDATE's own FROM clause was tried first and
# rejected: Postgres evaluates that CTE as an input to the scan BEFORE
# the row is matched/locked, so the sleep happened BEFORE lock
# acquisition, not while holding it — confirmed empirically (the
# "loser" connection won outright since the "holder" hadn't touched the
# row yet). The correct technique: issue the real UPDATE first (locks +
# writes immediately), THEN sleep, THEN COMMIT, inside one explicit
# transaction — Postgres holds a row lock from UPDATE until COMMIT/
# ROLLBACK regardless of what happens in between, so this genuinely
# holds the lock across the delay.
checkin_sql_held() {
  local token="$1" staff="$2" hold_secs="$3"
  cat <<SQL
BEGIN;
UPDATE event_attendees ea
SET checked_in_at = now(), checked_in_by_user_id = '$staff'
FROM event_order_items oi, event_orders eo
WHERE ea.order_item_id = oi.id AND oi.organisation_id = ea.organisation_id
  AND eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
  AND ea.ticket_token = '$token' AND ea.organisation_id = 'org-a' AND ea.event_id = 'event-1'
  AND ea.checked_in_at IS NULL
  AND eo.status <> 'CANCELLED'
RETURNING ea.id;
SELECT pg_sleep($hold_secs);
COMMIT;
SQL
}

# -t -A (unaligned, tuples-only): default aligned table output pads
# cell values with a leading space for column alignment (confirmed
# empirically — " att-fb", not "att-fb"), which breaks an exact-line
# grep for the bare id. -t -A prints just the raw value with no
# padding, one per line, so a RETURNING id that actually matched a row
# is grep-able by its exact text.
run_concurrent_pair() {
  local sql_a="$1" sql_b="$2"
  (echo "$sql_a" | docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_A" 2>&1) &
  local pid_a=$!
  sleep 0.5
  (echo "$sql_b" | docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_B" 2>&1) &
  local pid_b=$!
  wait "$pid_a" "$pid_b"
}

echo ""
echo "=== BOOTSTRAP ==="
reset_db
bootstrap
echo "  bootstrap applied (real scripts/create-events.sql + create-events-phase2.sql + add-events-ticketing.sql)"

echo ""
echo "=== NORMAL PATH ==="
seed_attendee att-1 tok-1 false
expect_success "1. first check-in on a fresh attendee succeeds" "$(checkin_sql tok-1 staff-1)"
expect_eq "1b. checked_in_at is now set" \
  "SELECT (checked_in_at IS NOT NULL) FROM event_attendees WHERE id='att-1';" "t"
expect_eq "1c. checked_in_by_user_id recorded" \
  "SELECT checked_in_by_user_id FROM event_attendees WHERE id='att-1';" "staff-1"

# RETURNING row count needs psql_query (prints rows via -t -A). NOTE:
# even with -t -A, psql still prints the "UPDATE 0"/"UPDATE 1" command
# tag for an UPDATE statement (confirmed empirically — -t only
# suppresses SELECT-style row/column formatting, not DML command
# tags) — so "is the output empty" is NOT a reliable zero-rows check.
# Check for the specific row id's own text instead, which only ever
# appears when RETURNING actually produced that row.
SECOND_ATTEMPT_OUTPUT="$(checkin_sql tok-1 staff-2 | psql_query)"
if ! echo "$SECOND_ATTEMPT_OUTPUT" | grep -q '^att-1$'; then
  echo "  PASS: 2. a second check-in on the same token returns zero rows (already checked in)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 2. second check-in unexpectedly returned a row: $SECOND_ATTEMPT_OUTPUT"
  FAIL=$((FAIL + 1))
  FAILURES+=("second check-in did not no-op")
fi
expect_eq "2b. checked_in_by_user_id is still the FIRST staff member, not overwritten by the second attempt" \
  "SELECT checked_in_by_user_id FROM event_attendees WHERE id='att-1';" "staff-1"

echo ""
echo "=== CANCELLATION ATOMICITY ==="
# A real bug this harness is here to prevent regressing: an earlier
# version of confirmCheckIn() checked order cancellation only via a
# SEPARATE read AFTER the UPDATE had already run, so a cancelled
# order's never-checked-in attendee would be (incorrectly) marked
# checked in by the UPDATE before the cancellation was ever noticed.
# The fix folds "AND eo.status <> 'CANCELLED'" into the UPDATE's own
# WHERE clause (via the FROM join to event_orders) — this proves a
# cancelled order's attendee, with checked_in_at IS NULL, can NEVER be
# checked in, atomically, in one statement.
echo "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents) VALUES ('order-cancelled', 'org-a', 'event-1', 'Cancelled Purchaser', 'c@example.com', 'CANCELLED', 0);" | psql_exec >/dev/null
echo "INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('item-cancelled', 'org-a', 'order-cancelled', 'event-1', 'tt-1', 1, 0);" | psql_exec >/dev/null
echo "INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token) VALUES ('att-cancelled', 'org-a', 'event-1', 'order-cancelled', 'item-cancelled', 'Cancelled Attendee', 'tok-cancelled');" | psql_exec >/dev/null
CANCELLED_ATTEMPT_OUTPUT="$(checkin_sql tok-cancelled staff-1 | psql_query)"
CANCELLED_FINAL_STATE="$(echo "SELECT (checked_in_at IS NULL) FROM event_attendees WHERE id='att-cancelled';" | psql_query | tr -d '[:space:]')"
if ! echo "$CANCELLED_ATTEMPT_OUTPUT" | grep -q '^att-cancelled$' && [ "$CANCELLED_FINAL_STATE" = "t" ]; then
  echo "  PASS: 2c. a cancelled order's attendee (checked_in_at IS NULL) is NEVER checked in — the UPDATE itself matches zero rows"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 2c. cancelled-order attendee was incorrectly checked in (output: $CANCELLED_ATTEMPT_OUTPUT, final checked_in_at IS NULL: $CANCELLED_FINAL_STATE)"
  FAIL=$((FAIL + 1))
  FAILURES+=("cancelled-order attendee was checked in")
fi

echo ""
echo "=== UNDO ==="
expect_success "3. undo (checked_in_at IS NOT NULL -> NULL) succeeds on the checked-in attendee" \
  "UPDATE event_attendees SET checked_in_at = NULL, checked_in_by_user_id = NULL WHERE id = 'att-1' AND organisation_id = 'org-a' AND event_id = 'event-1' AND checked_in_at IS NOT NULL;"
expect_eq "3b. checked_in_at is NULL again after undo" \
  "SELECT (checked_in_at IS NULL) FROM event_attendees WHERE id='att-1';" "t"

UNDO_NOOP_OUTPUT="$(echo "UPDATE event_attendees SET checked_in_at = NULL WHERE id = 'att-1' AND organisation_id = 'org-a' AND event_id = 'event-1' AND checked_in_at IS NOT NULL RETURNING id;" | psql_query)"
if ! echo "$UNDO_NOOP_OUTPUT" | grep -q '^att-1$'; then
  echo "  PASS: 4. undo on an attendee who is NOT checked in updates zero rows (safe no-op, not an error)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 4. undo-on-not-checked-in unexpectedly updated a row"
  FAIL=$((FAIL + 1))
  FAILURES+=("undo-on-not-checked-in did not no-op")
fi

echo ""
echo "=== FORCED-BLOCKING PROOF ==="
# Connection A performs its UPDATE (locking + writing the row)
# immediately, then holds the transaction open for 2s before COMMIT —
# see checkin_sql_held's own comment for why this, not a CTE-embedded
# delay, is what actually holds the lock. Connection B, started 0.5s
# later, must block waiting for A's row lock and then correctly observe
# A's COMMITTED checked_in_at once it unblocks — proving B never uses a
# stale pre-commit view of this row, the exact property duplicate-scan
# prevention depends on.
reset_db; bootstrap
seed_attendee att-fb tok-fb false
run_concurrent_pair "$(checkin_sql_held tok-fb staff-1 2)" "$(checkin_sql tok-fb staff-2)"
FB_A_ROWS="$(grep -c '^att-fb$' "$OUT_A" 2>/dev/null || true)"
FB_B_ROWS="$(grep -c '^att-fb$' "$OUT_B" 2>/dev/null || true)"
FB_FINAL_STAFF="$(echo "SELECT checked_in_by_user_id FROM event_attendees WHERE id='att-fb';" | psql_query | tr -d '[:space:]')"
if [ "${FB_A_ROWS:-0}" = "1" ] && [ "${FB_B_ROWS:-0}" = "0" ] && [ "$FB_FINAL_STAFF" = "staff-1" ]; then
  echo "  PASS: 5. forced-blocking proof — B blocked on A's row lock, then correctly observed A's commit (0 rows for B, staff-1 recorded)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 5. forced-blocking proof — expected A=1 row/B=0 rows/staff-1 recorded, got A=${FB_A_ROWS:-?} B=${FB_B_ROWS:-?} staff=$FB_FINAL_STAFF"
  FAIL=$((FAIL + 1))
  FAILURES+=("forced-blocking proof failed")
fi

echo ""
echo "=== CONCURRENCY (blocking gate) — repeated genuine race, no forced delay ==="
CONCURRENCY_REPS=10
concurrency_pass=0
for i in $(seq 1 "$CONCURRENCY_REPS"); do
  reset_db; bootstrap
  seed_attendee "att-race-$i" "tok-race-$i" false
  # Both connections fire the identical statement against the same row
  # with NO artificial stagger/delay — a genuine race, letting the OS/DB
  # scheduler decide who wins on each repetition.
  (echo "$(checkin_sql tok-race-$i staff-1)" | docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_A" 2>&1) &
  pid_a=$!
  (echo "$(checkin_sql tok-race-$i staff-2)" | docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_B" 2>&1) &
  pid_b=$!
  wait "$pid_a" "$pid_b"
  rows_a="$(grep -c "^att-race-$i\$" "$OUT_A" 2>/dev/null || true)"
  rows_b="$(grep -c "^att-race-$i\$" "$OUT_B" 2>/dev/null || true)"
  final_count="$(echo "SELECT COUNT(*) FROM event_attendees WHERE id='att-race-$i' AND checked_in_at IS NOT NULL;" | psql_query | tr -d '[:space:]')"
  total_wins=$(( ${rows_a:-0} + ${rows_b:-0} ))
  if [ "$total_wins" = "1" ] && [ "$final_count" = "1" ]; then
    concurrency_pass=$((concurrency_pass + 1))
  else
    echo "    rep $i: unexpected outcome — rows_a=${rows_a:-0} rows_b=${rows_b:-0} final_checked_in_count=$final_count"
  fi
done
echo "  $concurrency_pass/$CONCURRENCY_REPS repetitions: exactly one concurrent request performed the first check-in, exactly one checked_in_at value established, no duplicates"
if [ "$concurrency_pass" = "$CONCURRENCY_REPS" ]; then
  echo "  PASS: 6. duplicate-scan prevention holds under genuine concurrency across $CONCURRENCY_REPS repetitions (0 duplicates)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 6. duplicate-scan prevention failed on $((CONCURRENCY_REPS - concurrency_pass))/$CONCURRENCY_REPS repetitions"
  FAIL=$((FAIL + 1))
  FAILURES+=("concurrency gate: $((CONCURRENCY_REPS - concurrency_pass))/$CONCURRENCY_REPS repetitions had a duplicate or lost check-in")
fi

echo ""
echo "=== MUTATION PROOF — weaken the atomic condition, confirm the harness catches it ==="
# Deliberately drop "AND checked_in_at IS NULL" from the UPDATE's WHERE
# clause (the exact regression this whole mechanism guards against: an
# unconditional check-in that both concurrent requests can "win").
mutated_checkin_sql() {
  local token="$1" staff="$2"
  cat <<SQL
UPDATE event_attendees
SET checked_in_at = now(), checked_in_by_user_id = '$staff'
WHERE ticket_token = '$token' AND organisation_id = 'org-a' AND event_id = 'event-1'
RETURNING id;
SQL
}
reset_db; bootstrap
seed_attendee att-mut tok-mut false
(echo "$(mutated_checkin_sql tok-mut staff-1)" | docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_A" 2>&1) &
pid_a=$!
(echo "$(mutated_checkin_sql tok-mut staff-2)" | docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_B" 2>&1) &
pid_b=$!
wait "$pid_a" "$pid_b"
mut_rows_a="$(grep -c '^att-mut$' "$OUT_A" 2>/dev/null || true)"
mut_rows_b="$(grep -c '^att-mut$' "$OUT_B" 2>/dev/null || true)"
mut_total=$(( ${mut_rows_a:-0} + ${mut_rows_b:-0} ))
if [ "$mut_total" -ge 2 ]; then
  echo "  PASS: 7. mutation correctly reproduces a double-check-in when the IS NULL guard is removed (both requests returned a row) — the harness is sensitive to this regression"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 7. mutation did NOT reproduce a double-check-in (got $mut_total winning rows) — the harness may not actually be exercising real concurrency"
  FAIL=$((FAIL + 1))
  FAILURES+=("mutation proof did not reproduce the regression")
fi

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
