#!/usr/bin/env bash
# Data Hub 5A.2K.2 — real disposable-Postgres integration harness for the
# CSV-only live vertical slice: the new inspectCsvWorksheet.ts service and
# the two new HTTP routes (inspect, confirm-illegal-dumping) wrapping it
# and the existing K.1 confirmWorksheet.ts.
#
# Extends the exact disposable-container methodology established by
# scripts/tests/verify-confirm-worksheet.sh (5A.2K.1): a fresh
# postgres:16-alpine container, created and destroyed by this script only,
# never touching Production/Neon or any already-running database.
#
# WHAT THIS DOES: starts the container, applies the identical bootstrap
# schema (organisations/users/uploads/illegal_dumping) used by
# verify-confirm-worksheet.sh, the real scripts/create-import-batches.sql
# migration, then runs `npx vitest run --config vitest.integration.config.ts
# scripts/tests/dataHubK2.integration.test.ts` — exercising the real,
# unmodified inspectCsvWorksheet.ts, confirmWorksheet.ts, and both new
# route POST handlers against real Postgres, never a hand-duplicated copy
# of their SQL/Prisma calls.
#
# WHAT THIS DOES NOT DO: it is not wired into CI in this phase (same as
# every other harness above). It never makes a live Vercel Blob network
# call (the storage adapter is mocked with an in-memory implementation)
# and never connects to Neon/Production (DATABASE_URL always points at
# the disposable container this script itself creates).
#
# USAGE:
#   bash scripts/tests/verify-datahub-k2.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION="$REPO_ROOT/scripts/create-import-batches.sql"
CONTAINER="datahub-5a2k2-harness-$$"
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

echo "Applying bootstrap schema (organisations/users/uploads/illegal_dumping)..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
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

-- illegal_dumping — hand-reproduced from prisma/schema.prisma's
-- IllegalDumping model, identical to verify-confirm-worksheet.sh's own
-- bootstrap, so the real confirmWorksheet.ts's
-- tx.illegalDumping.createMany() call can be exercised against genuine
-- Postgres CHECK/constraint behaviour.
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

CREATE TABLE illegal_dumping (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  upload_id TEXT REFERENCES uploads(id),
  report_date TIMESTAMP NOT NULL,
  location TEXT NOT NULL,
  suburb TEXT,
  zone TEXT,
  waste_type TEXT NOT NULL,
  volume_estimate TEXT,
  severity "Severity" NOT NULL DEFAULT 'MEDIUM',
  status "IncidentStatus" NOT NULL DEFAULT 'OPEN',
  crew_assigned TEXT,
  resolution_date TIMESTAMP,
  cost_estimate DOUBLE PRECISION,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX ON illegal_dumping (organisation_id);
CREATE INDEX ON illegal_dumping (status);
CREATE INDEX ON illegal_dumping (report_date);
CREATE INDEX ON illegal_dumping (suburb);
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
npx vitest run --config vitest.integration.config.ts scripts/tests/dataHubK2.integration.test.ts
RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo "PASS: Data Hub K.2 (CSV-only live vertical) integration suite."
else
  echo "FAIL: Data Hub K.2 (CSV-only live vertical) integration suite (exit $RESULT)."
fi

exit $RESULT
