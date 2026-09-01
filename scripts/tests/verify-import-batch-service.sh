#!/usr/bin/env bash
# Data Hub 5A.2G.1 — real disposable-Postgres integration harness for the
# initiate/finalize/staleReclaim service layer.
#
# Extends the exact disposable-container methodology established by
# scripts/tests/verify-import-batches-migration.sh (5A.2C): a fresh
# postgres:16-alpine container, created and destroyed by this script only,
# never touching Production/Neon or any already-running database.
#
# WHAT THIS DOES: starts the container, applies a minimal bootstrap schema
# (organisations/users — mirroring the 5A.2C harness's own bootstrap) plus
# the real scripts/create-import-batches.sql migration, exports
# DATABASE_URL to point at the container, then runs
# `npx vitest run --config vitest.integration.config.ts`, which collects
# ONLY scripts/tests/importBatchService.integration.test.ts. That spec
# exercises the real, unmodified initiate.ts/finalize.ts/staleReclaim.ts
# service functions — never a hand-duplicated copy of their SQL — proving
# real-Postgres concurrency/fencing/idempotency behavior that no mock can
# substitute for.
#
# WHAT THIS DOES NOT DO: it is not wired into CI in this phase (same as
# the 5A.2C harness). It never makes a live Vercel Blob network call (the
# spec mocks the storage adapter with an in-memory implementation) and
# never connects to Neon/Production (DATABASE_URL always points at the
# disposable container this script itself creates).
#
# USAGE:
#   bash scripts/tests/verify-import-batch-service.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION="$REPO_ROOT/scripts/create-import-batches.sql"
CONTAINER="datahub-5a2g1-service-harness-$$"
HOST_PORT=$((20000 + RANDOM % 20000))

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ ! -f "$MIGRATION" ]; then
  echo "ERROR: migration file not found at $MIGRATION" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 2
fi

echo "Starting disposable postgres:16-alpine ($CONTAINER) on host port $HOST_PORT..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb \
  -p "127.0.0.1:${HOST_PORT}:5432" \
  postgres:16-alpine >/dev/null

READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: postgres in $CONTAINER did not become ready within 30s." >&2
  exit 2
fi

echo "Applying bootstrap schema (organisations/users)..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mimetype TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
SQL
if [ $? -ne 0 ]; then
  echo "ERROR: bootstrap schema failed to apply." >&2
  exit 2
fi

echo "Applying scripts/create-import-batches.sql..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$MIGRATION"
if [ $? -ne 0 ]; then
  echo "ERROR: create-import-batches.sql failed to apply." >&2
  exit 2
fi

export DATABASE_URL="postgresql://postgres:test@localhost:${HOST_PORT}/testdb"
echo "DATABASE_URL=$DATABASE_URL (disposable container only)"

echo "Running the integration suite..."
cd "$REPO_ROOT"
# Explicit file argument (5A.2H.1 addition): vitest.integration.config.ts's
# `include` now also lists scripts/tests/inspectWorksheets.integration.test.ts
# (a separate harness, its own bootstrap schema/enum types) — passing this
# file explicitly ensures this script only ever collects its OWN spec,
# regardless of what else `include` lists.
npx vitest run --config vitest.integration.config.ts scripts/tests/importBatchService.integration.test.ts
RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo "PASS: Data Hub import batch service integration suite."
else
  echo "FAIL: Data Hub import batch service integration suite (exit $RESULT)."
fi

exit $RESULT
