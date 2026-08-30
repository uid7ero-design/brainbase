#!/usr/bin/env bash
# Events & Ticketing Phase 4B — pre-commit correctness remediation.
# Proves, against REAL PostgreSQL (not a mock), two independent things:
#
#   1. Free registration now writes capacity/order/order-items/
#      attendees/registration-responses as ONE atomic statement —
#      either everything commits together, or none of it does
#      (TESTS 1-4).
#   2. The registration-question reorder endpoint's lock-then-swap
#      design correctly serializes concurrent reorders — a second,
#      overlapping reorder request can never compute its "who is my
#      neighbor" answer from a stale, pre-swap view of the sibling
#      rows (TEST 5).
#
# WHY THIS EXISTS: the free-registration route
# (app/api/public/events/[organisationSlug]/[eventSlug]/register/
# route.ts) originally wrote registration-question responses in a
# SEPARATE statement AFTER the capacity-gated reservation transaction
# had already committed — a genuine correctness bug (a successful,
# ticketed registration could silently be missing its submitted
# answers). The fix folds the response writes into the SAME
# sql.transaction([...]) statement as the order/item/attendee insert,
# using two additional CTEs (ins_order_responses,
# ins_attendee_responses) referenced from the final SELECT via an
# uncorrelated scalar-count WHERE clause — the standard Postgres idiom
# for forcing an otherwise-output-unreferenced data-modifying CTE to
# execute. Attendee-scoped answers are correlated to their attendee by
# ticket_token (a value already known in JS before any row exists),
# joined inside the SAME statement — never by the attendee row's own
# generated id (unknowable before INSERT) and never by assuming
# RETURNING preserves SELECT input row order (not a documented
# PostgreSQL guarantee).
#
# None of this is provable against a mock: mocks have no genuine
# transaction, CTE-execution, or rollback semantics, by construction
# (see every other Events concurrency harness's own header comment for
# the same reasoning). This harness follows the exact same "disposable
# postgres:16-alpine container, replay the real route SQL, assert
# actual table state" pattern as
# scripts/tests/verify-events-phase2-concurrency.sh /
# verify-events-phase3-checkin-concurrency.sh /
# verify-events-phase4-payment-concurrency.sh.
#
# WHAT THIS DOES NOT DO: not wired into CI (Docker isn't part of the
# standard CI workflow here, matching every sibling harness). Requires
# only Docker. Creates and destroys its own disposable container;
# never touches Production or any already-running database.
#
# USAGE:
#   bash scripts/tests/verify-events-phase4b-response-atomicity.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVENTS_MIGRATION="$REPO_ROOT/scripts/create-events.sql"
PHASE2_MIGRATION="$REPO_ROOT/scripts/create-events-phase2.sql"
TICKETING_MIGRATION="$REPO_ROOT/scripts/add-events-ticketing.sql"
QUESTIONS_MIGRATION="$REPO_ROOT/scripts/add-events-registration-questions.sql"
CONTAINER="events-p4b-atomicity-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" "${OUT_A:-}" "${OUT_B:-}" 2>/dev/null || true
}
trap cleanup EXIT

for f in "$EVENTS_MIGRATION" "$PHASE2_MIGRATION" "$TICKETING_MIGRATION" "$QUESTIONS_MIGRATION"; do
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

DIAG_OUT="/tmp/events_p4b_atomicity_out.$$.txt"
OUT_A="/tmp/events_p4b_reorder_a.$$.txt"
OUT_B="/tmp/events_p4b_reorder_b.$$.txt"

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1
}
psql_query() {
  docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1
}

# Fires two genuinely concurrent connections — same technique as
# verify-events-phase2-concurrency.sh's own run_concurrent_pair (see
# that harness for the full reasoning): A holds its lock for a forced
# 2s (via an injected pg_sleep between its lock and swap statements),
# B starts 0.5s later with no artificial delay, so B is guaranteed to
# block on A's lock and only proceed once A has committed.
run_concurrent_pair() {
  local sql_a="$1" sql_b="$2"
  (echo "$sql_a" | docker exec -i "$CONTAINER" psql -X -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_A" 2>&1) &
  local pid_a=$!
  sleep 0.5
  (echo "$sql_b" | docker exec -i "$CONTAINER" psql -X -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_B" 2>&1) &
  local pid_b=$!
  wait "$pid_a" "$pid_b"
}

bootstrap() {
  {
    cat <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
SQL
    cat "$EVENTS_MIGRATION"
    cat "$PHASE2_MIGRATION"
    cat "$TICKETING_MIGRATION"
    cat "$QUESTIONS_MIGRATION"
    cat <<'SQL'
INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a');
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
  VALUES ('event-1', 'org-a', 'Graduation', 'graduation', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide');
INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active)
  VALUES ('tt-1', 'event-1', 'org-a', 'GA', 0, 2, true);
INSERT INTO event_registration_questions (id, organisation_id, event_id, label, field_type, required, scope, sort_order)
  VALUES ('oq-1', 'org-a', 'event-1', 'Special requests', 'LONG_TEXT', false, 'ORDER', 0);
INSERT INTO event_registration_questions (id, organisation_id, event_id, label, field_type, required, scope, sort_order)
  VALUES ('aq-1', 'org-a', 'event-1', 'Dietary requirements', 'LONG_TEXT', false, 'ATTENDEE', 0);
-- A question belonging to a DIFFERENT event, used to construct an
-- intentionally invalid response (FK violation) for the rollback proof.
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
  VALUES ('event-other', 'org-a', 'Other Event', 'other-event', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide');
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

# ─── The atomic registration+responses statement, as REAL Postgres SQL ─
# Mirrors, clause-for-clause, exactly what register/route.ts's
# non-session sql.transaction([...]) third statement now submits.
# $1=order_id_prefix (for uniqueness across test runs), $2=purchaser,
# $3=qty, $4=attendee names array literal e.g. "'A','B'",
# $5=ticket tokens array literal e.g. "'tok-a','tok-b'",
# $6=order-question-id array literal (or 'ARRAY[]::text[]'),
# $7=order-answer-json array literal,
# $8=attendee-response ticket_token array literal (repeats per answer),
# $9=attendee-response question-id array literal,
# $10=attendee-response answer-json array literal.
register_with_responses_sql() {
  local purchaser="$1" qty="$2" names="$3" tokens="$4"
  local oq_ids="$5" oq_answers="$6"
  local aq_tokens="$7" aq_ids="$8" aq_answers="$9"
  cat <<SQL
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = 'tt-1' AND organisation_id = 'org-a' FOR UPDATE;
SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED';
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL, 'CONFIRMED', 0
  FROM sold_tt
  WHERE sold_tt.qty + $qty <= (SELECT capacity FROM event_ticket_types WHERE id = 'tt-1' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', 'tt-1', NULL, $qty, 0
  FROM ins_order
  RETURNING id, order_id
),
ins_attendees AS (
  INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email, ticket_token)
  SELECT 'org-a', 'event-1', ins_item.order_id, ins_item.id, a.name, NULL, a.token
  FROM ins_item, UNNEST(ARRAY[$names]::text[], ARRAY[$tokens]::text[]) AS a(name, token)
  RETURNING id, order_id, attendee_name, ticket_token
),
ins_order_responses AS (
  INSERT INTO event_registration_responses
    (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, io.id, NULL, 'snapshot-label', 'LONG_TEXT', r.answer_json::jsonb
  FROM ins_order io, UNNEST(ARRAY[$oq_ids]::text[], ARRAY[$oq_answers]::text[]) AS r(question_id, answer_json)
  RETURNING id
),
ins_attendee_responses AS (
  INSERT INTO event_registration_responses
    (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, ia.order_id, ia.id, 'snapshot-label', 'LONG_TEXT', r.answer_json::jsonb
  FROM ins_attendees ia
  JOIN UNNEST(ARRAY[$aq_tokens]::text[], ARRAY[$aq_ids]::text[], ARRAY[$aq_answers]::text[]) AS r(ticket_token, question_id, answer_json)
    ON r.ticket_token = ia.ticket_token
  RETURNING id
)
SELECT ia.id, ia.order_id, ia.attendee_name, ia.ticket_token
FROM ins_attendees ia
WHERE (SELECT count(*) FROM ins_order_responses) >= 0
  AND (SELECT count(*) FROM ins_attendee_responses) >= 0;
COMMIT;
SQL
}

echo ""
echo "=== BOOTSTRAP ==="
bootstrap
if [ -s "$DIAG_OUT" ] && grep -qi "error" "$DIAG_OUT"; then
  echo "  FAIL: bootstrap"
  cat "$DIAG_OUT"
  exit 2
fi
echo "  bootstrap applied (real create-events.sql + create-events-phase2.sql + add-events-ticketing.sql + add-events-registration-questions.sql)"

echo ""
echo "=== TEST 1: successful atomic write — order-scoped AND attendee-scoped answers for two attendees ==="
sql1=$(register_with_responses_sql \
  "Jane One" 2 \
  "'Alice','Bob'" "'tok-alice','tok-bob'" \
  "'oq-1'" "'\"Window seat please\"'" \
  "'tok-alice','tok-bob'" "'aq-1','aq-1'" "'\"Vegan\"','\"None\"'")
expect_success "1. atomic write with both order- and attendee-scoped responses succeeds" "$sql1"
expect_eq "1b. exactly one order exists" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name = 'Jane One';" "1"
expect_eq "1c. exactly two attendees exist for that order" \
  "SELECT count(*) FROM event_attendees ea JOIN event_orders eo ON eo.id = ea.order_id WHERE eo.purchaser_name = 'Jane One';" "2"
expect_eq "1d. exactly one order-scoped response exists, correctly linked (attendee_id IS NULL)" \
  "SELECT count(*) FROM event_registration_responses r JOIN event_orders eo ON eo.id = r.order_id WHERE eo.purchaser_name = 'Jane One' AND r.question_id = 'oq-1' AND r.attendee_id IS NULL;" "1"
expect_eq "1e. exactly two attendee-scoped responses exist" \
  "SELECT count(*) FROM event_registration_responses r JOIN event_orders eo ON eo.id = r.order_id WHERE eo.purchaser_name = 'Jane One' AND r.question_id = 'aq-1';" "2"
expect_eq "1f. Alice's attendee-scoped answer is correctly hers (not Bob's), correlated via ticket_token join" \
  "SELECT r.answer::text FROM event_registration_responses r JOIN event_attendees ea ON ea.id = r.attendee_id WHERE ea.ticket_token = 'tok-alice' AND r.question_id = 'aq-1';" "\"Vegan\""
expect_eq "1g. Bob's attendee-scoped answer is correctly his, not Alice's" \
  "SELECT r.answer::text FROM event_registration_responses r JOIN event_attendees ea ON ea.id = r.attendee_id WHERE ea.ticket_token = 'tok-bob' AND r.question_id = 'aq-1';" "\"None\""
expect_eq "1h. the response snapshot columns were written (never left NULL)" \
  "SELECT count(*) FROM event_registration_responses r JOIN event_orders eo ON eo.id = r.order_id WHERE eo.purchaser_name = 'Jane One' AND r.question_label_snapshot IS NOT NULL AND r.field_type_snapshot IS NOT NULL;" "3"

echo ""
echo "=== TEST 2: registration with NO submitted responses (empty arrays) still succeeds, zero response rows ==="
# TEST 1 already consumed the seeded capacity=2 — raise it so THIS
# registration is judged purely on its own merits, not rejected by an
# unrelated prior test's capacity consumption.
echo "UPDATE event_ticket_types SET capacity = 100 WHERE id = 'tt-1';" | psql_exec
# Empty PostgreSQL array literals need the bare ARRAY[]::text[] form
# (not an interpolated empty list), so this one is built directly
# rather than via register_with_responses_sql.
sql2=$(cat <<'SQL'
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = 'tt-1' AND organisation_id = 'org-a' FOR UPDATE;
SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED';
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
  SELECT 'org-a', 'event-1', 'No Responses Person', 'p@example.com', NULL, 'CONFIRMED', 0
  FROM sold_tt
  WHERE sold_tt.qty + 1 <= (SELECT capacity FROM event_ticket_types WHERE id = 'tt-1' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', 'tt-1', NULL, 1, 0
  FROM ins_order
  RETURNING id, order_id
),
ins_attendees AS (
  INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email, ticket_token)
  SELECT 'org-a', 'event-1', ins_item.order_id, ins_item.id, a.name, NULL, a.token
  FROM ins_item, UNNEST(ARRAY['Charlie']::text[], ARRAY['tok-charlie']::text[]) AS a(name, token)
  RETURNING id, order_id, attendee_name, ticket_token
),
ins_order_responses AS (
  INSERT INTO event_registration_responses
    (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, io.id, NULL, 'snapshot-label', 'LONG_TEXT', r.answer_json::jsonb
  FROM ins_order io, UNNEST(ARRAY[]::text[], ARRAY[]::text[]) AS r(question_id, answer_json)
  RETURNING id
),
ins_attendee_responses AS (
  INSERT INTO event_registration_responses
    (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, ia.order_id, ia.id, 'snapshot-label', 'LONG_TEXT', r.answer_json::jsonb
  FROM ins_attendees ia
  JOIN UNNEST(ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]) AS r(ticket_token, question_id, answer_json)
    ON r.ticket_token = ia.ticket_token
  RETURNING id
)
SELECT ia.id, ia.order_id, ia.attendee_name, ia.ticket_token
FROM ins_attendees ia
WHERE (SELECT count(*) FROM ins_order_responses) >= 0
  AND (SELECT count(*) FROM ins_attendee_responses) >= 0;
COMMIT;
SQL
)
expect_success "2. registration with zero submitted responses still succeeds" "$sql2"
expect_eq "2b. an order was created" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name = 'No Responses Person';" "1"
expect_eq "2c. zero response rows exist for it" \
  "SELECT count(*) FROM event_registration_responses r JOIN event_orders eo ON eo.id = r.order_id WHERE eo.purchaser_name = 'No Responses Person';" "0"

echo ""
echo "=== TEST 3 (THE CRITICAL PROOF): a response-insert failure rolls back the ENTIRE registration ==="
# Ticket-type capacity is 2; TEST 1 already consumed 2, so this
# registration WOULD be capacity-rejected on its own merits too — reset
# capacity higher first so THIS failure is unambiguously caused by the
# response FK violation, not capacity.
echo "UPDATE event_ticket_types SET capacity = 100 WHERE id = 'tt-1';" | psql_exec
sold_before="$(echo "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id WHERE oi.ticket_type_id='tt-1';" | psql_query | tr -d '[:space:]')"
sql3=$(cat <<'SQL'
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = 'tt-1' AND organisation_id = 'org-a' FOR UPDATE;
SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED';
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
  SELECT 'org-a', 'event-1', 'Doomed Registration', 'p@example.com', NULL, 'CONFIRMED', 0
  FROM sold_tt
  WHERE sold_tt.qty + 1 <= (SELECT capacity FROM event_ticket_types WHERE id = 'tt-1' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', 'tt-1', NULL, 1, 0
  FROM ins_order
  RETURNING id, order_id
),
ins_attendees AS (
  INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email, ticket_token)
  SELECT 'org-a', 'event-1', ins_item.order_id, ins_item.id, a.name, NULL, a.token
  FROM ins_item, UNNEST(ARRAY['Doomed Attendee']::text[], ARRAY['tok-doomed']::text[]) AS a(name, token)
  RETURNING id, order_id, attendee_name, ticket_token
),
ins_order_responses AS (
  -- 'nonexistent-question-id' violates the FK to
  -- event_registration_questions(id, organisation_id) — this is the
  -- forced failure. In real life this exact shape is impossible from
  -- the application (validateSubmittedResponses rejects an unknown
  -- question_id before the transaction even starts) — this harness
  -- deliberately bypasses that application-layer guard to prove the
  -- DATABASE-level atomicity holds even if it somehow didn't.
  INSERT INTO event_registration_responses
    (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, io.id, NULL, 'snapshot-label', 'LONG_TEXT', r.answer_json::jsonb
  FROM ins_order io, UNNEST(ARRAY['nonexistent-question-id']::text[], ARRAY['"broken"']::text[]) AS r(question_id, answer_json)
  RETURNING id
),
ins_attendee_responses AS (
  INSERT INTO event_registration_responses
    (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, ia.order_id, ia.id, 'snapshot-label', 'LONG_TEXT', r.answer_json::jsonb
  FROM ins_attendees ia
  JOIN UNNEST(ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]) AS r(ticket_token, question_id, answer_json)
    ON r.ticket_token = ia.ticket_token
  RETURNING id
)
SELECT ia.id, ia.order_id, ia.attendee_name, ia.ticket_token
FROM ins_attendees ia
WHERE (SELECT count(*) FROM ins_order_responses) >= 0
  AND (SELECT count(*) FROM ins_attendee_responses) >= 0;
COMMIT;
SQL
)
expect_failure "3. a response-insert FK violation correctly aborts the whole statement (not just the response CTE)" "$sql3"
expect_eq "3b. NO order named 'Doomed Registration' exists — order was rolled back" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name = 'Doomed Registration';" "0"
expect_eq "3c. NO attendee named 'Doomed Attendee' exists — attendee was rolled back" \
  "SELECT count(*) FROM event_attendees WHERE attendee_name = 'Doomed Attendee';" "0"
expect_eq "3d. NO response row referencing 'nonexistent-question-id' exists" \
  "SELECT count(*) FROM event_registration_responses WHERE question_id = 'nonexistent-question-id';" "0"
expect_eq "3e. NO ticket_token 'tok-doomed' exists anywhere — no token was ever issued for the rolled-back attendee" \
  "SELECT count(*) FROM event_attendees WHERE ticket_token = 'tok-doomed';" "0"
sold_after="$(echo "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id WHERE oi.ticket_type_id='tt-1';" | psql_query | tr -d '[:space:]')"
if [ "$sold_before" = "$sold_after" ]; then
  echo "  PASS: 3f. capacity is unconsumed by the failed attempt (sold quantity unchanged at $sold_after)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 3f. capacity changed after a rolled-back registration (before=$sold_before, after=$sold_after)"
  FAIL=$((FAIL + 1))
  FAILURES+=("3f. capacity unconsumed by failed attempt")
fi

echo ""
echo "=== TEST 4: the capacity gate itself still works correctly with the response CTEs present ==="
echo "UPDATE event_ticket_types SET capacity = 1 WHERE id = 'tt-1';" | psql_exec
echo "DELETE FROM event_registration_responses;" | psql_exec
echo "DELETE FROM event_order_items; DELETE FROM event_attendees; DELETE FROM event_orders;" | psql_exec
sql4a=$(cat <<'SQL'
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = 'tt-1' AND organisation_id = 'org-a' FOR UPDATE;
SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED';
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
  SELECT 'org-a', 'event-1', 'First Slot', 'p@example.com', NULL, 'CONFIRMED', 0
  FROM sold_tt
  WHERE sold_tt.qty + 1 <= (SELECT capacity FROM event_ticket_types WHERE id = 'tt-1' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', 'tt-1', NULL, 1, 0
  FROM ins_order
  RETURNING id, order_id
),
ins_attendees AS (
  INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email, ticket_token)
  SELECT 'org-a', 'event-1', ins_item.order_id, ins_item.id, a.name, NULL, a.token
  FROM ins_item, UNNEST(ARRAY['First']::text[], ARRAY['tok-first']::text[]) AS a(name, token)
  RETURNING id, order_id, attendee_name, ticket_token
),
ins_order_responses AS (
  INSERT INTO event_registration_responses
    (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, io.id, NULL, 'snapshot-label', 'LONG_TEXT', r.answer_json::jsonb
  FROM ins_order io, UNNEST(ARRAY[]::text[], ARRAY[]::text[]) AS r(question_id, answer_json)
  RETURNING id
),
ins_attendee_responses AS (
  INSERT INTO event_registration_responses
    (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, ia.order_id, ia.id, 'snapshot-label', 'LONG_TEXT', r.answer_json::jsonb
  FROM ins_attendees ia
  JOIN UNNEST(ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]) AS r(ticket_token, question_id, answer_json)
    ON r.ticket_token = ia.ticket_token
  RETURNING id
)
SELECT ia.id, ia.order_id, ia.attendee_name, ia.ticket_token
FROM ins_attendees ia
WHERE (SELECT count(*) FROM ins_order_responses) >= 0
  AND (SELECT count(*) FROM ins_attendee_responses) >= 0;
COMMIT;
SQL
)
expect_success "4a. seed: capacity=1, take the one slot" "$sql4a"
sql4b=$(cat <<'SQL'
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = 'tt-1' AND organisation_id = 'org-a' FOR UPDATE;
SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED';
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
  SELECT 'org-a', 'event-1', 'Second Slot Rejected', 'p@example.com', NULL, 'CONFIRMED', 0
  FROM sold_tt
  WHERE sold_tt.qty + 1 <= (SELECT capacity FROM event_ticket_types WHERE id = 'tt-1' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', 'tt-1', NULL, 1, 0
  FROM ins_order
  RETURNING id, order_id
),
ins_attendees AS (
  INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email, ticket_token)
  SELECT 'org-a', 'event-1', ins_item.order_id, ins_item.id, a.name, NULL, a.token
  FROM ins_item, UNNEST(ARRAY['Second']::text[], ARRAY['tok-second']::text[]) AS a(name, token)
  RETURNING id, order_id, attendee_name, ticket_token
),
ins_order_responses AS (
  INSERT INTO event_registration_responses
    (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, io.id, NULL, 'snapshot-label', 'LONG_TEXT', r.answer_json::jsonb
  FROM ins_order io, UNNEST(ARRAY['oq-1']::text[], ARRAY['"should never be written"']::text[]) AS r(question_id, answer_json)
  RETURNING id
),
ins_attendee_responses AS (
  INSERT INTO event_registration_responses
    (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, ia.order_id, ia.id, 'snapshot-label', 'LONG_TEXT', r.answer_json::jsonb
  FROM ins_attendees ia
  JOIN UNNEST(ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]) AS r(ticket_token, question_id, answer_json)
    ON r.ticket_token = ia.ticket_token
  RETURNING id
)
SELECT ia.id, ia.order_id, ia.attendee_name, ia.ticket_token
FROM ins_attendees ia
WHERE (SELECT count(*) FROM ins_order_responses) >= 0
  AND (SELECT count(*) FROM ins_attendee_responses) >= 0;
COMMIT;
SQL
)
expect_success "4b. capacity-rejected attempt does not error (empty RETURNING, not an exception)" "$sql4b"
expect_eq "4c. capacity-rejected attempt created NO second order" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name = 'Second Slot Rejected';" "0"
expect_eq "4d. and consequently wrote NO order-scoped response either — the response CTE never ran with rows because ins_order/io was empty" \
  "SELECT count(*) FROM event_registration_responses WHERE answer::text = '\"should never be written\"';" "0"

# ─── Reorder — the atomic lock-then-swap statement pair, as REAL SQL ───
# Mirrors, statement-for-statement, exactly what
# app/api/events/[id]/questions/[questionId]/reorder/route.ts's
# sql.transaction([...]) call now submits. $1=question id being moved,
# $2=direction ('up'|'down'), $3=optional SQL injected between the lock
# and swap statements (used only by the forced-blocking concurrency
# proof below).
reorder_sql() {
  local qid="$1" direction="$2" inject="${3:-}"
  cat <<SQL
BEGIN;
SELECT id FROM event_registration_questions
WHERE event_id = 'event-1' AND organisation_id = 'org-a'
  AND scope = (
    SELECT scope FROM event_registration_questions
    WHERE id = '$qid' AND event_id = 'event-1' AND organisation_id = 'org-a'
  )
FOR UPDATE;
$inject
WITH target AS (
  SELECT id, scope, sort_order, created_at
  FROM event_registration_questions
  WHERE id = '$qid' AND event_id = 'event-1' AND organisation_id = 'org-a'
),
ordered AS (
  SELECT
    q.id, q.sort_order,
    LAG(q.id)  OVER (ORDER BY q.sort_order, q.created_at) AS prev_id,
    LAG(q.sort_order)  OVER (ORDER BY q.sort_order, q.created_at) AS prev_sort_order,
    LEAD(q.id) OVER (ORDER BY q.sort_order, q.created_at) AS next_id,
    LEAD(q.sort_order) OVER (ORDER BY q.sort_order, q.created_at) AS next_sort_order
  FROM event_registration_questions q, target t
  WHERE q.event_id = 'event-1' AND q.organisation_id = 'org-a' AND q.scope = t.scope
),
swap AS (
  SELECT
    t.id AS target_id, t.sort_order AS target_sort_order,
    CASE WHEN '$direction' = 'up' THEN o.prev_id ELSE o.next_id END AS neighbor_id,
    CASE WHEN '$direction' = 'up' THEN o.prev_sort_order ELSE o.next_sort_order END AS neighbor_sort_order
  FROM target t
  JOIN ordered o ON o.id = t.id
)
UPDATE event_registration_questions AS q
SET sort_order = CASE WHEN q.id = swap.target_id THEN swap.neighbor_sort_order ELSE swap.target_sort_order END
FROM swap
WHERE swap.neighbor_id IS NOT NULL
  AND q.id IN (swap.target_id, swap.neighbor_id)
  AND q.organisation_id = 'org-a'
  AND q.event_id = 'event-1'
RETURNING q.id, q.sort_order;
COMMIT;
SQL
}

echo ""
echo "=== TEST 5: reorder correctness (single request) ==="
echo "INSERT INTO event_registration_questions (id, organisation_id, event_id, label, field_type, required, scope, sort_order) VALUES ('r1','org-a','event-1','Reorder Q1','SHORT_TEXT',false,'ATTENDEE',0), ('r2','org-a','event-1','Reorder Q2','SHORT_TEXT',false,'ATTENDEE',1), ('r3','org-a','event-1','Reorder Q3','SHORT_TEXT',false,'ATTENDEE',2);" | psql_exec
expect_success "5a. move r2 up — swaps with r1" "$(reorder_sql r2 up)"
expect_eq "5b. r1 is now at sort_order 1" "SELECT sort_order FROM event_registration_questions WHERE id = 'r1';" "1"
expect_eq "5c. r2 is now at sort_order 0" "SELECT sort_order FROM event_registration_questions WHERE id = 'r2';" "0"
expect_eq "5d. r3 (not part of this swap) is untouched at sort_order 2" "SELECT sort_order FROM event_registration_questions WHERE id = 'r3';" "2"
expect_success "5e. move r2 (now at the top) up again — a clean no-op, not an error (empty RETURNING)" "$(reorder_sql r2 up)"
expect_eq "5f. no-op left the ordering unchanged" "SELECT sort_order FROM event_registration_questions WHERE id = 'r2';" "0"
expect_success "5g. move r3 (at the bottom) down — a clean no-op" "$(reorder_sql r3 down)"
expect_eq "5h. no-op left r3 unchanged" "SELECT sort_order FROM event_registration_questions WHERE id = 'r3';" "2"

echo ""
echo "=== TEST 6 (THE CRITICAL CONCURRENCY PROOF): a second reorder cannot use a stale pre-swap neighbor view ==="
# Reset to a known state: r1=0, r2=1, r3=2 (undo test 5's net-zero swaps).
echo "UPDATE event_registration_questions SET sort_order = 0 WHERE id = 'r1'; UPDATE event_registration_questions SET sort_order = 1 WHERE id = 'r2'; UPDATE event_registration_questions SET sort_order = 2 WHERE id = 'r3';" | psql_exec
# A: move r2 up (swap with r1), holding its lock for 2s before swapping.
# B: move r2 down (swap with whatever is CURRENTLY r2's next neighbor),
# started 0.5s later — must block on A's lock, then correctly recompute
# using A's POST-commit state.
#
# Expected correct (lock-respecting) outcome: A swaps r1<->r2 first
# (r1=1, r2=0, r3=2). B then blocks until A commits, sees r2 now at 0
# with next-neighbor r1 (now at 1) — NOT the stale r3 a pre-swap view
# would have picked — and swaps r2<->r1 again, landing back at r1=0,
# r2=1, r3=2 (the two swaps cancel out). If B had used a stale
# snapshot (the bug this fix targets), it would swap r2<->r3 instead,
# producing the WRONG r2=2, r3=1 — easily distinguished below.
sql_a=$(reorder_sql r2 up "SELECT pg_sleep(2);")
sql_b=$(reorder_sql r2 down)
run_concurrent_pair "$sql_a" "$sql_b"
if grep -qi "error" "$OUT_A"; then
  echo "  FAIL: 6a. connection A (reorder r2 up) errored"; cat "$OUT_A"; FAIL=$((FAIL + 1)); FAILURES+=("6a. connection A errored")
else
  echo "  PASS: 6a. connection A (reorder r2 up, forced 2s hold) completed without error"; PASS=$((PASS + 1))
fi
if grep -qi "error" "$OUT_B"; then
  echo "  FAIL: 6b. connection B (reorder r2 down) errored"; cat "$OUT_B"; FAIL=$((FAIL + 1)); FAILURES+=("6b. connection B errored")
else
  echo "  PASS: 6b. connection B (reorder r2 down, started 0.5s after A) completed without error"; PASS=$((PASS + 1))
fi
expect_eq "6c. r1 is back at sort_order 0 — B correctly recomputed its neighbor from A's POST-commit state, not a stale pre-swap view" \
  "SELECT sort_order FROM event_registration_questions WHERE id = 'r1';" "0"
expect_eq "6d. r2 is back at sort_order 1" \
  "SELECT sort_order FROM event_registration_questions WHERE id = 'r2';" "1"
expect_eq "6e. r3 was NEVER touched by either concurrent request — proof B did not swap with r3 (the stale-view bug's exact symptom)" \
  "SELECT sort_order FROM event_registration_questions WHERE id = 'r3';" "2"

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
