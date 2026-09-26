#!/usr/bin/env bash
# Data Hub 6.2D4B remediation — real disposable-Postgres integration
# harness for app/api/data-hub/worksheets/[id]/stage (the multi-request
# lease/continuation seam an independent review found a real bug in).
#
# Unlike the older hand-rolled-minimal-schema harnesses (e.g.
# verify-datahub-initiate-finalize-routes.sh), 6.2D4B's dependency graph
# (SourceSchemaWorksheet/WorksheetMappingProfileVersion/DataHubRawStagingRun/
# etc.) is deep enough that this harness bootstraps the FULL current Prisma
# schema via `prisma db push`, normalizes the handful of columns D4A/D4B's
# own hand-written migrations manage as real constraints/FKs (db push
# creates some of D4A's own pre-existing composite uniques as plain
# indexes rather than named constraints — a cosmetic drift this harness
# corrects before applying the real migrations, exactly as the disposable-
# Postgres proof harnesses used during 6.2D4B's own implementation did),
# then applies the REAL, unmodified scripts/create-datahub-raw-staging.sql
# (D4A) and scripts/create-datahub-raw-staging-runs.sql (D4B, remediated)
# migrations, then runs the real route handler directly against it.
#
# Never touches Production/Preview/Neon — DATABASE_URL always points at
# the disposable container this script itself creates and destroys.
#
# USAGE:
#   bash scripts/tests/verify-datahub-stage-worksheet-route.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
D4A_MIGRATION="$REPO_ROOT/scripts/create-datahub-raw-staging.sql"
D4B_MIGRATION="$REPO_ROOT/scripts/create-datahub-raw-staging-runs.sql"
CONTAINER="datahub-6-2d4b-stage-route-harness-$$"
HOST_PORT=$((20000 + RANDOM % 20000))

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for f in "$D4A_MIGRATION" "$D4B_MIGRATION"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: required migration file not found at $f" >&2
    exit 2
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 2
fi

echo "Starting disposable postgres:16-alpine ($CONTAINER) on host port $HOST_PORT..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
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

export DATABASE_URL="postgresql://postgres:postgres@localhost:${HOST_PORT}/postgres"
export DIRECT_URL="$DATABASE_URL"
cd "$REPO_ROOT"

echo "Bootstrapping the full current Prisma schema via db push..."
npx prisma db push --skip-generate --accept-data-loss >/dev/null
if [ $? -ne 0 ]; then
  echo "ERROR: prisma db push failed." >&2
  exit 2
fi

echo "Dropping db-push-created D4A/D4B tables/columns so the real migrations' own idempotent-create logic runs from scratch..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DROP TABLE IF EXISTS data_hub_raw_cells CASCADE;
DROP TABLE IF EXISTS data_hub_raw_rows CASCADE;
DROP TABLE IF EXISTS data_hub_raw_staging_runs CASCADE;
ALTER TABLE uploads DROP COLUMN IF EXISTS raw_staged_at;
ALTER TABLE uploads DROP COLUMN IF EXISTS raw_staged_by;
ALTER TABLE uploads DROP COLUMN IF EXISTS raw_profile_version_id;
ALTER TABLE uploads DROP COLUMN IF EXISTS raw_row_count;
ALTER TABLE uploads DROP COLUMN IF EXISTS raw_cell_count;
ALTER TABLE uploads DROP COLUMN IF EXISTS raw_staging_run_id;
DROP INDEX IF EXISTS import_batches_id_schema_version_organisation_key;
DROP INDEX IF EXISTS uploads_id_import_batch_organisation_key;
DROP INDEX IF EXISTS source_schema_worksheets_id_version_organisation_key;
DROP INDEX IF EXISTS worksheet_mapping_profiles_id_worksheet_organisation_key;
DROP INDEX IF EXISTS source_schema_columns_id_worksheet_ordinal_organisation_key;
DROP INDEX IF EXISTS source_schema_columns_raw_evidence_key;
SQL
if [ $? -ne 0 ]; then
  echo "ERROR: drift normalization failed." >&2
  exit 2
fi

echo "Applying D4A (scripts/create-datahub-raw-staging.sql, unmodified)..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$D4A_MIGRATION"
if [ $? -ne 0 ]; then
  echo "ERROR: D4A migration failed to apply." >&2
  exit 2
fi

echo "Applying D4B (scripts/create-datahub-raw-staging-runs.sql, remediated)..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$D4B_MIGRATION"
if [ $? -ne 0 ]; then
  echo "ERROR: D4B migration failed to apply." >&2
  exit 2
fi

echo "Running the integration suite..."
npx vitest run --config vitest.integration.config.ts scripts/tests/dataHubStageWorksheetRoute.integration.test.ts
RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo "PASS: Data Hub 6.2D4B stage-route continuation integration suite."
else
  echo "FAIL: Data Hub 6.2D4B stage-route continuation integration suite (exit $RESULT)."
fi

exit $RESULT
