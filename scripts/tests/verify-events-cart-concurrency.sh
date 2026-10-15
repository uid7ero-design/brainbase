#!/usr/bin/env bash
# Events & Ticketing Phase 2 (multi-ticket-type orders / carts) —
# repeatable behavioural validation, against REAL PostgreSQL 16, of the
# capacity-gated cart reservation shared by:
#   lib/events/services/paidCheckout.ts     (paid cart reservation)
#   lib/events/services/freeRegistration.ts (free cart registration)
#   lib/events/services/retryCheckout.ts    (whole-order retry reacquisition)
# with lock statements from lib/events/services/cart.ts
# (buildCartLockStatements / cartLockOrder).
#
# WHY THIS EXISTS: a cart reserves several ticket types at once. Mocked
# SQL has no locks and no MVCC, so it cannot prove any of:
#   A. two concurrent carts competing for the same ticket type never oversell
#   B. carts overlapping on one of several ticket types stay correct
#   C. a cart where one type is sold out fails ENTIRELY (no partial rows)
#   D. session capacity is enforced against the COMBINED cart quantity
#   E. stale (expired) PENDING paid holds do not falsely consume capacity
#   F. the deterministic lock order (ascending ticket_type_id, then the
#      session) prevents deadlock between carts that list the same types
#      in opposite orders — with a MUTATION PROOF showing the harness
#      detects a real deadlock when locks are taken in cart order instead
#   G. a free cart uses the same gate (all-or-nothing, shared capacity pool)
#   R. whole-order retry reacquisition re-checks every line and the session,
#      and two concurrent retries of the same order cannot both win
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with the ACTUAL, unmodified Events migration files, then runs SQL that
# mirrors, statement-for-statement, each service's sql.transaction([...])
# array: one `SELECT ... FOR UPDATE` per ticket type in ascending id order
# (LC_ALL=C byte order — identical to cartLockOrder's code-unit order for
# these ASCII ids), then the session lock (if any), then the single
# capacity-gated statement. `inject` places pg_sleep() between the first
# lock and the rest so two connections genuinely interleave.
#
# Usage: bash scripts/tests/verify-events-cart-concurrency.sh
# Exit 0 = all checks passed; 1 = at least one failed; 2 = harness error.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS=(
  "$REPO_ROOT/scripts/create-events.sql"
  "$REPO_ROOT/scripts/create-events-phase2.sql"
  "$REPO_ROOT/scripts/add-events-ticketing.sql"
  "$REPO_ROOT/scripts/add-events-payments.sql"
  "$REPO_ROOT/scripts/add-events-registration-questions.sql"
  "$REPO_ROOT/scripts/add-events-booking-wallet.sql"
  "$REPO_ROOT/scripts/add-events-ticket-email-delivery.sql"
  "$REPO_ROOT/scripts/create-events-ticket-type-session-inventory.sql"
)
CONTAINER="events-cart-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" "${OUT_A:-}" "${OUT_B:-}" 2>/dev/null || true
}
trap cleanup EXIT

for f in "${MIGRATIONS[@]}"; do
  if [ ! -f "$f" ]; then echo "ERROR: migration file not found: $f" >&2; exit 2; fi
done
if ! command -v docker >/dev/null 2>&1; then echo "ERROR: docker is required to run this harness." >&2; exit 2; fi

echo "Starting disposable postgres:16-alpine ($CONTAINER)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine >/dev/null
READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then echo "ERROR: postgres in $CONTAINER did not become ready within 30s." >&2; exit 2; fi

DIAG_OUT="$(mktemp)"
OUT_A="$(mktemp)"
OUT_B="$(mktemp)"

psql_exec() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1; }
psql_query() { docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1; }
reset_db() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "DROP DATABASE IF EXISTS testdb;" >/dev/null 2>&1
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "CREATE DATABASE testdb;" >/dev/null 2>&1
}
# Portable UUID (Linux /proc, uuidgen, or /dev/urandom via od) so the
# harness runs unchanged on Linux CI and on Windows Git Bash.
gen_uuid() {
  if [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then uuidgen
  else od -An -N16 -tx1 /dev/urandom | tr -d ' \n' | sed -E 's/^(.{8})(.{4})(.{4})(.{4})(.{12})$/\1-\2-\3-\4-\5/'
  fi
}
bootstrap() {
  {
    cat <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
SQL
    for f in "${MIGRATIONS[@]}"; do cat "$f"; echo; done
    cat <<'SQL'
INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a');
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
  VALUES ('event-1', 'org-a', 'Gala', 'gala', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide');
SQL
  } | psql_exec || { echo "ERROR: bootstrap failed:" >&2; cat "$DIAG_OUT" >&2; exit 2; }
}

expect_success() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then echo "  PASS: $desc"; PASS=$((PASS + 1))
  else echo "  FAIL (expected success, got error): $desc"; sed 's/^/    /' "$DIAG_OUT"; FAIL=$((FAIL + 1)); FAILURES+=("$desc"); fi
}
expect_eq() {
  local desc="$1" sql="$2" want="$3" got
  got="$(echo "$sql" | psql_query | tr -d '[:space:]')"
  if [ "$got" = "$want" ]; then echo "  PASS: $desc (got $got)"; PASS=$((PASS + 1))
  else echo "  FAIL: $desc (want $want, got $got)"; FAIL=$((FAIL + 1)); FAILURES+=("$desc"); fi
}
expect_val() {
  local desc="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then echo "  PASS: $desc (got $got)"; PASS=$((PASS + 1))
  else echo "  FAIL: $desc (want $want, got $got)"; FAIL=$((FAIL + 1)); FAILURES+=("$desc"); fi
}
expect_true() {
  local desc="$1" cond="$2"
  if eval "$cond"; then echo "  PASS: $desc"; PASS=$((PASS + 1))
  else echo "  FAIL: $desc"; FAIL=$((FAIL + 1)); FAILURES+=("$desc"); fi
}

seed_type() { # id price capacity
  echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('$1', 'event-1', 'org-a', '$1', $2, $3, true);" | psql_exec
}
seed_session() { # id capacity
  echo "INSERT INTO event_sessions (id, event_id, organisation_id, name, starts_at, ends_at, capacity) VALUES ('$1', 'event-1', 'org-a', '$1', now(), now() + interval '1 hour', $2);" | psql_exec
}

# Builds SQL array literals for a cart from "type:qty" args.
# Sets: LINE_IDS LINE_QTYS LINE_PRICES (paid prices looked up by caller via PRICE_<id>) ATT_IDS ATT_TYPES ATT_NAMES TOTAL_QTY LOCK_IDS
build_cart() {
  local line id qty i n
  local ids=() qtys=() prices=() att_ids=() att_types=() att_names=()
  TOTAL_QTY=0
  for line in "$@"; do
    id="${line%%:*}"; qty="${line##*:}"
    ids+=("'$id'"); qtys+=("$qty")
    local pvar="PRICE_${id//-/_}"; prices+=("${!pvar:-0}")
    for ((i = 0; i < qty; i++)); do
      att_ids+=("'$(gen_uuid)'")
      att_types+=("'$id'")
      att_names+=("'A-$id-$i'")
    done
    TOTAL_QTY=$((TOTAL_QTY + qty))
  done
  LINE_IDS="ARRAY[$(IFS=,; echo "${ids[*]}")]::text[]"
  LINE_QTYS="ARRAY[$(IFS=,; echo "${qtys[*]}")]::int[]"
  LINE_PRICES="ARRAY[$(IFS=,; echo "${prices[*]}")]::int[]"
  ATT_IDS="ARRAY[$(IFS=,; echo "${att_ids[*]}")]::text[]"
  ATT_TYPES="ARRAY[$(IFS=,; echo "${att_types[*]}")]::text[]"
  ATT_NAMES="ARRAY[$(IFS=,; echo "${att_names[*]}")]::text[]"
  N_LINES=${#ids[@]}
  # Ascending ticket_type_id, byte order (== cartLockOrder for ASCII ids).
  LOCK_IDS="$(for line in "$@"; do echo "${line%%:*}"; done | LC_ALL=C sort)"
  TOTAL_CENTS=0
  for ((n = 0; n < ${#qtys[@]}; n++)); do TOTAL_CENTS=$((TOTAL_CENTS + qtys[n] * prices[n])); done
}

# lock statements: per type in LOCK_IDS order (or $UNSORTED_LOCKS cart
# order for the mutation proof), then (session-bound only, Phase 3) per
# type's (type, session) inventory row in the same order, then session.
# inject after the FIRST lock.
lock_sql() {
  local sess="$1" inject="$2" order="$3" first=1 id
  for id in $order; do
    echo "SELECT capacity FROM event_ticket_types WHERE id = '$id' AND organisation_id = 'org-a' FOR UPDATE;"
    if [ "$first" -eq 1 ] && [ -n "$inject" ]; then echo "$inject"; fi
    first=0
  done
  if [ -n "$sess" ]; then
    for id in $order; do
      echo "SELECT capacity FROM event_ticket_type_session_inventory WHERE ticket_type_id = '$id' AND event_session_id = '$sess' AND organisation_id = 'org-a' FOR UPDATE;"
    done
    echo "SELECT capacity FROM event_sessions WHERE id = '$sess' AND organisation_id = 'org-a' FOR UPDATE;"
  fi
}

sess_lit() { if [ -n "$1" ]; then echo "'$1'"; else echo "NULL"; fi; }

# Mirrors lib/events/services/paidCheckout.ts's transaction.
# args: purchaser session expires_expr inject lines...
paid_cart_sql() {
  local purchaser="$1" sess="$2" expires_expr="$3" inject="$4"; shift 4
  build_cart "$@"
  local order="${LOCK_ORDER_OVERRIDE:-$LOCK_IDS}" s; s="$(sess_lit "$sess")"
  cat <<SQL
BEGIN;
$(lock_sql "$sess" "$inject" "$order")
WITH cart AS (
  SELECT c.ticket_type_id, c.quantity, c.unit_price_cents
  FROM UNNEST($LINE_IDS, $LINE_QTYS, $LINE_PRICES) AS c(ticket_type_id, quantity, unit_price_cents)
),
cart_tt AS (
  SELECT c.ticket_type_id, c.quantity, COALESCE(inv.capacity, tt.capacity) AS capacity,
    (
      SELECT COALESCE(SUM(oi.quantity), 0)
      FROM event_order_items oi
      JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
      WHERE oi.ticket_type_id = c.ticket_type_id AND oi.organisation_id = 'org-a'
        AND (inv.id IS NULL OR oi.event_session_id = $s)
        AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
    ) AS sold
  FROM cart c
  JOIN event_ticket_types tt ON tt.id = c.ticket_type_id AND tt.organisation_id = 'org-a'
  LEFT JOIN event_ticket_type_session_inventory inv
    ON inv.ticket_type_id = c.ticket_type_id AND inv.event_session_id = $s AND inv.organisation_id = 'org-a'
),
sold_sess AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty
  FROM event_order_items oi
  JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
  WHERE oi.event_session_id = $s AND oi.organisation_id = 'org-a'
    AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
),
gate AS (
  SELECT 1 AS ok
  FROM sold_sess
  WHERE (SELECT count(*) FROM cart_tt) = $N_LINES
    AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)
    AND (
      $s::text IS NULL
      OR sold_sess.qty + $TOTAL_QTY <= (SELECT capacity FROM event_sessions WHERE id = $s AND organisation_id = 'org-a')
    )
),
ins_order AS (
  INSERT INTO event_orders (
    organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone,
    status, total_cents, payment_status, payment_provider, currency, expires_at
  )
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL,
    'PENDING', $TOTAL_CENTS, 'PENDING', 'stripe', 'AUD', $expires_expr
  FROM gate
  RETURNING id
),
ins_items AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', cart.ticket_type_id, $s, cart.quantity, cart.unit_price_cents
  FROM ins_order, cart
  RETURNING id, order_id, ticket_type_id
)
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
SELECT a.id, 'org-a', 'event-1', ii.order_id, ii.id, a.name, NULL
FROM ins_items ii
JOIN UNNEST($ATT_IDS, $ATT_TYPES, $ATT_NAMES) AS a(id, ticket_type_id, name)
  ON a.ticket_type_id = ii.ticket_type_id
RETURNING id, order_id;
COMMIT;
SQL
}

# Mirrors lib/events/services/freeRegistration.ts's transaction
# (responses CTEs included, with empty answer arrays).
free_cart_sql() {
  local purchaser="$1" sess="$2" inject="$3"; shift 3
  build_cart "$@"
  local s; s="$(sess_lit "$sess")"
  local tokens; tokens="ARRAY[$(n=$TOTAL_QTY; for ((i=0;i<n;i++)); do printf "%s'%s'" "$([ $i -gt 0 ] && echo ,)" "$(gen_uuid)"; done)]::text[]"
  cat <<SQL
BEGIN;
$(lock_sql "$sess" "$inject" "$LOCK_IDS")
WITH cart AS (
  SELECT c.ticket_type_id, c.quantity
  FROM UNNEST($LINE_IDS, $LINE_QTYS) AS c(ticket_type_id, quantity)
),
cart_tt AS (
  SELECT c.ticket_type_id, c.quantity, COALESCE(inv.capacity, tt.capacity) AS capacity,
    (
      SELECT COALESCE(SUM(oi.quantity), 0)
      FROM event_order_items oi
      JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
      WHERE oi.ticket_type_id = c.ticket_type_id AND oi.organisation_id = 'org-a'
        AND (inv.id IS NULL OR oi.event_session_id = $s)
        AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
    ) AS sold
  FROM cart c
  JOIN event_ticket_types tt ON tt.id = c.ticket_type_id AND tt.organisation_id = 'org-a'
  LEFT JOIN event_ticket_type_session_inventory inv
    ON inv.ticket_type_id = c.ticket_type_id AND inv.event_session_id = $s AND inv.organisation_id = 'org-a'
),
sold_sess AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty
  FROM event_order_items oi
  JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
  WHERE oi.event_session_id = $s AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
),
gate AS (
  SELECT 1 AS ok
  FROM sold_sess
  WHERE (SELECT count(*) FROM cart_tt) = $N_LINES
    AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)
    AND (
      $s::text IS NULL
      OR sold_sess.qty + $TOTAL_QTY <= (SELECT capacity FROM event_sessions WHERE id = $s AND organisation_id = 'org-a')
    )
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents, booking_token, ticket_email_status)
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL, 'CONFIRMED', 0, md5(random()::text) || md5(random()::text), 'pending'
  FROM gate
  RETURNING id
),
ins_items AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', cart.ticket_type_id, $s, cart.quantity, 0
  FROM ins_order, cart
  RETURNING id, order_id, ticket_type_id
),
ins_attendees AS (
  INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email, ticket_token)
  SELECT 'org-a', 'event-1', ii.order_id, ii.id, a.name, NULL, a.token
  FROM ins_items ii
  JOIN UNNEST($ATT_TYPES, $ATT_NAMES, $tokens)
    AS a(ticket_type_id, name, token)
    ON a.ticket_type_id = ii.ticket_type_id
  RETURNING id, order_id, attendee_name, ticket_token
),
ins_order_responses AS (
  INSERT INTO event_registration_responses
    (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, io.id, NULL, r.label, r.field_type, r.answer_json::jsonb
  FROM ins_order io, UNNEST(ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[])
    AS r(question_id, label, field_type, answer_json)
  RETURNING id
)
SELECT ia.id, ia.order_id
FROM ins_attendees ia
JOIN UNNEST($tokens) WITH ORDINALITY AS t(token, ord) ON t.token = ia.ticket_token
WHERE (SELECT count(*) FROM ins_order_responses) >= 0
ORDER BY t.ord;
COMMIT;
SQL
}

# Mirrors lib/events/services/retryCheckout.ts's reacquisition.
# args: order_purchaser session verified_session_literal verified_expires_literal inject
retry_sql() {
  local purchaser="$1" sess="$2" vsess="$3" vexp="$4" inject="$5"
  local order_id types qtys total
  order_id="$(echo "SELECT id FROM event_orders WHERE purchaser_name='$purchaser';" | psql_query | tr -d '[:space:]')"
  types="$(echo "SELECT ticket_type_id FROM event_order_items WHERE order_id='$order_id' ORDER BY created_at, id;" | psql_query)"
  local ids_arr qty_arr
  ids_arr="ARRAY[$(echo "SELECT string_agg(quote_literal(ticket_type_id), ',' ORDER BY created_at, id) FROM event_order_items WHERE order_id='$order_id';" | psql_query)]::text[]"
  qty_arr="ARRAY[$(echo "SELECT string_agg(quantity::text, ',' ORDER BY created_at, id) FROM event_order_items WHERE order_id='$order_id';" | psql_query)]::int[]"
  total="$(echo "SELECT SUM(quantity) FROM event_order_items WHERE order_id='$order_id';" | psql_query | tr -d '[:space:]')"
  local n; n="$(echo "$types" | grep -c .)"
  local s; s="$(sess_lit "$sess")"
  cat <<SQL
BEGIN;
$(lock_sql "$sess" "$inject" "$(echo "$types" | LC_ALL=C sort)")
WITH cart AS (
  SELECT c.ticket_type_id, c.quantity
  FROM UNNEST($ids_arr, $qty_arr) AS c(ticket_type_id, quantity)
),
cart_tt AS (
  SELECT c.ticket_type_id, c.quantity, COALESCE(inv.capacity, tt.capacity) AS capacity,
    (
      SELECT COALESCE(SUM(oi.quantity), 0) FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
      WHERE oi.ticket_type_id = c.ticket_type_id AND oi.organisation_id = 'org-a' AND eo.id <> '$order_id'
        AND (inv.id IS NULL OR oi.event_session_id = $s)
        AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
    ) AS sold
  FROM cart c
  JOIN event_ticket_types tt ON tt.id = c.ticket_type_id AND tt.organisation_id = 'org-a'
  LEFT JOIN event_ticket_type_session_inventory inv
    ON inv.ticket_type_id = c.ticket_type_id AND inv.event_session_id = $s AND inv.organisation_id = 'org-a'
),
sold_sess AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
  WHERE oi.event_session_id = $s AND oi.organisation_id = 'org-a' AND eo.id <> '$order_id'
    AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
)
UPDATE event_orders eo
SET expires_at = NOW() + make_interval(secs => 1860), stripe_checkout_session_id = NULL
FROM sold_sess
WHERE eo.id = '$order_id' AND eo.organisation_id = 'org-a' AND eo.payment_status = 'PENDING'
  AND eo.stripe_checkout_session_id IS NOT DISTINCT FROM $vsess
  AND eo.expires_at IS NOT DISTINCT FROM $vexp
  AND (SELECT count(*) FROM cart_tt) = $n
  AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)
  AND (
    $s::text IS NULL
    OR sold_sess.qty + $total <= (SELECT capacity FROM event_sessions WHERE id = $s AND organisation_id = 'org-a')
  )
RETURNING eo.id, eo.expires_at;
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
  wait "$pid_a" || true
  wait "$pid_b" || true
}

live_qty() { # ticket type -> live sold quantity
  echo "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id WHERE oi.ticket_type_id='$1' AND eo.status<>'CANCELLED' AND (eo.payment_status<>'PENDING' OR eo.expires_at>NOW());"
}
LIVE="NOW() + interval '30 minutes'"
PRICE_tt_adult=2500; PRICE_tt_child=1500; PRICE_tt_vip=9900; PRICE_tt_x=1000; PRICE_tt_y=1000; PRICE_tt_z=1000

echo ""
echo "=== NORMAL PATH: 2 Adult + 2 Child + 1 VIP in one paid order ==="
reset_db; bootstrap
seed_type tt-adult 2500 10; seed_type tt-child 1500 10; seed_type tt-vip 9900 2
expect_success "N1. the 3-line cart reserves in one transaction" "$(paid_cart_sql Family '' "$LIVE" '' tt-adult:2 tt-child:2 tt-vip:1)"
expect_eq "N2. exactly one order" "SELECT count(*) FROM event_orders;" "1"
expect_eq "N3. three order items, one per ticket type" "SELECT string_agg(ticket_type_id||'='||quantity||'@'||unit_price_cents, ',' ORDER BY ticket_type_id) FROM event_order_items;" "tt-adult=2@2500,tt-child=2@1500,tt-vip=1@9900"
expect_eq "N4. five attendees" "SELECT count(*) FROM event_attendees;" "5"
expect_eq "N5. every attendee is attached to the order item of its own ticket type" \
  "SELECT count(*) FROM event_attendees ea JOIN event_order_items oi ON oi.id=ea.order_item_id WHERE ea.attendee_name NOT LIKE 'A-'||oi.ticket_type_id||'-%';" "0"
expect_eq "N6. per-item attendee counts equal item quantities" \
  "SELECT count(*) FROM event_order_items oi WHERE oi.quantity <> (SELECT count(*) FROM event_attendees ea WHERE ea.order_item_id=oi.id);" "0"
expect_eq "N7. order total equals the sum of the lines (2*2500 + 2*1500 + 9900)" "SELECT total_cents FROM event_orders;" "17900"
expect_eq "N8. every row carries the same organisation (composite tenant FKs accepted every insert)" \
  "SELECT count(DISTINCT organisation_id) FROM (SELECT organisation_id FROM event_orders UNION ALL SELECT organisation_id FROM event_order_items UNION ALL SELECT organisation_id FROM event_attendees) t;" "1"

echo ""
echo "=== A: two concurrent carts competing for the same ticket type ==="
reset_db; bootstrap
seed_type tt-x 1000 3; seed_type tt-y 1000 10
run_concurrent_pair \
  "$(paid_cart_sql A-cart '' "$LIVE" 'SELECT pg_sleep(1.5);' tt-x:2 tt-y:1)" \
  "$(paid_cart_sql B-cart '' "$LIVE" '' tt-x:2 tt-y:1)"
expect_eq "A1. tt-x (capacity 3) never oversold by two 2-ticket carts" "$(live_qty tt-x)" "2"
expect_eq "A2. exactly one of the two carts exists" "SELECT count(*) FROM event_orders;" "1"
expect_eq "A3. the losing cart left no rows at all (its tt-y line was not reserved either)" "$(live_qty tt-y)" "1"

echo ""
echo "=== B: carts overlapping on one of several ticket types ==="
reset_db; bootstrap
seed_type tt-x 1000 10; seed_type tt-y 1000 1; seed_type tt-z 1000 10
run_concurrent_pair \
  "$(paid_cart_sql B1-cart '' "$LIVE" 'SELECT pg_sleep(1.5);' tt-x:1 tt-y:1)" \
  "$(paid_cart_sql B2-cart '' "$LIVE" '' tt-y:1 tt-z:2)"
expect_eq "B1. shared type tt-y (capacity 1) sold exactly once" "$(live_qty tt-y)" "1"
expect_eq "B2. exactly one cart won" "SELECT count(*) FROM event_orders;" "1"
expect_eq "B3. the winner's non-shared line is present and the loser's is absent (tt-x + tt-z total is 1 or 2, never 3)" \
  "SELECT CASE WHEN (SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id IN ('tt-x','tt-z')) IN (1,2) THEN 'ok' ELSE 'bad' END;" "ok"
reset_db; bootstrap
seed_type tt-x 1000 10; seed_type tt-y 1000 10; seed_type tt-z 1000 10
run_concurrent_pair \
  "$(paid_cart_sql B3-cart '' "$LIVE" 'SELECT pg_sleep(1.5);' tt-x:3 tt-y:3)" \
  "$(paid_cart_sql B4-cart '' "$LIVE" '' tt-y:3 tt-z:3)"
expect_eq "B4. with room for both, overlapping carts both succeed (no false rejection)" "SELECT count(*) FROM event_orders;" "2"
expect_eq "B5. shared type counts both carts' quantities" "$(live_qty tt-y)" "6"

echo ""
echo "=== C: one type sold out -> the entire cart fails ==="
reset_db; bootstrap
seed_type tt-adult 2500 10; seed_type tt-child 1500 10; seed_type tt-vip 9900 1
expect_success "C setup: VIP sold out by an earlier order" "$(paid_cart_sql Earlier '' "$LIVE" '' tt-vip:1)"
expect_success "C1. a cart with an available Adult line and a sold-out VIP line runs without error" "$(paid_cart_sql Blocked '' "$LIVE" '' tt-adult:2 tt-vip:1)"
expect_eq "C2. no order was created for the blocked cart" "SELECT count(*) FROM event_orders WHERE purchaser_name='Blocked';" "0"
expect_eq "C3. no order items or attendees were created for the available Adult line (no partial reservation)" \
  "SELECT (SELECT count(*) FROM event_order_items WHERE ticket_type_id='tt-adult') + (SELECT count(*) FROM event_attendees ea JOIN event_order_items oi ON oi.id=ea.order_item_id WHERE oi.ticket_type_id='tt-adult');" "0"
expect_success "C4. a ticket type of another event/organisation (missing from the join) also fails the whole cart" "$(paid_cart_sql Ghost '' "$LIVE" '' tt-adult:1 tt-missing:1)"
expect_eq "C5. no order for the ghost-line cart" "SELECT count(*) FROM event_orders WHERE purchaser_name='Ghost';" "0"

echo ""
echo "=== D: session capacity enforced against the combined cart quantity ==="
reset_db; bootstrap
seed_type tt-adult 2500 10; seed_type tt-child 1500 10; seed_session sess-1 4
expect_success "D1. 3 Adult + 2 Child (5) for a session of 4 — every line fits its own type, the combined quantity does not" \
  "$(paid_cart_sql TooBig sess-1 "$LIVE" '' tt-adult:3 tt-child:2)"
expect_eq "D2. rejected: no order" "SELECT count(*) FROM event_orders;" "0"
expect_success "D3. 2 Adult + 2 Child (4) fits exactly" "$(paid_cart_sql Fits sess-1 "$LIVE" '' tt-adult:2 tt-child:2)"
expect_eq "D4. accepted: one order, 4 tickets, all on sess-1" \
  "SELECT count(DISTINCT order_id)||'/'||SUM(quantity)||'/'||count(*) FILTER (WHERE event_session_id='sess-1') FROM event_order_items;" "1/4/2"
reset_db; bootstrap
seed_type tt-adult 2500 10; seed_type tt-child 1500 10; seed_session sess-1 5
run_concurrent_pair \
  "$(paid_cart_sql D-A sess-1 "$LIVE" 'SELECT pg_sleep(1.5);' tt-adult:2 tt-child:1)" \
  "$(paid_cart_sql D-B sess-1 "$LIVE" '' tt-child:2 tt-adult:1)"
expect_eq "D5. concurrent carts on different types still respect the shared session (5): only one 3-ticket cart fits" \
  "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi WHERE oi.event_session_id='sess-1';" "3"

echo ""
echo "=== E: stale paid holds do not falsely consume capacity ==="
reset_db; bootstrap
seed_type tt-adult 2500 2; seed_type tt-vip 9900 1; seed_session sess-1 3
expect_success "E1. seed an EXPIRED pending cart holding the whole VIP allocation and 2 of 3 session places" \
  "$(paid_cart_sql Stale sess-1 "NOW() - interval '1 minute'" '' tt-adult:1 tt-vip:1)"
expect_success "E2. a fresh cart for the same VIP + 2 Adult (3 = full session) succeeds" "$(paid_cart_sql Fresh sess-1 "$LIVE" '' tt-adult:2 tt-vip:1)"
expect_eq "E3. the fresh cart exists" "SELECT count(*) FROM event_orders WHERE purchaser_name='Fresh';" "1"
expect_eq "E4. live VIP quantity is 1 (the stale hold is excluded)" "$(live_qty tt-vip)" "1"
expect_success "E5. a LIVE pending hold still blocks: another VIP cart is rejected" "$(paid_cart_sql Blocked sess-1 "$LIVE" '' tt-vip:1)"
expect_eq "E6. no order for the blocked cart" "SELECT count(*) FROM event_orders WHERE purchaser_name='Blocked';" "0"

echo ""
echo "=== F: deterministic lock order prevents deadlock ==="
reset_db; bootstrap
seed_type tt-x 1000 10; seed_type tt-y 1000 10
# Cart A lists x then y, cart B lists y then x. Both lock in ascending id
# order (x, y); the sleep after A's first lock forces B to queue behind it.
run_concurrent_pair \
  "$(paid_cart_sql F-A '' "$LIVE" 'SELECT pg_sleep(1.5);' tt-x:1 tt-y:1)" \
  "$(paid_cart_sql F-B '' "$LIVE" 'SELECT pg_sleep(1.5);' tt-y:1 tt-x:1)"
expect_true "F1. no deadlock reported by either connection" "! grep -qi 'deadlock' '$OUT_A' '$OUT_B'"
expect_eq "F2. both carts committed" "SELECT count(*) FROM event_orders;" "2"
echo ""
echo "=== F MUTATION PROOF: locking in CART order (not sorted) deadlocks — the harness is sensitive ==="
reset_db; bootstrap
seed_type tt-x 1000 10; seed_type tt-y 1000 10
MUT_A="$(LOCK_ORDER_OVERRIDE="tt-x tt-y" paid_cart_sql FM-A '' "$LIVE" 'SELECT pg_sleep(1.5);' tt-x:1 tt-y:1)"
MUT_B="$(LOCK_ORDER_OVERRIDE="tt-y tt-x" paid_cart_sql FM-B '' "$LIVE" 'SELECT pg_sleep(1.5);' tt-y:1 tt-x:1)"
run_concurrent_pair "$MUT_A" "$MUT_B"
expect_true "FM1. unsorted lock order produces a real 'deadlock detected' error" "grep -qi 'deadlock detected' '$OUT_A' '$OUT_B'"
expect_eq "FM2. Postgres aborted one victim, so at most one mutated cart committed" \
  "SELECT CASE WHEN count(*) <= 1 THEN 'ok' ELSE 'bad' END FROM event_orders;" "ok"

echo ""
echo "=== G: free carts use the same all-or-nothing gate and shared pool ==="
reset_db; bootstrap
seed_type tt-x 0 2; seed_type tt-y 0 5
expect_success "G1. free cart 1 x + 2 y" "$(free_cart_sql FreeOne '' '' tt-x:1 tt-y:2)"
expect_eq "G2. confirmed free order with two items and three ticketed attendees" \
  "SELECT eo.status||'/'||eo.payment_status||'/'||(SELECT count(*) FROM event_order_items)||'/'||(SELECT count(*) FROM event_attendees WHERE ticket_token IS NOT NULL) FROM event_orders eo;" "CONFIRMED/NOT_REQUIRED/2/3"
expect_success "G3. a free cart exceeding tt-x (2 more of 1 left) runs without error" "$(free_cart_sql FreeTwo '' '' tt-x:2 tt-y:1)"
expect_eq "G4. ...and creates nothing (the tt-y line is not partially reserved)" "SELECT count(*) FROM event_orders WHERE purchaser_name='FreeTwo';" "0"
reset_db; bootstrap
seed_type tt-x 0 3; seed_type tt-y 0 10
run_concurrent_pair \
  "$(free_cart_sql FA '' 'SELECT pg_sleep(1.5);' tt-x:2 tt-y:1)" \
  "$(free_cart_sql FB '' '' tt-y:1 tt-x:2)"
expect_eq "G5. concurrent free carts never oversell tt-x (capacity 3)" "$(live_qty tt-x)" "2"

echo ""
echo "=== R: whole-order retry reacquisition ==="
reset_db; bootstrap
seed_type tt-adult 2500 3; seed_type tt-vip 9900 1; seed_session sess-1 10
expect_success "R setup: an expired pending 2 Adult + 1 VIP order" "$(paid_cart_sql Retried sess-1 "NOW() - interval '1 minute'" '' tt-adult:2 tt-vip:1)"
VEXP="'$(echo "SELECT expires_at FROM event_orders WHERE purchaser_name='Retried';" | psql_query)'::timestamptz"
expect_success "R1. someone else takes the VIP while the hold is lapsed" "$(paid_cart_sql Taker sess-1 "$LIVE" '' tt-vip:1)"
expect_val "R2. retry reacquisition matches no row when ANY line no longer fits (VIP gone) — no partial re-hold" \
  "$(retry_sql Retried sess-1 NULL "$VEXP" '' | psql_query | grep -c '|' || true)" "0"
expect_success "R3. the competing VIP order is cancelled" "UPDATE event_orders SET status='CANCELLED', payment_status='EXPIRED' WHERE purchaser_name='Taker';"
expect_val "R4. now every line fits again and the retry re-holds the whole order (1 row)" \
  "$(retry_sql Retried sess-1 NULL "$VEXP" '' | psql_query | grep -c '|' || true)" "1"
reset_db; bootstrap
seed_type tt-adult 2500 10; seed_type tt-vip 9900 10
expect_success "R5 setup: a pending 2-line order with no prior Checkout Session" "$(paid_cart_sql Twice '' "NOW() - interval '1 minute'" '' tt-adult:1 tt-vip:1)"
VEXP2="'$(echo "SELECT expires_at FROM event_orders WHERE purchaser_name='Twice';" | psql_query)'::timestamptz"
run_concurrent_pair "$(retry_sql Twice '' NULL "$VEXP2" 'SELECT pg_sleep(1.5);')" "$(retry_sql Twice '' NULL "$VEXP2" '')"
expect_val "R6. two concurrent retries of the same multi-line order: exactly one wins the expires_at compare-and-set" \
  "$(cat "$OUT_A" "$OUT_B" | grep -c '^UPDATE 1$' || true)" "1"

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
exit 0
