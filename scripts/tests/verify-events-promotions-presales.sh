#!/usr/bin/env bash
# Events & Ticketing Phase 4 (promotional codes, presale access codes,
# ticket-type sale windows) — repeatable behavioural validation, against
# REAL PostgreSQL 16, of
#   scripts/create-events-promotions-presales-sale-windows.sql   (the migration)
# and of the Phase 4 additions to the capacity gate shared by
#   lib/events/services/paidCheckout.ts     (paid cart reservation + promotion)
#   lib/events/services/freeRegistration.ts (free cart registration + access code)
#   lib/events/services/retryCheckout.ts    (whole-order retry, redemption re-check)
# with lock statements from lib/events/services/cart.ts
# (buildCartLockStatements: types asc, pair rows asc, session, THEN promotion code).
#
# WHY THIS EXISTS: mocked SQL has no constraints, no locks, no MVCC and no
# clock, so it cannot prove any of:
#   M. the migration applies to the CURRENT schema, is idempotent, leaves
#      every existing row byte-identical, rejects a cross-organisation AND a
#      same-organisation cross-event code reference on an ORDER (approval
#      §2), rejects bad code formats / discount values / snapshot
#      incoherence, and rolls back only in the documented order
#   D. the brief's cart (2×$40 + 2×$20 + 1×$100, 10%) reserves at $198 with
#      a 2200-cent discount allocated 800/400/1000, Σ(unit×qty − d) = total
#   R. max_redemptions with the D3 accounting: live holds count, an
#      expired hold releases, a FAILED/CANCELLED unpaid order releases, a
#      PAID order counts and KEEPS counting after refund / cancellation
#   T. retry re-checks the limit excluding its own order, ignores the
#      code's current active flag/dates, and never changes the snapshot
#   C. 20 CONCURRENT carts on DIFFERENT ticket types sharing one code with
#      max_redemptions 10 commit exactly 10 — with a MUTATION PROOF that
#      dropping the promotion-row lock tier oversubscribes
#   W. sale-window boundaries are decided by the database clock inside the
#      locked statement (a cart that fits now is refused one second later)
#   A. presale access: a restricted type is refused without a code, with a
#      code scoped to another type, an inactive code, another event's code
#      (same organisation); accepted with a matching code; access codes add
#      no capacity; a free order snapshots the access code
#   G. an event with no promotions / windows / restrictions behaves exactly
#      as before (discount 0, total = gross, no promotion statements)
#   L. the extended lock order is deadlock-free for opposite-order carts
#      sharing a limited code
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container with
# the ACTUAL, unmodified Events migration files, then runs SQL that mirrors,
# statement-for-statement, each service's sql.transaction([...]) array.
# `inject` places pg_sleep() after the first lock so connections genuinely
# interleave.
#
# Usage: bash scripts/tests/verify-events-promotions-presales.sh
# Exit 0 = all checks passed; 1 = at least one failed; 2 = harness error.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_MIGRATIONS=(
  "$REPO_ROOT/scripts/create-events.sql"
  "$REPO_ROOT/scripts/create-events-phase2.sql"
  "$REPO_ROOT/scripts/add-events-ticketing.sql"
  "$REPO_ROOT/scripts/add-events-payments.sql"
  "$REPO_ROOT/scripts/add-events-payment-connect.sql"
  "$REPO_ROOT/scripts/add-events-registration-questions.sql"
  "$REPO_ROOT/scripts/add-events-booking-wallet.sql"
  "$REPO_ROOT/scripts/add-events-ticket-email-delivery.sql"
  "$REPO_ROOT/scripts/create-events-ticket-type-session-inventory.sql"
)
NEW_MIGRATION="$REPO_ROOT/scripts/create-events-promotions-presales-sale-windows.sql"
MIGRATIONS=("${BASE_MIGRATIONS[@]}" "$NEW_MIGRATION")
CONTAINER="events-promotions-presales-harness-$$"
PASS=0
FAIL=0
FAILURES=()
CONC_DIR=""

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" "${OUT_A:-}" "${OUT_B:-}" 2>/dev/null || true
  [ -n "$CONC_DIR" ] && rm -rf "$CONC_DIR" 2>/dev/null || true
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
CONC_DIR="$(mktemp -d)"

psql_exec() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1; }
psql_query() { docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1; }
reset_db() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "DROP DATABASE IF EXISTS testdb;" >/dev/null 2>&1
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "CREATE DATABASE testdb;" >/dev/null 2>&1
}
gen_uuid() {
  if [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then uuidgen
  else od -An -N16 -tx1 /dev/urandom | tr -d ' \n' | sed -E 's/^(.{8})(.{4})(.{4})(.{4})(.{12})$/\1-\2-\3-\4-\5/'
  fi
}
bootstrap_with() {
  {
    cat <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, stripe_account_id TEXT);
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
  got="$( (echo "$sql" | psql_query 2>&1 || true) | tr -d '[:space:]')"
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

seed_type() { # id price capacity [event] [org] [extra SET columns e.g. "sale_ends_at = now() + interval '1 second'"]
  echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('$1', '${4:-event-1}', '${5:-org-a}', '$1', $2, $3, true);" | psql_exec
  if [ -n "${6:-}" ]; then echo "UPDATE event_ticket_types SET $6 WHERE id = '$1';" | psql_exec; fi
}
seed_session() { # id capacity [event] [org]
  echo "INSERT INTO event_sessions (id, event_id, organisation_id, name, starts_at, ends_at, capacity) VALUES ('$1', '${3:-event-1}', '${4:-org-a}', '$1', now(), now() + interval '1 hour', $2);" | psql_exec
}
seed_promo() { # id code type value max_or_NULL [event] [org]
  echo "INSERT INTO event_promotion_codes (id, organisation_id, event_id, code, discount_type, discount_value, max_redemptions) VALUES ('$1', '${7:-org-a}', '${6:-event-1}', '$2', '$3', $4, $5);" | psql_exec
}
seed_access() { # id code [event] [org]
  echo "INSERT INTO event_access_codes (id, organisation_id, event_id, code) VALUES ('$1', '${4:-org-a}', '${3:-event-1}', '$2');" | psql_exec
}
assign_access() { # access_id type [event] [org]
  echo "INSERT INTO event_access_code_ticket_types (access_code_id, ticket_type_id, event_id, organisation_id) VALUES ('$1', '$2', '${3:-event-1}', '${4:-org-a}');" | psql_exec
}

# Builds SQL array literals for a cart from "type:qty" args. Per-line
# discounts come from LINE_DISCOUNTS_OVERRIDE ("800,400,1000") or default 0.
build_cart() {
  local line id qty i n
  local ids=() qtys=() prices=() discs=() att_ids=() att_types=() att_names=()
  TOTAL_QTY=0
  IFS=',' read -r -a override <<<"${LINE_DISCOUNTS_OVERRIDE:-}"
  n=0
  for line in "$@"; do
    id="${line%%:*}"; qty="${line##*:}"
    ids+=("'$id'"); qtys+=("$qty")
    local pvar="PRICE_${id//-/_}"; prices+=("${!pvar:-0}")
    discs+=("${override[$n]:-0}")
    for ((i = 0; i < qty; i++)); do
      att_ids+=("'$(gen_uuid)'"); att_types+=("'$id'"); att_names+=("'A-$id-$i'")
    done
    TOTAL_QTY=$((TOTAL_QTY + qty)); n=$((n + 1))
  done
  LINE_IDS="ARRAY[$(IFS=,; echo "${ids[*]}")]::text[]"
  LINE_QTYS="ARRAY[$(IFS=,; echo "${qtys[*]}")]::int[]"
  LINE_PRICES="ARRAY[$(IFS=,; echo "${prices[*]}")]::int[]"
  LINE_DISCS="ARRAY[$(IFS=,; echo "${discs[*]}")]::int[]"
  ATT_IDS="ARRAY[$(IFS=,; echo "${att_ids[*]}")]::text[]"
  ATT_TYPES="ARRAY[$(IFS=,; echo "${att_types[*]}")]::text[]"
  ATT_NAMES="ARRAY[$(IFS=,; echo "${att_names[*]}")]::text[]"
  N_LINES=${#ids[@]}
  LOCK_IDS="$(for line in "$@"; do echo "${line%%:*}"; done | LC_ALL=C sort)"
  GROSS_CENTS=0; DISCOUNT_CENTS=0
  for ((n = 0; n < ${#qtys[@]}; n++)); do GROSS_CENTS=$((GROSS_CENTS + qtys[n] * prices[n])); DISCOUNT_CENTS=$((DISCOUNT_CENTS + discs[n])); done
  TOTAL_CENTS=$((GROSS_CENTS - DISCOUNT_CENTS))
}

# Lock statements mirroring buildCartLockStatements: per type (asc), pair
# rows (asc), session, then — when PROMO_ID is set and NO_PROMO_LOCK is not —
# the promotion code row. inject after the FIRST lock.
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
  if [ -n "${PROMO_ID:-}" ] && [ -z "${NO_PROMO_LOCK:-}" ]; then
    echo "SELECT max_redemptions FROM event_promotion_codes WHERE id = '$PROMO_ID' AND organisation_id = 'org-a' FOR UPDATE;"
  fi
}

sess_lit() { if [ -n "$1" ]; then echo "'$1'"; else echo "NULL"; fi; }
lit_or_null() { if [ -n "$1" ]; then echo "'$1'"; else echo "NULL"; fi; }

# The shared cart_tt CTE with the Phase 4 `purchasable` column (mirrors
# paidCheckout.ts / freeRegistration.ts). args: session_literal extra_predicate
cart_tt_sql() {
  local s="$1" extra="$2" ac; ac="$(lit_or_null "${ACCESS_ID:-}")"
  cat <<SQL
cart_tt AS (
  SELECT c.ticket_type_id, c.quantity, COALESCE(inv.capacity, tt.capacity) AS capacity,
    (
      tt.active
      AND (tt.sale_starts_at IS NULL OR tt.sale_starts_at <= NOW())
      AND (tt.sale_ends_at IS NULL OR tt.sale_ends_at > NOW())
      AND (
        NOT tt.requires_access_code
        OR EXISTS (
          SELECT 1 FROM event_access_codes ac
          WHERE ac.id = $ac AND ac.organisation_id = 'org-a' AND ac.event_id = 'event-1'
            AND ac.active = true
            AND (ac.starts_at IS NULL OR ac.starts_at <= NOW())
            AND (ac.ends_at IS NULL OR ac.ends_at > NOW())
            AND (
              NOT EXISTS (SELECT 1 FROM event_access_code_ticket_types att WHERE att.access_code_id = ac.id AND att.organisation_id = ac.organisation_id)
              OR EXISTS (SELECT 1 FROM event_access_code_ticket_types att WHERE att.access_code_id = ac.id AND att.organisation_id = ac.organisation_id AND att.ticket_type_id = tt.id)
            )
        )
      )
    ) AS purchasable,
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

# The promotion clause of the paid gate (mirrors paidCheckout.ts).
promo_gate_sql() {
  local p; p="$(lit_or_null "${PROMO_ID:-}")"
  cat <<SQL
    AND (
      $p::text IS NULL
      OR EXISTS (
        SELECT 1 FROM event_promotion_codes pc
        WHERE pc.id = $p AND pc.organisation_id = 'org-a' AND pc.event_id = 'event-1'
          AND pc.active = true
          AND (pc.starts_at IS NULL OR pc.starts_at <= NOW())
          AND (pc.ends_at IS NULL OR pc.ends_at > NOW())
          AND (pc.max_redemptions IS NULL OR (
            SELECT count(*) FROM event_orders eo
            WHERE eo.promotion_code_id = pc.id AND eo.organisation_id = pc.organisation_id
              AND (eo.payment_status IN ('PAID', 'REFUNDED') OR (eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())))
          ) + 1 <= pc.max_redemptions)
      )
    )
SQL
}

# Mirrors lib/events/services/paidCheckout.ts's transaction.
# env: PROMO_ID PROMO_CODE ACCESS_ID ACCESS_CODE LINE_DISCOUNTS_OVERRIDE NO_PROMO_LOCK LOCK_ORDER_OVERRIDE
# args: purchaser session expires_expr inject lines...
paid_cart_sql() {
  local purchaser="$1" sess="$2" expires_expr="$3" inject="$4"; shift 4
  build_cart "$@"
  local order="${LOCK_ORDER_OVERRIDE:-$LOCK_IDS}" s; s="$(sess_lit "$sess")"
  local p pc a ac
  p="$(lit_or_null "${PROMO_ID:-}")"; pc="$(lit_or_null "${PROMO_CODE:-}")"; a="$(lit_or_null "${ACCESS_ID:-}")"; ac="$(lit_or_null "${ACCESS_CODE:-}")"
  cat <<SQL
BEGIN;
$(lock_sql "$sess" "$inject" "$order")
WITH cart AS (
  SELECT c.ticket_type_id, c.quantity, c.unit_price_cents, c.discount_cents
  FROM UNNEST($LINE_IDS, $LINE_QTYS, $LINE_PRICES, $LINE_DISCS) AS c(ticket_type_id, quantity, unit_price_cents, discount_cents)
),
$(cart_tt_sql "$s" ""),
gate AS (
  SELECT 1 AS ok
  FROM sold_sess
  WHERE (SELECT count(*) FROM cart_tt) = $N_LINES
    AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE NOT cart_tt.purchasable)
    AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)
    AND (
      $s::text IS NULL
      OR sold_sess.qty + $TOTAL_QTY <= (SELECT capacity FROM event_sessions WHERE id = $s AND organisation_id = 'org-a')
    )
$(promo_gate_sql)
),
ins_order AS (
  INSERT INTO event_orders (
    organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone,
    status, total_cents, payment_status, payment_provider, currency, expires_at, stripe_account_id,
    discount_cents, promotion_code_id, promotion_code_snapshot, access_code_id, access_code_snapshot
  )
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL,
    'PENDING', $TOTAL_CENTS, 'PENDING', 'stripe', 'AUD', $expires_expr, 'acct_test',
    $DISCOUNT_CENTS, $p, $pc, $a, $ac
  FROM gate
  RETURNING id
),
ins_items AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents, discount_cents)
  SELECT 'org-a', ins_order.id, 'event-1', cart.ticket_type_id, $s, cart.quantity, cart.unit_price_cents, cart.discount_cents
  FROM ins_order, cart
  RETURNING id, order_id, ticket_type_id
)
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email)
SELECT a.id, 'org-a', 'event-1', ii.order_id, ii.id, a.name, NULL
FROM ins_items ii
JOIN UNNEST($ATT_IDS, $ATT_TYPES, $ATT_NAMES) AS a(id, ticket_type_id, name)
  ON a.ticket_type_id = ii.ticket_type_id
RETURNING id, order_id;
${POST_GATE_INJECT:-}
COMMIT;
SQL
}

# Mirrors lib/events/services/freeRegistration.ts's transaction (responses
# CTEs included, with empty answer arrays). env: ACCESS_ID ACCESS_CODE
free_cart_sql() {
  local purchaser="$1" sess="$2" inject="$3"; shift 3
  build_cart "$@"
  local s a ac; s="$(sess_lit "$sess")"; a="$(lit_or_null "${ACCESS_ID:-}")"; ac="$(lit_or_null "${ACCESS_CODE:-}")"
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
    AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE NOT cart_tt.purchasable)
    AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)
    AND (
      $s::text IS NULL
      OR sold_sess.qty + $TOTAL_QTY <= (SELECT capacity FROM event_sessions WHERE id = $s AND organisation_id = 'org-a')
    )
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents, booking_token, ticket_email_status, access_code_id, access_code_snapshot)
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL, 'CONFIRMED', 0, md5(random()::text) || md5(random()::text), 'pending', $a, $ac
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
  JOIN UNNEST($ATT_TYPES, $ATT_NAMES, $tokens) AS a(ticket_type_id, name, token)
    ON a.ticket_type_id = ii.ticket_type_id
  RETURNING id, order_id, attendee_name, ticket_token
),
ins_order_responses AS (
  INSERT INTO event_registration_responses
    (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, io.id, NULL, r.label, r.field_type, r.answer_json::jsonb
  FROM ins_order io, UNNEST(ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]) AS r(question_id, label, field_type, answer_json)
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

# Mirrors lib/events/services/retryCheckout.ts's reacquisition (Phase 4:
# promotion lock tier + redemption re-check excluding the order itself; the
# code's active flag / dates are deliberately NOT re-checked).
# args: order_purchaser session verified_session_literal verified_stamp_literal inject
retry_sql() {
  local purchaser="$1" sess="$2" vsess="$3" vstamp="$4" inject="$5"
  local order_id types total ids_arr qty_arr n s promo_id
  order_id="$(echo "SELECT id FROM event_orders WHERE purchaser_name='$purchaser';" | psql_query | tr -d '[:space:]')"
  promo_id="$(echo "SELECT COALESCE(promotion_code_id, '') FROM event_orders WHERE id='$order_id';" | psql_query | tr -d '[:space:]')"
  types="$(echo "SELECT ticket_type_id FROM event_order_items WHERE order_id='$order_id' ORDER BY created_at, id;" | psql_query)"
  ids_arr="ARRAY[$(echo "SELECT string_agg(quote_literal(ticket_type_id), ',' ORDER BY created_at, id) FROM event_order_items WHERE order_id='$order_id';" | psql_query)]::text[]"
  qty_arr="ARRAY[$(echo "SELECT string_agg(quantity::text, ',' ORDER BY created_at, id) FROM event_order_items WHERE order_id='$order_id';" | psql_query)]::int[]"
  total="$(echo "SELECT SUM(quantity) FROM event_order_items WHERE order_id='$order_id';" | psql_query | tr -d '[:space:]')"
  n="$(echo "$types" | grep -c .)"
  s="$(sess_lit "$sess")"
  local p; p="$(lit_or_null "$promo_id")"
  cat <<SQL
BEGIN;
$(PROMO_ID="$promo_id" lock_sql "$sess" "$inject" "$(echo "$types" | LC_ALL=C sort)")
WITH cart AS (
  SELECT c.ticket_type_id, c.quantity
  FROM UNNEST($ids_arr, $qty_arr) AS c(ticket_type_id, quantity)
),
$(ACCESS_ID="" cart_tt_sql "$s" "AND eo.id <> '$order_id'")
UPDATE event_orders eo
SET expires_at = NOW() + make_interval(secs => 1860), stripe_checkout_session_id = NULL
FROM sold_sess
WHERE eo.id = '$order_id' AND eo.organisation_id = 'org-a' AND eo.payment_status = 'PENDING'
  AND eo.stripe_checkout_session_id IS NOT DISTINCT FROM $vsess
  AND (extract(epoch FROM eo.expires_at) * 1000000)::bigint IS NOT DISTINCT FROM $vstamp::bigint
  AND (SELECT count(*) FROM cart_tt) = $n
  AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)
  AND (
    $s::text IS NULL
    OR sold_sess.qty + $total <= (SELECT capacity FROM event_sessions WHERE id = $s AND organisation_id = 'org-a')
  )
  AND (
    $p::text IS NULL
    OR EXISTS (
      SELECT 1 FROM event_promotion_codes pc
      WHERE pc.id = $p AND pc.organisation_id = 'org-a'
        AND (pc.max_redemptions IS NULL OR (
          SELECT count(*) FROM event_orders ro
          WHERE ro.promotion_code_id = pc.id AND ro.organisation_id = pc.organisation_id AND ro.id <> '$order_id'
            AND (ro.payment_status IN ('PAID', 'REFUNDED') OR (ro.status <> 'CANCELLED' AND (ro.payment_status <> 'PENDING' OR ro.expires_at > NOW())))
        ) + 1 <= pc.max_redemptions)
    )
  )
RETURNING eo.id, eo.expires_at;
COMMIT;
SQL
}
stamp_of() { echo "SELECT (extract(epoch FROM expires_at) * 1000000)::bigint::text FROM event_orders WHERE purchaser_name='$1';" | psql_query | tr -d '[:space:]'; }

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
# Runs every *.sql file in CONC_DIR concurrently (one psql each) and waits.
run_concurrent_dir() {
  local pids=() f
  for f in "$CONC_DIR"/*.sql; do
    (docker exec -i "$CONTAINER" psql -X -U postgres -d testdb -v ON_ERROR_STOP=1 < "$f" > "${f%.sql}.out" 2>&1) &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p" || true; done
}

orders_named() { echo "SELECT count(*) FROM event_orders WHERE purchaser_name='$1';"; }
orders_expr() { echo "(SELECT count(*) FROM event_orders WHERE purchaser_name='$1')"; }
# The D3 redemption predicate (lib/events/services/promotions.ts REDEMPTION_COUNTS_PREDICATE_SQL).
redemptions_expr() { echo "(SELECT count(*) FROM event_orders eo WHERE eo.promotion_code_id='$1' AND (eo.payment_status IN ('PAID', 'REFUNDED') OR (eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW()))))"; }
redemptions_of() { echo "SELECT $(redemptions_expr "$1");"; }
LIVE="NOW() + interval '30 minutes'"
PRICE_tt_adult=4000; PRICE_tt_child=2000; PRICE_tt_vip=10000; PRICE_tt_x=1000; PRICE_tt_y=1000; PRICE_tt_free=0; PRICE_tt_early=5000; PRICE_tt_late=5000; PRICE_tt_locked=5000

SNAPSHOT_SQL="SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM (
  SELECT 'tt'::text AS k, id::text AS c1, event_id::text AS c2, organisation_id::text AS c3, name::text AS c4, price_cents::text AS c5, capacity::text AS c6, active::text AS c7, currency::text AS c8 FROM event_ticket_types
  UNION ALL SELECT 'es'::text, id::text, event_id::text, organisation_id::text, name::text, capacity::text, NULL::text, NULL::text, NULL::text FROM event_sessions
  UNION ALL SELECT 'eo'::text, id::text, event_id::text, organisation_id::text, purchaser_name::text, status::text, total_cents::text, payment_status::text, currency::text FROM event_orders
  UNION ALL SELECT 'oi'::text, id::text, order_id::text, organisation_id::text, ticket_type_id::text, event_session_id::text, quantity::text, unit_price_cents::text, NULL::text FROM event_order_items
) t;"

echo ""
echo "=== M: migration proof on the CURRENT schema ==="
reset_db; bootstrap_with "${BASE_MIGRATIONS[@]}"
echo "  bootstrap applied every PRE-EXISTING Events migration (not yet the new one)"
seed_type tt-adult 4000 10; seed_type tt-child 2000 10; seed_session sess-fri 20
seed_type tt-e2 1000 5 event-2; seed_type tt-b 1000 5 event-b org-b
expect_success "M0. pre-migration orders exist (paid and free) — data the migration must leave intact" \
  "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, currency) VALUES ('ord-paid', 'org-a', 'event-1', 'Before-Paid', 'b@example.com', 'CONFIRMED', 12000, 'PAID', 'AUD'), ('ord-free', 'org-a', 'event-1', 'Before-Free', 'f@example.com', 'CONFIRMED', 0, 'NOT_REQUIRED', 'AUD');
   INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents) VALUES ('org-a', 'ord-paid', 'event-1', 'tt-adult', 'sess-fri', 2, 4000), ('org-a', 'ord-paid', 'event-1', 'tt-child', 'sess-fri', 2, 2000), ('org-a', 'ord-free', 'event-1', 'tt-adult', NULL, 1, 0);"
BEFORE_SNAP="$(echo "$SNAPSHOT_SQL" | psql_query | tr -d '[:space:]')"
expect_true "M1. scripts/create-events-promotions-presales-sale-windows.sql applies cleanly to the current schema" "cat '$NEW_MIGRATION' | psql_exec"
[ "$FAIL" -eq 0 ] || { echo "  migration output:"; sed 's/^/    /' "$DIAG_OUT"; }
AFTER_SNAP="$(echo "$SNAPSHOT_SQL" | psql_query | tr -d '[:space:]')"
expect_val "M2. every pre-existing ticket type / session / order / item row is byte-identical in every pre-existing column" "$AFTER_SNAP" "$BEFORE_SNAP"
expect_eq "M3. existing prices and totals are untouched (adult 4000, child 2000, paid order 12000)" \
  "SELECT (SELECT price_cents FROM event_ticket_types WHERE id='tt-adult')||'/'||(SELECT price_cents FROM event_ticket_types WHERE id='tt-child')||'/'||(SELECT total_cents FROM event_orders WHERE id='ord-paid');" "4000/2000/12000"
expect_eq "M4. every existing order reads discount 0 / no code; every item discount 0; every type unrestricted and unbounded (defaults satisfy every CHECK)" \
  "SELECT (SELECT count(*) FROM event_orders WHERE discount_cents<>0 OR promotion_code_id IS NOT NULL OR promotion_code_snapshot IS NOT NULL OR access_code_id IS NOT NULL)||'/'||(SELECT count(*) FROM event_order_items WHERE discount_cents<>0)||'/'||(SELECT count(*) FROM event_ticket_types WHERE requires_access_code OR sale_starts_at IS NOT NULL OR sale_ends_at IS NOT NULL);" "0/0/0"
expect_eq "M5. derived gross subtotal = total_cents + discount_cents equals the paid order's own total" "SELECT total_cents + discount_cents FROM event_orders WHERE id='ord-paid';" "12000"
expect_true "M6. re-running the migration is a no-op (idempotent)" "cat '$NEW_MIGRATION' | psql_exec"
expect_eq "M7. four new tables exist and are empty" \
  "SELECT (SELECT count(*) FROM event_promotion_codes)||'/'||(SELECT count(*) FROM event_promotion_code_ticket_types)||'/'||(SELECT count(*) FROM event_access_codes)||'/'||(SELECT count(*) FROM event_access_code_ticket_types)||'/'||(SELECT count(*) FROM information_schema.tables WHERE table_name IN ('event_promotion_codes','event_promotion_code_ticket_types','event_access_codes','event_access_code_ticket_types'));" "0/0/0/0/4"
expect_eq "M8. the seven ALTER-added constraints exist with the right kinds" \
  "SELECT string_agg(conname||':'||contype::text, ',' ORDER BY conname) FROM pg_constraint WHERE conname IN ('event_ticket_types_sale_window_check','event_orders_discount_cents_check','event_orders_promotion_snapshot_check','event_orders_access_snapshot_check','event_orders_promotion_code_fkey','event_orders_access_code_fkey','event_order_items_discount_cents_check');" \
  "event_order_items_discount_cents_check:c,event_orders_access_code_fkey:f,event_orders_access_snapshot_check:c,event_orders_discount_cents_check:c,event_orders_promotion_code_fkey:f,event_orders_promotion_snapshot_check:c,event_ticket_types_sale_window_check:c"
expect_eq "M9. the order->code FKs are the 3-column EVENT-scoped composites (approval §2), NO ACTION" \
  "SELECT string_agg(conname||'='||pg_get_constraintdef(oid), ' ; ' ORDER BY conname) FROM pg_constraint WHERE conname IN ('event_orders_promotion_code_fkey','event_orders_access_code_fkey');" \
  "event_orders_access_code_fkey=FOREIGNKEY(access_code_id,event_id,organisation_id)REFERENCESevent_access_codes(id,event_id,organisation_id);event_orders_promotion_code_fkey=FOREIGNKEY(promotion_code_id,event_id,organisation_id)REFERENCESevent_promotion_codes(id,event_id,organisation_id)"
echo "  -- code tables: format, values, scoping --"
expect_success "M10. a valid promotion code (EARLY20, 20%, event-1)" "INSERT INTO event_promotion_codes (id, organisation_id, event_id, code, discount_type, discount_value) VALUES ('p-early', 'org-a', 'event-1', 'EARLY20', 'PERCENT', 20);"
expect_error "M11. a lower-case / untrimmed code is rejected (stored form is normalised)" "INSERT INTO event_promotion_codes (organisation_id, event_id, code, discount_type, discount_value) VALUES ('org-a', 'event-1', 'early20', 'PERCENT', 20);" "code_format_check"
expect_error "M12. a 2-character promotion code is rejected" "INSERT INTO event_promotion_codes (organisation_id, event_id, code, discount_type, discount_value) VALUES ('org-a', 'event-1', 'AB', 'PERCENT', 20);" "code_format_check"
expect_error "M13. PERCENT 0 / 101 and FIXED 0 are rejected" "INSERT INTO event_promotion_codes (organisation_id, event_id, code, discount_type, discount_value) VALUES ('org-a', 'event-1', 'ZERO', 'PERCENT', 0);" "discount_value_check"
expect_error "M13b. PERCENT 101 is rejected" "INSERT INTO event_promotion_codes (organisation_id, event_id, code, discount_type, discount_value) VALUES ('org-a', 'event-1', 'OVER', 'PERCENT', 101);" "discount_value_check"
expect_error "M13c. FIXED 0 is rejected" "INSERT INTO event_promotion_codes (organisation_id, event_id, code, discount_type, discount_value) VALUES ('org-a', 'event-1', 'FREEBIE', 'FIXED', 0);" "discount_value_check"
expect_error "M14. a duplicate code within the same (organisation, event) is rejected" "INSERT INTO event_promotion_codes (organisation_id, event_id, code, discount_type, discount_value) VALUES ('org-a', 'event-1', 'EARLY20', 'FIXED', 500);" "org_event_code_key"
expect_success "M15. the SAME code text in another event of the same organisation, and in another organisation, both insert (no conflict)" \
  "INSERT INTO event_promotion_codes (id, organisation_id, event_id, code, discount_type, discount_value) VALUES ('p-e2', 'org-a', 'event-2', 'EARLY20', 'PERCENT', 20), ('p-b', 'org-b', 'event-b', 'EARLY20', 'PERCENT', 20);"
expect_error "M16. an access code shorter than 8 characters is rejected (approval §3)" "INSERT INTO event_access_codes (organisation_id, event_id, code) VALUES ('org-a', 'event-1', 'VIP10');" "code_format_check"
expect_success "M17. an 8-character access code inserts" "INSERT INTO event_access_codes (id, organisation_id, event_id, code) VALUES ('a-members', 'org-a', 'event-1', 'MEMBER25');"
expect_error "M18. a join row attaching event-1's code to event-2's ticket type (same organisation) is rejected" \
  "INSERT INTO event_promotion_code_ticket_types (promotion_code_id, ticket_type_id, event_id, organisation_id) VALUES ('p-early', 'tt-e2', 'event-1', 'org-a');" "foreign key"
expect_error "M19. a join row asserting event-2 for event-1's code is rejected" \
  "INSERT INTO event_promotion_code_ticket_types (promotion_code_id, ticket_type_id, event_id, organisation_id) VALUES ('p-early', 'tt-e2', 'event-2', 'org-a');" "foreign key"
expect_error "M20. a join row attaching org-a's access code to org-b's ticket type is rejected" \
  "INSERT INTO event_access_code_ticket_types (access_code_id, ticket_type_id, event_id, organisation_id) VALUES ('a-members', 'tt-b', 'event-1', 'org-a');" "foreign key"
expect_success "M21. a valid join row (event-1 code, event-1 type) inserts" \
  "INSERT INTO event_promotion_code_ticket_types (promotion_code_id, ticket_type_id, event_id, organisation_id) VALUES ('p-early', 'tt-adult', 'event-1', 'org-a');"
echo "  -- order snapshot integrity --"
expect_error "M22. an event-1 ORDER referencing event-2's code (SAME organisation) is rejected by the composite FK" \
  "INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, discount_cents, promotion_code_id, promotion_code_snapshot) VALUES ('org-a', 'event-1', 'X', 'x@example.com', 'PENDING', 100, 'PENDING', 10, 'p-e2', 'EARLY20');" "event_orders_promotion_code_fkey"
expect_error "M23. an org-a ORDER referencing org-b's code is rejected" \
  "INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, discount_cents, promotion_code_id, promotion_code_snapshot) VALUES ('org-a', 'event-1', 'X', 'x@example.com', 'PENDING', 100, 'PENDING', 10, 'p-b', 'EARLY20');" "event_orders_promotion_code_fkey"
expect_error "M24. an event-1 ORDER referencing an access code of another event is rejected" \
  "INSERT INTO event_access_codes (id, organisation_id, event_id, code) VALUES ('a-e2', 'org-a', 'event-2', 'MEMBER25');
   INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, access_code_id, access_code_snapshot) VALUES ('org-a', 'event-1', 'X', 'x@example.com', 'CONFIRMED', 0, 'NOT_REQUIRED', 'a-e2', 'MEMBER25');" "event_orders_access_code_fkey"
expect_error "M25. a discount without a code is rejected" \
  "INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, discount_cents) VALUES ('org-a', 'event-1', 'X', 'x@example.com', 'PENDING', 100, 'PENDING', 10);" "promotion_snapshot_check"
expect_error "M26. a code id without its text snapshot is rejected" \
  "INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, discount_cents, promotion_code_id) VALUES ('org-a', 'event-1', 'X', 'x@example.com', 'PENDING', 100, 'PENDING', 10, 'p-early');" "promotion_snapshot_check"
expect_error "M27. a negative discount is rejected" \
  "INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, discount_cents, promotion_code_id, promotion_code_snapshot) VALUES ('org-a', 'event-1', 'X', 'x@example.com', 'PENDING', 100, 'PENDING', -1, 'p-early', 'EARLY20');" "discount_cents_check"
expect_success "M28. a coherent snapshot (event-1 order, event-1 code) inserts" \
  "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, discount_cents, promotion_code_id, promotion_code_snapshot) VALUES ('ord-snap', 'org-a', 'event-1', 'Snap', 's@example.com', 'PENDING', 90, 'PENDING', 10, 'p-early', 'EARLY20');"
expect_error "M29. a line discount exceeding the line gross is rejected" \
  "INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents, discount_cents) VALUES ('org-a', 'ord-snap', 'event-1', 'tt-adult', 1, 100, 101);" "discount_cents_check"
expect_error "M30. a sale window closing before it opens is rejected" \
  "UPDATE event_ticket_types SET sale_starts_at = now() + interval '2 days', sale_ends_at = now() + interval '1 day' WHERE id='tt-adult';" "sale_window_check"
echo "  -- rollback order --"
expect_error "M31. dropping event_promotion_codes while an order snapshot references it is refused (so the documented order is the only order)" \
  "DROP TABLE event_promotion_codes;" "depends on|dependent objects"
PRE_ROLLBACK_SNAP="$(echo "$SNAPSHOT_SQL" | psql_query | tr -d '[:space:]')"
expect_success "M32. rollback in the documented order succeeds" \
  "ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_promotion_code_fkey, DROP CONSTRAINT IF EXISTS event_orders_access_code_fkey, DROP CONSTRAINT IF EXISTS event_orders_promotion_snapshot_check, DROP CONSTRAINT IF EXISTS event_orders_access_snapshot_check, DROP CONSTRAINT IF EXISTS event_orders_discount_cents_check;
   DROP INDEX IF EXISTS idx_event_orders_promotion_code_id; DROP INDEX IF EXISTS idx_event_orders_access_code_id;
   ALTER TABLE event_orders DROP COLUMN IF EXISTS discount_cents, DROP COLUMN IF EXISTS promotion_code_id, DROP COLUMN IF EXISTS promotion_code_snapshot, DROP COLUMN IF EXISTS access_code_id, DROP COLUMN IF EXISTS access_code_snapshot;
   ALTER TABLE event_order_items DROP CONSTRAINT IF EXISTS event_order_items_discount_cents_check, DROP COLUMN IF EXISTS discount_cents;
   DROP TABLE IF EXISTS event_promotion_code_ticket_types; DROP TABLE IF EXISTS event_access_code_ticket_types;
   DROP TABLE IF EXISTS event_promotion_codes; DROP TABLE IF EXISTS event_access_codes;
   ALTER TABLE event_ticket_types DROP CONSTRAINT IF EXISTS event_ticket_types_sale_window_check, DROP COLUMN IF EXISTS sale_starts_at, DROP COLUMN IF EXISTS sale_ends_at, DROP COLUMN IF EXISTS requires_access_code;"
ROLLED_SNAP="$(echo "$SNAPSHOT_SQL" | psql_query | tr -d '[:space:]')"
expect_val "M33. pre-existing rows are still byte-identical after rollback (total_cents of the snapshot order survives as the amount payable)" "$ROLLED_SNAP" "$PRE_ROLLBACK_SNAP"
expect_true "M34. the migration re-applies cleanly after rollback" "cat '$NEW_MIGRATION' | psql_exec"

echo ""
echo "=== G: an event with NO promotions / windows / restrictions behaves exactly as before ==="
reset_db; bootstrap
seed_type tt-adult 4000 10; seed_type tt-child 2000 10; seed_type tt-vip 10000 2; seed_session sess-fri 20
expect_success "G1. the brief's 3-line cart reserves with no code" "$(paid_cart_sql G-Plain sess-fri "$LIVE" '' tt-adult:2 tt-child:2 tt-vip:1)"
expect_eq "G2. total 22000, discount 0, no code snapshot, every item discount 0" \
  "SELECT total_cents||'/'||discount_cents||'/'||COALESCE(promotion_code_id,'-')||'/'||(SELECT SUM(discount_cents) FROM event_order_items WHERE order_id=eo.id) FROM event_orders eo WHERE purchaser_name='G-Plain';" "22000/0/-/0"
expect_success "G3. the free flow still books" "$(free_cart_sql G-Free '' '' tt-adult:1)"
expect_eq "G4. ...one CONFIRMED free order, access columns NULL" "SELECT count(*)||'/'||COALESCE(access_code_id,'-')||'/'||COALESCE(access_code_snapshot,'-') FROM event_orders WHERE purchaser_name='G-Free' GROUP BY access_code_id, access_code_snapshot;" "1/-/-"

echo ""
echo "=== D: the brief's cart with EARLY20 (10%) — snapshot and reconciliation ==="
reset_db; bootstrap
seed_type tt-adult 4000 10; seed_type tt-child 2000 10; seed_type tt-vip 10000 2
seed_promo p-early EARLY20 PERCENT 10 NULL
expect_success "D1. 2 Adult + 2 Child + 1 VIP with EARLY20 reserves (discount allocated 800/400/1000)" \
  "$(PROMO_ID=p-early PROMO_CODE=EARLY20 LINE_DISCOUNTS_OVERRIDE='800,400,1000' paid_cart_sql D-Early '' "$LIVE" '' tt-adult:2 tt-child:2 tt-vip:1)"
expect_eq "D2. order: total 19800 (payable), discount 2200, snapshot EARLY20" \
  "SELECT total_cents||'/'||discount_cents||'/'||promotion_code_id||'/'||promotion_code_snapshot FROM event_orders WHERE purchaser_name='D-Early';" "19800/2200/p-early/EARLY20"
expect_eq "D3. items keep GROSS unit prices and accurate quantities; Σ(unit×qty − discount) = total_cents; Σ discount = order discount" \
  "SELECT SUM(oi.unit_price_cents*oi.quantity - oi.discount_cents)||'/'||SUM(oi.discount_cents)||'/'||string_agg(oi.unit_price_cents||'x'||oi.quantity||'-'||oi.discount_cents, ',' ORDER BY oi.ticket_type_id) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id WHERE eo.purchaser_name='D-Early';" "19800/2200/4000x2-800,2000x2-400,10000x1-1000"
expect_eq "D4. redemption count for EARLY20 = 1 (a live hold counts)" "$(redemptions_of p-early)" "1"
expect_success "D5. changing the code afterwards (50%, then disabled) ..." "UPDATE event_promotion_codes SET discount_value = 50 WHERE id='p-early'; UPDATE event_promotion_codes SET active = false WHERE id='p-early';"
expect_eq "D6. ...does not alter the existing order's snapshot (invariant 6)" "SELECT total_cents||'/'||discount_cents||'/'||promotion_code_snapshot FROM event_orders WHERE purchaser_name='D-Early';" "19800/2200/EARLY20"
expect_success "D7. a NEW cart with the now-disabled code runs" "$(PROMO_ID=p-early PROMO_CODE=EARLY20 LINE_DISCOUNTS_OVERRIDE='400' paid_cart_sql D-Disabled '' "$LIVE" '' tt-adult:1)"
expect_eq "D8. ...and is refused by the gate (inactive code)" "$(orders_named D-Disabled)" "0"

echo ""
echo "=== R: max_redemptions with the D3 accounting ==="
reset_db; bootstrap
seed_type tt-adult 4000 100; seed_type tt-child 2000 100
seed_promo p-lim LIMIT2 PERCENT 10 2
expect_success "R1. first redemption (live hold)" "$(PROMO_ID=p-lim PROMO_CODE=LIMIT2 LINE_DISCOUNTS_OVERRIDE='400' paid_cart_sql R-1 '' "$LIVE" '' tt-adult:1)"
expect_success "R2. second redemption (live hold)" "$(PROMO_ID=p-lim PROMO_CODE=LIMIT2 LINE_DISCOUNTS_OVERRIDE='400' paid_cart_sql R-2 '' "$LIVE" '' tt-adult:1)"
expect_success "R3. a third cart with the code runs" "$(PROMO_ID=p-lim PROMO_CODE=LIMIT2 LINE_DISCOUNTS_OVERRIDE='400' paid_cart_sql R-3 '' "$LIVE" '' tt-adult:1)"
expect_eq "R4. ...and is refused: the limit (2) is reached while capacity (100) is not" "SELECT $(orders_expr R-3)||'/'||(SELECT count(*) FROM event_orders);" "0/2"
expect_success "R5. the same cart WITHOUT the code still reserves (the limit never blocks an undiscounted purchase)" "$(paid_cart_sql R-3-nocode '' "$LIVE" '' tt-adult:1)"
expect_success "R6. the first hold expires (expires_at in the past)" "UPDATE event_orders SET expires_at = NOW() - interval '1 minute' WHERE purchaser_name='R-1';"
expect_eq "R7. an expired unpaid hold no longer counts (1 of 2 used)" "$(redemptions_of p-lim)" "1"
expect_success "R8. a new cart with the code now reserves (abandoned holds release availability)" "$(PROMO_ID=p-lim PROMO_CODE=LIMIT2 LINE_DISCOUNTS_OVERRIDE='400' paid_cart_sql R-4 '' "$LIVE" '' tt-adult:1)"
expect_eq "R9. accepted; count back to 2" "SELECT $(orders_expr R-4)||'/'||$(redemptions_expr p-lim);" "1/2"
expect_success "R10. R-2's payment fails (webhook: CANCELLED/FAILED)" "UPDATE event_orders SET status='CANCELLED', payment_status='FAILED' WHERE purchaser_name='R-2';"
expect_eq "R11. a failed unpaid order releases (1 of 2)" "$(redemptions_of p-lim)" "1"
expect_success "R12. R-4 is PAID (webhook)" "UPDATE event_orders SET status='CONFIRMED', payment_status='PAID', paid_at=now() WHERE purchaser_name='R-4';"
expect_success "R13. one more code redemption fills the limit again" "$(PROMO_ID=p-lim PROMO_CODE=LIMIT2 LINE_DISCOUNTS_OVERRIDE='400' paid_cart_sql R-5 '' "$LIVE" '' tt-adult:1)"
expect_eq "R14. count 2 (one PAID, one live hold)" "$(redemptions_of p-lim)" "2"
expect_success "R15. R-4 is refunded (status CANCELLED, payment_status REFUNDED)" "UPDATE event_orders SET status='CANCELLED', payment_status='REFUNDED', refunded_at=now() WHERE purchaser_name='R-4';"
expect_eq "R16. a refunded PAID order KEEPS counting (D3) — still 2" "$(redemptions_of p-lim)" "2"
expect_success "R17. a further code cart runs" "$(PROMO_ID=p-lim PROMO_CODE=LIMIT2 LINE_DISCOUNTS_OVERRIDE='400' paid_cart_sql R-6 '' "$LIVE" '' tt-adult:1)"
expect_eq "R18. ...and is refused: the refund did not free a redemption" "$(orders_named R-6)" "0"
expect_success "R19. replaying the PAID webhook UPDATE on an already-PAID/REFUNDED row changes nothing" "UPDATE event_orders SET status='CONFIRMED', payment_status='PAID' WHERE purchaser_name='R-4' AND payment_status='PENDING';"
expect_eq "R20. no double counting on replay — still 2" "$(redemptions_of p-lim)" "2"
expect_success "R21. R-5 is cancelled by the organiser while still PENDING (unpaid)" "UPDATE event_orders SET status='CANCELLED', payment_status='EXPIRED' WHERE purchaser_name='R-5';"
expect_eq "R22. an unpaid cancellation releases (1 of 2)" "$(redemptions_of p-lim)" "1"

echo ""
echo "=== T: retry re-checks the limit EXCLUDING itself and never re-reads the code's rules ==="
reset_db; bootstrap
seed_type tt-adult 4000 100
seed_promo p-lim LIMIT2 PERCENT 10 2
expect_success "T setup: an EXPIRED pending order with the code (the one to retry)" "$(PROMO_ID=p-lim PROMO_CODE=LIMIT2 LINE_DISCOUNTS_OVERRIDE='800' paid_cart_sql T-Retried '' "NOW() - interval '1 minute'" '' tt-adult:2)"
expect_success "T1. two OTHER buyers take both redemptions while the hold is lapsed" \
  "$(PROMO_ID=p-lim PROMO_CODE=LIMIT2 LINE_DISCOUNTS_OVERRIDE='400' paid_cart_sql T-Other1 '' "$LIVE" '' tt-adult:1)
   $(PROMO_ID=p-lim PROMO_CODE=LIMIT2 LINE_DISCOUNTS_OVERRIDE='400' paid_cart_sql T-Other2 '' "$LIVE" '' tt-adult:1)"
expect_eq "T2. both committed; count 2" "SELECT count(*) FROM event_orders WHERE purchaser_name LIKE 'T-Other%';" "2"
VSTAMP="$(stamp_of T-Retried)"
expect_val "T3. retry matches no row: others filled the limit (capacity itself is fine)" \
  "$(retry_sql T-Retried '' NULL "$VSTAMP" '' | psql_query | grep -c '|' || true)" "0"
expect_success "T4. one competitor's hold expires" "UPDATE event_orders SET expires_at = NOW() - interval '1 minute' WHERE purchaser_name='T-Other2';"
expect_success "T5. the code is DISABLED and its dates moved into the past" "UPDATE event_promotion_codes SET active=false, starts_at=now()-interval '2 days', ends_at=now()-interval '1 day' WHERE id='p-lim';"
expect_val "T6. retry now re-holds the order (1 row): the limit has room excluding itself, and the code's active flag/dates are NOT re-checked (D4)" \
  "$(retry_sql T-Retried '' NULL "$VSTAMP" '' | psql_query | grep -c '|' || true)" "1"
expect_eq "T7. the retried order's snapshot is unchanged (total 7200, discount 800, EARLY-style code text) and its hold is live" \
  "SELECT total_cents||'/'||discount_cents||'/'||promotion_code_snapshot||'/'||(expires_at > NOW())::text FROM event_orders WHERE purchaser_name='T-Retried';" "7200/800/LIMIT2/true"
expect_eq "T8. the retried order counts ONCE (count 2: itself + T-Other1), never twice" "$(redemptions_of p-lim)" "2"
expect_success "T9. a brand-new cart with the (disabled) code runs" "$(PROMO_ID=p-lim PROMO_CODE=LIMIT2 LINE_DISCOUNTS_OVERRIDE='400' paid_cart_sql T-New '' "$LIVE" '' tt-adult:1)"
expect_eq "T10. ...and is refused (new orders DO check active/dates)" "$(orders_named T-New)" "0"
reset_db; bootstrap
seed_type tt-adult 4000 100
seed_promo p-lim LIMIT1 PERCENT 10 1
expect_success "T11 setup: an expired pending order holding the ONLY redemption" "$(PROMO_ID=p-lim PROMO_CODE=LIMIT1 LINE_DISCOUNTS_OVERRIDE='400' paid_cart_sql T-Twice '' "NOW() - interval '1 minute'" '' tt-adult:1)"
VSTAMP2="$(stamp_of T-Twice)"
run_concurrent_pair "$(retry_sql T-Twice '' NULL "$VSTAMP2" 'SELECT pg_sleep(1.5);')" "$(retry_sql T-Twice '' NULL "$VSTAMP2" '')"
expect_val "T12. two concurrent retries of the same order: exactly one wins; the loser never becomes a second redemption" \
  "$(cat "$OUT_A" "$OUT_B" | grep -c '^UPDATE 1$' || true)" "1"
expect_eq "T13. count stays 1" "$(redemptions_of p-lim)" "1"

echo ""
echo "=== C: 20 concurrent carts on DIFFERENT ticket types sharing a code with max_redemptions 10 ==="
reset_db; bootstrap
for i in $(seq 1 20); do seed_type "tt-c$i" 1000 100; eval "PRICE_tt_c$i=1000"; done
seed_promo p-ten TENONLY PERCENT 10 10
rm -f "$CONC_DIR"/*.sql "$CONC_DIR"/*.out
for i in $(seq 1 20); do
  PROMO_ID=p-ten PROMO_CODE=TENONLY LINE_DISCOUNTS_OVERRIDE='100' paid_cart_sql "C-$i" '' "$LIVE" 'SELECT pg_sleep(4);' "tt-c$i:1" > "$CONC_DIR/c$i.sql"
done
run_concurrent_dir
expect_eq "C1. exactly 10 of 20 concurrent carts committed (the promotion-row lock serialises the redemption check)" "SELECT count(*) FROM event_orders WHERE purchaser_name LIKE 'C-%';" "10"
expect_eq "C2. redemption count = 10 = max; every committed order carries the snapshot" "SELECT $(redemptions_expr p-ten)||'/'||(SELECT count(*) FROM event_orders WHERE promotion_code_snapshot='TENONLY' AND discount_cents=100);" "10/10"
expect_true "C3. no deadlock and no error on any connection" "! grep -qiE 'deadlock|ERROR' $CONC_DIR/*.out"
echo "  -- deterministic two-connection race on the LAST redemption (different ticket types, so only the code row is shared) --"
# A gates first and then holds its transaction open (pg_sleep AFTER the
# gated INSERT, before COMMIT); B starts 0.5s later. With the code lock, B
# blocks on the promotion row A holds until A commits, then B's gate reads
# count 1 and refuses. Without the lock, B's gate runs while A is still
# uncommitted, reads count 0, and both commit — the limit of 1 becomes 2.
reset_db; bootstrap
seed_type tt-x 1000 100; seed_type tt-y 1000 100
seed_promo p-one LASTONE PERCENT 10 1
run_concurrent_pair \
  "$(POST_GATE_INJECT='SELECT pg_sleep(3);' PROMO_ID=p-one PROMO_CODE=LASTONE LINE_DISCOUNTS_OVERRIDE='100' paid_cart_sql C-A '' "$LIVE" '' tt-x:1)" \
  "$(PROMO_ID=p-one PROMO_CODE=LASTONE LINE_DISCOUNTS_OVERRIDE='100' paid_cart_sql C-B '' "$LIVE" '' tt-y:1)"
expect_eq "C4. with the code lock: exactly one of the two commits (B waited for A, then saw the limit reached)" "SELECT count(*) FROM event_orders WHERE promotion_code_id='p-one';" "1"
expect_true "C5. no deadlock, no error" "! grep -qiE 'deadlock|ERROR' '$OUT_A' '$OUT_B'"
echo "  -- MUTATION PROOF: without the promotion-row lock tier the same race oversubscribes --"
reset_db; bootstrap
seed_type tt-x 1000 100; seed_type tt-y 1000 100
seed_promo p-one LASTONE PERCENT 10 1
run_concurrent_pair \
  "$(NO_PROMO_LOCK=1 POST_GATE_INJECT='SELECT pg_sleep(3);' PROMO_ID=p-one PROMO_CODE=LASTONE LINE_DISCOUNTS_OVERRIDE='100' paid_cart_sql CM-A '' "$LIVE" '' tt-x:1)" \
  "$(NO_PROMO_LOCK=1 PROMO_ID=p-one PROMO_CODE=LASTONE LINE_DISCOUNTS_OVERRIDE='100' paid_cart_sql CM-B '' "$LIVE" '' tt-y:1)"
expect_eq "CM1. with the code lock REMOVED, both commit against max_redemptions 1 (oversubscription) — the harness is sensitive to the lock" \
  "SELECT count(*) FROM event_orders WHERE promotion_code_id='p-one';" "2"

echo ""
echo "=== W: sale-window boundaries are decided by the database clock inside the locked statement ==="
reset_db; bootstrap
seed_type tt-late 5000 10 event-1 org-a "sale_ends_at = now() + interval '2 seconds'"
seed_type tt-early 5000 10 event-1 org-a "sale_starts_at = now() + interval '2 seconds'"
expect_success "W1. a cart for a type whose sales close in 2s reserves now" "$(paid_cart_sql W-Before '' "$LIVE" '' tt-late:1)"
expect_success "W2. a cart for a type whose sales OPEN in 2s runs now" "$(paid_cart_sql W-TooEarly '' "$LIVE" '' tt-early:1)"
expect_eq "W3. ...and is refused (Coming soon)" "$(orders_named W-TooEarly)" "0"
sleep 2.5
expect_success "W4. the same closing-type cart runs after the boundary (a page kept open changes nothing server-side)" "$(paid_cart_sql W-After '' "$LIVE" '' tt-late:1)"
expect_eq "W5. ...and is refused (Sales ended); the earlier order still stands" "SELECT $(orders_expr W-After)||'/'||$(orders_expr W-Before);" "0/1"
expect_success "W6. the now-open type reserves" "$(paid_cart_sql W-NowOpen '' "$LIVE" '' tt-early:1)"
expect_eq "W7. accepted" "$(orders_named W-NowOpen)" "1"
expect_success "W8. a free registration for a closed type runs" "$(free_cart_sql W-FreeLate '' '' tt-late:1)"
expect_eq "W9. ...and is refused too (same purchasable rule in the free flow)" "$(orders_named W-FreeLate)" "0"

echo ""
echo "=== A: presale access codes — eligibility only, never capacity ==="
reset_db; bootstrap
seed_type tt-locked 5000 2 event-1 org-a "requires_access_code = true"
seed_type tt-adult 4000 10; seed_type tt-free 0 5 event-1 org-a "requires_access_code = true"
seed_access a-any MEMBERS2026; seed_access a-adult ADULTONLY1; assign_access a-adult tt-adult
seed_access a-off DISABLED01; echo "UPDATE event_access_codes SET active=false WHERE id='a-off';" | psql_exec
seed_access a-e2 OTHEREVENT1 event-2
expect_success "A1. a restricted type WITHOUT a code runs" "$(paid_cart_sql A-NoCode '' "$LIVE" '' tt-locked:1)"
expect_eq "A2. ...refused" "$(orders_named A-NoCode)" "0"
expect_success "A3. with a code assigned to a DIFFERENT type runs" "$(ACCESS_ID=a-adult ACCESS_CODE=ADULTONLY1 paid_cart_sql A-WrongType '' "$LIVE" '' tt-locked:1)"
expect_eq "A4. ...refused" "$(orders_named A-WrongType)" "0"
expect_success "A5. with a DISABLED code runs" "$(ACCESS_ID=a-off ACCESS_CODE=DISABLED01 paid_cart_sql A-Off '' "$LIVE" '' tt-locked:1)"
expect_eq "A6. ...refused" "$(orders_named A-Off)" "0"
expect_success "A7. with another EVENT's code (same organisation) runs" "$(ACCESS_ID=a-e2 ACCESS_CODE=OTHEREVENT1 paid_cart_sql A-OtherEvent '' "$LIVE" '' tt-locked:1)"
expect_eq "A8. ...refused (the gate scopes the code to THIS event; the FK would refuse the snapshot anyway)" "$(orders_named A-OtherEvent)" "0"
expect_success "A9. with a matching code (no specific assignment = every restricted type) reserves" "$(ACCESS_ID=a-any ACCESS_CODE=MEMBERS2026 paid_cart_sql A-Ok1 '' "$LIVE" '' tt-locked:1)"
expect_eq "A10. accepted, with the access snapshot and NO discount" "SELECT access_code_id||'/'||access_code_snapshot||'/'||discount_cents||'/'||total_cents FROM event_orders WHERE purchaser_name='A-Ok1';" "a-any/MEMBERS2026/0/5000"
expect_success "A11. a second matching purchase takes the last place (capacity 2)" "$(ACCESS_ID=a-any ACCESS_CODE=MEMBERS2026 paid_cart_sql A-Ok2 '' "$LIVE" '' tt-locked:1)"
expect_success "A12. a third matching purchase runs" "$(ACCESS_ID=a-any ACCESS_CODE=MEMBERS2026 paid_cart_sql A-Full '' "$LIVE" '' tt-locked:1)"
expect_eq "A13. ...refused: an access code grants eligibility, never extra capacity" "$(orders_named A-Full)" "0"
expect_success "A14. a mixed cart (restricted + unrestricted) with a code scoped to the unrestricted type only runs" "$(ACCESS_ID=a-adult ACCESS_CODE=ADULTONLY1 paid_cart_sql A-Mixed '' "$LIVE" '' tt-adult:1 tt-locked:1)"
expect_eq "A15. ...refused as a whole (all-or-nothing)" "$(orders_named A-Mixed)" "0"
expect_success "A16. a FREE restricted type registers with the code" "$(ACCESS_ID=a-any ACCESS_CODE=MEMBERS2026 free_cart_sql A-Free '' '' tt-free:1)"
expect_eq "A16b. ...and snapshots it (CONFIRMED, total 0, access snapshot)" "SELECT count(*)||'/'||access_code_snapshot||'/'||total_cents||'/'||status FROM event_orders WHERE purchaser_name='A-Free' GROUP BY access_code_snapshot, total_cents, status;" "1/MEMBERS2026/0/CONFIRMED"
expect_success "A17. a FREE restricted type without a code runs" "$(free_cart_sql A-FreeNo '' '' tt-free:1)"
expect_eq "A18. ...refused" "$(orders_named A-FreeNo)" "0"

echo ""
echo "=== L: the extended lock order (types asc, pairs, session, promotion) is deadlock-free ==="
reset_db; bootstrap
seed_type tt-x 1000 100; seed_type tt-y 1000 100; seed_session sess-fri 100
seed_promo p-l LOCKTEST PERCENT 10 100
run_concurrent_pair \
  "$(PROMO_ID=p-l PROMO_CODE=LOCKTEST LINE_DISCOUNTS_OVERRIDE='100,100' paid_cart_sql L-A sess-fri "$LIVE" 'SELECT pg_sleep(1.5);' tt-x:1 tt-y:1)" \
  "$(PROMO_ID=p-l PROMO_CODE=LOCKTEST LINE_DISCOUNTS_OVERRIDE='100,100' paid_cart_sql L-B sess-fri "$LIVE" 'SELECT pg_sleep(1.5);' tt-y:1 tt-x:1)"
expect_true "L1. no deadlock reported by either connection" "! grep -qi 'deadlock' '$OUT_A' '$OUT_B'"
expect_eq "L2. both carts committed with the code" "SELECT count(*) FROM event_orders WHERE promotion_code_id='p-l';" "2"
reset_db; bootstrap
seed_type tt-x 1000 100; seed_type tt-y 1000 100; seed_session sess-fri 100
seed_promo p-l LOCKTEST PERCENT 10 100
run_concurrent_pair \
  "$(PROMO_ID=p-l PROMO_CODE=LOCKTEST LINE_DISCOUNTS_OVERRIDE='100' paid_cart_sql L-C sess-fri "$LIVE" 'SELECT pg_sleep(1.5);' tt-x:1)" \
  "$(paid_cart_sql L-D '' "$LIVE" 'SELECT pg_sleep(1.5);' tt-y:1 tt-x:1)"
expect_true "L3. a code-bearing session cart racing a no-code no-session cart on a shared type: no deadlock" "! grep -qi 'deadlock' '$OUT_A' '$OUT_B'"
expect_eq "L4. both committed" "SELECT count(*) FROM event_orders;" "2"

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
exit 0
