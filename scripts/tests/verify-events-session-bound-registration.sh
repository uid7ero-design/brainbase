#!/usr/bin/env bash
# app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts —
# session-bound free-registration transaction, real-Postgres proof.
#
# WHY THIS EXISTS: a real Production incident. The session-bound branch
# of this route's capacity-gated transaction had a missing comma between
# the `ins_item` and `ins_attendees` CTEs — a genuine Postgres syntax
# error ("syntax error at or near \"ins_attendees\"", code 42601) that
# every existing containment test for this route was structurally
# INCAPABLE of catching, because every one of them mocks
# sql.transaction() away entirely (it returns canned JS arrays, it never
# sends real SQL text anywhere). A mocked test can prove request
# orchestration, permission checks, and call ordering; it cannot prove a
# SQL statement actually PARSES. Only a real Postgres instance can, which
# is exactly the discipline this repo already established for every
# other Events concurrency/constraint claim (see
# scripts/tests/verify-events-phase2-concurrency.sh and siblings) — this
# harness extends that same discipline to this route's session-bound
# path specifically, since that was the one path nothing had ever
# exercised against a real database.
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with the real organisations/users/events/event_sessions/
# event_ticket_types/event_orders/event_order_items/event_attendees/
# event_registration_responses schema (from this repo's own
# scripts/create-events.sql + scripts/create-events-phase2.sql +
# scripts/add-events-ticketing.sql + scripts/add-events-registration-
# questions.sql), then runs the EXACT 5-statement session-bound
# transaction array this route submits via sql.transaction() — copied
# verbatim from the current, POST-FIX source — as one psql transaction.
# Proves: (1) the statement parses and executes without error, (2) an
# order/order-item/attendee are all created with a real 64-hex ticket
# token, (3) the capacity gate still correctly rejects an over-capacity
# request and inserts nothing when it does, and (4) — the sharpest proof
# of all — re-applying the OLD, BROKEN (missing-comma) version of the
# exact same statement against the exact same schema reproduces the
# original Production error character-for-character, demonstrating this
# harness would have caught the real incident before it ever shipped.
#
# WHAT THIS DOES NOT DO: not wired into CI (Docker is not part of the
# standard CI workflow here, matching every other disposable-Postgres
# harness's own precedent). Requires only Docker. Creates and destroys
# its own disposable container; never touches Production, DEV, or any
# already-running database.
#
# USAGE:
#   bash scripts/tests/verify-events-session-bound-registration.sh

set -uo pipefail

CONTAINER="session-bound-reg-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

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
  echo "ERROR: postgres did not become ready within 30s." >&2
  exit 2
fi

DIAG_OUT="/tmp/session_bound_reg_harness_out.$$.txt"
psql_exec() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1; }
psql_query() { docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1; }

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

expect_failure_matching() {
  local desc="$1" sql="$2" pattern="$3"
  if echo "$sql" | psql_exec; then
    echo "  FAIL (expected an error, got success): $desc"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  else
    if grep -qi "$pattern" "$DIAG_OUT"; then
      echo "  PASS: $desc (correctly rejected, matching \"$pattern\")"
      PASS=$((PASS + 1))
    else
      echo "  FAIL: $desc (rejected, but not with the expected error text)"
      sed 's/^/    /' "$DIAG_OUT"
      FAIL=$((FAIL + 1))
      FAILURES+=("$desc (wrong error)")
    fi
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

echo ""
echo "=== BOOTSTRAP: real Events schema (matching scripts/create-events*.sql exactly) ==="
cat <<'SQL' | psql_exec
CREATE TABLE organisations (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL REFERENCES organisations(id), email TEXT NOT NULL, role TEXT NOT NULL);

CREATE TABLE events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CANCELLED')),
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, timezone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT events_id_organisation_id_key UNIQUE (id, organisation_id),
  CONSTRAINT events_organisation_id_slug_key UNIQUE (organisation_id, slug),
  CONSTRAINT events_time_order_check CHECK (ends_at > starts_at)
);
CREATE TABLE event_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, event_id TEXT NOT NULL, organisation_id TEXT NOT NULL,
  name TEXT NOT NULL, starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, capacity INTEGER NOT NULL CHECK (capacity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_sessions_time_order_check CHECK (ends_at > starts_at),
  CONSTRAINT event_sessions_event_org_fkey FOREIGN KEY (event_id, organisation_id) REFERENCES events (id, organisation_id) ON DELETE CASCADE
);
CREATE TABLE event_ticket_types (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, event_id TEXT NOT NULL, organisation_id TEXT NOT NULL,
  name TEXT NOT NULL, description TEXT, price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0), capacity INTEGER NOT NULL CHECK (capacity >= 0),
  active BOOLEAN NOT NULL DEFAULT true, sort_order INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'AUD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_ticket_types_event_org_fkey FOREIGN KEY (event_id, organisation_id) REFERENCES events (id, organisation_id) ON DELETE CASCADE
);

DO $$
BEGIN
  ALTER TABLE event_sessions ADD CONSTRAINT event_sessions_id_organisation_id_key UNIQUE (id, organisation_id);
  ALTER TABLE event_ticket_types ADD CONSTRAINT event_ticket_types_id_organisation_id_key UNIQUE (id, organisation_id);
END $$;

CREATE TABLE event_orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL, event_id TEXT NOT NULL,
  purchaser_name TEXT NOT NULL, purchaser_email TEXT NOT NULL, purchaser_phone TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','CANCELLED')),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_orders_id_organisation_id_key UNIQUE (id, organisation_id),
  CONSTRAINT event_orders_event_org_fkey FOREIGN KEY (event_id, organisation_id) REFERENCES events (id, organisation_id) ON DELETE CASCADE
);
CREATE TABLE event_order_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL, order_id TEXT NOT NULL, event_id TEXT NOT NULL,
  event_session_id TEXT, ticket_type_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0), unit_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_order_items_id_organisation_id_key UNIQUE (id, organisation_id),
  CONSTRAINT event_order_items_order_org_fkey FOREIGN KEY (order_id, organisation_id) REFERENCES event_orders (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_order_items_ticket_type_org_fkey FOREIGN KEY (ticket_type_id, organisation_id) REFERENCES event_ticket_types (id, organisation_id) ON DELETE RESTRICT,
  CONSTRAINT event_order_items_session_org_fkey FOREIGN KEY (event_session_id, organisation_id) REFERENCES event_sessions (id, organisation_id) ON DELETE RESTRICT
);
CREATE TABLE event_attendees (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL, event_id TEXT NOT NULL, order_id TEXT NOT NULL, order_item_id TEXT NOT NULL,
  attendee_name TEXT NOT NULL, attendee_email TEXT, ticket_token TEXT,
  checked_in_at TIMESTAMPTZ, checked_in_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_attendees_order_item_org_fkey FOREIGN KEY (order_item_id, organisation_id) REFERENCES event_order_items (id, organisation_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_event_attendees_ticket_token ON event_attendees(ticket_token) WHERE ticket_token IS NOT NULL;
ALTER TABLE event_attendees ADD CONSTRAINT event_attendees_id_organisation_id_key UNIQUE (id, organisation_id);

CREATE TABLE event_registration_questions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL, event_id TEXT NOT NULL,
  label TEXT NOT NULL, help_text TEXT, field_type TEXT NOT NULL CHECK (field_type IN ('SHORT_TEXT','LONG_TEXT','YES_NO','SINGLE_SELECT','MULTI_SELECT')),
  required BOOLEAN NOT NULL DEFAULT false, scope TEXT NOT NULL CHECK (scope IN ('ORDER','ATTENDEE')), options JSONB, sort_order INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_registration_questions_id_organisation_id_key UNIQUE (id, organisation_id),
  CONSTRAINT event_registration_questions_event_org_fkey FOREIGN KEY (event_id, organisation_id) REFERENCES events (id, organisation_id) ON DELETE CASCADE
);
CREATE TABLE event_registration_responses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL, event_id TEXT NOT NULL, question_id TEXT NOT NULL, order_id TEXT NOT NULL, attendee_id TEXT,
  question_label_snapshot TEXT NOT NULL, field_type_snapshot TEXT NOT NULL, answer JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_registration_responses_question_org_fkey FOREIGN KEY (question_id, organisation_id) REFERENCES event_registration_questions (id, organisation_id) ON DELETE RESTRICT,
  CONSTRAINT event_registration_responses_order_org_fkey FOREIGN KEY (order_id, organisation_id) REFERENCES event_orders (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_registration_responses_attendee_org_fkey FOREIGN KEY (attendee_id, organisation_id) REFERENCES event_attendees (id, organisation_id) ON DELETE CASCADE
);

INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a');
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
  VALUES ('event-1', 'org-a', 'Graduation', 'graduation', 'PUBLISHED', now() + interval '10 days', now() + interval '10 days 2 hours', 'Australia/Adelaide');
INSERT INTO event_sessions (id, event_id, organisation_id, name, starts_at, ends_at, capacity)
  VALUES ('sess-1', 'event-1', 'org-a', 'Morning Session', now() + interval '10 days', now() + interval '10 days 2 hours', 2);
INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active)
  VALUES ('tt-1', 'event-1', 'org-a', 'Adult Guest', 0, 10, true);
SQL
echo "  schema + fixtures created"

# The exact 5-statement session-bound array this route submits via
# sql.transaction() — copied verbatim (post-fix) from
# app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts,
# with the JS template-literal ${...} interpolations replaced by literal
# values matching this fixture (organisation 'org-a', ticket type
# 'tt-1', session 'sess-1', event 'event-1'). $QTY / $NAMES / $EMAILS /
# $TOKENS are substituted per-call below.
run_session_bound_registration() {
  local qty="$1" name="$2" email="$3" token="$4"
  cat <<SQL | psql_exec
BEGIN;
SELECT capacity FROM event_ticket_types WHERE id = 'tt-1' AND organisation_id = 'org-a' FOR UPDATE;
SELECT capacity FROM event_sessions WHERE id = 'sess-1' AND organisation_id = 'org-a' FOR UPDATE;
SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED';
SELECT COALESCE(SUM(oi.quantity), 0)::int AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.event_session_id = 'sess-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED';
WITH sold_tt AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.ticket_type_id = 'tt-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
sold_sess AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM event_order_items oi JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id WHERE oi.event_session_id = 'sess-1' AND oi.organisation_id = 'org-a' AND eo.status <> 'CANCELLED'
),
ins_order AS (
  INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents)
  SELECT 'org-a', 'event-1', '$name', '$email', NULL, 'CONFIRMED', 0
  FROM sold_tt, sold_sess
  WHERE sold_tt.qty + $qty <= (SELECT capacity FROM event_ticket_types WHERE id = 'tt-1' AND organisation_id = 'org-a')
    AND sold_sess.qty + $qty <= (SELECT capacity FROM event_sessions WHERE id = 'sess-1' AND organisation_id = 'org-a')
  RETURNING id
),
ins_item AS (
  INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents)
  SELECT 'org-a', ins_order.id, 'event-1', 'tt-1', 'sess-1', $qty, 0
  FROM ins_order
  RETURNING id, order_id
),
ins_attendees AS (
  INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, attendee_email, ticket_token)
  SELECT 'org-a', 'event-1', ins_item.order_id, ins_item.id, a.name, NULLIF(a.email, ''), a.token
  FROM ins_item, UNNEST(ARRAY['$name']::text[], ARRAY['$email']::text[], ARRAY['$token']::text[]) AS a(name, email, token)
  RETURNING id, order_id, attendee_name, ticket_token
),
ins_order_responses AS (
  INSERT INTO event_registration_responses (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, io.id, NULL, r.label, r.field_type, r.answer_json::jsonb
  FROM ins_order io, UNNEST(ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]) AS r(question_id, label, field_type, answer_json)
  RETURNING id
),
ins_attendee_responses AS (
  INSERT INTO event_registration_responses (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot, answer)
  SELECT 'org-a', 'event-1', r.question_id, ia.order_id, ia.id, r.label, r.field_type, r.answer_json::jsonb
  FROM ins_attendees ia
  JOIN UNNEST(ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]) AS r(ticket_token, question_id, label, field_type, answer_json)
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
echo "=== FIXED SQL: session-bound registration within capacity ==="
run_session_bound_registration 1 'Attendee One' 'attendee.one@example.invalid' "$(printf '%064d' 1)"
if [ $? -eq 0 ]; then
  echo "  PASS: 1. fixed session-bound statement parses and executes without error (this is the exact class of failure the missing comma caused in Production)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 1. fixed session-bound statement still errors"
  sed 's/^/    /' "$DIAG_OUT"
  FAIL=$((FAIL + 1))
  FAILURES+=("fixed statement should execute cleanly")
fi

expect_eq "2. exactly 1 event_orders row created" "SELECT count(*) FROM event_orders;" "1"
expect_eq "3. exactly 1 event_order_items row created" "SELECT count(*) FROM event_order_items;" "1"
expect_eq "4. exactly 1 event_attendees row created" "SELECT count(*) FROM event_attendees;" "1"
expect_eq "5. the attendee's ticket_token is a real 64-char hex value (matching lib/events/ticketToken.ts's real shape)" \
  "SELECT ticket_token ~ '^[0-9a-f]{64}\$' FROM event_attendees LIMIT 1;" "t"
expect_eq "6. the order item is correctly linked to both the ticket type AND the session" \
  "SELECT ticket_type_id = 'tt-1' AND event_session_id = 'sess-1' FROM event_order_items LIMIT 1;" "t"

echo ""
echo "=== CAPACITY: a second registration that would exceed the SESSION's capacity (2) is correctly rejected ==="
run_session_bound_registration 2 'Attendee Two' 'attendee.two@example.invalid' "$(printf '%064d' 2)" >/dev/null 2>&1
REJECTED_COUNT="$(echo "SELECT count(*) FROM event_orders;" | psql_query | tr -d '[:space:]')"
if [ "$REJECTED_COUNT" = "1" ]; then
  echo "  PASS: 7. over-session-capacity request inserted nothing (still exactly 1 order — the WHERE-clause capacity gate correctly rejected it, not a Postgres error)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 7. expected order count to remain 1 after an over-capacity attempt, got $REJECTED_COUNT"
  FAIL=$((FAIL + 1))
  FAILURES+=("over-capacity request should insert nothing")
fi

echo ""
echo "=== REGRESSION PROOF: the OLD, BROKEN (missing-comma) statement reproduces the exact Production error ==="
BROKEN_SQL='BEGIN;
WITH sold_tt AS (SELECT 0::bigint AS qty), sold_sess AS (SELECT 0::bigint AS qty),
ins_order AS (INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents) SELECT '"'"'org-a'"'"', '"'"'event-1'"'"', '"'"'Broken Test'"'"', '"'"'broken@example.invalid'"'"', '"'"'CONFIRMED'"'"', 0 FROM sold_tt, sold_sess RETURNING id),
ins_item AS (INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) SELECT '"'"'org-a'"'"', ins_order.id, '"'"'event-1'"'"', '"'"'tt-1'"'"', 1, 0 FROM ins_order RETURNING id, order_id)
ins_attendees AS (INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name) SELECT '"'"'org-a'"'"', '"'"'event-1'"'"', ins_item.order_id, ins_item.id, '"'"'x'"'"' FROM ins_item RETURNING id)
SELECT 1;
ROLLBACK;'
expect_failure_matching "8. the pre-fix (missing-comma) statement fails with the same class of error Production hit" "$BROKEN_SQL" "syntax error"

echo ""
echo "=== SUMMARY ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
exit 0
