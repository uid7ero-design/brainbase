#!/usr/bin/env bash
# Events & Ticketing — free registration / paid Checkout stale-reservation
# capacity parity (app/api/public/events/[organisationSlug]/[eventSlug]/
# register/route.ts), a small sibling harness to
# scripts/tests/verify-events-phase2-concurrency.sh (same bootstrap/helper
# conventions, deliberately NOT merged into that file — this proves a
# different, unrelated property and keeps each harness small and focused).
#
# WHY THIS EXISTS: a read-only Events/Ticketing production-readiness audit
# found that the paid Checkout route's "sold" aggregate excludes a PENDING
# paid reservation whose expires_at has passed
# (`AND (payment_status <> 'PENDING' OR expires_at > NOW())`), so an
# abandoned Checkout self-heals for future capacity checks even if its
# checkout.session.expired webhook is delayed or never arrives — but the
# free-registration route's aggregates did NOT carry the same exclusion.
# Failure scenario: a session/ticket type shared between a paid and a free
# ticket type — a free registrant gets a false "sold out" 409 because of
# another purchaser's abandoned paid Checkout, for as long as the expiry
# webhook is delayed. This is a plain WHERE-clause/real-timestamp-
# comparison question, not a snapshot-timing subtlety like R1 — a real
# Postgres NOW() comparison against real inserted timestamps is the
# faithful way to prove it, which a mocked-SQL test cannot do (a mock
# returns whatever a test tells it to, regardless of what the real SQL
# text would actually compute against real data).
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with the ACTUAL, unmodified schema (scripts/create-events.sql +
# scripts/create-events-phase2.sql), then executes the SAME statement
# sequence the free-registration route's sql.transaction([...]) call
# submits (post-fix, including the new predicate), against real rows with
# real past/future expires_at timestamps.
#
# USAGE:
#   bash scripts/tests/verify-events-free-capacity-stale-reservations.sh
#
# Exits 0 if every check passes, non-zero otherwise. Always removes its
# disposable container (trap on EXIT). Never touches Production or any
# already-running database.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVENTS_MIGRATION="$REPO_ROOT/scripts/create-events.sql"
PHASE2_MIGRATION="$REPO_ROOT/scripts/create-events-phase2.sql"
TICKETING_MIGRATION="$REPO_ROOT/scripts/add-events-ticketing.sql"
PAYMENTS_MIGRATION="$REPO_ROOT/scripts/add-events-payments.sql"
CONTAINER="events-free-capacity-stale-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -f "$EVENTS_MIGRATION" ] || [ ! -f "$PHASE2_MIGRATION" ] || [ ! -f "$TICKETING_MIGRATION" ] || [ ! -f "$PAYMENTS_MIGRATION" ]; then
  echo "ERROR: migration file(s) not found." >&2
  exit 2
fi

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

DIAG_OUT="/tmp/events_free_cap_stale_harness_out.$$.txt"

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

# ─── The FIXED free-registration statement sequence, as REAL SQL text ──
# Mirrors app/api/public/events/[organisationSlug]/[eventSlug]/register/
# route.ts's post-fix sql.transaction([...]) array (non-session branch).
# $4 (use_fix) = 1 uses the new predicate, 0 uses the OLD predicate —
# used only by the mutation-proof section at the bottom.
register_ticket_type_sql() {
  local tt_id="$1" purchaser="$2" qty="$3" use_fix="${4:-1}"
  local extra_pred=""
  if [ "$use_fix" = "1" ]; then
    extra_pred="AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())"
  fi
  cat <<SQL
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a' FOR UPDATE;
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = '$tt_id' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED' $extra_pred
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

# Session-bound variant.
register_session_sql() {
  local tt_id="$1" sess_id="$2" purchaser="$3" qty="$4" use_fix="${5:-1}"
  local extra_pred=""
  if [ "$use_fix" = "1" ]; then
    extra_pred="AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())"
  fi
  cat <<SQL
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = '$tt_id' AND organisation_id = 'org-a' FOR UPDATE;
SELECT capacity FROM event_sessions WHERE id = '$sess_id' AND organisation_id = 'org-a' FOR UPDATE;
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = '$tt_id' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED' $extra_pred
),
sold_sess AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.event_session_id = '$sess_id' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED' $extra_pred
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

echo ""
echo "=== BOOTSTRAP ==="
reset_db
bootstrap
echo "  bootstrap applied (real scripts/create-events.sql + scripts/create-events-phase2.sql)"

echo ""
echo "=== A/B. baseline: confirmed free and paid registrations both still consume capacity ==="
expect_success "A. seed capacity=5 ticket type" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-base', 'event-1', 'org-a', 'GA', 0, 5, true);"
expect_success "A. free registration succeeds and consumes capacity" \
  "$(register_ticket_type_sql tt-base FreeP1 2)"
expect_eq "A. confirmed free order consumed 2 of 5" \
  "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.status<>'CANCELLED' WHERE oi.ticket_type_id='tt-base';" "2"
expect_success "B. a CONFIRMED paid order (payment_status irrelevant once status=CONFIRMED) consumes capacity" \
  "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents) VALUES ('order-paid-confirmed', 'org-a', 'event-1', 'PaidConfirmed', 'pc@example.com', 'CONFIRMED', 'PAID', 500); INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('item-paid-confirmed', 'org-a', 'order-paid-confirmed', 'event-1', 'tt-base', 1, 500);"
expect_eq "B. confirmed paid order also counted (now 3 of 5)" \
  "SELECT COALESCE(SUM(oi.quantity),0) FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.status<>'CANCELLED' WHERE oi.ticket_type_id='tt-base';" "3"

echo ""
echo "=== C/D/E. exclusion correctness: active-pending counts, expired-pending doesn't, cancelled doesn't ==="
reset_db; bootstrap
expect_success "seed capacity=1 ticket type" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-cde', 'event-1', 'org-a', 'GA', 0, 1, true);"
expect_success "C. seed a NON-expired PENDING paid reservation (expires_at 20 min in the future)" \
  "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents, expires_at) VALUES ('order-active-hold', 'org-a', 'event-1', 'ActiveHold', 'ah@example.com', 'PENDING', 'PENDING', 500, now() + interval '20 minutes'); INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('item-active-hold', 'org-a', 'order-active-hold', 'event-1', 'tt-cde', 1, 500);"
expect_eq "C. active (non-expired) pending reservation counts toward capacity" \
  "$(cat <<SQL
WITH sold_tt AS (SELECT COALESCE(SUM(oi.quantity),0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.organisation_id=oi.organisation_id WHERE oi.ticket_type_id='tt-cde' AND oi.organisation_id='org-a' AND eo.status<>'CANCELLED' AND (eo.payment_status<>'PENDING' OR eo.expires_at>NOW())) SELECT qty FROM sold_tt;
SQL
)" "1"
expect_success "G. free registration script runs cleanly (rejected via zero-row INSERT, not an error)" \
  "$(register_ticket_type_sql tt-cde FreeBlocked 1)"
expect_eq "G. free registration is correctly REJECTED while this active hold consumes the only slot — no order was created" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name='FreeBlocked';" "0"

reset_db; bootstrap
expect_success "seed capacity=1 ticket type (fresh)" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-cde2', 'event-1', 'org-a', 'GA', 0, 1, true);"
expect_success "D. seed an EXPIRED PENDING paid reservation (expires_at 10 min in the PAST — webhook never arrived)" \
  "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents, expires_at) VALUES ('order-stale-hold', 'org-a', 'event-1', 'StaleHold', 'sh@example.com', 'PENDING', 'PENDING', 500, now() - interval '10 minutes'); INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('item-stale-hold', 'org-a', 'order-stale-hold', 'event-1', 'tt-cde2', 1, 500);"
expect_eq "D. expired pending reservation does NOT count toward capacity" \
  "$(cat <<SQL
WITH sold_tt AS (SELECT COALESCE(SUM(oi.quantity),0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.organisation_id=oi.organisation_id WHERE oi.ticket_type_id='tt-cde2' AND oi.organisation_id='org-a' AND eo.status<>'CANCELLED' AND (eo.payment_status<>'PENDING' OR eo.expires_at>NOW())) SELECT qty FROM sold_tt;
SQL
)" "0"
expect_success "F. free registration SUCCEEDS despite the stale hold (this is the exact bug scenario from the audit)" \
  "$(register_ticket_type_sql tt-cde2 FreeSucceeds 1)"
expect_eq "F. the free registrant's order actually exists" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name='FreeSucceeds';" "1"

reset_db; bootstrap
expect_success "seed capacity=1 ticket type (fresh, for cancelled-order check)" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-cde3', 'event-1', 'org-a', 'GA', 0, 1, true);"
expect_success "E. seed a CANCELLED order holding the only slot" \
  "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents) VALUES ('order-cancelled', 'org-a', 'event-1', 'Cancelled', 'c@example.com', 'CANCELLED', 'FAILED', 500); INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('item-cancelled', 'org-a', 'order-cancelled', 'event-1', 'tt-cde3', 1, 500);"
expect_success "E. free registration succeeds — a cancelled order never consumed capacity, before or after this fix" \
  "$(register_ticket_type_sql tt-cde3 FreeAfterCancel 1)"

echo ""
echo "=== F (mixed, session-bound). same free-succeeds proof for a session-bound ticket type ==="
reset_db; bootstrap
expect_success "seed session capacity=1 (ticket type non-limiting)" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-sess-stale', 'event-1', 'org-a', 'GA', 0, 100, true); INSERT INTO event_sessions (id, event_id, organisation_id, name, starts_at, ends_at, capacity) VALUES ('sess-stale', 'event-1', 'org-a', 'S1', now(), now()+interval '1 hour', 1);"
expect_success "seed an EXPIRED PENDING paid reservation against the session" \
  "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents, expires_at) VALUES ('order-stale-sess', 'org-a', 'event-1', 'StaleSess', 'ss@example.com', 'PENDING', 'PENDING', 500, now() - interval '10 minutes'); INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents) VALUES ('item-stale-sess', 'org-a', 'order-stale-sess', 'event-1', 'tt-sess-stale', 'sess-stale', 1, 500);"
expect_success "F. session-bound free registration succeeds despite the stale session-level hold" \
  "$(register_session_sql tt-sess-stale sess-stale FreeSessSucceeds 1)"
expect_eq "F. the session-bound free registrant's order actually exists" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name='FreeSessSucceeds';" "1"

echo ""
echo "=== H. multiple ticket/session rows continue to aggregate correctly alongside the new exclusion ==="
reset_db; bootstrap
expect_success "seed capacity=3 ticket type" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-multi', 'event-1', 'org-a', 'GA', 0, 3, true);"
expect_success "seed one expired hold (excluded) and one active confirmed order (counted) across two different order rows" \
  "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents, expires_at) VALUES ('order-multi-stale', 'org-a', 'event-1', 'MultiStale', 'ms@example.com', 'PENDING', 'PENDING', 500, now() - interval '5 minutes'); INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('item-multi-stale', 'org-a', 'order-multi-stale', 'event-1', 'tt-multi', 2, 500); INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents) VALUES ('order-multi-confirmed', 'org-a', 'event-1', 'MultiConfirmed', 'mc@example.com', 'CONFIRMED', 'NOT_REQUIRED', 0); INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('item-multi-confirmed', 'org-a', 'order-multi-confirmed', 'event-1', 'tt-multi', 1, 0);"
expect_eq "H. only the confirmed row's quantity (1) counts — the expired hold's quantity (2) is excluded, leaving 2 of 3 remaining" \
  "$(cat <<SQL
WITH sold_tt AS (SELECT COALESCE(SUM(oi.quantity),0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id=oi.order_id AND eo.organisation_id=oi.organisation_id WHERE oi.ticket_type_id='tt-multi' AND oi.organisation_id='org-a' AND eo.status<>'CANCELLED' AND (eo.payment_status<>'PENDING' OR eo.expires_at>NOW())) SELECT qty FROM sold_tt;
SQL
)" "1"
expect_success "H. a registration for the remaining 2 slots succeeds (3 total capacity, 1 already counted, 2 requested)" \
  "$(register_ticket_type_sql tt-multi MultiFill 2)"
expect_success "H. one more unit is correctly rejected (capacity now genuinely exhausted)" \
  "$(register_ticket_type_sql tt-multi MultiOverflow 1)"
expect_eq "H. no orphan order was created by the correctly-rejected attempt" \
  "SELECT count(*) FROM event_orders WHERE purchaser_name='MultiOverflow';" "0"

echo ""
echo "=== I. tenant scoping remains intact — a stale hold in a DIFFERENT organisation never affects this one ==="
reset_db; bootstrap
expect_success "seed a second organisation with its own event/ticket type sharing no rows with org-a" \
  "INSERT INTO organisations (id, name, slug) VALUES ('org-b', 'Org B', 'org-b'); INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone) VALUES ('event-2', 'org-b', 'Other Event', 'other-event', 'PUBLISHED', now(), now()+interval '2 hours', 'Australia/Adelaide'); INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-orgb', 'event-2', 'org-b', 'GA', 0, 1, true); INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-orga', 'event-1', 'org-a', 'GA', 0, 1, true);"
expect_success "I. seed an active (non-expired) pending hold consuming org-b's only slot" \
  "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents, expires_at) VALUES ('order-orgb-hold', 'org-b', 'event-2', 'OrgBHold', 'ob@example.com', 'PENDING', 'PENDING', 500, now()+interval '20 minutes'); INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('item-orgb-hold', 'org-b', 'order-orgb-hold', 'event-2', 'tt-orgb', 1, 500);"
expect_success "I. org-a's own registration is completely unaffected by org-b's hold — still succeeds" \
  "$(register_ticket_type_sql tt-orga OrgAFree 1)"

echo ""
echo "=== MUTATION PROOF — reverting to the OLD (pre-fix) predicate reproduces the false-sold-out bug ==="
reset_db; bootstrap
expect_success "seed capacity=1 ticket type for the mutation proof" \
  "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-mut', 'event-1', 'org-a', 'GA', 0, 1, true);"
expect_success "seed the same EXPIRED PENDING paid reservation as scenario D/F above" \
  "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents, expires_at) VALUES ('order-mut-stale', 'org-a', 'event-1', 'MutStale', 'mut@example.com', 'PENDING', 'PENDING', 500, now() - interval '10 minutes'); INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('item-mut-stale', 'org-a', 'order-mut-stale', 'event-1', 'tt-mut', 1, 500);"
echo "$(register_ticket_type_sql tt-mut MutFree 1 0)" | psql_exec >/dev/null 2>&1
got_mut="$(echo "SELECT count(*) FROM event_orders WHERE purchaser_name='MutFree';" | psql_query | tr -d '[:space:]')"
if [ "$got_mut" = "0" ]; then
  echo "  PASS (mutation proof — the OLD predicate correctly reproduces the false-sold-out bug this fix addresses): free registration was incorrectly rejected (0 orders created) against a stale-but-uncounted hold"
  PASS=$((PASS + 1))
else
  echo "  FAIL (mutation proof did not reproduce the bug — harness may not be sensitive to this defect class): got $got_mut orders, expected 0"
  FAIL=$((FAIL + 1))
  FAILURES+=("mutation proof did not reproduce the false-sold-out bug")
fi

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo "Failed checks:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
