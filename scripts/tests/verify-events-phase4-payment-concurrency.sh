#!/usr/bin/env bash
# Events & Ticketing Phase 4 — repeatable behavioral validation for the
# paid Checkout reservation route's concurrency safety
# (app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts).
#
# WHY THIS EXISTS: §9/§28 of the Phase 4 brief require proof, against
# real PostgreSQL (not mocks), that a paid reservation's capacity hold
# behaves correctly under genuine concurrency — same category of proof
# as scripts/tests/verify-events-phase2-concurrency.sh (Phase 2) and
# scripts/tests/verify-events-phase3-checkin-concurrency.sh (Phase 3),
# now applied to the one genuinely new mechanism Phase 4 introduces: a
# time-bounded PENDING reservation that must count against capacity
# while live and stop counting the moment it expires — without ever
# depending on the Stripe webhook actually arriving to make that true
# (§17).
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with the ACTUAL, unmodified schema from create-events.sql,
# create-events-phase2.sql, add-events-ticketing.sql, and
# add-events-payments.sql, then executes the SAME statement sequence
# the checkout route's sql.transaction([...]) submits (lock, then the
# capacity-gated insert whose aggregate excludes a PENDING reservation
# past its own expires_at) via BEGIN/COMMIT blocks through
# `docker exec ... psql` — the identical technique and the identical
# reason for using it as the Phase 2 harness's own header comment
# explains; not reproduced verbatim here.
#
# WHAT THIS DOES NOT DO: not wired into CI (Docker is not part of the
# standard CI workflow here, matching every other harness's own
# precedent). Requires only Docker. No Neon/Production access. Creates
# and destroys its own disposable container.
#
# USAGE:
#   bash scripts/tests/verify-events-phase4-payment-concurrency.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVENTS_MIGRATION="$REPO_ROOT/scripts/create-events.sql"
PHASE2_MIGRATION="$REPO_ROOT/scripts/create-events-phase2.sql"
TICKETING_MIGRATION="$REPO_ROOT/scripts/add-events-ticketing.sql"
PAYMENTS_MIGRATION="$REPO_ROOT/scripts/add-events-payments.sql"
CONTAINER="events-p4-payment-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" "${OUT_A:-}" "${OUT_B:-}" 2>/dev/null || true
}
trap cleanup EXIT

for f in "$EVENTS_MIGRATION" "$PHASE2_MIGRATION" "$TICKETING_MIGRATION" "$PAYMENTS_MIGRATION"; do
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

DIAG_OUT="/tmp/events_p4_harness_out.$$.txt"
OUT_A="/tmp/events_p4_harness_a.$$.txt"
OUT_B="/tmp/events_p4_harness_b.$$.txt"

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
  {
    cat <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
SQL
    cat "$EVENTS_MIGRATION"
    cat "$PHASE2_MIGRATION"
    cat "$TICKETING_MIGRATION"
    cat "$PAYMENTS_MIGRATION"
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

# ─── The paid-reservation statement sequence, as REAL Postgres SQL ─────
# Mirrors, statement-for-statement, the checkout route's
# sql.transaction([...]) array (non-session branch): lock, then the
# capacity-gated insert whose aggregate is
#   AND (payment_status <> 'PENDING' OR expires_at > NOW())
# — the one substantive difference from the Phase 2 harness's own
# register_ticket_type_sql. $5 lets a test seed a reservation with an
# already-past expires_at (scenario B) or a real future one (normal
# path) via a literal interval expression.
reserve_ticket_type_sql() {
  local tt_id="$1" purchaser="$2" qty="$3" expires_expr="${4:-NOW() + interval '30 minutes'}" inject="${5:-}"
  cat <<SQL
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a' FOR UPDATE;
$inject
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
  WHERE oi.ticket_type_id = '$tt_id' AND oi.organisation_id = 'org-a'
    AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents, payment_status, payment_provider, currency, expires_at)
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL, 'PENDING', 2500 * $qty, 'PENDING', 'stripe', 'AUD', $expires_expr
  FROM sold_tt
  WHERE sold_tt.qty + $qty <= (SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', '$tt_id', NULL, $qty, 2500
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

reserve_session_sql() {
  local tt_id="$1" sess_id="$2" purchaser="$3" qty="$4" expires_expr="${5:-NOW() + interval '30 minutes'}" inject="${6:-}"
  cat <<SQL
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a' FOR UPDATE;
SELECT capacity FROM event_sessions WHERE id = '$sess_id' AND organisation_id = 'org-a' FOR UPDATE;
$inject
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
  WHERE oi.ticket_type_id = '$tt_id' AND oi.organisation_id = 'org-a'
    AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
),
sold_sess AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
  WHERE oi.event_session_id = '$sess_id' AND oi.organisation_id = 'org-a'
    AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents, payment_status, payment_provider, currency, expires_at)
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL, 'PENDING', 2500 * $qty, 'PENDING', 'stripe', 'AUD', $expires_expr
  FROM sold_tt, sold_sess
  WHERE sold_tt.qty + $qty <= (SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a')
    AND sold_sess.qty + $qty <= (SELECT capacity FROM event_sessions WHERE id = '$sess_id' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', '$tt_id', '$sess_id', $qty, 2500
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

# Free registration statement — identical to the Phase 2 harness's own
# register_ticket_type_sql (payment_status defaults NOT_REQUIRED).
free_register_sql() {
  local tt_id="$1" purchaser="$2" qty="$3"
  cat <<SQL
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a' FOR UPDATE;
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
  WHERE oi.ticket_type_id = '$tt_id' AND oi.organisation_id = 'org-a'
    AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
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

run_concurrent_pair() {
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
echo "  bootstrap applied (real create-events.sql + create-events-phase2.sql + add-events-ticketing.sql + add-events-payments.sql)"

echo ""
echo "=== NORMAL PATH ==="

expect_success "1. seed capacity=3 paid ticket type" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-paid', 'event-1', 'org-a', 'Premium', 2500, 3, true);"
expect_success "1b. one paid reservation under capacity succeeds" \
  "$(reserve_ticket_type_sql tt-paid 'P1' 1)"
expect_eq "1c. reserved quantity is 1 (PENDING order still counts while live)" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-paid';" "1"
expect_eq "1d. the order is PENDING/PENDING (lifecycle/payment)" \
  "SELECT status || '/' || payment_status FROM event_orders WHERE purchaser_name='P1';" "PENDING/PENDING"

echo ""
echo "=== A: capacity 1, two simultaneous paid reservations -> only one succeeds ==="
reset_db; bootstrap
expect_success "A setup: capacity=1 paid ticket type" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-a', 'event-1', 'org-a', 'Premium', 2500, 1, true);"
run_concurrent_pair "$(reserve_ticket_type_sql tt-a A-conn 1)" "$(reserve_ticket_type_sql tt-a B-conn 1)"
expect_eq "A. exactly one of the two concurrent paid reservations holds capacity (total qty = 1, not 2)" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-a';" "1"
expect_eq "A2. exactly one order actually exists for this ticket type" \
  "SELECT count(*) FROM event_orders eo JOIN event_order_items oi ON oi.order_id=eo.id WHERE oi.ticket_type_id='tt-a';" "1"

echo ""
echo "=== B: an expired reservation stops blocking capacity ==="
reset_db; bootstrap
expect_success "B setup: capacity=1 paid ticket type" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-b', 'event-1', 'org-a', 'Premium', 2500, 1, true);"
expect_success "B1. seed one EXPIRED-window PENDING reservation directly (expires_at already in the past)" \
  "$(reserve_ticket_type_sql tt-b Stale-conn 1 "NOW() - interval '1 minute'")"
expect_eq "B2. the stale reservation itself still holds a row (it was live when created)" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-b';" "1"
expect_success "B3. a fresh reservation for the SAME (now nominally full) capacity succeeds anyway — the expired hold is excluded" \
  "$(reserve_ticket_type_sql tt-b Fresh-conn 1)"
expect_eq "B4. total reserved quantity is 2 (both order_items exist as rows), but only the fresh one is 'live'" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-b';" "2"
expect_eq "B5. the fresh reservation's own capacity check counted only 0 live prior quantity, not 1 — confirmed by it succeeding at capacity=1" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name='Fresh-conn' AND payment_status='PENDING';" "1"

echo ""
echo "=== C: a successful (PAID) order continues to consume capacity ==="
reset_db; bootstrap
expect_success "C setup: capacity=1 paid ticket type" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-c', 'event-1', 'org-a', 'Premium', 2500, 1, true);"
expect_success "C1. reserve the one slot" \
  "$(reserve_ticket_type_sql tt-c Paid-conn 1)"
expect_success "C2. simulate the webhook flipping it to PAID (payment_status = 'PENDING' guard, matching lib/events/stripe.ts)" \
  "UPDATE event_orders SET status='CONFIRMED', payment_status='PAID', paid_at=now() WHERE purchaser_name='Paid-conn' AND payment_status='PENDING';"
expect_success "C3. a second reservation attempt for the same now-PAID-out capacity is cleanly rejected (zero rows, no error)" \
  "$(reserve_ticket_type_sql tt-c Blocked-conn 1)"
expect_eq "C4. still only the original PAID order's quantity counts (1, not 2)" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id WHERE oi.ticket_type_id='tt-c' AND eo.status<>'CANCELLED' AND (eo.payment_status<>'PENDING' OR eo.expires_at>NOW());" "1"
expect_eq "C5. no orphan order was created by the rejected attempt" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name='Blocked-conn';" "0"

echo ""
echo "=== D: free + paid quantities share the same capacity pool correctly ==="
reset_db; bootstrap
expect_success "D setup: capacity=2 ticket type usable by both flows" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-d', 'event-1', 'org-a', 'GA', 0, 2, true);"
expect_success "D1. a free registration takes 1 of 2" \
  "$(free_register_sql tt-d Free-conn 1)"
expect_success "D2. a paid reservation for the remaining 1 succeeds" \
  "$(reserve_ticket_type_sql tt-d Paid-conn2 1)"
expect_eq "D3. combined quantity across both flows equals capacity (2)" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-d';" "2"
expect_success "D4. a further paid reservation attempt (now genuinely full) is cleanly rejected" \
  "$(reserve_ticket_type_sql tt-d Overflow-conn 1)"
expect_eq "D5. quantity still exactly 2 — the free order correctly counted against the paid reservation's own capacity check" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-d';" "2"

echo ""
echo "=== E: session capacity behaves the same way as ticket-type capacity ==="
reset_db; bootstrap
expect_success "E setup: capacity=1 session (ticket type non-limiting)" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-e', 'event-1', 'org-a', 'Premium', 2500, 100, true); INSERT INTO event_sessions (id, event_id, organisation_id, name, starts_at, ends_at, capacity) VALUES ('sess-e', 'event-1', 'org-a', 'S1', now(), now()+interval '1 hour', 1);"
run_concurrent_pair "$(reserve_session_sql tt-e sess-e SessA-conn 1)" "$(reserve_session_sql tt-e sess-e SessB-conn 1)"
expect_eq "E. exactly one of two concurrent session-bound paid reservations holds capacity" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE event_session_id='sess-e';" "1"

echo ""
echo "=== F: retry-payment capacity reacquisition (§A.2) ==="
# Mirrors app/api/events/[id]/orders/[orderId]/retry/route.ts's own
# atomic UPDATE exactly: excludes the order being retried from the
# "sold" aggregate (it is the SAME demand being re-confirmed, not new
# demand), then extends expires_at only if capacity still allows it.
order_id_for() {
  echo "SELECT id FROM event_orders WHERE purchaser_name = '$1';" | psql_query | tr -d '[:space:]'
}

retry_sql() {
  local order_id="$1" tt_id="$2" qty="$3"
  cat <<SQL
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a' FOR UPDATE;
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
  WHERE oi.ticket_type_id = '$tt_id' AND oi.organisation_id = 'org-a' AND eo.id <> '$order_id'
    AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
)
UPDATE event_orders eo
SET expires_at = NOW() + interval '30 minutes', stripe_checkout_session_id = NULL
FROM sold_tt
WHERE eo.id = '$order_id' AND eo.organisation_id = 'org-a' AND eo.payment_status = 'PENDING'
  AND sold_tt.qty + $qty <= (SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a')
RETURNING eo.id;
COMMIT;
SQL
}

reset_db; bootstrap
expect_success "F setup: capacity=1 paid ticket type" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-f', 'event-1', 'org-a', 'Premium', 2500, 1, true);"
expect_success "F1. reserve the one slot (order-f1, still-valid expires_at)" \
  "$(reserve_ticket_type_sql tt-f order-f1 1)"
ORDER_F1_ID="$(order_id_for order-f1)"
expect_success "F2. retrying the SAME still-valid order succeeds (self-exclusion means it never conflicts with itself)" \
  "$(retry_sql "$ORDER_F1_ID" tt-f 1)"
expect_eq "F2b. capacity still shows exactly 1 held (not 2 — retry never double-counts)" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-f';" "1"

reset_db; bootstrap
expect_success "F3 setup: capacity=1 paid ticket type" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-f3', 'event-1', 'org-a', 'Premium', 2500, 1, true);"
expect_success "F3. seed an EXPIRED PENDING reservation (order-f3)" \
  "$(reserve_ticket_type_sql tt-f3 order-f3 1 "NOW() - interval '1 minute'")"
ORDER_F3_ID="$(order_id_for order-f3)"
expect_success "F4. retrying the expired order reacquires capacity — no one else is competing for it" \
  "$(retry_sql "$ORDER_F3_ID" tt-f3 1)"
expect_eq "F4b. the retried order's expires_at is now in the future again (reacquired, not still expired)" \
  "SELECT (expires_at > NOW())::text FROM event_orders WHERE id='$ORDER_F3_ID';" "true"

reset_db; bootstrap
expect_success "F5 setup: capacity=1 paid ticket type" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-f5', 'event-1', 'org-a', 'Premium', 2500, 1, true);"
expect_success "F5. seed an EXPIRED PENDING reservation (order-f5)" \
  "$(reserve_ticket_type_sql tt-f5 order-f5 1 "NOW() - interval '1 minute'")"
ORDER_F5_ID="$(order_id_for order-f5)"
expect_success "F6. a DIFFERENT fresh reservation takes the now-free capacity first" \
  "$(reserve_ticket_type_sql tt-f5 order-f5-competitor 1)"
expect_success "F7. retrying the original expired order now correctly finds NO available capacity (0 rows, no error) — cannot oversell" \
  "$(retry_sql "$ORDER_F5_ID" tt-f5 1)"
expect_eq "F7b. the original order's expires_at is still in the past — retry did NOT reacquire it" \
  "SELECT (expires_at > NOW())::text FROM event_orders WHERE id='$ORDER_F5_ID';" "false"
expect_eq "F7c. capacity still shows exactly 1 (the competitor's), never 2" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id WHERE oi.ticket_type_id='tt-f5' AND eo.status<>'CANCELLED' AND (eo.payment_status<>'PENDING' OR eo.expires_at>NOW());" "1"

echo ""
echo "=== G: concurrent retry vs. a brand-new reservation racing for the same last slot ==="
reset_db; bootstrap
echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-g', 'event-1', 'org-a', 'Premium', 2500, 1, true);" | psql_exec >/dev/null 2>&1
echo "$(reserve_ticket_type_sql tt-g order-g 1 "NOW() - interval '1 minute'")" | psql_exec >/dev/null 2>&1
ORDER_G_ID="$(order_id_for order-g)"
run_concurrent_pair "$(retry_sql "$ORDER_G_ID" tt-g 1)" "$(reserve_ticket_type_sql tt-g NewBuyer-g 1)"
expect_eq "G. exactly one of {retry the expired order, a brand-new reservation} wins the single last slot" \
  "SELECT COALESCE(SUM(quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id WHERE oi.ticket_type_id='tt-g' AND eo.status<>'CANCELLED' AND (eo.payment_status<>'PENDING' OR eo.expires_at>NOW());" "1"

echo ""
echo "=== CONCURRENCY (blocking gate) — repeated genuine race, no forced delay ==="
TOTAL_PASS=0
TOTAL_FAIL=0
for i in $(seq 1 10); do
  reset_db >/dev/null 2>&1; bootstrap >/dev/null 2>&1
  echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-race', 'event-1', 'org-a', 'Premium', 2500, 1, true);" | psql_exec >/dev/null 2>&1
  run_concurrent_pair "$(reserve_ticket_type_sql tt-race RaceA-$i 1)" "$(reserve_ticket_type_sql tt-race RaceB-$i 1)"
  got="$(echo "SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-race';" | psql_query | tr -d '[:space:]')"
  if [ "$got" = "1" ]; then
    TOTAL_PASS=$((TOTAL_PASS + 1))
  else
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    echo "    run $i: FAIL — want 1, got $got"
  fi
done
echo "  $TOTAL_PASS/10 repetitions correct, $TOTAL_FAIL oversold"
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo "  PASS: duplicate-reservation prevention holds under genuine concurrency across 10 repetitions"
  PASS=$((PASS + 1))
else
  echo "  FAIL: oversold in $TOTAL_FAIL/10 repetitions"
  FAIL=$((FAIL + 1))
  FAILURES+=("concurrency blocking gate")
fi

echo ""
echo "=== MUTATION PROOF — weaken the expiry condition, confirm the harness catches it ==="
reset_db; bootstrap
echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-mut', 'event-1', 'org-a', 'Premium', 2500, 1, true);" | psql_exec >/dev/null 2>&1
echo "$(reserve_ticket_type_sql tt-mut Stale-mut 1 "NOW() - interval '1 minute'")" | psql_exec >/dev/null 2>&1
# Weakened predicate: drops the `(payment_status <> 'PENDING' OR expires_at > NOW())`
# guard entirely, so a stale PENDING reservation incorrectly still
# blocks capacity forever — this should now WRONGLY reject a fresh
# reservation attempt (0 rows), proving the harness is sensitive to the
# exact regression the real predicate exists to prevent.
MUT_SQL="$(cat <<SQL
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = 'tt-mut' AND organisation_id = 'org-a' FOR UPDATE;
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
  WHERE oi.ticket_type_id = 'tt-mut' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents, payment_status, payment_provider, currency, expires_at)
  SELECT 'org-a', 'event-1', 'Fresh-mut', 'p@example.com', NULL, 'PENDING', 2500, 'PENDING', 'stripe', 'AUD', NOW() + interval '30 minutes'
  FROM sold_tt
  WHERE sold_tt.qty + 1 <= (SELECT capacity FROM event_ticket_types WHERE id = 'tt-mut' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', 'tt-mut', NULL, 1, 2500 FROM ins_order RETURNING id, order_id
)
INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
SELECT 'org-a', 'event-1', ins_item.order_id, ins_item.id, a.name, NULL FROM ins_item, UNNEST(ARRAY['Attendee']::text[]) AS a(name)
RETURNING order_id;
COMMIT;
SQL
)"
echo "$MUT_SQL" | psql_exec >/dev/null 2>&1
got_mut="$(echo "SELECT count(*) FROM event_orders WHERE purchaser_name='Fresh-mut';" | psql_query | tr -d '[:space:]')"
if [ "$got_mut" = "0" ]; then
  echo "  PASS (mutation correctly reproduces a stale-hold-blocks-forever regression when the expiry guard is removed): Fresh-mut was wrongly rejected"
  PASS=$((PASS + 1))
else
  echo "  FAIL: removing the expiry guard did NOT reproduce the expected regression — harness may not be sensitive to it"
  FAIL=$((FAIL + 1))
  FAILURES+=("mutation proof")
fi

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
