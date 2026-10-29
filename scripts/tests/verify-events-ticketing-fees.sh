#!/usr/bin/env bash
# Events & Ticketing Phase 5A (commercial fee + GST/invoice foundation) —
# repeatable behavioural validation, against REAL PostgreSQL 16, of
#   scripts/create-events-ticketing-fees-foundation.sql   (the migration)
# and of the fee snapshot the paid reservation in
#   lib/events/services/paidCheckout.ts
# writes (mirrored statement-for-statement below), plus the refund
# transition in lib/events/services/orderTransitions.ts.
#
# WHY THIS EXISTS: mocked SQL has no constraints, no indexes and no MVCC,
# so it cannot prove any of:
#   M. the migration applies to the CURRENT schema, is idempotent, leaves
#      every existing row byte-identical (fee 0, mode/payment NULL), creates
#      one table with one-policy-per-scope partial unique indexes, scopes the
#      order->policy FK to the organisation, and rolls back only in the
#      documented order
#   P. the policy row is database-constrained (mode, bps range, negatives,
#      max >= min, tax treatment vocabulary, label, version)
#   S. event_orders_fee_snapshot_check refuses every non-reconciling
#      combination (fee without mode, PASS_THROUGH with the wrong payment
#      total, ABSORB with payment != ticket or fee > ticket, a mode without a
#      policy id) and accepts the coherent ones
#   Z. a reservation written WITHOUT a policy (the BrainBase default) is
#      indistinguishable from a pre-Phase-5A row apart from
#      payment_total_cents = total_cents
#   F. the brief's cart (2×$40 + 2×$20 + 1×$100, 10% off, 2.5% + $0.30 fee)
#      reserves as ticket 19800 / fee 525 / customer 20325 (PASS_THROUGH)
#      and 19800 / 525 / 19800 (ABSORB); changing or disabling the policy
#      afterwards never alters the order; the refund UPDATE records
#      refunded_cents and the whole fee reversed
#   R. the resolution subquery picks the event row over the organisation
#      row and the platform default (no row) when neither exists
#   C. the fee columns do not weaken capacity/promotion locking: 20
#      concurrent carts sharing a limited code under a fee policy still
#      commit exactly max_redemptions
#
# Usage: bash scripts/tests/verify-events-ticketing-fees.sh
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
  "$REPO_ROOT/scripts/add-eve-registration-questions.sql"
  "$REPO_ROOT/scripts/add-events-booking-wallet.sql"
  "$REPO_ROOT/scripts/add-events-ticket-email-delivery.sql"
  "$REPO_ROOT/scripts/create-events-ticket-type-session-inventory.sql"
  "$REPO_ROOT/scripts/create-events-promotions-presales-sale-windows.sql"
)
NEW_MIGRATION="$REPO_ROOT/scripts/create-events-ticketing-fees-foundation.sql"
MIGRATIONS=("${BASE_MIGRATIONS[@]}" "$NEW_MIGRATION")
CONTAINER="events-ticketing-fees-harness-$$"
PASS=0
FAIL=0
FAILURES=()
CONC_DIR=""

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
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

seed_type() { # id price capacity [event] [org]
  echo "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('$1', '${4:-event-1}', '${5:-org-a}', '$1', $2, $3, true);" | psql_exec
}
seed_promo() { # id code type value max_or_NULL
  echo "INSERT INTO event_promotion_codes (id, organisation_id, event_id, code, discount_type, discount_value, max_redemptions) VALUES ('$1', 'org-a', 'event-1', '$2', '$3', $4, $5);" | psql_exec
}
seed_policy() { # id org event_or_NULL mode bps fixed_order fixed_ticket enabled [extra SET]
  echo "INSERT INTO ticketing_fee_policies (id, organisation_id, event_id, fee_mode, percent_bps, fixed_per_order_cents, fixed_per_ticket_cents, enabled) VALUES ('$1', '$2', $3, '$4', $5, $6, $7, $8);" | psql_exec
  if [ -n "${9:-}" ]; then echo "UPDATE ticketing_fee_policies SET $9 WHERE id = '$1';" | psql_exec; fi
}
lit_or_null() { if [ -n "$1" ]; then echo "'$1'"; else echo "NULL"; fi; }
int_or_null() { if [ -n "$1" ]; then echo "$1"; else echo "NULL"; fi; }

# The resolution subquery exactly as lib/events/services/cart.ts embeds it.
resolve_policy_sql() { # org event
  echo "SELECT (SELECT to_jsonb(p) FROM ticketing_fee_policies p WHERE p.organisation_id = '$1' AND (p.event_id = '$2' OR p.event_id IS NULL) ORDER BY (p.event_id IS NOT NULL) DESC LIMIT 1) AS fee_policy;"
}

# Builds SQL array literals for a cart from "type:qty" args; per-line
# discounts from LINE_DISCOUNTS_OVERRIDE ("800,400,1000") or 0.
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

# Fee arithmetic mirroring lib/events/feeCalculation.ts (integer, half-up once).
# env: FEE_BPS FEE_FIXED_ORDER FEE_FIXED_TICKET FEE_MIN FEE_MAX FEE_MODE
compute_fee() { # net qty
  local net="$1" qty="$2" pct fee
  pct=$(( (net * ${FEE_BPS:-0} + 5000) / 10000 ))
  fee=$(( ${FEE_FIXED_ORDER:-0} + ${FEE_FIXED_TICKET:-0} * qty + pct ))
  if [ -n "${FEE_MIN:-}" ] && [ "$fee" -lt "$FEE_MIN" ]; then fee=$FEE_MIN; fi
  if [ -n "${FEE_MAX:-}" ] && [ "$fee" -gt "$FEE_MAX" ]; then fee=$FEE_MAX; fi
  echo "$fee"
}

lock_sql() { # inject order
  local inject="$1" order="$2" first=1 id
  for id in $order; do
    echo "SELECT capacity FROM event_ticket_types WHERE id = '$id' AND organisation_id = 'org-a' FOR UPDATE;"
    if [ "$first" -eq 1 ] && [ -n "$inject" ]; then echo "$inject"; fi
    first=0
  done
  if [ -n "${PROMO_ID:-}" ]; then
    echo "SELECT max_redemptions FROM event_promotion_codes WHERE id = '$PROMO_ID' AND organisation_id = 'org-a' FOR UPDATE;"
  fi
}

# Mirrors lib/events/services/paidCheckout.ts's reservation statement
# (no session; Phase 5A fee snapshot columns included).
# env: PROMO_ID PROMO_CODE LINE_DISCOUNTS_OVERRIDE POLICY_ID POLICY_VERSION FEE_MODE FEE_BPS FEE_FIXED_ORDER FEE_FIXED_TICKET FEE_MIN FEE_MAX FEE_LABEL
# args: purchaser expires_expr inject lines...
paid_cart_sql() {
  local purchaser="$1" expires_expr="$2" inject="$3"; shift 3
  build_cart "$@"
  local p pc; p="$(lit_or_null "${PROMO_ID:-}")"; pc="$(lit_or_null "${PROMO_CODE:-}")"
  local fee=0 mode="NULL" payment=$TOTAL_CENTS policy="NULL" version="NULL" bps="NULL" fo="NULL" ft="NULL" fmin="NULL" fmax="NULL" tax="NULL" label="NULL"
  if [ -n "${POLICY_ID:-}" ]; then
    fee="$(compute_fee "$TOTAL_CENTS" "$TOTAL_QTY")"
    mode="'${FEE_MODE}'"; policy="'$POLICY_ID'"; version="${POLICY_VERSION:-1}"
    bps="${FEE_BPS:-0}"; fo="${FEE_FIXED_ORDER:-0}"; ft="${FEE_FIXED_TICKET:-0}"; fmin="$(int_or_null "${FEE_MIN:-}")"; fmax="$(int_or_null "${FEE_MAX:-}")"
    tax="'UNSPECIFIED'"; label="'${FEE_LABEL:-Booking fee}'"
    if [ "$FEE_MODE" = "PASS_THROUGH" ]; then payment=$((TOTAL_CENTS + fee)); else payment=$TOTAL_CENTS; fi
  fi

  cat <<SQL
BEGIN;
$(lock_sql "$inject" "$LOCK_IDS")
WITH cart AS (
  SELECT c.ticket_type_id, c.quantity, c.unit_price_cents, c.discount_cents
  FROM UNNEST($LINE_IDS, $LINE_QTYS, $LINE_PRICES, $LINE_DISCS) AS c(ticket_type_id, quantity, unit_price_cents, discount_cents)
),
cart_tt AS (
  SELECT c.ticket_type_id, c.quantity, tt.capacity,
    (tt.active AND (tt.sale_starts_at IS NULL OR tt.sale_starts_at <= NOW()) AND (tt.sale_ends_at IS NULL OR tt.sale_ends_at > NOW()) AND NOT tt.requires_access_code) AS purchasable,
    (
      SELECT COALESCE(SUM(oi.quantity), 0)
      FROM event_order_items oi
      JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
      WHERE oi.ticket_type_id = c.ticket_type_id AND oi.organisation_id = 'org-a'
        AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
    ) AS sold
  FROM cart c
  JOIN event_ticket_types tt ON tt.id = c.ticket_type_id AND tt.organisation_id = 'org-a'
),
gate AS (
  SELECT 1 AS ok
  WHERE (SELECT count(*) FROM cart_tt) = $N_LINES
    AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE NOT cart_tt.purchasable)
    AND NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)
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
),
ins_order AS (
  INSERT INTO event_orders (
    organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone,
    status, total_cents, payment_status, payment_provider, currency, expires_at, stripe_account_id,
    platform_fee_cents, fee_mode, payment_total_cents, fee_policy_id, fee_policy_version,
    fee_percent_bps, fee_fixed_per_order_cents, fee_fixed_per_ticket_cents, fee_min_cents, fee_max_cents, fee_tax_treatment, fee_label,
    discount_cents, promotion_code_id, promotion_code_snapshot, access_code_id, access_code_snapshot
  )
  SELECT 'org-a', 'event-1', '$purchaser', 'p@example.com', NULL,
    'PENDING', $TOTAL_CENTS, 'PENDING', 'stripe', 'AUD', $expires_expr, 'acct_test',
    $fee, $mode, $payment, $policy, $version,
    $bps, $fo, $ft, $fmin, $fmax, $tax, $label,
    $DISCOUNT_CENTS, $p, $pc, NULL, NULL
  FROM gate
  RETURNING id
),
ins_items AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents, discount_cents)
  SELECT 'org-a', ins_order.id, 'event-1', cart.ticket_type_id, NULL, cart.quantity, cart.unit_price_cents, cart.discount_cents
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

orders_expr() { echo "(SELECT count(*) FROM event_orders WHERE purchaser_name='$1')"; }
orders_named() { echo "SELECT $(orders_expr "$1");"; }
snapshot_of() { echo "SELECT total_cents||'/'||platform_fee_cents||'/'||COALESCE(fee_mode,'-')||'/'||COALESCE(payment_total_cents::text,'-')||'/'||COALESCE(fee_policy_id,'-')||'/'||COALESCE(fee_policy_version::text,'-') FROM event_orders WHERE purchaser_name='$1';"; }

run_concurrent() { # n sql_template(with %N% for the purchaser suffix)
  local n="$1" tmpl="$2" i
  for ((i = 1; i <= n; i++)); do
    echo "${tmpl//%N%/$i}" > "$CONC_DIR/c$i.sql"
    (docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb < "$CONC_DIR/c$i.sql" > "$CONC_DIR/c$i.out" 2>&1 || true) &
  done
  wait
}

PRICE_tt_adult=4000; PRICE_tt_child=2000; PRICE_tt_vip=10000; PRICE_tt_x=100

SNAPSHOT_SQL="SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM (
  SELECT 'tt'::text AS k, id::text AS c1, event_id::text AS c2, organisation_id::text AS c3, name::text AS c4, price_cents::text AS c5, capacity::text AS c6, active::text AS c7, currency::text AS c8 FROM event_ticket_types
  UNION ALL SELECT 'eo'::text, id::text, event_id::text, organisation_id::text, purchaser_name::text, status::text, total_cents::text, payment_status::text, discount_cents::text FROM event_orders
  UNION ALL SELECT 'oi'::text, id::text, order_id::text, organisation_id::text, ticket_type_id::text, quantity::text, unit_price_cents::text, discount_cents::text, NULL::text FROM event_order_items
) t;"

echo ""
echo "=== M: migration proof on the CURRENT schema ==="
reset_db; bootstrap_with "${BASE_MIGRATIONS[@]}"
echo "  bootstrap applied every PRE-EXISTING Events migration (through Phase 4), not yet the new one"
seed_type tt-adult 4000 10; seed_type tt-child 2000 10
seed_promo p-early EARLY20 PERCENT 10 NULL
expect_success "M0. pre-migration orders exist (paid with a discount, free) — data the migration must leave intact" \
  "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, currency, discount_cents, promotion_code_id, promotion_code_snapshot) VALUES ('ord-paid', 'org-a', 'event-1', 'Before-Paid', 'b@example.com', 'CONFIRMED', 10800, 'PAID', 'AUD', 1200, 'p-early', 'EARLY20'), ('ord-free', 'org-a', 'event-1', 'Before-Free', 'f@example.com', 'CONFIRMED', 0, 'NOT_REQUIRED', 'AUD', 0, NULL, NULL);
   INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents, discount_cents) VALUES ('org-a', 'ord-paid', 'event-1', 'tt-adult', 2, 4000, 800), ('org-a', 'ord-paid', 'event-1', 'tt-child', 2, 2000, 400), ('org-a', 'ord-free', 'event-1', 'tt-adult', 1, 0, 0);"
BEFORE_SNAP="$(echo "$SNAPSHOT_SQL" | psql_query | tr -d '[:space:]')"
expect_true "M1. scripts/create-events-ticketing-fees-foundation.sql applies cleanly to the current schema" "cat '$NEW_MIGRATION' | psql_exec"
[ "$FAIL" -eq 0 ] || { echo "  migration output:"; sed 's/^/    /' "$DIAG_OUT"; }
AFTER_SNAP="$(echo "$SNAPSHOT_SQL" | psql_query | tr -d '[:space:]')"
expect_val "M2. every pre-existing ticket type / order / item row is byte-identical in every pre-existing column" "$AFTER_SNAP" "$BEFORE_SNAP"
expect_eq "M3. every existing order reads fee 0 / no mode / NULL payment total / no policy — defaults satisfy the new CHECKs" \
  "SELECT (SELECT count(*) FROM event_orders WHERE platform_fee_cents<>0 OR fee_mode IS NOT NULL OR payment_total_cents IS NOT NULL OR fee_policy_id IS NOT NULL OR refunded_cents IS NOT NULL)||'/'||(SELECT count(*) FROM event_orders);" "0/2"
expect_eq "M4. the historical customer-paid figure is readable as COALESCE(payment_total_cents, total_cents) = total_cents" \
  "SELECT COALESCE(payment_total_cents, total_cents) FROM event_orders WHERE id='ord-paid';" "10800"
expect_true "M5. re-running the migration is a no-op (idempotent)" "cat '$NEW_MIGRATION' | psql_exec"
expect_eq "M6. exactly one new table, empty; both scope indexes are UNIQUE and partial" \
  "SELECT (SELECT count(*) FROM ticketing_fee_policies)||'/'||(SELECT count(*) FROM information_schema.tables WHERE table_name='ticketing_fee_policies')||'/'||(SELECT count(*) FROM pg_indexes WHERE tablename='ticketing_fee_policies' AND indexname IN ('idx_ticketing_fee_policies_org_default','idx_ticketing_fee_policies_org_event') AND indexdef LIKE 'CREATE UNIQUE INDEX%WHERE%');" "0/1/2"
expect_eq "M7. the seven ALTER-added order constraints exist with the right kinds" \
  "SELECT string_agg(conname||':'||contype::text, ',' ORDER BY conname) FROM pg_constraint WHERE conname IN ('event_orders_platform_fee_cents_check','event_orders_fee_mode_check','event_orders_payment_total_cents_check','event_orders_fee_tax_treatment_check','event_orders_refunded_cents_check','event_orders_fee_snapshot_check','event_orders_fee_policy_fkey');" \
  "event_orders_fee_mode_check:c,event_orders_fee_policy_fkey:f,event_orders_fee_snapshot_check:c,event_orders_fee_tax_treatment_check:c,event_orders_payment_total_cents_check:c,event_orders_platform_fee_cents_check:c,event_orders_refunded_cents_check:c"
expect_eq "M8. the order->policy FK is the ORGANISATION-scoped composite, NO ACTION" \
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='event_orders_fee_policy_fkey';" \
  "FOREIGNKEY(fee_policy_id,organisation_id)REFERENCESticketing_fee_policies(id,organisation_id)"
echo "  -- P: policy row constraints --"
expect_success "P1. a valid organisation-level PASS_THROUGH policy (2.5% + \$0.30), disabled by default" "INSERT INTO ticketing_fee_policies (id, organisation_id, fee_mode, percent_bps, fixed_per_order_cents) VALUES ('fee-org', 'org-a', 'PASS_THROUGH', 250, 30);"
expect_eq "P2. ...enabled defaults to false, version 1, label 'Booking fee', tax UNSPECIFIED, currency AUD" "SELECT enabled||'/'||version||'/'||label||'/'||tax_treatment||'/'||currency FROM ticketing_fee_policies WHERE id='fee-org';" "false/1/Bookingfee/UNSPECIFIED/AUD"
expect_error "P3. a second organisation-level policy for the same organisation is refused (one per scope)" "INSERT INTO ticketing_fee_policies (organisation_id, fee_mode) VALUES ('org-a', 'ABSORB');" "idx_ticketing_fee_policies_org_default"
expect_success "P4. an event-level policy for event-1 inserts" "INSERT INTO ticketing_fee_policies (id, organisation_id, event_id, fee_mode, percent_bps, enabled) VALUES ('fee-ev1', 'org-a', 'event-1', 'ABSORB', 100, true);"
expect_error "P5. a second event-level policy for the same event is refused" "INSERT INTO ticketing_fee_policies (organisation_id, event_id, fee_mode) VALUES ('org-a', 'event-1', 'PASS_THROUGH');" "idx_ticketing_fee_policies_org_event"
expect_error "P6. a policy naming another organisation's event is refused by the composite FK" "INSERT INTO ticketing_fee_policies (organisation_id, event_id, fee_mode) VALUES ('org-a', 'event-b', 'PASS_THROUGH');" "ticketing_fee_policies_event_org_fkey"
expect_error "P7. an unknown mode is refused" "INSERT INTO ticketing_fee_policies (organisation_id, fee_mode) VALUES ('org-b', 'SPLIT');" "fee_mode_check"
expect_error "P8. 10001 bps is refused" "INSERT INTO ticketing_fee_policies (organisation_id, fee_mode, percent_bps) VALUES ('org-b', 'ABSORB', 10001);" "percent_bps_check"
expect_error "P9. a negative fixed fee is refused" "INSERT INTO ticketing_fee_policies (organisation_id, fee_mode, fixed_per_order_cents) VALUES ('org-b', 'ABSORB', -1);" "fixed_per_order_check"
expect_error "P10. max below min is refused" "INSERT INTO ticketing_fee_policies (organisation_id, fee_mode, min_fee_cents, max_fee_cents) VALUES ('org-b', 'ABSORB', 500, 100);" "min_max_check"
expect_error "P11. an unknown tax treatment is refused" "INSERT INTO ticketing_fee_policies (organisation_id, fee_mode, tax_treatment) VALUES ('org-b', 'ABSORB', 'VAT');" "tax_treatment_check"
expect_error "P12. a blank label is refused" "INSERT INTO ticketing_fee_policies (organisation_id, fee_mode, label) VALUES ('org-b', 'ABSORB', '   ');" "label_check"
echo "  -- S: snapshot coherence on orders --"
BASE_ORDER="INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, currency"
expect_error "S1. a fee without a mode is refused" "$BASE_ORDER, platform_fee_cents) VALUES ('org-a','event-1','S','s@x','PENDING',1000,'PENDING','AUD',50);" "fee_snapshot_check"
expect_error "S2. a mode without a policy id is refused" "$BASE_ORDER, platform_fee_cents, fee_mode, payment_total_cents) VALUES ('org-a','event-1','S','s@x','PENDING',1000,'PENDING','AUD',50,'PASS_THROUGH',1050);" "fee_snapshot_check"
expect_error "S3. PASS_THROUGH with payment != ticket + fee is refused" "$BASE_ORDER, platform_fee_cents, fee_mode, payment_total_cents, fee_policy_id, fee_policy_version) VALUES ('org-a','event-1','S','s@x','PENDING',1000,'PENDING','AUD',50,'PASS_THROUGH',1000,'fee-org',1);" "fee_snapshot_check"
expect_error "S4. ABSORB with payment != ticket is refused" "$BASE_ORDER, platform_fee_cents, fee_mode, payment_total_cents, fee_policy_id, fee_policy_version) VALUES ('org-a','event-1','S','s@x','PENDING',1000,'PENDING','AUD',50,'ABSORB',1050,'fee-org',1);" "fee_snapshot_check"
expect_error "S5. ABSORB with fee > ticket is refused" "$BASE_ORDER, platform_fee_cents, fee_mode, payment_total_cents, fee_policy_id, fee_policy_version) VALUES ('org-a','event-1','S','s@x','PENDING',100,'PENDING','AUD',150,'ABSORB',100,'fee-org',1);" "fee_snapshot_check"
expect_error "S6. no mode but payment != ticket is refused" "$BASE_ORDER, payment_total_cents) VALUES ('org-a','event-1','S','s@x','PENDING',1000,'PENDING','AUD',1001);" "fee_snapshot_check"
expect_error "S7. a negative fee is refused" "$BASE_ORDER, platform_fee_cents) VALUES ('org-a','event-1','S','s@x','PENDING',1000,'PENDING','AUD',-1);" "platform_fee_cents_check|fee_snapshot_check"
expect_error "S8. an org-a order referencing org-b's policy is refused by the composite FK" "INSERT INTO ticketing_fee_policies (id, organisation_id, fee_mode, enabled) VALUES ('fee-b', 'org-b', 'PASS_THROUGH', true);
  $BASE_ORDER, platform_fee_cents, fee_mode, payment_total_cents, fee_policy_id, fee_policy_version) VALUES ('org-a','event-1','S','s@x','PENDING',1000,'PENDING','AUD',50,'PASS_THROUGH',1050,'fee-b',1);" "event_orders_fee_policy_fkey"
expect_success "S9. coherent PASS_THROUGH (1000 + 50 = 1050), coherent ABSORB (1000/50/1000) and no-fee (payment = ticket) all insert" \
  "$BASE_ORDER, platform_fee_cents, fee_mode, payment_total_cents, fee_policy_id, fee_policy_version) VALUES ('org-a','event-1','S-pass','s@x','PENDING',1000,'PENDING','AUD',50,'PASS_THROUGH',1050,'fee-org',1);
   $BASE_ORDER, platform_fee_cents, fee_mode, payment_total_cents, fee_policy_id, fee_policy_version) VALUES ('org-a','event-1','S-absorb','s@x','PENDING',1000,'PENDING','AUD',50,'ABSORB',1000,'fee-ev1',1);
   $BASE_ORDER, payment_total_cents) VALUES ('org-a','event-1','S-none','s@x','PENDING',1000,'PENDING','AUD',1000);"
expect_error "S10. a fee refund larger than the fee is refused" "UPDATE event_orders SET platform_fee_refunded_cents = 51 WHERE purchaser_name='S-pass';" "refunded_cents_check"
expect_error "S11. a policy that an order has snapshotted cannot be deleted (NO ACTION)" "DELETE FROM ticketing_fee_policies WHERE id='fee-org';" "event_orders_fee_policy_fkey"
echo "  -- rollback order --"
PRE_ROLLBACK_SNAP="$(echo "$SNAPSHOT_SQL" | psql_query | tr -d '[:space:]')"
expect_error "M9. dropping the policy table while order snapshots reference it is refused" "DROP TABLE ticketing_fee_policies;" "depends on|dependent objects"
expect_success "M10. rollback in the documented order succeeds" \
  "ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_fee_policy_fkey, DROP CONSTRAINT IF EXISTS event_orders_fee_snapshot_check, DROP CONSTRAINT IF EXISTS event_orders_fee_mode_check, DROP CONSTRAINT IF EXISTS event_orders_platform_fee_cents_check, DROP CONSTRAINT IF EXISTS event_orders_payment_total_cents_check, DROP CONSTRAINT IF EXISTS event_orders_refunded_cents_check, DROP CONSTRAINT IF EXISTS event_orders_fee_tax_treatment_check;
   DROP INDEX IF EXISTS idx_event_orders_fee_policy_id;
   ALTER TABLE event_orders DROP COLUMN IF EXISTS platform_fee_cents, DROP COLUMN IF EXISTS fee_mode, DROP COLUMN IF EXISTS payment_total_cents, DROP COLUMN IF EXISTS fee_policy_id, DROP COLUMN IF EXISTS fee_policy_version, DROP COLUMN IF EXISTS fee_percent_bps, DROP COLUMN IF EXISTS fee_fixed_per_order_cents, DROP COLUMN IF EXISTS fee_fixed_per_ticket_cents, DROP COLUMN IF EXISTS fee_min_cents, DROP COLUMN IF EXISTS fee_max_cents, DROP COLUMN IF EXISTS fee_tax_treatment, DROP COLUMN IF EXISTS fee_label, DROP COLUMN IF EXISTS refunded_cents, DROP COLUMN IF EXISTS platform_fee_refunded_cents;
   DROP TABLE IF EXISTS ticketing_fee_policies;"
ROLLED_SNAP="$(echo "$SNAPSHOT_SQL" | psql_query | tr -d '[:space:]')"
expect_val "M11. pre-existing rows are still byte-identical after rollback (total_cents and discount_cents survive)" "$ROLLED_SNAP" "$PRE_ROLLBACK_SNAP"
expect_true "M12. the migration re-applies cleanly after rollback" "cat '$NEW_MIGRATION' | psql_exec"

echo ""
echo "=== Z: the BrainBase default — no policy row — reserves exactly as before ==="
reset_db; bootstrap
seed_type tt-adult 4000 10; seed_type tt-child 2000 10; seed_type tt-vip 10000 2
seed_promo p-early EARLY20 PERCENT 10 NULL
expect_eq "Z0. with no policy rows anywhere, the resolution subquery yields NULL (platform default)" "$(resolve_policy_sql org-a event-1)" ""
expect_success "Z1. the brief's cart with EARLY20 reserves" "$(PROMO_ID=p-early PROMO_CODE=EARLY20 LINE_DISCOUNTS_OVERRIDE='800,400,1000' paid_cart_sql Z-Early "NOW() + interval '30 minutes'" '' tt-adult:2 tt-child:2 tt-vip:1)"
expect_eq "Z2. ticket 19800, fee 0, no mode, payment 19800, no policy" "$(snapshot_of Z-Early)" "19800/0/-/19800/-/-"
expect_eq "Z3. every fee input column is NULL on a no-fee order" "SELECT count(*) FROM event_orders WHERE purchaser_name='Z-Early' AND fee_percent_bps IS NULL AND fee_fixed_per_order_cents IS NULL AND fee_fixed_per_ticket_cents IS NULL AND fee_min_cents IS NULL AND fee_max_cents IS NULL AND fee_tax_treatment IS NULL AND fee_label IS NULL;" "1"
expect_success "Z4. a cart without a code reserves too" "$(paid_cart_sql Z-Plain "NOW() + interval '30 minutes'" '' tt-adult:1)"
expect_eq "Z5. 4000/0/-/4000" "$(snapshot_of Z-Plain)" "4000/0/-/4000/-/-"

echo ""
echo "=== F: the brief's cart under a fee policy — snapshot, both modes, immutability, refund ==="
reset_db; bootstrap
seed_type tt-adult 4000 10; seed_type tt-child 2000 10; seed_type tt-vip 10000 2
seed_promo p-early EARLY20 PERCENT 10 NULL
seed_policy fee-org org-a NULL PASS_THROUGH 250 30 0 true "version = 3"
expect_eq "F0. the organisation-level policy resolves for event-1" "SELECT (fee_policy->>'id')||'/'||(fee_policy->>'fee_mode')||'/'||(fee_policy->>'version') FROM ($(resolve_policy_sql org-a event-1 | sed 's/;$//')) r;" "fee-org/PASS_THROUGH/3"
expect_success "F1. 2 Adult + 2 Child + 1 VIP with EARLY20 under PASS_THROUGH 2.5% + \$0.30 reserves" \
  "$(PROMO_ID=p-early PROMO_CODE=EARLY20 LINE_DISCOUNTS_OVERRIDE='800,400,1000' POLICY_ID=fee-org POLICY_VERSION=3 FEE_MODE=PASS_THROUGH FEE_BPS=250 FEE_FIXED_ORDER=30 paid_cart_sql F-Pass "NOW() + interval '30 minutes'" '' tt-adult:2 tt-child:2 tt-vip:1)"
expect_val "F2. harness arithmetic (lib/events/feeCalculation.ts mirror): fee 525, customer 20325" "$(FEE_BPS=250 FEE_FIXED_ORDER=30 compute_fee 19800 5)/$((19800 + $(FEE_BPS=250 FEE_FIXED_ORDER=30 compute_fee 19800 5)))" "525/20325"
expect_eq "F3. order snapshot: ticket 19800 / fee 525 / PASS_THROUGH / payment 20325 / fee-org v3" "$(snapshot_of F-Pass)" "19800/525/PASS_THROUGH/20325/fee-org/3"
expect_eq "F4. inputs snapshotted: 250 bps, 30 per order, 0 per ticket, UNSPECIFIED, 'Booking fee'; gross derived 22000" \
  "SELECT fee_percent_bps||'/'||fee_fixed_per_order_cents||'/'||fee_fixed_per_ticket_cents||'/'||fee_tax_treatment||'/'||fee_label||'/'||(total_cents+discount_cents) FROM event_orders WHERE purchaser_name='F-Pass';" "250/30/0/UNSPECIFIED/Bookingfee/22000"
expect_success "F5. the policy is changed (10% + \$5) and then disabled" "UPDATE ticketing_fee_policies SET percent_bps = 1000, fixed_per_order_cents = 500, version = version + 1 WHERE id='fee-org'; UPDATE ticketing_fee_policies SET enabled = false, version = version + 1 WHERE id='fee-org';"
expect_eq "F6. ...the existing order's snapshot is unchanged (invariant: policy edits never touch orders)" "$(snapshot_of F-Pass)" "19800/525/PASS_THROUGH/20325/fee-org/3"
expect_eq "F7. ...and a disabled row resolves as 'no fee' (enabled=false) for the next cart" "SELECT (fee_policy->>'enabled') FROM ($(resolve_policy_sql org-a event-1 | sed 's/;$//')) r;" "false"
expect_success "F8. the order is PAID (webhook) then REFUNDED with the fee reversed (the refund UPDATE as orderTransitions.ts writes it)" \
  "UPDATE event_orders SET status='CONFIRMED', payment_status='PAID', paid_at=now(), stripe_payment_intent_id='pi_test' WHERE purchaser_name='F-Pass';
   UPDATE event_orders SET payment_status = 'REFUNDED', refunded_at = now(), status = 'CANCELLED', refunded_cents = COALESCE(20325::int, payment_total_cents, total_cents), platform_fee_refunded_cents = platform_fee_cents WHERE purchaser_name='F-Pass' AND organisation_id='org-a' AND payment_status = 'PAID';"
expect_eq "F9. refunded 20325 (the customer's full payment), fee reversed 525, snapshot intact" "SELECT refunded_cents||'/'||platform_fee_refunded_cents||'/'||payment_total_cents||'/'||platform_fee_cents FROM event_orders WHERE purchaser_name='F-Pass';" "20325/525/20325/525"
expect_eq "F10. a second refund UPDATE matches no row (payment_status no longer PAID)" "WITH u AS (UPDATE event_orders SET refunded_cents = 1 WHERE purchaser_name='F-Pass' AND payment_status='PAID' RETURNING id) SELECT count(*) FROM u;" "0"
seed_policy fee-ev1 org-a "'event-1'" ABSORB 250 30 0 true
expect_eq "F11. an enabled event-level ABSORB row now wins over the (disabled) organisation row" "SELECT (fee_policy->>'id')||'/'||(fee_policy->>'fee_mode') FROM ($(resolve_policy_sql org-a event-1 | sed 's/;$//')) r;" "fee-ev1/ABSORB"
expect_eq "F12. ...while event-2 still resolves the organisation row" "SELECT (fee_policy->>'id') FROM ($(resolve_policy_sql org-a event-2 | sed 's/;$//')) r;" "fee-org"
expect_success "F13. the same cart under ABSORB reserves" \
  "$(PROMO_ID=p-early PROMO_CODE=EARLY20 LINE_DISCOUNTS_OVERRIDE='800,400,1000' POLICY_ID=fee-ev1 POLICY_VERSION=1 FEE_MODE=ABSORB FEE_BPS=250 FEE_FIXED_ORDER=30 paid_cart_sql F-Absorb "NOW() + interval '30 minutes'" '' tt-adult:2 tt-child:2 tt-vip:1)"
expect_eq "F14. ABSORB snapshot: ticket 19800 / fee 525 / payment 19800 (customer total unchanged)" "$(snapshot_of F-Absorb)" "19800/525/ABSORB/19800/fee-ev1/1"
expect_eq "F15. organiser reporting: ticket revenue Σ total_cents vs platform fees vs customer paid are three distinct figures" \
  "SELECT SUM(total_cents)||'/'||SUM(platform_fee_cents)||'/'||SUM(payment_total_cents) FROM event_orders WHERE purchaser_name IN ('F-Pass','F-Absorb');" "39600/1050/40125"
seed_type tt-x 100 10
expect_success "F16. clamps: a \$1.00 cart with min 200 -> fee 200, customer 300 (PASS_THROUGH)" "$(POLICY_ID=fee-ev1 POLICY_VERSION=1 FEE_MODE=PASS_THROUGH FEE_BPS=250 FEE_FIXED_ORDER=30 FEE_MIN=200 FEE_MAX=1000 paid_cart_sql F-Min "NOW() + interval '30 minutes'" '' tt-x:1)"
expect_eq "F17. 100/200/PASS_THROUGH/300" "$(snapshot_of F-Min)" "100/200/PASS_THROUGH/300/fee-ev1/1"
expect_error "F18. the same \$1.00 cart under ABSORB with a 200 fee is unrepresentable (fee > ticket) — the service fails closed before reaching here" \
  "$(POLICY_ID=fee-ev1 POLICY_VERSION=1 FEE_MODE=ABSORB FEE_BPS=250 FEE_FIXED_ORDER=30 FEE_MIN=200 paid_cart_sql F-AbsorbTooBig "NOW() + interval '30 minutes'" '' tt-x:1)" "fee_snapshot_check"

echo ""
echo "=== C: fee columns do not weaken promotion/capacity locking under concurrency ==="
reset_db; bootstrap
for i in $(seq 1 20); do seed_type "tt-c$i" 1000 100; eval "PRICE_tt_c$i=1000"; done
seed_promo p-lim LIMIT10 PERCENT 10 10
seed_policy fee-org org-a NULL PASS_THROUGH 250 30 0 true
rm -f "$CONC_DIR"/*.sql "$CONC_DIR"/*.out
# Each cart is generated separately (its own attendee UUIDs) and buys a
# DIFFERENT ticket type, so only the promotion row is contended; pg_sleep(4)
# after the first lock guarantees all 20 connections genuinely overlap.
for i in $(seq 1 20); do
  PROMO_ID=p-lim PROMO_CODE=LIMIT10 LINE_DISCOUNTS_OVERRIDE='100' POLICY_ID=fee-org POLICY_VERSION=1 FEE_MODE=PASS_THROUGH FEE_BPS=250 FEE_FIXED_ORDER=30 paid_cart_sql "C-$i" "NOW() + interval '30 minutes'" 'SELECT pg_sleep(4);' "tt-c$i:1" > "$CONC_DIR/c$i.sql"
done
for i in $(seq 1 20); do
  (docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$CONC_DIR/c$i.sql" > "$CONC_DIR/c$i.out" 2>&1 || true) &
done
wait
expect_eq "C1. 20 concurrent fee-bearing carts sharing LIMIT10 commit exactly 10" "SELECT count(*) FROM event_orders WHERE promotion_code_id='p-lim';" "10"
expect_eq "C2. every committed order carries the coherent fee snapshot (900 net, 53 fee, 953 paid)" "SELECT count(*) FROM event_orders WHERE promotion_code_id='p-lim' AND total_cents=900 AND platform_fee_cents=53 AND payment_total_cents=953 AND fee_mode='PASS_THROUGH';" "10"
expect_true "C3. no deadlock on any connection; the 10 refusals are clean zero-row gates, not errors" "! grep -qiE 'deadlock|ERROR' $CONC_DIR/c*.out"

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
exit 0
