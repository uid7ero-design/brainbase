#!/usr/bin/env bash
# Scheduling Phase 2C: disposable-Postgres proof for the booking foundation.
#
# Starts a FRESH postgres container (never touches Production, Neon or any running database), builds a BrainBase-shaped host, applies the shared schema in order
# (010, 030-036 and the host scripts), then runs the Phase 2C suites:
#   packages/scheduling-postgres/tests/availabilityVersions.integration.test.ts   Migration 037: rows, backfill, every bump source, isolation, rollback
#   packages/scheduling-postgres/tests/availabilityAtCommit.integration.test.ts   Phase 2C.0: what is and is not atomic when availability is checked and a booking written
#   packages/scheduling-postgres/tests/bookingReads.integration.test.ts           Phase 2C.2: tenant-scoped range reads, viewer-reduced shape, read-only proof (a READ ONLY connection)
#   scripts/tests/schedulingBookingOverlay2c2.integration.test.ts                  Phase 2C.2: the guarded overlay API (permissions, redaction, bounds)
# Suites that do not exist on the current branch are skipped, so the same script serves the 2C.1 and 2C.2 branches.
#
# USAGE   bash scripts/tests/verify-scheduling-phase2c.sh [PG_MAJOR]      (default 17; run it for 16 and 17)
#         SCHED_KEEP=1 keeps the container and prints its URL (for development); remove it with `docker rm -f <name>`.
# Not wired into CI (Docker is not part of the standard CI workflow in this repo).

set -uo pipefail

PG_MAJOR="${1:-17}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_DIR="$REPO_ROOT/packages/scheduling/sql"
HOST_DIR="$REPO_ROOT/scripts/scheduling"
NAME="sched2c-proof-${PG_MAJOR}-$$"

cleanup() { [ "${SCHED_KEEP:-0}" = "1" ] || docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required." >&2; exit 2; }

psql_c() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_f() { tr -d '\r' < "$1" | psql_c; }   # always apply the committed LF bytes (a Windows checkout is CRLF)

echo "== start postgres:${PG_MAJOR}-alpine"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=pw -p 127.0.0.1::5432 "postgres:${PG_MAJOR}-alpine" -c max_connections=300 >/dev/null || exit 2
for _ in $(seq 1 40); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
PORT="$(docker port "$NAME" 5432/tcp | head -n1 | sed 's/.*://')"
URL="postgres://postgres:pw@127.0.0.1:${PORT}/postgres"
echo "   version: $(docker exec "$NAME" psql -U postgres -Atc 'select version()' | cut -c1-40)"

echo "== BrainBase-shaped host"
psql_c <<'SQL' || exit 2
CREATE TYPE "Plan" AS ENUM ('TRIAL','STARTER','PROFESSIONAL','ENTERPRISE');
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE','SUSPENDED','CHURNED');
CREATE TABLE organisations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, plan "Plan" NOT NULL DEFAULT 'TRIAL',
  status "OrgStatus" NOT NULL DEFAULT 'ACTIVE', settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL, timezone TEXT);
CREATE UNIQUE INDEX organisations_slug_key ON organisations (slug);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), email TEXT, name TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id), action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT,
  before_state JSONB, after_state JSONB, ip_address TEXT, user_agent TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE zz_committed (id TEXT PRIMARY KEY);
SQL
psql_f "$REPO_ROOT/scripts/create-modules.sql" >/dev/null || exit 2
psql_f "$REPO_ROOT/scripts/create-organisation-modules.sql" >/dev/null || exit 2

echo "== approved scheduling schema (010, 030-036) and host scripts (110, 120)"
for f in 010_shared_schema 030_resource_concurrency 031_reservation_integrity 032_schedule_archive_ordering 033_occurrence_integrity 034_availability_integrity 035_availability_partial_closures 036_availability_zones; do psql_f "$SQL_DIR/$f.sql" >/dev/null || exit 2; done
psql_f "$HOST_DIR/110_brainbase_host.sql" >/dev/null || exit 2
psql_f "$HOST_DIR/120_brainbase_capability.sql" >/dev/null || exit 2

export SCHEDULING_TEST_DATABASE_URL="$URL"
export SCHEDULING_PG_CONTAINER="$NAME"
RC=0
run() { # one file per run: two files in one run execute in parallel and race on the shared catalogue
  local f="$1"; shift
  if [ -f "$REPO_ROOT/$f" ]; then
    echo "== $f"
    npx vitest run --config vitest.integration.config.ts --reporter=verbose "$f" || RC=1
  else
    echo "== (skipped: $f is not on this branch)"
  fi
}
run packages/scheduling-postgres/tests/availabilityVersions.integration.test.ts
run packages/scheduling-postgres/tests/availabilityAtCommit.integration.test.ts
run packages/scheduling-postgres/tests/bookingReads.integration.test.ts
run scripts/tests/schedulingBookingOverlay2c2.integration.test.ts

if [ "${SCHED_KEEP:-0}" = "1" ]; then echo "KEPT $NAME  $URL"; fi
if [ "$RC" -eq 0 ]; then echo "SCHEDULING 2C PROOF (PG $PG_MAJOR): PASS"; else echo "SCHEDULING 2C PROOF (PG $PG_MAJOR): FAIL"; fi
exit "$RC"
