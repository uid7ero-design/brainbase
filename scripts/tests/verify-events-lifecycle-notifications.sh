#!/usr/bin/env bash
# Phase 5B — lifecycle communications. Real-Postgres proof of every piece
# of SQL this phase introduces that a vi.fn() sql mock cannot prove:
#   (a) scripts/create-events-notifications.sql applies cleanly on top of
#       the real Events schema (verbatim migration files, dependency order)
#       and its constraints/indexes/defaults are exactly as designed;
#   (b) the cancel/refund transition CTEs in
#       lib/events/services/orderTransitions.ts schedule exactly one
#       notification per (type, order), return notification_id only for
#       the call that inserted it, and schedule NOTHING when the UPDATE
#       matches zero rows (the conditional guard) — pinned by the same
#       statement text the TypeScript holds (extracted below, not retyped);
#   (c) the EVENT_CANCELLED bulk statement selects exactly the affected
#       orders, is idempotent on repeat, writes one audit row per
#       scheduled notification with a masked recipient, and is
#       organisation-scoped;
#   (d) the reminder scheduler respects reminder_enabled (default false),
#       the 24h window, PUBLISHED status, order state, and the UNIQUE key;
#       and the ineligibility sweep closes only what it should;
#   (e) the claim UPDATE grants exactly ONE winner under concurrent
#       contention (two sessions, same row), is NULL-free, re-checks
#       reminder eligibility, and the stale-lease/exhausted sweeps behave;
#   (f) tenant integrity: the composite FKs refuse a cross-organisation
#       event/order pairing.
#
# WHY A BASH+PSQL HARNESS: lib/db.ts's neon() driver speaks Neon's HTTPS
# protocol and cannot connect to a disposable local container (see every
# sibling harness in this directory). Statements under test are extracted
# from the real .ts sources with their `${...}` placeholders replaced by
# psql variables, so what runs here is what the application runs.
#
# Requires only Docker. Not wired into CI. Creates and destroys its own
# disposable container; never touches Production, Preview, or any shared
# database.
#
# USAGE:
#   bash scripts/tests/verify-events-lifecycle-notifications.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER="events-lifecycle-notifications-harness-$$"
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
# Runs a statement and prints "ok" or the SQLSTATE so a constraint
# violation can be asserted positively.
psql_try() { docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb 2>&1 | sed -n 's/^ERROR:  .*//; /^$/d; p' ; }

# ── Extract the application's own statements from the TypeScript ───────
# The three transition statements live inside sql`...` templates in
# lib/events/services/orderTransitions.ts. We cut each template by its
# unique first line and substitute the `${...}` interpolations with psql
# :'var' bindings — the SQL text itself is never retyped here.
TRANSITIONS="$REPO_ROOT/lib/events/services/orderTransitions.ts"
extract_sql() { # $1 = unique anchor text that starts the statement, $2 = text that ends it
  tr -d '\r' < "$TRANSITIONS" | awk -v start="$1" -v end="$2" '
    index($0, start) { on = 1 }
    on { print }
    on && index($0, end) { exit }
  '
}
subst_vars() {
  sed -e "s/\${refundedCents}/:'refundedCents'/g" \
      -e "s/\${orderId}/:'orderId'/g" \
      -e "s/\${organisationId}/:'organisationId'/g" \
      -e 's/`;$//' -e 's/`$//' -e 's/^[[:space:]]*`//'
}
CANCEL_PENDING_SQL="$(extract_sql "WITH updated AS (" "SELECT updated.id, scheduled.id AS notification_id FROM updated LEFT JOIN scheduled ON TRUE" | subst_vars)"
# The three statements share the same shape; select each by its SET line.
REFUND_SQL="$(tr -d '\r' < "$TRANSITIONS" | awk '/WITH updated AS \(/{buf=""; on=1} on{buf=buf $0 "\n"} on && /SELECT updated.id, scheduled.id AS notification_id/{ if (buf ~ /REFUNDED/) {print buf; exit} on=0 }' | subst_vars)"
CANCEL_PENDING_SQL="$(tr -d '\r' < "$TRANSITIONS" | awk '/WITH updated AS \(/{buf=""; on=1} on{buf=buf $0 "\n"} on && /SELECT updated.id, scheduled.id AS notification_id/{ if (buf ~ /EXPIRED/) {print buf; exit} on=0 }' | subst_vars)"
CANCEL_FREE_SQL="$(tr -d '\r' < "$TRANSITIONS" | awk '/WITH updated AS \(/{buf=""; on=1} on{buf=buf $0 "\n"} on && /SELECT updated.id, scheduled.id AS notification_id/{ if (buf ~ /NOT_REQUIRED/ && buf !~ /EXPIRED/ && buf !~ /REFUNDED/) {print buf; exit} on=0 }' | subst_vars)"
for name in REFUND_SQL CANCEL_PENDING_SQL CANCEL_FREE_SQL; do
  if [ -z "${!name}" ]; then echo "ERROR: could not extract $name from orderTransitions.ts" >&2; exit 2; fi
done
echo "  extracted 3 transition statements from orderTransitions.ts"

NOTIFICATIONS="$REPO_ROOT/lib/events/notifications.ts"
DELIVERY="$REPO_ROOT/lib/events/notificationDelivery.ts"
extract_template() { # $1 = file, $2 = function name -> the first sql`...` body inside it, with ${x} -> :'x'
  tr -d '\r' < "$1" | awk -v fn="$2" '
    index($0, "export async function " fn) { infn = 1 }
    infn && /await sql`/ { on = 1; sub(/.*await sql`/, ""); }
    on { print }
    on && /`;/ { exit }
  ' | sed -e 's/`;$//' \
      -e "s/\${params\.eventId}/:'eventId'/g" -e "s/\${params\.organisationId}/:'organisationId'/g" -e "s/\${params\.actorUserId}/:'actorUserId'/g" \
      -e "s/\${REMINDER_LEAD_HOURS}/24/g" -e "s/\${limit}/200/g" \
      -e "s/\${MAX_ATTEMPTS}/3/g" -e "s/\${LEASE_TIMEOUT_MINUTES}/10/g" \
      -e "s/\${notificationId}/:'notificationId'/g" -e "s/\${claimId}/:'claimId'/g"
}
EVENT_CANCELLED_SQL="$(extract_template "$NOTIFICATIONS" scheduleEventCancelledNotifications)"
REMINDER_SQL="$(extract_template "$NOTIFICATIONS" scheduleEventReminderNotifications)"
EXPIRE_SQL="$(extract_template "$NOTIFICATIONS" expireIneligibleReminderNotifications)"
CLAIM_SQL="$(extract_template "$DELIVERY" claimNotificationDelivery)"
SWEEP_SQL="$(extract_template "$DELIVERY" sweepStaleExhaustedNotificationLeases | sed -e "s/\${limit}/20/g")"
for name in EVENT_CANCELLED_SQL REMINDER_SQL EXPIRE_SQL CLAIM_SQL SWEEP_SQL; do
  if [ -z "${!name}" ]; then echo "ERROR: could not extract $name" >&2; exit 2; fi
done
echo "  extracted 5 statements from notifications.ts / notificationDelivery.ts"

echo ""
echo "=== BOOTSTRAP: organisations/users + the REAL events schema (verbatim .sql files) ==="
cat <<'SQL' | psql_exec
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Org', settings JSONB NOT NULL DEFAULT '{}');
CREATE TABLE users (id TEXT PRIMARY KEY);
INSERT INTO organisations (id) VALUES ('org-a'), ('org-b');
INSERT INTO users (id) VALUES ('staff-1');
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
SQL
for f in create-events.sql create-events-phase2.sql add-events-payments.sql add-events-ticketing.sql add-events-payment-connect.sql add-events-booking-wallet.sql add-events-ticket-email-delivery.sql create-events-ticket-email-deliveries.sql create-events-promotions-presales-sale-windows.sql create-events-ticketing-fees-foundation.sql; do
  tr -d '\r' < "$REPO_ROOT/scripts/$f" | psql_exec
done
echo "  events schema ready (10 real migration files)"

echo ""
echo "=== (a) APPLY scripts/create-events-notifications.sql (verbatim) and verify its shape ==="
tr -d '\r' < "$REPO_ROOT/scripts/create-events-notifications.sql" | psql_exec
check "event_notifications column count" "$(echo "SELECT count(*) FROM information_schema.columns WHERE table_name='event_notifications'" | psql_query)" "29"
check "event_notifications constraint count" "$(echo "SELECT count(*) FROM pg_constraint WHERE conrelid='event_notifications'::regclass" | psql_query)" "13"
check "event_notifications index count" "$(echo "SELECT count(*) FROM pg_indexes WHERE tablename='event_notifications'" | psql_query)" "6"
check "events.reminder_enabled default false" "$(echo "SELECT column_default || '/' || is_nullable FROM information_schema.columns WHERE table_name='events' AND column_name='reminder_enabled'" | psql_query)" "false/NO"
check "re-running the migration is a no-op (IF NOT EXISTS throughout)" "$(tr -d '\r' < "$REPO_ROOT/scripts/create-events-notifications.sql" | psql_exec >/dev/null 2>&1 && echo ok)" "ok"
check "zero notifications after migration" "$(echo "SELECT count(*) FROM event_notifications" | psql_query)" "0"

echo ""
echo "=== SEED ==="
cat <<'SQL' | psql_exec
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
VALUES ('event-a', 'org-a', 'Event A', 'event-a', 'PUBLISHED', now() + interval '3 days', now() + interval '3 days 2 hours', 'Australia/Adelaide'),
       ('event-soon', 'org-a', 'Event Soon', 'event-soon', 'PUBLISHED', now() + interval '6 hours', now() + interval '8 hours', 'Australia/Adelaide'),
       ('event-b', 'org-b', 'Event B', 'event-b', 'PUBLISHED', now() + interval '6 hours', now() + interval '8 hours', 'Australia/Adelaide');
INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity)
VALUES ('tt-free', 'event-a', 'org-a', 'Free', 0, 100), ('tt-paid', 'event-a', 'org-a', 'Paid', 2500, 100),
       ('tt-soon', 'event-soon', 'org-a', 'Soon', 0, 100), ('tt-b', 'event-b', 'org-b', 'B', 0, 100);
-- event-a orders covering every state the bulk EVENT_CANCELLED statement must classify
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents, payment_total_cents, stripe_payment_intent_id, stripe_account_id) VALUES
  ('o-free',     'org-a', 'event-a', 'Free Confirmed', 'free@example.com',     'CONFIRMED', 'NOT_REQUIRED', 0,    0,    NULL,   NULL),
  ('o-paid',     'org-a', 'event-a', 'Paid Confirmed', 'paid@example.com',     'CONFIRMED', 'PAID',         2500, 2500, 'pi_1', 'acct_1'),
  ('o-pending',  'org-a', 'event-a', 'Pending',        'pending@example.com',  'PENDING',   'PENDING',      2500, 2500, NULL,   'acct_1'),
  ('o-refunded', 'org-a', 'event-a', 'Refunded',       'refunded@example.com', 'CANCELLED', 'REFUNDED',     2500, 2500, 'pi_2', 'acct_1'),
  ('o-expired',  'org-a', 'event-a', 'Expired',        'expired@example.com',  'CANCELLED', 'EXPIRED',      2500, 2500, NULL,   'acct_1'),
  ('o-failed',   'org-a', 'event-a', 'Failed',         'failed@example.com',   'PENDING',   'FAILED',       2500, 2500, NULL,   'acct_1'),
  ('o-freecanc', 'org-a', 'event-a', 'Free Cancelled', 'freecanc@example.com', 'CANCELLED', 'NOT_REQUIRED', 0,    0,    NULL,   NULL),
  ('o-noemail',  'org-a', 'event-a', 'No Email',       '  ',                   'CONFIRMED', 'NOT_REQUIRED', 0,    0,    NULL,   NULL),
  ('o-soon',     'org-a', 'event-soon', 'Soon',        'soon@example.com',     'CONFIRMED', 'NOT_REQUIRED', 0,    0,    NULL,   NULL),
  ('o-soon2',    'org-a', 'event-soon', 'Soon Pending','soon2@example.com',    'PENDING',   'PENDING',      2500, 2500, NULL,   'acct_1'),
  ('o-b',        'org-b', 'event-b',  'Org B',         'b@example.com',        'CONFIRMED', 'NOT_REQUIRED', 0,    0,    NULL,   NULL);
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents)
SELECT 'oi-' || id, organisation_id, id, event_id, CASE event_id WHEN 'event-a' THEN (CASE WHEN total_cents > 0 THEN 'tt-paid' ELSE 'tt-free' END) WHEN 'event-soon' THEN 'tt-soon' ELSE 'tt-b' END, 1, total_cents FROM event_orders;
SQL
echo "  seeded 3 events / 11 orders"

echo ""
echo "=== (b) TRANSITION CTEs — cancel free / cancel pending / refund (statements extracted from orderTransitions.ts) ==="
R1="$(echo "$CANCEL_FREE_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v orderId=o-free -v organisationId=org-a)"
check "free cancel: UPDATE matched and scheduled (id|notification_id non-null)" "$(echo "$R1" | awk -F'|' '{print $1 "|" ($2 != "" ? "scheduled" : "null")}')" "o-free|scheduled"
check "free cancel: order is CANCELLED / NOT_REQUIRED" "$(echo "SELECT status || '/' || payment_status FROM event_orders WHERE id='o-free'" | psql_query)" "CANCELLED/NOT_REQUIRED"
check "free cancel: exactly one ORDER_CANCELLED row, pending, deterministic key, recipient copied" "$(echo "SELECT count(*) || '|' || min(status) || '|' || min(idempotency_key) || '|' || min(recipient_email) FROM event_notifications WHERE order_id='o-free'" | psql_query)" "1|pending|event-notification:ORDER_CANCELLED:o-free|free@example.com"
R1b="$(echo "$CANCEL_FREE_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v orderId=o-free -v organisationId=org-a)"
check "repeat free cancel: UPDATE matches zero rows -> no row returned, nothing scheduled" "$(echo "${R1b:-none}")|$(echo "SELECT count(*) FROM event_notifications WHERE order_id='o-free'" | psql_query)" "none|1"
R2="$(echo "$CANCEL_PENDING_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v orderId=o-pending -v organisationId=org-a)"
check "pending cancel: CANCELLED/EXPIRED and one ORDER_CANCELLED row" "$(echo "SELECT status || '/' || payment_status FROM event_orders WHERE id='o-pending'" | psql_query)|$(echo "SELECT count(*) FROM event_notifications WHERE order_id='o-pending' AND notification_type='ORDER_CANCELLED'" | psql_query)" "CANCELLED/EXPIRED|1"
R3="$(echo "$REFUND_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v orderId=o-paid -v organisationId=org-a -v refundedCents=2500)"
check "refund: REFUNDED/CANCELLED, refunded_cents 2500, one ORDER_REFUNDED row" "$(echo "SELECT status || '/' || payment_status || '/' || refunded_cents FROM event_orders WHERE id='o-paid'" | psql_query)|$(echo "SELECT count(*) FROM event_notifications WHERE order_id='o-paid' AND notification_type='ORDER_REFUNDED'" | psql_query)" "CANCELLED/REFUNDED/2500|1"
R3b="$(echo "$REFUND_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v orderId=o-paid -v organisationId=org-a -v refundedCents=2500)"
check "repeat refund: zero rows, still one notification" "${R3b:-none}|$(echo "SELECT count(*) FROM event_notifications WHERE order_id='o-paid'" | psql_query)" "none|1"
check "cross-organisation cancel is a no-op (org-b cannot cancel org-a's order)" "$(echo "$CANCEL_FREE_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v orderId=o-noemail -v organisationId=org-b | sed 's/^$/none/')" ""
check "an order with a blank purchaser email cancels but schedules nothing (notification_id null)" "$(echo "$CANCEL_FREE_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v orderId=o-noemail -v organisationId=org-a)" "o-noemail|"
# Simulate the ON CONFLICT path directly: a pre-existing key for a fresh order.
cat <<'SQL' | psql_exec
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents, payment_total_cents)
VALUES ('o-free2', 'org-a', 'event-a', 'Free 2', 'free2@example.com', 'CONFIRMED', 'NOT_REQUIRED', 0, 0);
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('oi-o-free2', 'org-a', 'o-free2', 'event-a', 'tt-free', 1, 0);
INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key, status)
VALUES ('org-a', 'event-a', 'o-free2', 'ORDER_CANCELLED', 'free2@example.com', 'event-notification:ORDER_CANCELLED:o-free2', 'sent');
SQL
check "ON CONFLICT: cancel of an order whose key already exists still cancels, returns notification_id NULL, inserts nothing" "$(echo "$CANCEL_FREE_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v orderId=o-free2 -v organisationId=org-a)|$(echo "SELECT count(*) || '/' || min(status) FROM event_notifications WHERE order_id='o-free2'" | psql_query)" "o-free2||1/sent"

echo ""
echo "=== (c) EVENT_CANCELLED bulk scheduling (statement extracted from notifications.ts) ==="
check "guard: event not yet CANCELLED -> schedules nothing" "$(echo "$EVENT_CANCELLED_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v eventId=event-a -v organisationId=org-a -v actorUserId=staff-1 | wc -l | tr -d ' ')" "0"
echo "UPDATE events SET status='CANCELLED' WHERE id='event-a'" | psql_exec
N1="$(echo "$EVENT_CANCELLED_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v eventId=event-a -v organisationId=org-a -v actorUserId=staff-1 | wc -l | tr -d ' ')"
# Affected now: o-refunded (REFUNDED before the cancellation) and o-paid (refunded above -> REFUNDED).
# Excluded: o-free / o-free2 (manually cancelled free orders, CANCELLED+NOT_REQUIRED), o-pending (now EXPIRED),
# o-expired, o-failed, o-freecanc, o-noemail (blank purchaser email).
check "bulk: schedules exactly the affected orders (o-paid and o-refunded, both REFUNDED)" "$N1|$(echo "SELECT string_agg(order_id, ',' ORDER BY order_id) FROM event_notifications WHERE notification_type='EVENT_CANCELLED'" | psql_query)" "2|o-paid,o-refunded"
check "bulk: one audit row per scheduled notification, human actor + masked recipient + source" "$(echo "SELECT count(*) || '|' || min(user_id) || '|' || (array_agg(after_state->>'recipient_masked' ORDER BY resource_id))[1] || '|' || min(after_state->>'source') FROM audit_logs WHERE action='event_order.notification_scheduled' AND after_state->>'notification_type'='EVENT_CANCELLED'" | psql_query)" "2|staff-1|p***@example.com|event_cancelled"
check "bulk repeat (second PATCH / re-save): zero new rows, zero new audit rows" "$(echo "$EVENT_CANCELLED_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v eventId=event-a -v organisationId=org-a -v actorUserId=staff-1 | wc -l | tr -d ' ')|$(echo "SELECT count(*) FROM audit_logs WHERE action='event_order.notification_scheduled'" | psql_query)" "0|2"
# A confirmed free order that is still live at cancellation time IS affected: add one and re-run.
cat <<'SQL' | psql_exec
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents, payment_total_cents)
VALUES ('o-free3', 'org-a', 'event-a', 'Free 3', 'free3@example.com', 'CONFIRMED', 'NOT_REQUIRED', 0, 0);
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('oi-o-free3', 'org-a', 'o-free3', 'event-a', 'tt-free', 1, 0);
SQL
check "bulk re-run after a late confirmed free order appears: schedules exactly that one more (o-free3), never the already-scheduled ones" "$(echo "$EVENT_CANCELLED_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v eventId=event-a -v organisationId=org-a -v actorUserId=staff-1 | wc -l | tr -d ' ')|$(echo "SELECT count(*) FROM event_notifications WHERE notification_type='EVENT_CANCELLED'" | psql_query)|$(echo "SELECT after_state->>'recipient_masked' FROM audit_logs WHERE action='event_order.notification_scheduled' AND resource_id='o-free3'" | psql_query)" "1|3|f***@example.com"
check "bulk: org-b calling with org-a's event id schedules nothing (tenant scoped)" "$(echo "$EVENT_CANCELLED_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v eventId=event-a -v organisationId=org-b -v actorUserId=staff-1 | wc -l | tr -d ' ')" "0"

echo ""
echo "=== (d) REMINDERS — opt-in, windowed, idempotent; ineligibility sweep ==="
check "reminders: nothing scheduled while every event has reminder_enabled = false (default)" "$(echo "$REMINDER_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 | wc -l | tr -d ' ')" "0"
echo "UPDATE events SET reminder_enabled = true WHERE id IN ('event-soon', 'event-b')" | psql_exec
R="$(echo "$REMINDER_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 | wc -l | tr -d ' ')"
check "reminders: enabled events inside 24h schedule one reminder per CONFIRMED order (o-soon, o-b), never a PENDING order" "$R|$(echo "SELECT string_agg(order_id, ',' ORDER BY order_id) FROM event_notifications WHERE notification_type='EVENT_REMINDER'" | psql_query)" "2|o-b,o-soon"
check "reminders: audit rows use the system actor + scheduled_job source" "$(echo "SELECT count(*) || '|' || coalesce(min(user_id), 'NULL') || '|' || min(after_state->>'source') FROM audit_logs WHERE after_state->>'notification_type'='EVENT_REMINDER'" | psql_query)" "2|NULL|scheduled_job:event_reminder"
check "reminders: a second sweep schedules nothing (NOT EXISTS + UNIQUE)" "$(echo "$REMINDER_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 | wc -l | tr -d ' ')" "0"
echo "UPDATE events SET reminder_enabled = true WHERE id='event-a'" | psql_exec
check "reminders: an enabled event outside the 24h window (event-a, +3 days, and also CANCELLED) schedules nothing" "$(echo "$REMINDER_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 | wc -l | tr -d ' ')" "0"
# Make o-b's event ineligible (cancelled) and sweep.
echo "UPDATE events SET status='CANCELLED' WHERE id='event-b'" | psql_exec
E="$(echo "$EXPIRE_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 | wc -l | tr -d ' ')"
check "sweep: closes exactly the now-ineligible reminder as terminal failed with a reason; the still-eligible one stays pending" "$E|$(echo "SELECT string_agg(order_id || ':' || status || ':' || coalesce(next_attempt_at::text, 'NULL'), ',' ORDER BY order_id) FROM event_notifications WHERE notification_type='EVENT_REMINDER'" | psql_query)" "1|o-b:failed:NULL,o-soon:pending:NULL"

echo ""
echo "=== (e) CLAIM — single winner under contention, NULL-free, reminder re-check; sweeps ==="
NID="$(echo "SELECT id FROM event_notifications WHERE order_id='o-soon'" | psql_query)"
# Two sessions race for the same row: session A claims inside an open
# transaction and holds the row lock for 2s; session B's identical claim
# blocks on that lock and, once A commits, re-evaluates its WHERE clause
# against the now-'sending' row (READ COMMITTED) -> zero rows. The script
# is piped on stdin (psql does not interpolate :'var' inside -c strings).
printf 'BEGIN;\n%s;\nSELECT pg_sleep(2);\nCOMMIT;\n' "$CLAIM_SQL" | docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 -v notificationId="$NID" -v claimId=claim-A >/dev/null 2>&1 &
sleep 0.7
W="$(echo "$CLAIM_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v notificationId="$NID" -v claimId=claim-B | wc -l | tr -d ' ')"
wait
check "claim contention: the second concurrent claimant wins zero rows" "$W" "0"
check "claim: exactly one lease, claim_id = the winner, attempt_count 1" "$(echo "SELECT status || '|' || claim_id || '|' || attempt_count FROM event_notifications WHERE id='$NID'" | psql_query)" "sending|claim-A|1"
check "claim: a live lease cannot be re-claimed (stale branch requires > 10 min)" "$(echo "$CLAIM_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v notificationId="$NID" -v claimId=claim-C | wc -l | tr -d ' ')" "0"
echo "UPDATE event_notifications SET claimed_at = now() - interval '11 minutes' WHERE id='$NID'" | psql_exec
check "claim: a stale lease (claimed 11 min ago, attempts remain) is reclaimed by a new claim id, attempt_count 2" "$(echo "$CLAIM_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v notificationId="$NID" -v claimId=claim-D | awk -F'|' '{print $2 "|" $3}')" "claim-D|2"
echo "UPDATE event_notifications SET status='failed', claim_id=NULL, claimed_at=NULL, next_attempt_at = now() + interval '5 minutes' WHERE id='$NID'" | psql_exec
check "claim: a failed row whose next_attempt_at is in the future is not claimable" "$(echo "$CLAIM_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v notificationId="$NID" -v claimId=claim-E | wc -l | tr -d ' ')" "0"
echo "UPDATE event_notifications SET next_attempt_at = NULL WHERE id='$NID'" | psql_exec
check "claim: a terminal failed row (next_attempt_at NULL) is never claimable — the NULL branch does not exist" "$(echo "$CLAIM_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v notificationId="$NID" -v claimId=claim-F | wc -l | tr -d ' ')" "0"
echo "UPDATE event_notifications SET next_attempt_at = now() - interval '1 minute' WHERE id='$NID'" | psql_exec
echo "UPDATE events SET status='CANCELLED' WHERE id='event-soon'" | psql_exec
check "claim: a due reminder for an event that was cancelled meanwhile is refused at claim time" "$(echo "$CLAIM_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v notificationId="$NID" -v claimId=claim-G | wc -l | tr -d ' ')" "0"
echo "UPDATE events SET status='PUBLISHED' WHERE id='event-soon'" | psql_exec
check "claim: the same due reminder is claimable again once the event is PUBLISHED, attempt_count 3" "$(echo "$CLAIM_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v notificationId="$NID" -v claimId=claim-H | awk -F'|' '{print $2 "|" $3}')" "claim-H|3"
echo "UPDATE event_notifications SET claimed_at = now() - interval '11 minutes' WHERE id='$NID'" | psql_exec
check "claim: an exhausted stale lease (attempt_count 3) is NOT reclaimable" "$(echo "$CLAIM_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v notificationId="$NID" -v claimId=claim-I | wc -l | tr -d ' ')" "0"
check "sweep: the exhausted stale lease is closed terminal with the documented reason" "$(echo "$SWEEP_SQL" | psql_query | wc -l | tr -d ' ')|$(echo "SELECT status || '|' || coalesce(claim_id,'NULL') || '|' || coalesce(next_attempt_at::text,'NULL') FROM event_notifications WHERE id='$NID'" | psql_query)" "1|failed|NULL|NULL"
NC="$(echo "SELECT id FROM event_notifications WHERE order_id='o-free'" | psql_query)"
check "claim: a historical-fact type (ORDER_CANCELLED) is claimable regardless of current order/event state" "$(echo "$CLAIM_SQL" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 -v notificationId="$NC" -v claimId=claim-J | awk -F'|' '{print $4}')" "ORDER_CANCELLED"

echo ""
echo "=== (f) CONSTRAINTS — tenant integrity, claim/provider consistency, type vocabulary ==="
check "FK: org-b event + org-a order pairing is refused (composite FK)" "$(echo "INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key) VALUES ('org-a', 'event-b', 'o-free', 'EVENT_CANCELLED', 'x@example.com', 'k1')" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb 2>&1 | grep -c 'event_notifications_event_org_fkey')" "1"
check "CHECK: unknown notification type is refused" "$(echo "INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key) VALUES ('org-a', 'event-a', 'o-free', 'MARKETING_BLAST', 'x@example.com', 'k2')" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb 2>&1 | grep -c 'event_notifications_type_check')" "1"
check "CHECK: a 'sending' row without a claim id is refused" "$(echo "UPDATE event_notifications SET status='sending' WHERE order_id='o-pending'" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb 2>&1 | grep -c 'event_notifications_claim_check')" "1"
check "CHECK: provider_message_id and delivery_status must be set together" "$(echo "UPDATE event_notifications SET provider_message_id='msg-x' WHERE id='$NC'" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb 2>&1 | grep -c 'event_notifications_provider_check')" "1"
check "UNIQUE: a second row with the same idempotency key is refused" "$(echo "INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key) VALUES ('org-a', 'event-a', 'o-free', 'ORDER_CANCELLED', 'x@example.com', 'event-notification:ORDER_CANCELLED:o-free')" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb 2>&1 | grep -c 'event_notifications_idempotency_key_key')" "1"
check "historical orders untouched: no event_orders row gained any notification column (schema unchanged) and ticket_email_status is still NULL everywhere" "$(echo "SELECT count(*) FROM information_schema.columns WHERE table_name='event_orders' AND column_name LIKE 'notification%'" | psql_query)|$(echo "SELECT count(*) FROM event_orders WHERE ticket_email_status IS NOT NULL" | psql_query)" "0|0"

echo ""
echo "=== SUMMARY ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
if [ "$FAIL" -ne 0 ]; then
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
exit 0
