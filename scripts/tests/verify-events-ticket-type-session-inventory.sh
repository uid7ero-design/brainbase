#!/usr/bin/env bash
# Events & Ticketing Phase 3 (ticket type × session inventory) —
# repeatable behavioural validation, against REAL PostgreSQL 16, of
#   scripts/create-events-ticket-type-session-inventory.sql   (the migration)
# and of the pair-aware capacity gate shared by
#   lib/events/services/paidCheckout.ts     (paid cart reservation)
#   lib/events/services/freeRegistration.ts (free cart registration)
#   lib/events/services/retryCheckout.ts    (whole-order retry reacquisition)
# with lock statements from lib/events/services/cart.ts
# (buildCartLockStatements: ticket types asc, then pair rows asc, then session).
#
# WHY THIS EXISTS: mocked SQL has no constraints, no locks and no MVCC, so
# it cannot prove any of:
#   M. the migration applies to the CURRENT schema, is idempotent, leaves
#      every existing row byte-identical, rejects a cross-organisation
#      pair, a cross-event pair, a duplicate pair and a negative capacity,
#      and rolls back only in the documented order (table, then parents)
#   A. the same ticket type in two sessions has independent pair inventory
#   B. one session-specific type sells out while the other session has room
#   C. a pair with NO override falls back to the event-wide type capacity,
#      which is still consumed across every session (today's behaviour)
#   D. the session's shared capacity still blocks a whole cart whose lines
#      each fit their own pair capacity
#   E. a multi-line cart is all-or-nothing when ONE line's pair is sold out
#   F. two concurrent carts on the same pair cannot oversell it
#   G. concurrent carts on different pairs of the same type proceed
#      independently where capacity allows
#   H. a stale (expired) PENDING paid hold does not consume pair inventory
#   I. whole-order retry reacquisition respects pair inventory
#   J. the deterministic lock order (types asc, pairs asc, session) is
#      deadlock-free for carts listing the same types in opposite orders —
#      with a MUTATION PROOF that cart-order locking does deadlock
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with the ACTUAL, unmodified Events migration files, then runs SQL that
# mirrors, statement-for-statement, each service's sql.transaction([...])
# array. `inject` places pg_sleep() after the first lock so two
# connections genuinely interleave.
#
# Usage: bash scripts/tests/verify-events-ticket-type-session-inventory.sh
# Exit 0 = all checks passed; 1 = at least one failed; 2 = harness error.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_MIGRATIONS=(
  "$REPO_ROOT/scripts/create-events.sql"
  "$REPO_ROOT/scripts/create-events-phase2.sql"
  "$REPO_ROOT/scripts/add-events-ticketing.sql"
  "$REPO_ROOT/scripts/add-events-payments.sql"
  "$REPO_ROOT/scripts/add-events-registration-questions.sql"
  "$REPO_ROOT/scripts/add-events-booking-wallet.sql"
  "$REPO_ROOT/scripts/add-events-ticket-email-delivery.sql"
)
NEW_MIGRATION="$REPO_ROOT/scripts/create-events-ticket-type-session-inventory.sql"
MIGRATIONS=("${BASE_MIGRATIONS[@]}" "$NEW_MIGRATION")
CONTAINER="events-tt-session-inventory-harness-$$"
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
# Bootstraps organisations/users + the given migration files + two
# organisations, each with two events (cross-org / cross-event proofs).
bootstrap_with() {
  {
    cat <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
SQL
    for f in "$@"; do cat "$f"; echo; done
    cat <<'SQL'
INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a'), ('org-b', 'Org B', 'org-b');
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone) VALUES
  ('event-1', 'org-a', 'Gala', 'gala', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide'),
  ('event-2', 'org-a', 'Other', 'other', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide'),
  ('event-b', 'org-b', 'Foreign', 'foreign', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide');
SQL
  } | psql_exec || { echo "ERROR: bootstrap failed:" >&2; cat "$DIAG_OUT" >&2; exit 2; }
}
bootstrap() { bootstrap_with "${MIGRATIONS[@]}"; }

expect_success() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then echo "  PASS: $desc"; PASS=$((PASS + 1))
  else echo "  FAIL (expected success, got error): $desc"; sed 's/^/    /' "$DIAG_OUT"; FAIL=$((FAIL + 1)); FAILURES+=("$desc"); fi
}
expect_error() { # desc sql expected_error_regex
  local desc="$1" sql="$2" want="$3"
  if echo "$sql" | psql_exec; then echo "  FAIL (expected an error, statement succeeded): $desc"; FAIL=$((FAIL + 1)); FAILURES+=("$desc")
  elif grep -qiE "$want" "$DIAG_OUT"; then echo "  PASS: $desc"; PASS=$((PASS + 1))
  else echo "  FAIL (error, but not the expected one /$want/): $desc"; sed 's/^/    /' "$DIAG_OUT"; FAIL=$((FAIL + 1)); FAILURES+=("$desc"); fi
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

seed_type() { # id price capacity [event] [org]
  echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('$1', '${4:-event-1}', '${5:-org-a}', '$1', $2, $3, true);" | psql_exec
}
seed_session() { # id capacity [event] [org]
  echo "INSERT INTO event_sessions (id, event_id, organisation_id, name, starts_at, ends_at, capacity) VALUES ('$1', '${3:-event-1}', '${4:-org-a}', '$1', now(), now() + interval '1 hour', $2);" | psql_exec
}
seed_pair() { # type session capacity  (org-a / event-1)
  echo "INSERT INTO event_ticket_type_session_inventory (organisation_id, event_id, ticket_type_id, event_session_id, capacity) VALUES ('org-a', 'event-1', '$1', '$2', $3);" | psql_exec
}
pair_insert_sql() { # org event type session capacity -> SQL text
  echo "INSERT INTO event_ticket_type_session_inventory (organisation_id, event_id, ticket_type_id, event_session_id, capacity) VALUES ('$1', '$2', '$3', '$4', $5);"
}

# Builds SQL array literals for a cart from "type:qty" args.
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

# Lock statements mirroring buildCartLockStatements: per type in $order,
# then (session-bound only) per type's pair row in the SAME order, then
# the session. inject after the FIRST lock.
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

# Phase 6 — mirrors lib/events/services/cart.ts's assessCartAvailability:
# the READ-SIDE twin of the gate (same cart_tt / sold_sess CTEs, no lock,
# no write). Prints "session_found|unavailable-type-ids|session_full".
avail_sql() {
  local sess="$1"; shift
  build_cart "$@"
  local s; s="$(sess_lit "$sess")"
  cat <<SQL
WITH cart AS (
  SELECT c.ticket_type_id, c.quantity
  FROM UNNEST($LINE_IDS, $LINE_QTYS) AS c(ticket_type_id, quantity)
),
$(cart_tt_sql "$s" ""),
sess AS (
  SELECT capacity FROM event_sessions
  WHERE id = $s AND organisation_id = 'org-a' AND event_id = 'event-1'
)
SELECT ($s::text IS NULL OR EXISTS (SELECT 1 FROM sess))::text
  || '|' || COALESCE((SELECT string_agg(cart_tt.ticket_type_id, ',' ORDER BY cart_tt.ticket_type_id) FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity), '')
  || '|' || ($s::text IS NOT NULL AND EXISTS (SELECT 1 FROM sess) AND (SELECT qty FROM sold_sess) + $TOTAL_QTY > (SELECT capacity FROM sess))::text;
SQL
}

# The shared pair-aware cart_tt CTE (mirrors all three services).
# args: session_literal extra_predicate (e.g. "AND eo.id <> 'x'")
cart_tt_sql() {
  local s="$1" extra="$2"
  cat <<SQL
cart_tt AS (
  SELECT c.ticket_type_id, c.quantity, COALESCE(inv.capacity, tt.capacity) AS capacity,
    (
      SELECT COALESCE(SUM(oi.quantity), 0)
      FROM event_order_items oi
      JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
      WHERE oi.ticket_type_id = c.ticket_type_id AND oi.organisation_id = 'org-a' $extra
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
  WHERE oi.event_session_id = $s AND oi.organisation_id = 'org-a' $extra
    AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
)
SQL
}

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
$(cart_tt_sql "$s" ""),
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
$(cart_tt_sql "$s" ""),
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
  local order_id types total ids_arr qty_arr n s
  order_id="$(echo "SELECT id FROM event_orders WHERE purchaser_name='$purchaser';" | psql_query | tr -d '[:space:]')"
  types="$(echo "SELECT ticket_type_id FROM event_order_items WHERE order_id='$order_id' ORDER BY created_at, id;" | psql_query)"
  ids_arr="ARRAY[$(echo "SELECT string_agg(quote_literal(ticket_type_id), ',' ORDER BY created_at, id) FROM event_order_items WHERE order_id='$order_id';" | psql_query)]::text[]"
  qty_arr="ARRAY[$(echo "SELECT string_agg(quantity::text, ',' ORDER BY created_at, id) FROM event_order_items WHERE order_id='$order_id';" | psql_query)]::int[]"
  total="$(echo "SELECT SUM(quantity) FROM event_order_items WHERE order_id='$order_id';" | psql_query | tr -d '[:space:]')"
  n="$(echo "$types" | grep -c .)"
  s="$(sess_lit "$sess")"
  cat <<SQL
BEGIN;
$(lock_sql "$sess" "$inject" "$(echo "$types" | LC_ALL=C sort)")
WITH cart AS (
  SELECT c.ticket_type_id, c.quantity
  FROM UNNEST($ids_arr, $qty_arr) AS c(ticket_type_id, quantity)
),
$(cart_tt_sql "$s" "AND eo.id <> '$order_id'")
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

live_pair_qty() { # type session -> live sold quantity for that pair
  echo "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id WHERE oi.ticket_type_id='$1' AND oi.event_session_id='$2' AND eo.status<>'CANCELLED' AND (eo.payment_status<>'PENDING' OR eo.expires_at>NOW());"
}
live_type_qty() { # type -> live sold quantity event-wide
  echo "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id WHERE oi.ticket_type_id='$1' AND eo.status<>'CANCELLED' AND (eo.payment_status<>'PENDING' OR eo.expires_at>NOW());"
}
orders_named() { echo "SELECT count(*) FROM event_orders WHERE purchaser_name='$1';"; }
LIVE="NOW() + interval '30 minutes'"
PRICE_tt_adult=2500; PRICE_tt_child=1500; PRICE_tt_vip=9900; PRICE_tt_x=1000; PRICE_tt_y=1000

# Row snapshot of every pre-existing Events table that the migration
# touches or neighbours (used by M2/M3).
SNAPSHOT_SQL="SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM (
  SELECT 'tt'::text AS k, id::text AS c1, event_id::text AS c2, organisation_id::text AS c3, name::text AS c4, price_cents::text AS c5, capacity::text AS c6, active::text AS c7 FROM event_ticket_types
  UNION ALL SELECT 'es'::text, id::text, event_id::text, organisation_id::text, name::text, capacity::text, NULL::text, NULL::text FROM event_sessions
  UNION ALL SELECT 'eo'::text, id::text, event_id::text, organisation_id::text, purchaser_name::text, status::text, total_cents::text, payment_status::text FROM event_orders
  UNION ALL SELECT 'oi'::text, id::text, order_id::text, organisation_id::text, ticket_type_id::text, event_session_id::text, quantity::text, NULL::text FROM event_order_items
) t;"

echo ""
echo "=== M: migration proof on the CURRENT schema ==="
reset_db; bootstrap_with "${BASE_MIGRATIONS[@]}"
echo "  bootstrap applied every PRE-EXISTING Events migration (not yet the new one)"
seed_type tt-adult 2500 10; seed_type tt-child 1500 4; seed_session sess-fri 6; seed_session sess-sat 8
seed_type tt-e2 1000 5 event-2; seed_session sess-e2 5 event-2
seed_type tt-b 1000 5 event-b org-b; seed_session sess-b 5 event-b org-b
# Pre-migration data is written with plain inserts (the pair-aware gate
# cannot run yet — the table it LEFT JOINs does not exist until M1).
expect_success "M0. pre-migration orders exist across sessions (data the migration must leave intact)" \
  "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status) VALUES ('ord-before', 'org-a', 'event-1', 'Before', 'b@example.com', 'CONFIRMED', 0, 'NOT_REQUIRED');
   INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents) VALUES ('org-a', 'ord-before', 'event-1', 'tt-adult', 'sess-fri', 2, 0), ('org-a', 'ord-before', 'event-1', 'tt-child', 'sess-fri', 1, 0);"
BEFORE_SNAP="$(echo "$SNAPSHOT_SQL" | psql_query | tr -d '[:space:]')"
expect_true "M1. scripts/create-events-ticket-type-session-inventory.sql applies cleanly to the current schema" \
  "cat '$NEW_MIGRATION' | psql_exec"
[ "$FAIL" -eq 0 ] || { echo "  migration output:"; sed 's/^/    /' "$DIAG_OUT"; }
AFTER_SNAP="$(echo "$SNAPSHOT_SQL" | psql_query | tr -d '[:space:]')"
expect_val "M2. every pre-existing ticket type / session / order / item row is byte-identical after the migration" "$AFTER_SNAP" "$BEFORE_SNAP"
expect_eq "M3. existing capacities are untouched (adult 10, child 4, fri 6, sat 8)" \
  "SELECT (SELECT capacity FROM event_ticket_types WHERE id='tt-adult')||'/'||(SELECT capacity FROM event_ticket_types WHERE id='tt-child')||'/'||(SELECT capacity FROM event_sessions WHERE id='sess-fri')||'/'||(SELECT capacity FROM event_sessions WHERE id='sess-sat');" "10/4/6/8"
expect_true "M4. re-running the migration is a no-op (idempotent)" "cat '$NEW_MIGRATION' | psql_exec"
expect_eq "M5. the new table exists with 8 NOT NULL columns" \
  "SELECT count(*)||'/'||count(*) FILTER (WHERE is_nullable='NO') FROM information_schema.columns WHERE table_name='event_ticket_type_session_inventory';" "8/8"
expect_eq "M6. both additive parent UNIQUE(id, event_id, organisation_id) constraints exist" \
  "SELECT count(*) FROM pg_constraint WHERE conname IN ('event_ticket_types_id_event_org_key','event_sessions_id_event_org_key') AND contype='u';" "2"
expect_eq "M7. the pair table carries the three composite FKs, the pair UNIQUE and the (id, organisation_id) UNIQUE" \
  "SELECT string_agg(conname||':'||contype::text, ',' ORDER BY conname) FROM pg_constraint WHERE conrelid='event_ticket_type_session_inventory'::regclass AND contype IN ('f','u');" \
  "event_tt_session_inventory_event_org_fkey:f,event_tt_session_inventory_id_org_key:u,event_tt_session_inventory_pair_key:u,event_tt_session_inventory_session_fkey:f,event_tt_session_inventory_ticket_type_fkey:f"
expect_eq "M8. the table is empty after migration (no override is ever inferred for existing data)" "SELECT count(*) FROM event_ticket_type_session_inventory;" "0"
expect_success "M9. a valid pair (org-a, event-1, tt-adult, sess-fri) inserts" "$(pair_insert_sql org-a event-1 tt-adult sess-fri 4)"
expect_error "M10. a cross-organisation pair (org-b's session with org-a's type) is rejected by the database" \
  "$(pair_insert_sql org-a event-1 tt-adult sess-b 4)" "foreign key"
expect_error "M11. a cross-organisation pair claiming org-b with org-a's type is rejected" \
  "$(pair_insert_sql org-b event-b tt-adult sess-b 4)" "foreign key"
expect_error "M12. a cross-event pair (event-1 type with event-2 session, same organisation) is rejected" \
  "$(pair_insert_sql org-a event-1 tt-adult sess-e2 4)" "foreign key"
expect_error "M13. a cross-event pair asserting event-2 with event-1's type is rejected" \
  "$(pair_insert_sql org-a event-2 tt-adult sess-e2 4)" "foreign key"
expect_error "M14. a duplicate (type, session) pair is rejected" \
  "$(pair_insert_sql org-a event-1 tt-adult sess-fri 9)" "event_tt_session_inventory_pair_key"
expect_error "M15. a negative capacity is rejected (same convention as every other Events capacity)" \
  "$(pair_insert_sql org-a event-1 tt-child sess-fri -1)" "check constraint"
expect_success "M16. capacity 0 is allowed (nothing bookable for that pair, not 'unlimited')" "$(pair_insert_sql org-a event-1 tt-child sess-fri 0)"
expect_success "M17. clearing an override is a plain row DELETE" \
  "DELETE FROM event_ticket_type_session_inventory WHERE ticket_type_id='tt-child' AND event_session_id='sess-fri' AND organisation_id='org-a';"
expect_success "M18a. an override on Saturday (a session with no orders)" "$(pair_insert_sql org-a event-1 tt-adult sess-sat 6)"
expect_success "M18b. deleting that session succeeds (existing event_order_items RESTRICT FK is untouched — Friday, which has orders, stays)" \
  "DELETE FROM event_sessions WHERE id='sess-sat';"
expect_eq "M18. ...and cascades Saturday's override row away while Friday's remains" \
  "SELECT (SELECT count(*) FROM event_ticket_type_session_inventory WHERE event_session_id='sess-sat')||'/'||(SELECT count(*) FROM event_ticket_type_session_inventory WHERE event_session_id='sess-fri');" "0/1"
echo "  -- rollback order --"
expect_error "M19. dropping a parent UNIQUE while the pair table still depends on it is refused (so the documented order is the only order)" \
  "ALTER TABLE event_ticket_types DROP CONSTRAINT event_ticket_types_id_event_org_key;" "depends on|dependent objects"
PRE_ROLLBACK_SNAP="$(echo "$SNAPSHOT_SQL" | psql_query | tr -d '[:space:]')"
expect_success "M20. rollback in the documented order succeeds: table, then the two parent UNIQUEs" \
  "DROP TABLE IF EXISTS event_ticket_type_session_inventory; ALTER TABLE event_ticket_types DROP CONSTRAINT IF EXISTS event_ticket_types_id_event_org_key; ALTER TABLE event_sessions DROP CONSTRAINT IF EXISTS event_sessions_id_event_org_key;"
ROLLED_SNAP="$(echo "$SNAPSHOT_SQL" | psql_query | tr -d '[:space:]')"
expect_val "M21. pre-existing rows are still byte-identical after rollback" "$ROLLED_SNAP" "$PRE_ROLLBACK_SNAP"
expect_true "M22. the migration re-applies cleanly after rollback" "cat '$NEW_MIGRATION' | psql_exec"

echo ""
echo "=== Z: existing events WITHOUT overrides behave exactly as today ==="
reset_db; bootstrap
seed_type tt-adult 2500 3; seed_session sess-fri 10; seed_session sess-sat 10
expect_success "Z1. 2 Adult on Friday (no override anywhere)" "$(paid_cart_sql Z-Fri sess-fri "$LIVE" '' tt-adult:2)"
expect_success "Z2. 2 more Adult on Saturday runs without error" "$(paid_cart_sql Z-Sat sess-sat "$LIVE" '' tt-adult:2)"
expect_eq "Z3. ...but is rejected: Adult's EVENT-WIDE capacity (3) is consumed across sessions, as before" "$(orders_named Z-Sat)" "0"
expect_success "Z4. 1 Adult with no session fits the last event-wide place" "$(paid_cart_sql Z-None '' "$LIVE" '' tt-adult:1)"
expect_eq "Z5. event-wide Adult sold = 3" "$(live_type_qty tt-adult)" "3"

echo ""
echo "=== A: the same type in different sessions has independent pair inventory ==="
reset_db; bootstrap
seed_type tt-adult 2500 100; seed_session sess-fri 50; seed_session sess-sat 50
seed_pair tt-adult sess-fri 4; seed_pair tt-adult sess-sat 6
expect_success "A1. 4 Adult on Friday (pair capacity 4)" "$(paid_cart_sql A-Fri sess-fri "$LIVE" '' tt-adult:4)"
expect_success "A2. 6 Adult on Saturday (pair capacity 6) still succeeds — Friday's sales did not consume it" "$(paid_cart_sql A-Sat sess-sat "$LIVE" '' tt-adult:6)"
expect_eq "A3. both orders exist" "SELECT count(*) FROM event_orders;" "2"
expect_eq "A4. pair sold: Friday 4, Saturday 6" "SELECT (SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE event_session_id='sess-fri')||'/'||(SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE event_session_id='sess-sat');" "4/6"
expect_success "A5. one more Adult on Friday runs" "$(paid_cart_sql A-Fri2 sess-fri "$LIVE" '' tt-adult:1)"
expect_eq "A6. ...and is rejected: Friday's pair (4) is full even though the type's event-wide capacity (100) is not" "$(orders_named A-Fri2)" "0"

echo ""
echo "=== B: one session-specific type sells out while another session has capacity ==="
reset_db; bootstrap
seed_type tt-vip 9900 10; seed_session sess-fri 20; seed_session sess-sat 20
seed_pair tt-vip sess-fri 1; seed_pair tt-vip sess-sat 2
expect_success "B1. VIP Friday sells its single place" "$(paid_cart_sql B-Fri sess-fri "$LIVE" '' tt-vip:1)"
expect_success "B2. a second VIP Friday runs" "$(paid_cart_sql B-Fri2 sess-fri "$LIVE" '' tt-vip:1)"
expect_eq "B3. ...rejected: VIP is sold out on Friday" "$(orders_named B-Fri2)" "0"
expect_success "B4. VIP Saturday still sells" "$(paid_cart_sql B-Sat sess-sat "$LIVE" '' tt-vip:1)"
expect_eq "B5. Saturday order exists; Friday remaining 0, Saturday remaining 1" \
  "SELECT (SELECT count(*) FROM event_orders WHERE purchaser_name='B-Sat')||'/'||(1-(SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE event_session_id='sess-fri'))||'/'||(2-(SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE event_session_id='sess-sat'));" "1/0/1"

echo ""
echo "=== C: a pair with NO override falls back to the event-wide type capacity ==="
reset_db; bootstrap
seed_type tt-adult 2500 5; seed_type tt-child 1500 3; seed_session sess-fri 20; seed_session sess-sat 20
seed_pair tt-adult sess-fri 2      # Adult overridden on Friday only; Child has no override anywhere
expect_success "C1. 2 Adult Friday (override 2) + 2 Child Friday (event-wide 3)" "$(paid_cart_sql C-Fri sess-fri "$LIVE" '' tt-adult:2 tt-child:2)"
expect_success "C2. 1 Adult Saturday — NO override: falls back to Adult's event-wide 5, of which 2 are sold on Friday" "$(paid_cart_sql C-Sat sess-sat "$LIVE" '' tt-adult:3)"
expect_eq "C3. accepted (2 + 3 = 5 fits event-wide)" "$(orders_named C-Sat)" "1"
expect_success "C4. one more Adult Saturday runs" "$(paid_cart_sql C-Sat2 sess-sat "$LIVE" '' tt-adult:1)"
expect_eq "C5. ...rejected: the fallback counts Friday's Adult sales too (event-wide 5 exhausted)" "$(orders_named C-Sat2)" "0"
expect_success "C6. 2 Child Saturday runs (event-wide Child 3, 2 sold Friday)" "$(paid_cart_sql C-Child sess-sat "$LIVE" '' tt-child:2)"
expect_eq "C7. ...rejected: Child has no override, so Friday's 2 count against Saturday too" "$(orders_named C-Child)" "0"
expect_success "C8. 1 Child Saturday fits the last event-wide place" "$(paid_cart_sql C-Child1 sess-sat "$LIVE" '' tt-child:1)"
expect_eq "C9. accepted" "$(orders_named C-Child1)" "1"
expect_success "C10. a no-session Adult order runs" "$(paid_cart_sql C-None '' "$LIVE" '' tt-adult:1)"
expect_eq "C11. ...rejected: no-session orders are always event-wide, and Adult event-wide is exhausted (2 Fri + 3 Sat)" "$(orders_named C-None)" "0"
echo "  -- override wins over the event-wide figure, both ways --"
reset_db; bootstrap
seed_type tt-adult 2500 2; seed_session sess-fri 20
seed_pair tt-adult sess-fri 5
expect_success "C12. 5 Adult Friday with override 5 and event-wide only 2" "$(paid_cart_sql C-Over sess-fri "$LIVE" '' tt-adult:5)"
expect_eq "C13. accepted — the pair override replaces (not caps-with) the event-wide capacity" "$(orders_named C-Over)" "1"

echo ""
echo "=== D: the session's shared capacity still blocks a whole cart ==="
reset_db; bootstrap
seed_type tt-adult 2500 50; seed_type tt-child 1500 50; seed_session sess-fri 5
seed_pair tt-adult sess-fri 4; seed_pair tt-child sess-fri 4   # pair sum 8 > session 5
expect_success "D1. 3 Adult + 3 Child Friday — each line fits its pair (4), the combined 6 does not fit the session (5)" \
  "$(paid_cart_sql D-Big sess-fri "$LIVE" '' tt-adult:3 tt-child:3)"
expect_eq "D2. rejected as a whole: no order, no items" "SELECT (SELECT count(*) FROM event_orders)||'/'||(SELECT count(*) FROM event_order_items);" "0/0"
expect_success "D3. 3 Adult + 2 Child (5) fits exactly" "$(paid_cart_sql D-Fit sess-fri "$LIVE" '' tt-adult:3 tt-child:2)"
expect_eq "D4. accepted: one order, 5 tickets" "SELECT count(DISTINCT order_id)||'/'||SUM(quantity) FROM event_order_items;" "1/5"
expect_success "D5. 1 Child Friday runs (pair has 2 left, session has 0)" "$(paid_cart_sql D-One sess-fri "$LIVE" '' tt-child:1)"
expect_eq "D6. ...rejected by the shared session capacity" "$(orders_named D-One)" "0"

echo ""
echo "=== E: a multi-line cart is all-or-nothing when ONE line's pair is sold out ==="
reset_db; bootstrap
seed_type tt-adult 2500 50; seed_type tt-vip 9900 50; seed_session sess-fri 50
seed_pair tt-adult sess-fri 10; seed_pair tt-vip sess-fri 1
expect_success "E setup: VIP Friday sold out" "$(paid_cart_sql E-Earlier sess-fri "$LIVE" '' tt-vip:1)"
expect_success "E1. 2 Adult (fits) + 1 VIP (sold out) Friday runs" "$(paid_cart_sql E-Blocked sess-fri "$LIVE" '' tt-adult:2 tt-vip:1)"
expect_eq "E2. no order for the blocked cart" "$(orders_named E-Blocked)" "0"
expect_eq "E3. the Adult line was NOT partially reserved (Adult Friday sold = 0)" "$(live_pair_qty tt-adult sess-fri)" "0"
expect_eq "E4. no attendee rows leaked" "SELECT count(*) FROM event_attendees ea JOIN event_orders eo ON eo.id=ea.order_id WHERE eo.purchaser_name='E-Blocked';" "0"
expect_success "E5. the same cart as a FREE registration runs" "$(free_cart_sql E-Free sess-fri '' tt-adult:2 tt-vip:1)"
expect_eq "E6. ...and also creates nothing (free flow shares the gate)" "$(orders_named E-Free)" "0"

echo ""
echo "=== F: concurrent carts on the same pair cannot oversell ==="
reset_db; bootstrap
seed_type tt-adult 2500 100; seed_session sess-fri 100
seed_pair tt-adult sess-fri 3
run_concurrent_pair \
  "$(paid_cart_sql F-A sess-fri "$LIVE" 'SELECT pg_sleep(1.5);' tt-adult:2)" \
  "$(paid_cart_sql F-B sess-fri "$LIVE" '' tt-adult:2)"
expect_eq "F1. (Adult, Friday) pair capacity 3 never oversold by two 2-ticket carts" "$(live_pair_qty tt-adult sess-fri)" "2"
expect_eq "F2. exactly one cart won" "SELECT count(*) FROM event_orders;" "1"
reset_db; bootstrap
seed_type tt-adult 2500 100; seed_session sess-fri 100
seed_pair tt-adult sess-fri 3
run_concurrent_pair \
  "$(free_cart_sql F-C sess-fri 'SELECT pg_sleep(1.5);' tt-adult:2)" \
  "$(free_cart_sql F-D sess-fri '' tt-adult:2)"
expect_eq "F3. same for two concurrent FREE carts" "$(live_pair_qty tt-adult sess-fri)" "2"

echo ""
echo "=== G: concurrent carts on DIFFERENT pairs of the same type proceed independently ==="
reset_db; bootstrap
seed_type tt-adult 2500 100; seed_session sess-fri 100; seed_session sess-sat 100
seed_pair tt-adult sess-fri 2; seed_pair tt-adult sess-sat 2
run_concurrent_pair \
  "$(paid_cart_sql G-Fri sess-fri "$LIVE" 'SELECT pg_sleep(1.5);' tt-adult:2)" \
  "$(paid_cart_sql G-Sat sess-sat "$LIVE" '' tt-adult:2)"
expect_eq "G1. both carts committed (they share the type lock, but each fits its own pair)" "SELECT count(*) FROM event_orders;" "2"
expect_eq "G2. Friday pair 2/2, Saturday pair 2/2" "SELECT (SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE event_session_id='sess-fri')||'/'||(SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE event_session_id='sess-sat');" "2/2"
expect_true "G3. no deadlock reported" "! grep -qi 'deadlock' '$OUT_A' '$OUT_B'"

echo ""
echo "=== H: stale paid holds do not consume pair inventory ==="
reset_db; bootstrap
seed_type tt-vip 9900 100; seed_session sess-fri 100
seed_pair tt-vip sess-fri 1
expect_success "H1. seed an EXPIRED pending hold on the only (VIP, Friday) place" "$(paid_cart_sql H-Stale sess-fri "NOW() - interval '1 minute'" '' tt-vip:1)"
expect_success "H2. a fresh VIP Friday cart succeeds past the stale hold" "$(paid_cart_sql H-Fresh sess-fri "$LIVE" '' tt-vip:1)"
expect_eq "H3. the fresh order exists" "$(orders_named H-Fresh)" "1"
expect_eq "H4. live (VIP, Friday) quantity is 1 — the stale hold is excluded" "$(live_pair_qty tt-vip sess-fri)" "1"
expect_success "H5. a LIVE pending hold still blocks: another VIP Friday cart runs" "$(paid_cart_sql H-Blocked sess-fri "$LIVE" '' tt-vip:1)"
expect_eq "H6. ...and is rejected" "$(orders_named H-Blocked)" "0"

echo ""
echo "=== I: whole-order retry reacquisition respects pair inventory ==="
reset_db; bootstrap
seed_type tt-adult 2500 100; seed_type tt-vip 9900 100; seed_session sess-fri 100
seed_pair tt-adult sess-fri 5; seed_pair tt-vip sess-fri 1
expect_success "I setup: an expired pending 2 Adult + 1 VIP Friday order" "$(paid_cart_sql I-Retried sess-fri "NOW() - interval '1 minute'" '' tt-adult:2 tt-vip:1)"
VEXP="'$(echo "SELECT expires_at FROM event_orders WHERE purchaser_name='I-Retried';" | psql_query)'::timestamptz"
expect_success "I1. someone else takes the (VIP, Friday) place while the hold is lapsed" "$(paid_cart_sql I-Taker sess-fri "$LIVE" '' tt-vip:1)"
expect_val "I2. retry matches no row when ANY line's pair no longer fits — no partial re-hold" \
  "$(retry_sql I-Retried sess-fri NULL "$VEXP" '' | psql_query | grep -c '|' || true)" "0"
expect_success "I3. the competing VIP order is cancelled" "UPDATE event_orders SET status='CANCELLED', payment_status='EXPIRED' WHERE purchaser_name='I-Taker';"
expect_val "I4. now every pair fits again and the retry re-holds the whole order (1 row)" \
  "$(retry_sql I-Retried sess-fri NULL "$VEXP" '' | psql_query | grep -c '|' || true)" "1"
expect_eq "I5. the retried order's hold is live again and still has both lines" \
  "SELECT (SELECT count(*) FROM event_orders WHERE purchaser_name='I-Retried' AND expires_at > NOW())||'/'||(SELECT count(*) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id WHERE eo.purchaser_name='I-Retried');" "1/2"
reset_db; bootstrap
seed_type tt-adult 2500 100; seed_session sess-fri 100
seed_pair tt-adult sess-fri 2
expect_success "I6 setup: a pending 2 Adult Friday order with no prior Checkout Session" "$(paid_cart_sql I-Twice sess-fri "NOW() - interval '1 minute'" '' tt-adult:2)"
VEXP2="'$(echo "SELECT expires_at FROM event_orders WHERE purchaser_name='I-Twice';" | psql_query)'::timestamptz"
run_concurrent_pair "$(retry_sql I-Twice sess-fri NULL "$VEXP2" 'SELECT pg_sleep(1.5);')" "$(retry_sql I-Twice sess-fri NULL "$VEXP2" '')"
expect_val "I7. two concurrent retries of the same order: exactly one wins the expires_at compare-and-set" \
  "$(cat "$OUT_A" "$OUT_B" | grep -c '^UPDATE 1$' || true)" "1"

echo ""
echo "=== J: deterministic lock order (types asc, pairs asc, session) is deadlock-free ==="
reset_db; bootstrap
seed_type tt-x 1000 100; seed_type tt-y 1000 100; seed_session sess-fri 100
seed_pair tt-x sess-fri 10; seed_pair tt-y sess-fri 10
run_concurrent_pair \
  "$(paid_cart_sql J-A sess-fri "$LIVE" 'SELECT pg_sleep(1.5);' tt-x:1 tt-y:1)" \
  "$(paid_cart_sql J-B sess-fri "$LIVE" 'SELECT pg_sleep(1.5);' tt-y:1 tt-x:1)"
expect_true "J1. no deadlock reported by either connection" "! grep -qi 'deadlock' '$OUT_A' '$OUT_B'"
expect_eq "J2. both carts committed" "SELECT count(*) FROM event_orders;" "2"
expect_eq "J3. pair quantities: x 2, y 2" "SELECT (SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-x')||'/'||(SELECT COALESCE(SUM(quantity),0) FROM event_order_items WHERE ticket_type_id='tt-y');" "2/2"
reset_db; bootstrap
seed_type tt-x 1000 100; seed_type tt-y 1000 100; seed_session sess-fri 100
seed_pair tt-x sess-fri 10; seed_pair tt-y sess-fri 10
run_concurrent_pair \
  "$(paid_cart_sql J-C sess-fri "$LIVE" 'SELECT pg_sleep(1.5);' tt-x:1 tt-y:1)" \
  "$(paid_cart_sql J-D '' "$LIVE" 'SELECT pg_sleep(1.5);' tt-y:1 tt-x:1)"
expect_true "J4. a session-bound cart racing a NO-session cart on the same types: no deadlock" "! grep -qi 'deadlock' '$OUT_A' '$OUT_B'"
expect_eq "J5. both committed" "SELECT count(*) FROM event_orders;" "2"
echo ""
echo "=== J MUTATION PROOF: locking in CART order (not sorted) deadlocks — the harness is sensitive ==="
reset_db; bootstrap
seed_type tt-x 1000 100; seed_type tt-y 1000 100; seed_session sess-fri 100
seed_pair tt-x sess-fri 10; seed_pair tt-y sess-fri 10
MUT_A="$(LOCK_ORDER_OVERRIDE="tt-x tt-y" paid_cart_sql JM-A sess-fri "$LIVE" 'SELECT pg_sleep(1.5);' tt-x:1 tt-y:1)"
MUT_B="$(LOCK_ORDER_OVERRIDE="tt-y tt-x" paid_cart_sql JM-B sess-fri "$LIVE" 'SELECT pg_sleep(1.5);' tt-y:1 tt-x:1)"
run_concurrent_pair "$MUT_A" "$MUT_B"
expect_true "JM1. unsorted lock order produces a real 'deadlock detected' error" "grep -qi 'deadlock detected' '$OUT_A' '$OUT_B'"
expect_eq "JM2. Postgres aborted one victim, so at most one mutated cart committed" \
  "SELECT CASE WHEN count(*) <= 1 THEN 'ok' ELSE 'bad' END FROM event_orders;" "ok"

echo ""
echo "=== K: read-side availability (public quote) agrees with the reservation gate ==="
reset_db; bootstrap
seed_type tt-adult 2500 5; seed_type tt-vip 9900 100; seed_session sess-fri 4; seed_session sess-sat 10
seed_pair tt-vip sess-fri 1
expect_success "K setup: 1 VIP Friday (pair 1) + 2 Adult Friday (no override, event-wide 5) are held" "$(paid_cart_sql K-Seed sess-fri "$LIVE" '' tt-adult:2 tt-vip:1)"
expect_eq "K1. 1 more VIP Friday: the pair is reported unavailable; the session is not full" "$(avail_sql sess-fri tt-vip:1)" "true|tt-vip|false"
expect_eq "K2. 2 Adult Friday: every line fits its own capacity but the shared session (4) is reported full" "$(avail_sql sess-fri tt-adult:2)" "true||true"
expect_eq "K3. 4 Adult Saturday (no override): the fallback counts Friday's 2, so event-wide 5 is reported exceeded" "$(avail_sql sess-sat tt-adult:4)" "true|tt-adult|false"
expect_eq "K4. 3 Adult Saturday fits the event-wide fallback exactly" "$(avail_sql sess-sat tt-adult:3)" "true||false"
expect_eq "K5. a session that is not this event's is reported as not found (and never full)" "$(avail_sql sess-nope tt-adult:1)" "false||false"
expect_eq "K6. a no-session cart is judged event-wide only" "$(avail_sql '' tt-adult:3)" "true||false"
expect_success "K7. the seed hold lapses (stale)" "UPDATE event_orders SET expires_at = NOW() - interval '1 minute' WHERE purchaser_name='K-Seed';"
expect_eq "K8. with the hold stale, VIP Friday is available again and the session is no longer full" "$(avail_sql sess-fri tt-vip:1)" "true||false"
expect_success "K9. ...and the gate agrees: a 1 VIP Friday cart reserves" "$(paid_cart_sql K-Agree sess-fri "$LIVE" '' tt-vip:1)"
expect_eq "K10. the order exists" "$(orders_named K-Agree)" "1"
expect_eq "K11. the read side now reports VIP Friday unavailable again" "$(avail_sql sess-fri tt-vip:1)" "true|tt-vip|false"
expect_success "K12. ...and the gate agrees: a second VIP Friday cart runs" "$(paid_cart_sql K-Refused sess-fri "$LIVE" '' tt-vip:1)"
expect_eq "K13. ...and reserves nothing" "$(orders_named K-Refused)" "0"
expect_eq "K14. a multi-line cart names every line that does not fit (Adult 6 > event-wide 5, VIP pair full) and the session cap too" "$(avail_sql sess-fri tt-adult:6 tt-vip:1)" "true|tt-adult,tt-vip|true"

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
exit 0
