#!/usr/bin/env bash
# Data Hub 6.2D4B2B -- real disposable-Postgres route integration harness
# for app/api/data-hub/worksheets/[id]/normalize/route.ts (POST + GET).
#
# Extends the exact "prisma db push, drop db-push-created objects, apply the
# real hand-written migrations in order" methodology established by
# scripts/tests/verify-datahub-normalization-executor.sh, then runs
# `npx vitest run --config vitest.integration.config.ts
# scripts/tests/dataHubNormalizeWorksheetRoute.integration.test.ts` --
# exercising the REAL, unmodified route handlers (imported and invoked
# directly) against real Postgres, with lib/org.ts's session resolution
# mocked (a controlled AUTH SEAM) -- the tenant/lease/continuation boundary
# itself, and every B2B2A executor call the route makes, is never mocked.
#
# Never touches Production/Preview/Neon -- DATABASE_URL always points at the
# disposable container this script itself creates and destroys.
#
# USAGE:
#   bash scripts/tests/verify-datahub-normalize-worksheet-route.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
D4A_MIGRATION="$REPO_ROOT/scripts/create-datahub-raw-staging.sql"
D4B_MIGRATION="$REPO_ROOT/scripts/create-datahub-raw-staging-runs.sql"
D4C_B1_MIGRATION="$REPO_ROOT/scripts/create-datahub-normalized-staging.sql"
D4C_B2B1_MIGRATION="$REPO_ROOT/scripts/create-datahub-normalization-findings.sql"
CONTAINER="datahub-6-2d4b2b-route-harness-$$"
HOST_PORT=$((20000 + RANDOM % 20000))

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for f in "$D4A_MIGRATION" "$D4B_MIGRATION" "$D4C_B1_MIGRATION" "$D4C_B2B1_MIGRATION"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: required SQL file not found at $f" >&2
    exit 2
  fi
done

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

export DATABASE_URL="postgresql://postgres:test@localhost:${HOST_PORT}/testdb"
export DIRECT_URL="$DATABASE_URL"
cd "$REPO_ROOT"

DIAG_OUT="$(mktemp 2>/dev/null || echo "/tmp/harness_6_2d4b2b_route_last_out.$$.txt")"
trap 'rm -f "$DIAG_OUT"; cleanup' EXIT

echo "Bootstrapping the full current Prisma schema via db push..."
if ! npx prisma db push --skip-generate --accept-data-loss >"$DIAG_OUT" 2>&1; then
  echo "ERROR: prisma db push failed." >&2; cat "$DIAG_OUT"; exit 2
fi

echo "Dropping db-push-created D4A/D4B/D4C-B1/B2B1 objects imprecisely created by db push..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 <<'SQL' >"$DIAG_OUT" 2>&1
DROP TABLE IF EXISTS data_hub_normalization_findings CASCADE;
DROP TABLE IF EXISTS data_hub_normalized_cells CASCADE;
DROP TABLE IF EXISTS data_hub_normalized_rows CASCADE;
DROP TABLE IF EXISTS data_hub_normalization_runs CASCADE;
DROP TABLE IF EXISTS data_hub_raw_cells CASCADE;
DROP TABLE IF EXISTS data_hub_raw_rows CASCADE;
DROP TABLE IF EXISTS data_hub_raw_staging_runs CASCADE;
ALTER TABLE uploads DROP COLUMN IF EXISTS raw_staged_at;
ALTER TABLE uploads DROP COLUMN IF EXISTS raw_staged_by;
ALTER TABLE uploads DROP COLUMN IF EXISTS raw_profile_version_id;
ALTER TABLE uploads DROP COLUMN IF EXISTS raw_row_count;
ALTER TABLE uploads DROP COLUMN IF EXISTS raw_cell_count;
ALTER TABLE uploads DROP COLUMN IF EXISTS raw_staging_run_id;
ALTER TABLE uploads DROP COLUMN IF EXISTS normalized_at;
ALTER TABLE uploads DROP COLUMN IF EXISTS normalized_by;
ALTER TABLE uploads DROP COLUMN IF EXISTS normalized_profile_version_id;
ALTER TABLE uploads DROP COLUMN IF EXISTS normalized_row_count;
ALTER TABLE uploads DROP COLUMN IF EXISTS normalized_cell_count;
ALTER TABLE uploads DROP COLUMN IF EXISTS normalization_run_id;
DROP INDEX IF EXISTS import_batches_id_schema_version_organisation_key;
DROP INDEX IF EXISTS uploads_id_import_batch_organisation_key;
DROP INDEX IF EXISTS source_schema_worksheets_id_version_organisation_key;
DROP INDEX IF EXISTS worksheet_mapping_profiles_id_worksheet_organisation_key;
DROP INDEX IF EXISTS source_schema_columns_id_worksheet_ordinal_organisation_key;
DROP INDEX IF EXISTS source_schema_columns_raw_evidence_key;
SQL
if [ $? -ne 0 ]; then
  echo "ERROR: drift normalization failed." >&2; cat "$DIAG_OUT"; exit 2
fi

echo "Applying the real D4A -> D4B -> D4C-B1 -> D4C-B2B1 migrations, unmodified, in order..."
for f in "$D4A_MIGRATION" "$D4B_MIGRATION" "$D4C_B1_MIGRATION" "$D4C_B2B1_MIGRATION"; do
  if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$f" >"$DIAG_OUT" 2>&1; then
    echo "ERROR: $(basename "$f") failed to apply." >&2; cat "$DIAG_OUT"; exit 2
  fi
done

echo "DATABASE_URL=$DATABASE_URL (disposable container only)"
echo ""
echo "=== Running the B2B2B normalize-worksheet route integration suite ==="
npx vitest run --config vitest.integration.config.ts scripts/tests/dataHubNormalizeWorksheetRoute.integration.test.ts
RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo "PASS: Data Hub 6.2D4B2B normalize-worksheet route integration suite."
else
  echo "FAIL: Data Hub 6.2D4B2B normalize-worksheet route integration suite (exit $RESULT)."
fi

exit $RESULT
