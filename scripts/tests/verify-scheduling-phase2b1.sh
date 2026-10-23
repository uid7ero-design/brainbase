#!/usr/bin/env bash
# Scheduling Phase 2B.1: disposable-Postgres proof of the access guard, the runtime and the audit trail, using the REAL
# routes, guard, capability lookup, repository and audit module.
#
# Starts a FRESH postgres container (never touches Production, Neon or any running database), builds a BrainBase-shaped
# host (the real registry scripts, organisations with a nullable timezone, users, audit_logs), applies the approved shared
# schema and the 110 and 120 host scripts, then runs scripts/tests/schedulingRuntime2b1.integration.test.ts against it.
# 120 is applied because it registers the capability; no organisation is entitled except by the test fixtures themselves,
# in the disposable database.
#
# USAGE   bash scripts/tests/verify-scheduling-phase2b1.sh [PG_MAJOR]      (default 17, the Neon major version)
# Not wired into CI (Docker is not part of the standard CI workflow in this repo).

set -uo pipefail

PG_MAJOR="${1:-17}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_DIR="$REPO_ROOT/packages/scheduling/sql"
HOST_DIR="$REPO_ROOT/scripts/scheduling"
NAME="sched2b1-proof-$$"

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

echo "== approved scheduling schema and host scripts (010, 110, 120)"
psql_f "$SQL_DIR/010_shared_schema.sql" >/dev/null || exit 2
psql_f "$HOST_DIR/110_brainbase_host.sql" >/dev/null || exit 2
psql_f "$HOST_DIR/120_brainbase_capability.sql" >/dev/null || exit 2

echo "== run the real-Postgres suite"
SCHEDULING_TEST_DATABASE_URL="$URL" npx vitest run --config vitest.integration.config.ts --reporter=verbose scripts/tests/schedulingRuntime2b1.integration.test.ts
RC=$?
if [ "$RC" -eq 0 ]; then echo "SCHEDULING 2B.1 PROOF: PASS"; else echo "SCHEDULING 2B.1 PROOF: FAIL"; fi
exit "$RC"
