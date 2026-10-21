#!/usr/bin/env bash
# LD Tennis booking capacity: real disposable-Postgres concurrency proof.
#
# Follows the same methodology as scripts/tests/verify-purchase-receipt-concurrency.sh:
# a fresh postgres:16-alpine container created and destroyed by this script only, never
# touching Production/Neon or any already-running database.
#
# WHY: every path that adds a booking to a session instance checks capacity with a separate
# read and then INSERTs (see docs/architecture/ld-tennis-public-booking-overbooking.md). Only
# real MVCC can prove or disprove that race.
#
# MODES
#   before   Schema only, NO guard. Runs bookingCapacityConcurrency.integration.test.ts and
#            EXPECTS IT TO FAIL (the invariant tests must report overbooking). This is the
#            failing regression test that exists before the fix. Exit 0 = failure reproduced.
#   after    Applies scripts/add-booking-capacity-guard.sql TWICE (idempotency), then runs the
#            same suite and EXPECTS IT TO PASS. Exit 0 = fix proven.
#   both     before, then after (default).
#
# USAGE
#   bash scripts/tests/verify-booking-capacity-concurrency.sh [before|after|both]
#
# Not wired into CI (Docker is not part of the standard CI workflow in this repo).

set -uo pipefail

MODE="${1:-both}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD_SQL="$REPO_ROOT/scripts/add-booking-capacity-guard.sql"
TEST_FILE="scripts/tests/bookingCapacityConcurrency.integration.test.ts"
CONTAINERS=()

cleanup() {
  for c in "${CONTAINERS[@]:-}"; do [ -n "$c" ] && docker rm -f "$c" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required." >&2; exit 2; }

# Minimal but real schema. Column-for-column from app/api/admin/migrate-sessions/route.ts
# (sessions, session_instances), app/api/admin/migrate/route.ts (client_pipeline,
# pipeline_messages), prisma/schema.prisma (bookings, contacts) and the real unique index in
# scripts/add-recurring-pause-support.sql. bookings.session_instance_id carries the foreign
# key the Prisma relation implies; the guard does not depend on it.
SCHEMA_SQL='
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, name TEXT NOT NULL, day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 60, max_capacity INTEGER NOT NULL DEFAULT 8,
  session_type TEXT NOT NULL, resource_id TEXT, recurring BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS session_instances (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, organisation_id TEXT NOT NULL,
  date DATE NOT NULL, start_time TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 60,
  max_capacity INTEGER NOT NULL DEFAULT 8, status TEXT NOT NULL DEFAULT '"'"'scheduled'"'"', created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (session_id, date)
);
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text, organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL, email TEXT, phone TEXT, status TEXT NOT NULL DEFAULT '"'"'lead'"'"',
  UNIQUE (organisation_id, email)
);
CREATE TABLE IF NOT EXISTS client_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id),
  submitted_by TEXT REFERENCES users(id), type TEXT NOT NULL DEFAULT '"'"'request'"'"', title TEXT NOT NULL, description TEXT,
  status TEXT NOT NULL DEFAULT '"'"'new'"'"', priority TEXT NOT NULL DEFAULT '"'"'medium'"'"', founder_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS pipeline_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pipeline_id UUID NOT NULL REFERENCES client_pipeline(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id), author_type TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), pipeline_id TEXT,
  client_name TEXT NOT NULL, client_email TEXT, date TIMESTAMP NOT NULL, time TEXT NOT NULL, session_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '"'"'pending_confirmation'"'"', notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now(), confirmed_at TIMESTAMP,
  session_id TEXT REFERENCES sessions(id), paid BOOLEAN NOT NULL DEFAULT false, attendance_status TEXT,
  session_instance_id TEXT REFERENCES session_instances(id), is_recurring BOOLEAN NOT NULL DEFAULT false, recurring_group_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_session_instance_id ON bookings (session_instance_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bookings_instance_recurring_group
  ON bookings (session_instance_id, recurring_group_id)
  WHERE status != '"'"'cancelled'"'"' AND recurring_group_id IS NOT NULL;
-- Test-seam only: Prisma sends string parameters with an explicit text type, whereas the Neon
-- driver lets Postgres infer the parameter type from the target column. This assignment cast
-- (disposable container only) reproduces that inference for the unmodified route SQL, e.g.
-- dashboard/enrolments inserting a to_char() date string into bookings.date.
DO $$ BEGIN
  CREATE CAST (text AS timestamp) WITH INOUT AS ASSIGNMENT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS booking_recurrence_pauses (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text, organisation_id TEXT NOT NULL, recurring_group_id TEXT,
  session_id TEXT NOT NULL, pause_from DATE NOT NULL, pause_until DATE NOT NULL, reason TEXT, created_by TEXT, created_at TIMESTAMP NOT NULL DEFAULT now()
);
'

run_phase() {
  local phase="$1" expect_guard="$2"
  local container="booking-capacity-harness-${phase}-$$"
  local port=$((20000 + RANDOM % 20000))
  CONTAINERS+=("$container")

  echo "[$phase] starting disposable postgres:16-alpine ($container) on host port $port..."
  docker run -d --name "$container" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb \
    -p "127.0.0.1:${port}:5432" postgres:16-alpine >/dev/null || return 2
  local ready=0
  for _ in $(seq 1 40); do
    docker exec "$container" pg_isready -U postgres >/dev/null 2>&1 && { ready=1; break; }
    sleep 1
  done
  [ "$ready" -eq 1 ] || { echo "ERROR: postgres not ready" >&2; return 2; }
  # pg_isready can pass during init before the real server restarts; wait for a real query.
  for _ in $(seq 1 20); do
    docker exec "$container" psql -X -q -U postgres -d testdb -c 'SELECT 1' >/dev/null 2>&1 && break
    sleep 1
  done

  psql_exec() { docker exec -i "$container" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1; }
  echo "$SCHEMA_SQL" | psql_exec || { echo "ERROR: schema failed" >&2; return 2; }

  if [ "$expect_guard" = "1" ]; then
    [ -f "$GUARD_SQL" ] || { echo "ERROR: $GUARD_SQL not found" >&2; return 2; }
    echo "[$phase] applying scripts/add-booking-capacity-guard.sql (run 1 of 2)..."
    psql_exec < "$GUARD_SQL" || { echo "ERROR: guard migration failed (run 1)" >&2; return 2; }
    echo "[$phase] applying scripts/add-booking-capacity-guard.sql (run 2 of 2, idempotency)..."
    psql_exec < "$GUARD_SQL" || { echo "ERROR: guard migration is not idempotent (run 2)" >&2; return 2; }
  fi

  echo "[$phase] running $TEST_FILE (EXPECT_CAPACITY_GUARD=$expect_guard)..."
  (
    cd "$REPO_ROOT" && \
    DATABASE_URL="postgresql://postgres:test@127.0.0.1:${port}/testdb" \
    EXPECT_CAPACITY_GUARD="$expect_guard" \
    npx prisma generate >/dev/null 2>&1; \
    DATABASE_URL="postgresql://postgres:test@127.0.0.1:${port}/testdb" \
    EXPECT_CAPACITY_GUARD="$expect_guard" \
    npx vitest run --config vitest.integration.config.ts "$TEST_FILE" 2>&1
  )
  return $?
}

RC=0
if [ "$MODE" = "before" ] || [ "$MODE" = "both" ]; then
  OUT=$(run_phase before 0); CODE=$?
  echo "$OUT" | grep -E "✓|×|Tests |Test Files|FAIL|AssertionError" | head -60
  if [ "$CODE" -eq 0 ]; then
    echo "RESULT before: UNEXPECTED PASS: the race was NOT reproduced without the guard." ; RC=1
  elif [ "$CODE" -eq 2 ]; then
    echo "RESULT before: harness error"; RC=2
  else
    echo "RESULT before: FAILED AS EXPECTED: overbooking reproduced without the guard."
  fi
fi

if [ "$RC" -eq 0 ] && { [ "$MODE" = "after" ] || [ "$MODE" = "both" ]; }; then
  OUT=$(run_phase after 1); CODE=$?
  echo "$OUT" | grep -E "✓|×|Tests |Test Files|FAIL|AssertionError" | head -60
  if [ "$CODE" -eq 0 ]; then
    echo "RESULT after: PASSED: capacity holds under concurrency with the guard."
  else
    echo "RESULT after: FAILED (exit $CODE)"; RC=1
  fi
fi
exit "$RC"
