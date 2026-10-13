#!/usr/bin/env bash
# Data Hub 6.2D4D1B2 -- real disposable-Postgres proof for the dataset
# profile execution service and D4D5N upload count service. Local throwaway postgres only. Never
# Production/Preview/Neon.
set -uo pipefail

bash -n "$0" || exit 2

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
D4A="$REPO_ROOT/scripts/create-datahub-raw-staging.sql"
D4B="$REPO_ROOT/scripts/create-datahub-raw-staging-runs.sql"
D4C_B1="$REPO_ROOT/scripts/create-datahub-normalized-staging.sql"
D4C_B2B1="$REPO_ROOT/scripts/create-datahub-normalization-findings.sql"
D4D1B1="$REPO_ROOT/scripts/create-datahub-dataset-profiles.sql"
D4D1B2="$REPO_ROOT/scripts/create-datahub-profile-execution.sql"
D4D5Q="$REPO_ROOT/scripts/create-datahub-analysis-reviews.sql"
CONTAINER="datahub-6-2d4d1b2-profile-execution-$$"
HOST_PORT=$((20000 + RANDOM % 20000))

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
}
trap cleanup EXIT

for f in "$D4A" "$D4B" "$D4C_B1" "$D4C_B2B1" "$D4D1B1" "$D4D1B2" "$D4D5Q"; do
  [ -f "$f" ] || { echo "ERROR: missing $f" >&2; exit 2; }
done
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required" >&2; exit 2; }

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
[ "$READY" -eq 1 ] || { echo "ERROR: postgres did not become ready" >&2; exit 2; }

export DATABASE_URL="postgresql://postgres:test@localhost:${HOST_PORT}/testdb"
export DIRECT_URL="$DATABASE_URL"
cd "$REPO_ROOT"
DIAG_OUT="$(mktemp 2>/dev/null || echo "/tmp/d4d1b2-last.$$.txt")"

echo "Bootstrapping the full current Prisma schema via db push..."
if ! npx prisma db push --skip-generate --accept-data-loss >"$DIAG_OUT" 2>&1; then
  echo "ERROR: prisma db push failed." >&2; cat "$DIAG_OUT"; exit 2
fi

echo "Dropping db-push-created D4A/D4B/D4C-B1/B2B1/D4D1B1/D4D1B2 objects imprecisely created by db push..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 <<'SQL' >"$DIAG_OUT" 2>&1
ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_dataset_profile_run_upload_fkey;
ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_id_dataset_profile_run_organisation_key;
ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_profiled_by_fkey;
ALTER TABLE uploads DROP COLUMN IF EXISTS dataset_profile_run_id;
ALTER TABLE uploads DROP COLUMN IF EXISTS profiled_at;
ALTER TABLE uploads DROP COLUMN IF EXISTS profiled_by;
ALTER TABLE uploads DROP COLUMN IF EXISTS profiler_version;

DROP TABLE IF EXISTS data_hub_analysis_reviews CASCADE;
DROP TABLE IF EXISTS data_hub_dataset_profile_columns CASCADE;
DROP TABLE IF EXISTS data_hub_dataset_profile_runs CASCADE;
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

echo "Applying the real D4A -> D4B -> D4C-B1 -> D4C-B2B1 -> D4D1B1 -> D4D1B2 migrations, unmodified, in order..."
for f in "$D4A" "$D4B" "$D4C_B1" "$D4C_B2B1" "$D4D1B1" "$D4D1B2" "$D4D5Q" "$D4D5Q"; do
  if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$f" >"$DIAG_OUT" 2>&1; then
    echo "ERROR: $(basename "$f") failed to apply" >&2
    sed 's/^/    /' "$DIAG_OUT"
    exit 2
  fi
done

echo "DATABASE_URL=$DATABASE_URL (disposable container only)"
echo ""
echo "=== Running dataset-profile execution and D4D5N upload count integration proofs ==="
npx vitest run --config vitest.integration.config.ts scripts/tests/dataHubDatasetProfileExecution.integration.test.ts
RESULT=$?

# Opt-in full browser proof uses the same freshly provisioned disposable DB.
# Build the application first; no mocks are installed in the browser flow.
if [ $RESULT -eq 0 ] && [ "${DATAHUB_BROWSER_PROOF:-}" = "1" ]; then
  node scripts/tests/verify-datahub-analysis-runtime.mjs
  RESULT=$?
fi

# Reapply with actual stored history, proving reruns preserve every record.
if [ $RESULT -eq 0 ]; then
  REVIEW_DIGEST=$(docker exec "$CONTAINER" psql -X -A -t -U postgres -d testdb -v ON_ERROR_STOP=1 -c \
    "SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'[]')) FROM data_hub_analysis_reviews r")
  if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$D4D5Q" >"$DIAG_OUT" 2>&1; then
    echo "ERROR: D4D5Q reapplication with stored history failed." >&2; cat "$DIAG_OUT"; RESULT=1
  else
    REVIEW_DIGEST_AFTER=$(docker exec "$CONTAINER" psql -X -A -t -U postgres -d testdb -v ON_ERROR_STOP=1 -c \
      "SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'[]')) FROM data_hub_analysis_reviews r")
    if [ -z "$REVIEW_DIGEST" ] || [ "$REVIEW_DIGEST" != "$REVIEW_DIGEST_AFTER" ]; then
      echo "ERROR: D4D5Q reapplication changed stored review history." >&2; RESULT=1
    fi
  fi
fi

if [ $RESULT -eq 0 ]; then
  echo "PASS: Data Hub 6.2D4D1B2 dataset-profile execution integration suite."
else
  echo "FAIL: Data Hub 6.2D4D1B2 dataset-profile execution integration suite (exit $RESULT)."
fi

exit $RESULT
