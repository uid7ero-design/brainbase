#!/usr/bin/env bash
# lib/events/registrationFilters.ts — real-Postgres proof of the search/
# filter semantics for the Events registration operations phase (list
# route app/api/events/[id]/orders/route.ts, export route
# app/api/events/[id]/orders/export/route.ts).
#
# WHY A BASH+PSQL HARNESS: same reason as every other disposable-
# Postgres harness in this repo — lib/db.ts's neon() driver speaks
# Neon's proprietary HTTPS protocol and cannot connect to an ordinary
# local/disposable postgres:16-alpine container.
#
# WHAT THIS PROVES, and an honest note on what it does NOT verbatim-
# extract: unlike the classification-backfill CTE (one static SQL
# block), buildRegistrationFilterSql() is composed from up to six
# INDEPENDENT conditional fragments — there is no single static
# template to regex-extract the way earlier harnesses in this repo did.
# Instead, this harness:
#   (a) applies the REAL schema migration scripts verbatim (never a
#       hand-invented/simplified column set — the exact lesson from the
#       audit_logs.detail incident this session already hit once);
#   (b) hand-writes SQL that mirrors lib/events/registrationFilters.ts's
#       documented column names, table aliases (eo/oi/ea), and EXISTS
#       scoping precisely (cross-checked against that file directly
#       while writing this harness);
#   (c) executes everything via genuine PREPARE/EXECUTE with real bound
#       parameters — never literal string substitution — matching the
#       exact lesson from the "$8" parameter-typing incident, even
#       though none of these queries pass a bound parameter into a
#       VARIADIC "any" function the way that incident did (every
#       parameter here sits in a directly-typed column-comparison
#       context, so that specific failure class cannot occur — this
#       harness still uses real bound parameters throughout rather than
#       assuming that from first principles).
# A companion containment test (tests/containment/
# eventsRegistrationSearchFilter.test.ts) statically cross-checks that
# the real TypeScript file's SQL text still contains the exact column
# names/EXISTS structure this harness relies on, so a future edit that
# silently diverges from what's tested here has a fast, mocked-sql
# tripwire in addition to this real-Postgres proof.
#
# Requires only Docker + Node. Not wired into CI. Creates and destroys
# its own disposable container; never touches Production, DEV, or any
# shared/persistent database.
#
# USAGE:
#   bash scripts/tests/verify-events-registration-search-filter.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

CONTAINER="events-reg-search-filter-harness-$$"
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

echo "Starting disposable postgres:16-alpine ($CONTAINER)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine >/dev/null

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

echo ""
echo "=== BOOTSTRAP: organisations/users (TEXT ids, matching prisma/schema.prisma) ==="
cat <<'SQL' | psql_exec
CREATE TABLE organisations (id TEXT PRIMARY KEY);
CREATE TABLE users (id TEXT PRIMARY KEY);
INSERT INTO organisations (id) VALUES ('org-a'), ('org-b');
SQL
echo "  organisations + users created, seeded"

echo ""
echo "=== APPLY THE REAL EVENTS SCHEMA (verbatim .sql files, in dependency order) ==="
cat "$REPO_ROOT/scripts/create-events.sql" | psql_exec
cat "$REPO_ROOT/scripts/create-events-phase2.sql" | psql_exec
cat "$REPO_ROOT/scripts/add-events-payments.sql" | psql_exec
cat "$REPO_ROOT/scripts/add-events-ticketing.sql" | psql_exec
echo "  events/event_sessions/event_ticket_types/event_orders/event_order_items/event_attendees ready"

echo ""
echo "=== SEED TEST DATA ==="
cat <<'SQL' | psql_exec
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
VALUES ('event-a', 'org-a', 'Test Event', 'test-event', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide');

INSERT INTO event_sessions (id, event_id, organisation_id, name, starts_at, ends_at, capacity)
VALUES
  ('session-1', 'event-a', 'org-a', 'Morning Session', now(), now() + interval '1 hour', 100),
  ('session-2', 'event-a', 'org-a', 'Afternoon Session', now() + interval '3 hours', now() + interval '4 hours', 100);

INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity)
VALUES
  ('ticket-1', 'event-a', 'org-a', 'General Admission', 2500, 100),
  ('ticket-2', 'event-a', 'org-a', 'VIP', 5000, 50);

-- O1: PAID, CONFIRMED, ticket-1 + session-1, MIXED-ATTENDEE order_item
-- (Alice checked in, Bob not) — the key scenario for checkin=in/out
-- "appears under both filters separately" semantics.
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents, payment_status)
VALUES ('order-1', 'org-a', 'event-a', 'Jane Doe', 'jane@example.invalid', '0412 345 678', 'CONFIRMED', 5000, 'PAID');
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, event_session_id, ticket_type_id, quantity)
VALUES ('item-1', 'org-a', 'order-1', 'event-a', 'session-1', 'ticket-1', 2);
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, checked_in_at)
VALUES
  ('attendee-1', 'org-a', 'event-a', 'order-1', 'item-1', 'Alice Smith', now()),
  ('attendee-2', 'org-a', 'event-a', 'order-1', 'item-1', 'Bob Jones', NULL);

-- O2: PENDING, ticket-2 + session-2, not checked in.
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status)
VALUES ('order-2', 'org-a', 'event-a', 'Carol White', 'carol@example.invalid', 'PENDING', 5000, 'PENDING');
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, event_session_id, ticket_type_id, quantity)
VALUES ('item-2', 'org-a', 'order-2', 'event-a', 'session-2', 'ticket-2', 1);
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name)
VALUES ('attendee-3', 'org-a', 'event-a', 'order-2', 'item-2', 'Carol White');

-- O3: CANCELLED, ticket-1, no session.
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status)
VALUES ('order-3', 'org-a', 'event-a', 'Dave Cancelled', 'dave@example.invalid', 'CANCELLED', 2500, 'NOT_REQUIRED');
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity)
VALUES ('item-3', 'org-a', 'order-3', 'event-a', 'ticket-1', 1);
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name)
VALUES ('attendee-4', 'org-a', 'event-a', 'order-3', 'item-3', 'Dave Cancelled');

-- Cross-tenant: a DIFFERENT organisation, same purchaser name "Jane
-- Doe", same event slug pattern — must never appear in org-a queries.
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
VALUES ('event-b', 'org-b', 'Other Org Event', 'other-org-event', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide');
INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity)
VALUES ('ticket-b1', 'event-b', 'org-b', 'General', 0, 100);
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status)
VALUES ('order-b1', 'org-b', 'event-b', 'Jane Doe', 'jane@example.invalid', 'CONFIRMED', 0, 'NOT_REQUIRED');
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity)
VALUES ('item-b1', 'org-b', 'order-b1', 'event-b', 'ticket-b1', 1);
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name)
VALUES ('attendee-b1', 'org-b', 'event-b', 'order-b1', 'item-b1', 'Jane Doe');
SQL
echo "  seeded: order-1 (mixed check-in), order-2 (pending), order-3 (cancelled), order-b1 (other org)"

# ─────────────────────────────────────────────────────────────────────
# LIST-QUERY HARNESS — mirrors app/api/events/[id]/orders/route.ts's
# FROM/JOIN/GROUP BY, WHERE eo.event_id=$1 AND eo.organisation_id=$2,
# plus one additional hand-written filter condition per scenario below
# (each mirroring the exact column names/EXISTS structure documented in
# lib/events/registrationFilters.ts). Genuine PREPARE/EXECUTE — real
# bound parameters throughout.
# ─────────────────────────────────────────────────────────────────────

list_query_ids() {
  # $1 = extra WHERE fragment (already valid SQL, may reference $3, $4...
  # as needed by the caller), $2.. = the extra bound params for it.
  local extra_where="$1"; shift
  local base="
    SELECT DISTINCT oi.id
    FROM event_orders eo
    JOIN event_order_items oi ON oi.order_id = eo.id AND oi.organisation_id = eo.organisation_id
    LEFT JOIN event_ticket_types tt ON tt.id = oi.ticket_type_id AND tt.organisation_id = oi.organisation_id
    LEFT JOIN event_sessions es ON es.id = oi.event_session_id AND es.organisation_id = oi.organisation_id
    LEFT JOIN event_attendees ea ON ea.order_item_id = oi.id AND ea.organisation_id = oi.organisation_id
    WHERE eo.event_id = \$1 AND eo.organisation_id = \$2
    $extra_where
    ORDER BY oi.id
  "
  {
    echo "PREPARE list_q AS $base;"
    echo "EXECUTE list_q('event-a', 'org-a'$([ $# -gt 0 ] && printf ", %s" "$@" || true));"
    echo "DEALLOCATE list_q;"
  } | psql_query | tr '\n' ',' | sed 's/,$//'
}

echo ""
echo "=== SEARCH: purchaser name ==="
RESULT="$(list_query_ids "AND eo.purchaser_name ILIKE \$3" "'%Jane%'")"
check "purchaser name search 'Jane' matches item-1 only (org-b's Jane excluded by org scope)" "$RESULT" "item-1"

echo ""
echo "=== SEARCH: purchaser email ==="
RESULT="$(list_query_ids "AND eo.purchaser_email ILIKE \$3" "'%carol@%'")"
check "purchaser email search matches item-2 only" "$RESULT" "item-2"

echo ""
echo "=== SEARCH: purchaser phone (digit-normalized) ==="
RESULT="$(list_query_ids "AND regexp_replace(COALESCE(eo.purchaser_phone, ''), '[^0-9]', '', 'g') ILIKE \$3" "'%412345678%'")"
check "phone search tolerates spaces/formatting, matches item-1 only" "$RESULT" "item-1"

echo ""
echo "=== SEARCH: attendee name (EXISTS, same order_item + same org) ==="
RESULT="$(list_query_ids "AND EXISTS (SELECT 1 FROM event_attendees ea2 WHERE ea2.order_item_id = oi.id AND ea2.organisation_id = \$3 AND ea2.attendee_name ILIKE \$4)" "'org-a'" "'%Alice%'")"
check "attendee-name search 'Alice' matches item-1 (via EXISTS)" "$RESULT" "item-1"

echo ""
echo "=== SEARCH: order reference (prefix) ==="
RESULT="$(list_query_ids "AND eo.id ILIKE \$3" "'order-2%'")"
check "order-reference prefix search matches item-2 only" "$RESULT" "item-2"

echo ""
echo "=== FILTER: checkin=in is EXISTENCE-based — matches the MIXED order_item ==="
RESULT="$(list_query_ids "AND EXISTS (SELECT 1 FROM event_attendees ea3 WHERE ea3.order_item_id = oi.id AND ea3.organisation_id = \$3 AND ea3.checked_in_at IS NOT NULL)" "'org-a'")"
check "checkin=in matches item-1 (Alice checked in) — Bob's own non-checked-in state does not exclude the row" "$RESULT" "item-1"

echo ""
echo "=== FILTER: checkin=out ALSO matches the SAME mixed order_item, applied separately ==="
RESULT="$(list_query_ids "AND EXISTS (SELECT 1 FROM event_attendees ea3 WHERE ea3.order_item_id = oi.id AND ea3.organisation_id = \$3 AND ea3.checked_in_at IS NULL)" "'org-a'")"
check "checkin=out matches item-1,item-2,item-3 (item-1 via Bob, item-2/3 via their own unchecked attendee) — proves the mixed order_item legitimately appears under BOTH filters" "$RESULT" "item-1,item-2,item-3"

echo ""
echo "=== FILTER: ticket type narrowing ==="
RESULT="$(list_query_ids "AND oi.ticket_type_id = \$3" "'ticket-1'")"
check "ticketTypeId=ticket-1 matches item-1,item-3 (item-2 uses ticket-2, excluded)" "$RESULT" "item-1,item-3"

echo ""
echo "=== FILTER: session narrowing ==="
RESULT="$(list_query_ids "AND oi.event_session_id = \$3" "'session-1'")"
check "sessionId=session-1 matches item-1 only" "$RESULT" "item-1"

echo ""
echo "=== FILTER: cancellation ==="
RESULT="$(list_query_ids "AND eo.status = 'CANCELLED'")"
check "cancelled=true matches item-3 only" "$RESULT" "item-3"
RESULT="$(list_query_ids "AND eo.status <> 'CANCELLED'")"
check "cancelled=false matches item-1,item-2" "$RESULT" "item-1,item-2"

echo ""
echo "=== FILTER: payment status ==="
RESULT="$(list_query_ids "AND eo.payment_status = \$3" "'PAID'")"
check "paymentStatus=PAID matches item-1 only" "$RESULT" "item-1"
RESULT="$(list_query_ids "AND eo.payment_status = \$3" "'PENDING'")"
check "paymentStatus=PENDING matches item-2 only" "$RESULT" "item-2"

echo ""
echo "=== COMBINED FILTERS: ticketTypeId=ticket-1 AND cancelled=false ==="
RESULT="$(list_query_ids "AND oi.ticket_type_id = \$3 AND eo.status <> 'CANCELLED'" "'ticket-1'")"
check "combined filter excludes item-3 (cancelled) even though it matches ticket-1, leaving item-1 only" "$RESULT" "item-1"

echo ""
echo "=== CROSS-ORGANISATION: org-b's rows never appear when querying org-a ==="
RESULT="$(list_query_ids "AND eo.purchaser_name ILIKE \$3" "'%Jane%'")"
check "cross-org purchaser 'Jane Doe' in org-b is excluded — same result as the earlier plain purchaser-name search" "$RESULT" "item-1"

# ─────────────────────────────────────────────────────────────────────
# CSV-QUERY HARNESS — mirrors app/api/events/[id]/orders/export/
# route.ts's ATTENDEE-GRAIN query (FROM event_attendees, joined UP
# through event_order_items/event_orders), proving one row per
# attendee and the documented "filter selects the order_item, not the
# individual attendee row" CSV semantics.
# ─────────────────────────────────────────────────────────────────────

csv_query_names() {
  local extra_where="$1"; shift
  local base="
    SELECT ea.attendee_name
    FROM event_attendees ea
    JOIN event_order_items oi ON oi.id = ea.order_item_id AND oi.organisation_id = ea.organisation_id
    JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
    WHERE eo.event_id = \$1 AND eo.organisation_id = \$2 AND ea.organisation_id = \$2
    $extra_where
    ORDER BY ea.attendee_name
  "
  {
    echo "PREPARE csv_q AS $base;"
    echo "EXECUTE csv_q('event-a', 'org-a'$([ $# -gt 0 ] && printf ", %s" "$@" || true));"
    echo "DEALLOCATE csv_q;"
  } | psql_query | tr '\n' ',' | sed 's/,$//'
}

echo ""
echo "=== CSV: attendee grain — item-1 (2 attendees) produces 2 rows, not 1 ==="
RESULT="$(csv_query_names "AND oi.id = \$3" "'item-1'")"
check "CSV rows for item-1 are exactly Alice Smith and Bob Jones (attendee grain, not order_item grain)" "$RESULT" "Alice Smith,Bob Jones"

echo ""
echo "=== CSV: checkin=in selects the ORDER_ITEM, not the individual attendee row — Bob's row still appears ==="
RESULT="$(csv_query_names "AND EXISTS (SELECT 1 FROM event_attendees ea3 WHERE ea3.order_item_id = oi.id AND ea3.organisation_id = \$3 AND ea3.checked_in_at IS NOT NULL)" "'org-a'")"
check "checkin=in CSV export includes BOTH Alice (checked in) AND Bob (not checked in, same order_item) — intentional, matches the list route's identical semantics" "$RESULT" "Alice Smith,Bob Jones"

echo ""
echo "=== CSV: checkin=out ALSO includes Alice, for the same reason, applied separately ==="
RESULT="$(csv_query_names "AND EXISTS (SELECT 1 FROM event_attendees ea3 WHERE ea3.order_item_id = oi.id AND ea3.organisation_id = \$3 AND ea3.checked_in_at IS NULL)" "'org-a'")"
check "checkin=out CSV rows include item-1 (Alice+Bob), item-2 (Carol), item-3 (Dave) — Alice's own checked-in state does not exclude her row" "$RESULT" "Alice Smith,Bob Jones,Carol White,Dave Cancelled"

echo ""
echo "=== SUMMARY ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
exit 0
