#!/usr/bin/env bash
# Data Hub 5A.2H.1 — real disposable-Postgres integration harness for the
# worksheet inspection/persistence service (inspectWorksheets.ts).
#
# Extends the exact disposable-container methodology established by
# scripts/tests/verify-import-batches-migration.sh (5A.2C) and
# scripts/tests/verify-import-batch-service.sh (5A.2G.1): a fresh
# postgres:16-alpine container, created and destroyed by this script only,
# never touching Production/Neon or any already-running database.
#
# WHAT THIS DOES: starts the container, applies a minimal bootstrap schema
# (organisations/users/uploads — identical to verify-import-batch-
# service.sh's own bootstrap) plus the real
# scripts/create-import-batches.sql migration (which adds the worksheet-
# lineage columns/constraints/unique index this service depends on), then
# runs `npx vitest run --config vitest.integration.config.ts
# scripts/tests/inspectWorksheets.integration.test.ts` — exercising the
# real, unmodified inspectWorksheets.ts against real Postgres, never a
# hand-duplicated copy of its SQL/Prisma calls.
#
# WHAT THIS DOES NOT DO: it is not wired into CI in this phase (same as
# the two harnesses above). It never makes a live Vercel Blob network call
# (the spec mocks the storage adapter with an in-memory implementation)
# and never connects to Neon/Production (DATABASE_URL always points at the
# disposable container this script itself creates).
#
# USAGE:
#   bash scripts/tests/verify-inspect-worksheets.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION="$REPO_ROOT/scripts/create-import-batches.sql"
CONTAINER="datahub-5a2h1-inspect-worksheets-harness-$$"
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

echo "Applying bootstrap schema (organisations/users/uploads)..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
-- Full column set matching prisma/schema.prisma's Upload model (this
-- harness's own inspectWorksheets.integration.test.ts drives real
-- prisma.upload.findMany()/createMany() calls, unlike
-- verify-import-batch-service.sh's harness, which only ever touches
-- import_batches via raw SQL and therefore could get away with a minimal
-- uploads bootstrap). Prisma's query engine emits explicit ::"EnumName"
-- casts for enum-typed columns (verified directly against this
-- container), so schema_type/status/module require REAL native Postgres
-- enum types matching prisma/schema.prisma's SchemaType/UploadStatus/
-- Module enums exactly — plain TEXT columns are rejected with
-- "type ... does not exist".
CREATE TYPE "SchemaType" AS ENUM (
  'MISSED_COLLECTIONS', 'ILLEGAL_DUMPING', 'DEBTORS', 'SERVICE_REQUESTS',
  'BIN_MAINTENANCE', 'WASTE_METRICS', 'FINANCIAL', 'GENERIC', 'UNKNOWN'
);
CREATE TYPE "UploadStatus" AS ENUM (
  'PENDING', 'DETECTING', 'VALIDATING', 'PREVIEW_READY', 'IMPORTING', 'COMPLETE', 'FAILED'
);
CREATE TYPE "Module" AS ENUM (
  'WASTE', 'DUMPING', 'FORECASTING', 'MISSED_COLLECTIONS', 'DEBTORS',
  'BIN_MAINTENANCE', 'CONTRACTS', 'OPERATIONS'
);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mimetype TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  schema_type "SchemaType" NOT NULL DEFAULT 'UNKNOWN',
  module "Module",
  status "UploadStatus" NOT NULL DEFAULT 'PENDING',
  row_count INTEGER,
  column_count INTEGER,
  columns_detected JSONB NOT NULL DEFAULT '[]',
  field_mappings JSONB NOT NULL DEFAULT '{}',
  validation_errors JSONB NOT NULL DEFAULT '[]',
  preview_rows JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
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
npx vitest run --config vitest.integration.config.ts scripts/tests/inspectWorksheets.integration.test.ts
RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo "PASS: Data Hub inspectWorksheets integration suite."
else
  echo "FAIL: Data Hub inspectWorksheets integration suite (exit $RESULT)."
fi

exit $RESULT
