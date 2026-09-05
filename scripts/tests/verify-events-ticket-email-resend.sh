#!/usr/bin/env bash
# Phase 7 — "Resend ticket email". Real-Postgres proof of the three
# genuinely new pieces of SQL this feature introduces (none of which
# were exercised by any prior harness):
#   (a) the order+attendees eligibility/data query in
#       app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts
#       (GROUP BY + json_agg + FILTER, one row per order regardless of
#       how many order_items/attendees it has);
#   (b) the 60-second cooldown lookup (EXTRACT(EPOCH FROM (now() -
#       created_at))) against audit_logs;
#   (c) the ticket-email-resend audit INSERT itself
#       (lib/events/auditLog.ts's logTicketEmailResent), including its
#       jsonb after_state cast and the real FK constraints audit_logs
#       carries to organisations/users in prisma/schema.prisma.
#
# WHY A BASH+PSQL HARNESS: same reason as every other disposable-
# Postgres harness in this repo — lib/db.ts's neon() driver speaks
# Neon's proprietary HTTPS protocol and cannot connect to an ordinary
# local/disposable postgres:16-alpine container.
#
# Schema applied here is either the REAL migration scripts verbatim
# (create-events.sql, create-events-phase2.sql, add-events-payments.sql,
# add-events-ticketing.sql) or, for audit_logs (which has no standalone
# .sql migration file in this repo — see add-events-order-notes.sql's
# own header, which explicitly notes audit_logs is untouched by that
# migration), a CREATE TABLE transcribed directly from
# prisma/schema.prisma's AuditLog model (@@map("audit_logs")) — same
# columns, same nullability, same FKs — never a hand-simplified
# substitute. This is the exact discipline the audit_logs.detail
# incident earlier this session established as non-negotiable.
#
# Requires only Docker. Not wired into CI. Creates and destroys its own
# disposable container; never touches Production, DEV, or any shared/
# persistent database.
#
# USAGE:
#   bash scripts/tests/verify-events-ticket-email-resend.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

CONTAINER="events-ticket-email-resend-harness-$$"
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

# For EXTRACT(EPOCH FROM (now() - created_at)) results: real wall-clock
# time elapses between the INSERT and the SELECT in this script, so an
# exact-seconds match is not meaningful — only that it falls in the
# expected window.
check_range() {
  local label="$1" actual="$2" min="$3" max="$4"
  if [ "$actual" -ge "$min" ] && [ "$actual" -le "$max" ]; then
    echo "  PASS: $label (got '$actual', within [$min,$max])"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label — expected within [$min,$max], got '$actual'"
    FAIL=$((FAIL + 1))
    FAILURES+=("$label — expected within [$min,$max], got '$actual'")
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
INSERT INTO users (id) VALUES ('staff-1');
SQL
echo "  organisations + users created, seeded"

echo ""
echo "=== APPLY THE REAL EVENTS SCHEMA (verbatim .sql files, in dependency order) ==="
cat "$REPO_ROOT/scripts/create-events.sql" | psql_exec
cat "$REPO_ROOT/scripts/create-events-phase2.sql" | psql_exec
cat "$REPO_ROOT/scripts/add-events-payments.sql" | psql_exec
cat "$REPO_ROOT/scripts/add-events-ticketing.sql" | psql_exec
echo "  events/event_orders/event_order_items/event_attendees ready"

echo ""
echo "=== APPLY audit_logs (transcribed verbatim from prisma/schema.prisma's AuditLog model) ==="
cat <<'SQL' | psql_exec
CREATE TABLE audit_logs (
  id              TEXT        PRIMARY KEY,
  organisation_id TEXT        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id         TEXT        REFERENCES users(id),
  action          TEXT        NOT NULL,
  resource_type   TEXT        NOT NULL,
  resource_id     TEXT,
  before_state    JSONB,
  after_state     JSONB,
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_logs (organisation_id);
CREATE INDEX ON audit_logs (resource_type, resource_id);
CREATE INDEX ON audit_logs (created_at DESC);
SQL
echo "  audit_logs ready"

echo ""
echo "=== SEED TEST DATA ==="
cat <<'SQL' | psql_exec
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
VALUES ('event-a', 'org-a', 'Test Event', 'test-event', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide');

INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity)
VALUES ('ticket-1', 'event-a', 'org-a', 'General Admission', 2500, 100);

-- order-eligible: CONFIRMED + PAID, two attendees, BOTH with issued
-- ticket_tokens — the eligible, multi-attendee case.
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status)
VALUES ('order-eligible', 'org-a', 'event-a', 'Jane Doe', 'jane@example.invalid', 'CONFIRMED', 5000, 'PAID');
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity)
VALUES ('item-eligible', 'org-a', 'order-eligible', 'event-a', 'ticket-1', 2);
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token)
VALUES
  ('attendee-e1', 'org-a', 'event-a', 'order-eligible', 'item-eligible', 'Jane Doe', repeat('a', 64)),
  ('attendee-e2', 'org-a', 'event-a', 'order-eligible', 'item-eligible', 'Bob Jones', repeat('b', 64));

-- order-pending: PENDING payment, attendees exist but NO ticket_token
-- issued yet (matches lib/events/stripe.ts's real issuance gate).
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status)
VALUES ('order-pending', 'org-a', 'event-a', 'Carol White', 'carol@example.invalid', 'PENDING', 2500, 'PENDING');
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity)
VALUES ('item-pending', 'org-a', 'order-pending', 'event-a', 'ticket-1', 1);
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token)
VALUES ('attendee-p1', 'org-a', 'event-a', 'order-pending', 'item-pending', 'Carol White', NULL);

-- order-refunded: a REFUNDED order whose attendee's token STILL
-- resolves at the row level (matches lib/events/publicTicket.ts's own
-- documented behaviour) — eligibility must still reject it because
-- payment_status = 'REFUNDED' is not in ('NOT_REQUIRED','PAID').
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, refunded_at)
VALUES ('order-refunded', 'org-a', 'event-a', 'Dave Refunded', 'dave@example.invalid', 'CANCELLED', 2500, 'REFUNDED', now());
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity)
VALUES ('item-refunded', 'org-a', 'order-refunded', 'event-a', 'ticket-1', 1);
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token)
VALUES ('attendee-r1', 'org-a', 'event-a', 'order-refunded', 'item-refunded', 'Dave Refunded', repeat('c', 64));

-- order-free: NOT_REQUIRED payment (free ticket), CONFIRMED, token
-- issued — the free-order eligible case.
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status)
VALUES ('order-free', 'org-a', 'event-a', 'Erin Free', 'erin@example.invalid', 'CONFIRMED', 0, 'NOT_REQUIRED');
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity)
VALUES ('item-free', 'org-a', 'order-free', 'event-a', 'ticket-1', 1);
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token)
VALUES ('attendee-f1', 'org-a', 'event-a', 'order-free', 'item-free', 'Erin Free', repeat('d', 64));

-- Cross-tenant: a different organisation, same purchaser name "Jane
-- Doe", must never surface when queried under org-a.
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
VALUES ('event-b', 'org-b', 'Other Org Event', 'other-org-event', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide');
INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity)
VALUES ('ticket-b1', 'event-b', 'org-b', 'General', 0, 100);
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status)
VALUES ('order-b1', 'org-b', 'event-b', 'Jane Doe', 'jane@example.invalid', 'CONFIRMED', 0, 'NOT_REQUIRED');
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity)
VALUES ('item-b1', 'org-b', 'order-b1', 'event-b', 'ticket-b1', 1);
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token)
VALUES ('attendee-b1', 'org-b', 'event-b', 'order-b1', 'item-b1', 'Jane Doe', repeat('e', 64));
SQL
echo "  seeded: order-eligible (2 attendees w/ tokens), order-pending (no tokens), order-refunded, order-free, order-b1 (org-b)"

# ─────────────────────────────────────────────────────────────────────
# (a) ORDER+ATTENDEES QUERY — mirrors the resend route's own
# SELECT ... GROUP BY eo.id, e.name exactly (table aliases, join
# structure, json_agg/FILTER shape).
# ─────────────────────────────────────────────────────────────────────

order_query() {
  local order_id="$1" org_id="$2" event_id="${3:-event-a}"
  local base="
    SELECT eo.status, eo.payment_status, eo.purchaser_email,
      COALESCE(
        json_agg(json_build_object('name', ea.attendee_name, 'ticket_token', ea.ticket_token)) FILTER (WHERE ea.id IS NOT NULL),
        '[]'
      )::text AS attendees
    FROM event_orders eo
    JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
    JOIN event_order_items oi ON oi.order_id = eo.id AND oi.organisation_id = eo.organisation_id
    LEFT JOIN event_attendees ea ON ea.order_item_id = oi.id AND ea.organisation_id = oi.organisation_id
    WHERE eo.id = \$1 AND eo.event_id = \$3 AND eo.organisation_id = \$2
    GROUP BY eo.id, e.name
  "
  {
    echo "PREPARE order_q AS $base;"
    echo "EXECUTE order_q('$order_id', '$org_id', '$event_id');"
    echo "DEALLOCATE order_q;"
  } | psql_query
}

echo ""
echo "=== (a) order-eligible: two attendees, both with tokens ==="
RESULT="$(order_query "order-eligible" "org-a")"
check "status|payment_status|purchaser_email row present" "$(echo "$RESULT" | grep -c 'CONFIRMED|PAID|jane@example.invalid|')" "1"
check "attendees array contains both attendee names" "$(echo "$RESULT" | grep -c 'Jane Doe' )$(echo "$RESULT" | grep -c 'Bob Jones')" "11"

echo ""
echo "=== (a) order-pending: attendee exists but ticket_token is NULL ==="
RESULT="$(order_query "order-pending" "org-a")"
check "attendees array reports a null ticket_token, not an empty array" "$(echo "$RESULT" | grep -c '"ticket_token" : null')" "1"

echo ""
echo "=== (a) cross-tenant: org-b's order is invisible when queried under org-a's organisation_id ==="
RESULT="$(order_query "order-b1" "org-b" "event-b")"
check "org-b's own order-b1 row IS found when queried with org-b + event-b" "$(echo "$RESULT" | grep -c 'jane@example.invalid')" "1"
RESULT_WRONG_ORG="$(order_query "order-b1" "org-a" "event-b")"
check "the SAME order id queried under org-a's organisation_id returns nothing (tenant isolation)" "$(echo -n "$RESULT_WRONG_ORG" | wc -l)" "0"

echo ""
echo "=== (a) unknown order id returns zero rows (404 path) ==="
RESULT="$(order_query "does-not-exist" "org-a")"
check "no row for a nonexistent order id" "$(echo -n "$RESULT" | wc -l)" "0"

# ─────────────────────────────────────────────────────────────────────
# (b) COOLDOWN QUERY — mirrors the resend route's own
# SELECT EXTRACT(EPOCH FROM (now() - created_at))::int ... ORDER BY
# created_at DESC LIMIT 1.
# ─────────────────────────────────────────────────────────────────────

cooldown_query() {
  local order_id="$1"
  local base="
    SELECT EXTRACT(EPOCH FROM (now() - created_at))::int
    FROM audit_logs
    WHERE organisation_id = \$1 AND resource_type = 'event_order' AND resource_id = \$2 AND action = 'event_order.ticket_email_resent'
    ORDER BY created_at DESC
    LIMIT 1
  "
  {
    echo "PREPARE cooldown_q AS $base;"
    echo "EXECUTE cooldown_q('org-a', '$order_id');"
    echo "DEALLOCATE cooldown_q;"
  } | psql_query
}

echo ""
echo "=== (b) no prior attempt -> zero rows, meaning 'not on cooldown' ==="
RESULT="$(cooldown_query "order-eligible")"
check "no audit row yet for order-eligible" "$(echo -n "$RESULT" | wc -l)" "0"

echo ""
echo "=== (b) a recent attempt (10s ago) reports seconds_since < 60 ==="
cat <<SQL | psql_exec
INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state, created_at)
VALUES ('log-recent', 'org-a', 'staff-1', 'event_order.ticket_email_resent', 'event_order', 'order-eligible', NULL, '{"result":"sent"}'::jsonb, now() - interval '10 seconds');
SQL
RESULT="$(cooldown_query "order-eligible")"
check_range "recent attempt reports seconds_since just over 10 (cooldown active, < 60)" "$RESULT" 10 30

echo ""
echo "=== (b) a FAILED attempt still counts toward the cooldown (not just sends) ==="
cat <<SQL | psql_exec
DELETE FROM audit_logs WHERE id = 'log-recent';
INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state, created_at)
VALUES ('log-failed', 'org-a', 'staff-1', 'event_order.ticket_email_resent', 'event_order', 'order-eligible', NULL, '{"result":"failed"}'::jsonb, now() - interval '5 seconds');
SQL
RESULT="$(cooldown_query "order-eligible")"
check_range "a prior 'failed'-result row still blocks the cooldown window, same as a 'sent' row" "$RESULT" 5 30

echo ""
echo "=== (b) an attempt older than 60 seconds no longer blocks ==="
cat <<SQL | psql_exec
DELETE FROM audit_logs WHERE id = 'log-failed';
INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state, created_at)
VALUES ('log-old', 'org-a', 'staff-1', 'event_order.ticket_email_resent', 'event_order', 'order-eligible', NULL, '{"result":"sent"}'::jsonb, now() - interval '90 seconds');
SQL
RESULT="$(cooldown_query "order-eligible")"
check_range "a 90-second-old attempt reports seconds_since well past the 60-second cooldown window" "$RESULT" 90 150
cat <<SQL | psql_exec
DELETE FROM audit_logs WHERE id = 'log-old';
SQL

# ─────────────────────────────────────────────────────────────────────
# (c) AUDIT INSERT — mirrors lib/events/auditLog.ts's
# logTicketEmailResent exactly (literal action/resource_type text,
# NULL before_state, jsonb after_state), against the real FK
# constraints to organisations/users.
# ─────────────────────────────────────────────────────────────────────

echo ""
echo "=== (c) audit insert succeeds with the real schema's FK constraints and jsonb cast ==="
INSERT_OK=$(
  {
    echo "PREPARE audit_ins AS
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      VALUES (\$1, \$2, \$3, 'event_order.ticket_email_resent', 'event_order', \$4, NULL, \$5::jsonb)
      RETURNING id;"
    echo "EXECUTE audit_ins('log-1', 'org-a', 'staff-1', 'order-eligible', '{\"result\":\"sent\",\"recipient_masked\":\"j***@example.invalid\",\"attendee_count\":2,\"provider_message_id\":\"resend-1\"}');"
    echo "DEALLOCATE audit_ins;"
  } | psql_query
)
check "audit insert returns the inserted id" "$INSERT_OK" "log-1"

echo ""
echo "=== (c) after_state round-trips exactly, with the recipient already masked (never the full address) ==="
RESULT="$(echo "SELECT after_state->>'recipient_masked', after_state->>'attendee_count', after_state->>'provider_message_id' FROM audit_logs WHERE id = 'log-1';" | psql_query)"
check "stored after_state matches masked recipient/attendee_count/provider_message_id" "$RESULT" "j***@example.invalid|2|resend-1"

echo ""
echo "=== (c) a NULL user_id (system/unknown actor) is accepted — user_id is nullable ==="
INSERT_OK2=$(
  {
    echo "PREPARE audit_ins2 AS
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      VALUES (\$1, \$2, NULL, 'event_order.ticket_email_resent', 'event_order', \$3, NULL, \$4::jsonb)
      RETURNING id;"
    echo "EXECUTE audit_ins2('log-2', 'org-a', 'order-free', '{\"result\":\"unknown\",\"recipient_masked\":\"e***@example.invalid\",\"attendee_count\":1,\"provider_message_id\":null}');"
    echo "DEALLOCATE audit_ins2;"
  } | psql_query
)
check "audit insert with NULL user_id succeeds" "$INSERT_OK2" "log-2"

echo ""
echo "=== (c) an unknown organisation_id is rejected by the real FK constraint ==="
FK_RESULT=$(
  {
    echo "INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      VALUES ('log-bad', 'org-does-not-exist', 'staff-1', 'event_order.ticket_email_resent', 'event_order', 'order-eligible', NULL, '{}'::jsonb);"
  } | docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 2>&1
  echo "EXIT:$?"
)
check "insert with a nonexistent organisation_id fails (FK constraint enforced)" "$(echo "$FK_RESULT" | grep -c 'foreign key constraint')" "1"

echo ""
echo "=== SUMMARY ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
exit 0
