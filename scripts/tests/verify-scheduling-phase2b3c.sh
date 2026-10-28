#!/usr/bin/env bash
# Scheduling Phase 2B.3c: disposable-Postgres proof of everything the availability screens stand on. It re-runs the whole 2B.3b proof
# (repository, migration-034 guards, availability API) and adds the 2B.3c parts:
#   packages/scheduling-postgres/tests/availabilityBatchAndClosures.integration.test.ts   atomic multi-rule creates (overnight windows), staged
#                                                                                          migration 035 (partial-day closures), its rollback
#   packages/scheduling-postgres/tests/availabilityZones.integration.test.ts              migration 036: owner-pinned zones (atomic first write, races, enforcement, backfill, rollback, fail closed)
#   packages/scheduling-postgres/tests/availabilityOvernightDelete.integration.test.ts    removing an overnight window in ONE statement (all or none)
#   scripts/tests/schedulingAvailabilityApi2b3c.integration.test.ts                       the HTTP API for the same: batches, overnight (create and remove), partial-day closures
#                                                                                          before and after 035, audit completeness
#
# Starts a FRESH postgres container (never touches Production, Neon or any running database), builds a BrainBase-shaped host (the real
# registry scripts, organisations with a nullable timezone, users, audit_logs), applies the shared schema in order (010, 030-033), proves the
# availability routes FAIL CLOSED before 034, then applies 034 (and, inside the 2B.3c suites, 035 and its rollback).
#
# USAGE   bash scripts/tests/verify-scheduling-phase2b3c.sh [PG_MAJOR]      (default 17; run it for 16 and 17)
# Not wired into CI (Docker is not part of the standard CI workflow in this repo).

set -uo pipefail

PG_MAJOR="${1:-17}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_DIR="$REPO_ROOT/packages/scheduling/sql"
HOST_DIR="$REPO_ROOT/scripts/scheduling"
NAME="sched2b3c-proof-$$"

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
echo "== 1. before 034: the API fails closed (503) and writes nothing"
npx vitest run --config vitest.integration.config.ts --reporter=verbose scripts/tests/schedulingAvailabilityApi2b3b.integration.test.ts -t "before migration 034" || RC=1

echo "== 2. 2B.3b repository and trigger suite (applies 034 itself, twice)"
npx vitest run --config vitest.integration.config.ts --reporter=verbose packages/scheduling-postgres/tests/availabilityIntegrity.integration.test.ts || RC=1

echo "== 3. 2B.3c repository suite: atomic batches, migration 035, its fail-closed behaviour and rollback"
npx vitest run --config vitest.integration.config.ts --reporter=verbose packages/scheduling-postgres/tests/availabilityBatchAndClosures.integration.test.ts || RC=1

echo "== 3b. atomic removal of an overnight window: all-or-none, version tokens, isolation, concurrency, fail closed"
npx vitest run --config vitest.integration.config.ts --reporter=verbose packages/scheduling-postgres/tests/availabilityOvernightDelete.integration.test.ts || RC=1

echo "== 3c. owner-pinned availability zones (036): atomic first write, concurrent pinning, enforcement, backfill, rollback, fail closed"
npx vitest run --config vitest.integration.config.ts --reporter=verbose packages/scheduling-postgres/tests/availabilityZones.integration.test.ts || RC=1

echo "== 4. after 034: the 2B.3b availability API"
npx vitest run --config vitest.integration.config.ts --reporter=verbose scripts/tests/schedulingAvailabilityApi2b3b.integration.test.ts -t "after migration 034" || RC=1

echo "== 5. 2B.3c availability API: batches, overnight, partial-day closures before and after 035"
npx vitest run --config vitest.integration.config.ts --reporter=verbose scripts/tests/schedulingAvailabilityApi2b3c.integration.test.ts || RC=1

echo "== 6. regression: the 2B.2b configuration API on the same schema"
npx vitest run --config vitest.integration.config.ts --reporter=dot scripts/tests/schedulingConfigApi2b2b.integration.test.ts || RC=1

if [ "$RC" -eq 0 ]; then echo "SCHEDULING 2B.3c PROOF (PG $PG_MAJOR): PASS"; else echo "SCHEDULING 2B.3c PROOF (PG $PG_MAJOR): FAIL"; fi
exit "$RC"
