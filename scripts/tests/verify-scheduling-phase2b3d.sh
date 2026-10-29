#!/usr/bin/env bash
# Scheduling Phase 2B.3d: disposable-Postgres proof of the READ-ONLY availability calendar (API and read path), plus regression of the zones and availability suites. Adapted from the 2B.3c script, whose host and schema setup it shares.
# Suites, run in this order (the first applies 034, 035 and 036 itself and rolls 036 and 035 back, so it must run first):
#   scripts/tests/schedulingCalendarApi2b3d.integration.test.ts                          the calendar HTTP API: access, input, tenant isolation, hours, closures, pinned zones, holds, daylight saving, read only
#   packages/scheduling-postgres/tests/availabilityCalendar.integration.test.ts           the read path: live holds (half-open, released, tenant, permission), zones fed to the shared model, nothing written
#   availabilityZones + availabilityIntegrity (regression)                                owner-pinned zones (036) and the 034 guards
#
# Starts a FRESH postgres container (never touches Production, Neon or any running database), builds a BrainBase-shaped host (the real
# registry scripts, organisations with a nullable timezone, users, audit_logs), applies the shared schema in order (010, 030-033), proves the
# availability routes FAIL CLOSED before 034, then applies 034 (and, inside the 2B.3c suites, 035 and its rollback).
#
# USAGE   bash scripts/tests/verify-scheduling-phase2b3d.sh [PG_MAJOR]      (default 17; run it for 16 and 17)
# Not wired into CI (Docker is not part of the standard CI workflow in this repo).

set -uo pipefail

PG_MAJOR="${1:-17}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_DIR="$REPO_ROOT/packages/scheduling/sql"
HOST_DIR="$REPO_ROOT/scripts/scheduling"
NAME="sched2b3d-proof-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
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
-- audit_logs as production defines it (Prisma timestamp without time zone, JSONB states).
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id), action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT,
  before_state JSONB, after_state JSONB, ip_address TEXT, user_agent TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE zz_committed (id TEXT PRIMARY KEY);
SQL
psql_f "$REPO_ROOT/scripts/create-modules.sql" >/dev/null || exit 2
psql_f "$REPO_ROOT/scripts/create-organisation-modules.sql" >/dev/null || exit 2

echo "== approved scheduling schema (010, 030-033) and host scripts (110, 120); 034 and 035 are NOT applied yet"
for f in 010_shared_schema 030_resource_concurrency 031_reservation_integrity 032_schedule_archive_ordering 033_occurrence_integrity; do psql_f "$SQL_DIR/$f.sql" >/dev/null || exit 2; done
psql_f "$HOST_DIR/110_brainbase_host.sql" >/dev/null || exit 2
psql_f "$HOST_DIR/120_brainbase_capability.sql" >/dev/null || exit 2

export SCHEDULING_TEST_DATABASE_URL="$URL"
RC=0
echo "== 1. the calendar API: access, input, tenant isolation, empty state, hours, closures, pinned zones, holds, daylight saving, read-only (applies 034, 035, 036 itself and rolls 036 and 035 back)"
npx vitest run --config vitest.integration.config.ts --reporter=verbose scripts/tests/schedulingCalendarApi2b3d.integration.test.ts || RC=1

echo "== 2. the calendar read path on real PostgreSQL: live holds (half-open, released, tenant, permission), pinned zones fed to the shared model, nothing written"
npx vitest run --config vitest.integration.config.ts --reporter=verbose packages/scheduling-postgres/tests/availabilityCalendar.integration.test.ts || RC=1

echo "== 3. regression: owner-pinned zones (036) and the 2B.3b/2B.3c availability suites on the same schema"
# one file per run: two files in one run execute in parallel and race on the shared catalogue (CREATE OR REPLACE FUNCTION: "tuple concurrently updated")
npx vitest run --config vitest.integration.config.ts --reporter=dot packages/scheduling-postgres/tests/availabilityIntegrity.integration.test.ts || RC=1
npx vitest run --config vitest.integration.config.ts --reporter=dot packages/scheduling-postgres/tests/availabilityZones.integration.test.ts || RC=1

if [ "$RC" -eq 0 ]; then echo "SCHEDULING 2B.3d PROOF (PG $PG_MAJOR): PASS"; else echo "SCHEDULING 2B.3d PROOF (PG $PG_MAJOR): FAIL"; fi
exit "$RC"
