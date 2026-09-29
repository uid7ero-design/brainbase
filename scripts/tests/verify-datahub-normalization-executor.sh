#!/usr/bin/env bash
# Data Hub 6.2D4B2A -- real disposable-Postgres integration harness for the
# resumable normalization executor service (dataHubNormalizationRun.ts,
# normalizeWorksheetRows.ts, completeNormalizationRun.ts).
#
# Extends the exact "prisma db push, drop db-push-created objects, apply the
# real hand-written migrations in order" methodology established by
# scripts/tests/verify-datahub-normalization-findings.sh, then runs the
# service-level (no route, no auth seam) integration suite via
# `npx vitest run --config vitest.integration.config.ts
# scripts/tests/dataHubNormalizationExecutor.integration.test.ts`.
#
# Never touches Production/Preview/Neon -- DATABASE_URL always points at the
# disposable container this script itself creates and destroys.
#
# USAGE:
#   bash scripts/tests/verify-datahub-normalization-executor.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
D4A_MIGRATION="$REPO_ROOT/scripts/create-datahub-raw-staging.sql"
D4B_MIGRATION="$REPO_ROOT/scripts/create-datahub-raw-staging-runs.sql"
D4C_B1_MIGRATION="$REPO_ROOT/scripts/create-datahub-normalized-staging.sql"
D4C_B2B1_MIGRATION="$REPO_ROOT/scripts/create-datahub-normalization-findings.sql"
CONTAINER="datahub-6-2d4b2a-executor-harness-$$"
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

DIAG_OUT="$(mktemp 2>/dev/null || echo "/tmp/harness_6_2d4b2a_last_out.$$.txt")"
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
echo "=== Running the B2B2A executor integration suite ==="
npx vitest run --config vitest.integration.config.ts scripts/tests/dataHubNormalizationExecutor.integration.test.ts
RESULT=$?

if [ $RESULT -ne 0 ]; then
  echo "FAIL: Data Hub 6.2D4B2A normalization executor integration suite (exit $RESULT)."
  exit $RESULT
fi
echo "PASS: Data Hub 6.2D4B2A normalization executor integration suite."

# ─────────────────────────────────────────────────────────────────────
# MUTATION PROOF (task point 17) — change resume to read the CURRENT
# active profile pointer instead of the run's own pin, and prove the
# "active-pointer immunity across resume" pinning tests actually fail
# without the real (unmutated) code's own discipline.
# ─────────────────────────────────────────────────────────────────────
RUN_TS="$REPO_ROOT/lib/data-hub/normalization/dataHubNormalizationRun.ts"
BACKUP="$(mktemp 2>/dev/null || echo "/tmp/dataHubNormalizationRun.ts.bak.$$")"
cp "$RUN_TS" "$BACKUP"
restore_run_ts() { cp "$BACKUP" "$RUN_TS"; rm -f "$BACKUP"; }
trap 'restore_run_ts; cleanup' EXIT

echo ""
echo "=== MUTATION PROOF — resume reads the CURRENT active profile pointer instead of its own pin ==="
awk '
  /PINNED_RESUME_PLAN_BEGIN/ {
    print;
    print "    const __mutationTestActiveProfile = await prisma.worksheetMappingProfile.findFirst({ where: { id: run.worksheet_mapping_profile_id, organisation_id: organisationId }, select: { active_profile_version_id: true } });";
    print "    const planResult = await resolvePlanForPinnedVersion({";
    print "      organisationId,";
    print "      worksheetMappingProfileId: run.worksheet_mapping_profile_id,";
    print "      worksheetMappingProfileVersionId: __mutationTestActiveProfile?.active_profile_version_id ?? run.worksheet_mapping_profile_version_id,";
    print "      sourceSchemaWorksheetId: run.source_schema_worksheet_id,";
    print "    });";
    skip=1;
    next
  }
  /PINNED_RESUME_PLAN_END/ { print; skip=0; next }
  skip==1 { next }
  { print }
' "$BACKUP" > "$RUN_TS"

if grep -q "__mutationTestActiveProfile" "$RUN_TS"; then
  echo "  Mutation applied. Re-running the pinning suite (expecting the active-pointer-immunity tests to FAIL)..."
else
  echo "ERROR: mutation failed to apply (marker not found)." >&2
  exit 2
fi

npx vitest run --config vitest.integration.config.ts scripts/tests/dataHubNormalizationExecutor.integration.test.ts -t "active-pointer immunity" >"$DIAG_OUT" 2>&1
MUTATION_RESULT=$?
if [ $MUTATION_RESULT -eq 0 ]; then
  echo "FAIL (mutation proof): the active-pointer-immunity tests WRONGLY passed under the mutated (active-pointer-reading) code." >&2
  cat "$DIAG_OUT"
  restore_run_ts
  exit 1
fi
if ! grep -q "active-pointer immunity across resume > moving the active profile version AFTER run creation" "$DIAG_OUT"; then
  echo "WARNING: mutation proof failed for an unexpected reason (not clearly the pinning assertion) -- inspect output:" >&2
  cat "$DIAG_OUT"
fi
echo "  PASS (fail-loud): mutation proof confirms the active-pointer-immunity tests actually depend on resume never reading the active pointer."

echo ""
echo "Restoring the real (unmutated) dataHubNormalizationRun.ts and re-running the FULL suite for a clean round-trip..."
restore_run_ts
trap 'cleanup' EXIT
npx vitest run --config vitest.integration.config.ts scripts/tests/dataHubNormalizationExecutor.integration.test.ts
RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo "PASS: Data Hub 6.2D4B2A normalization executor integration suite (post-mutation-proof round-trip)."
else
  echo "FAIL: Data Hub 6.2D4B2A normalization executor integration suite round-trip (exit $RESULT)."
fi

exit $RESULT
