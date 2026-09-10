#!/usr/bin/env bash
# Data Hub 5B.4B — real disposable-Postgres integration harness for the
# dedicated worksheet mapping-selection service
# (lib/data-hub/importBatch/selectWorksheetMapping.ts).
#
# Reuses the exact bootstrap methodology already established by
# scripts/tests/verify-datahub-source-mapping-services.sh /
# scripts/tests/verify-5b4a-source-atomicity.sh: organisations/users/uploads
# bootstrap, then the real scripts/create-import-batches.sql, then the real
# scripts/create-datahub-source-mappings.sql (unmodified). Runs
# `npx vitest run --config vitest.integration.config.ts
# scripts/tests/selectWorksheetMapping.integration.test.ts` against the
# REAL, unmodified production service function.
#
# Never touches Production/Preview/Neon. Destroys the container on exit
# regardless of outcome.
#
# USAGE:
#   bash scripts/tests/verify-select-worksheet-mapping.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_MIGRATION="$REPO_ROOT/scripts/create-import-batches.sql"
SOURCE_MAPPING_MIGRATION="$REPO_ROOT/scripts/create-datahub-source-mappings.sql"
CONTAINER="datahub-5b4b-mapping-selection-harness-$$"
HOST_PORT=$((20000 + RANDOM % 20000))

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ ! -f "$BASE_MIGRATION" ]; then
  echo "ERROR: base migration file not found at $BASE_MIGRATION" >&2
  exit 2
fi
if [ ! -f "$SOURCE_MAPPING_MIGRATION" ]; then
  echo "ERROR: 5B.1 migration file not found at $SOURCE_MAPPING_MIGRATION" >&2
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
docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$BASE_MIGRATION"
if [ $? -ne 0 ]; then
  echo "ERROR: create-import-batches.sql failed to apply." >&2
  exit 2
fi

echo "Applying scripts/create-datahub-source-mappings.sql (5B.1, unmodified)..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$SOURCE_MAPPING_MIGRATION"
if [ $? -ne 0 ]; then
  echo "ERROR: create-datahub-source-mappings.sql failed to apply." >&2
  exit 2
fi

# connection_limit is widened beyond Prisma's small default pool size
# because this suite's own concurrency tests deliberately issue several
# CONCURRENT selectWorksheetMapping() calls, each of which holds one
# connection open for the full duration of its own interactive
# transaction — a plain, standard Postgres-connector query-string
# parameter, not a Production/Preview concern (this URL is disposable and
# local-only).
export DATABASE_URL="postgresql://postgres:test@localhost:${HOST_PORT}/testdb?connection_limit=20"
echo "DATABASE_URL=$DATABASE_URL (disposable container only)"

echo "Running the integration suite..."
cd "$REPO_ROOT"
npx vitest run --config vitest.integration.config.ts scripts/tests/selectWorksheetMapping.integration.test.ts
RESULT=$?

if [ "$RESULT" -eq 0 ]; then
  echo "PASS: Data Hub 5B.4B worksheet mapping-selection integration suite."
else
  echo "FAIL: Data Hub 5B.4B worksheet mapping-selection integration suite."
fi

exit "$RESULT"
