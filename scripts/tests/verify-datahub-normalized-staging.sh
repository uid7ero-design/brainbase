#!/usr/bin/env bash
# Data Hub 6.2D4C-B1 — real disposable-Postgres proof for
# scripts/create-datahub-normalized-staging.sql (normalized-staging
# persistence/lifecycle foundation).
#
# Bootstraps the FULL current Prisma schema via `prisma db push` (same
# methodology as scripts/tests/verify-datahub-stage-worksheet-route.sh),
# drops the D4A/D4B/D4C-B1-managed tables/columns db push creates
# imprecisely, then applies the REAL, unmodified migrations in order:
#   scripts/create-datahub-raw-staging.sql          (D4A)
#   scripts/create-datahub-raw-staging-runs.sql     (D4B)
#   scripts/create-datahub-normalized-staging.sql   (D4C-B1, this phase)
#
# Never touches Production/Preview/Neon — DATABASE_URL always points at the
# disposable container this script itself creates and destroys.
#
# USAGE:
#   bash scripts/tests/verify-datahub-normalized-staging.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
D4A_MIGRATION="$REPO_ROOT/scripts/create-datahub-raw-staging.sql"
D4B_MIGRATION="$REPO_ROOT/scripts/create-datahub-raw-staging-runs.sql"
D4C_B1_MIGRATION="$REPO_ROOT/scripts/create-datahub-normalized-staging.sql"
D4C_B1_ROLLBACK="$REPO_ROOT/scripts/rollback-datahub-normalized-staging.sql"
CONTAINER="datahub-6-2d4c-b1-normalized-staging-harness-$$"
HOST_PORT=$((20000 + RANDOM % 20000))
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
}
trap cleanup EXIT

for f in "$D4A_MIGRATION" "$D4B_MIGRATION" "$D4C_B1_MIGRATION" "$D4C_B1_ROLLBACK"; do
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

DIAG_OUT="$(mktemp 2>/dev/null || echo "/tmp/harness_6_2d4c_b1_last_out.$$.txt")"

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1
}

expect_success() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL (expected success, got error): $desc"
    sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

expect_failure() {
  local desc="$1" sql="$2" pattern="$3"
  if echo "$sql" | psql_exec; then
    echo "  FAIL (expected failure, but succeeded): $desc"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  elif ! grep -qE "$pattern" "$DIAG_OUT"; then
    echo "  FAIL (failed, but not with the expected message /$pattern/): $desc"
    sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  else
    echo "  PASS (fail-loud): $desc"
    PASS=$((PASS + 1))
  fi
}

echo ""
echo "=== SETUP: full Prisma schema (db push) + real D4A/D4B/D4C-B1 migrations ==="
echo "Bootstrapping the full current Prisma schema via db push..."
if ! npx prisma db push --skip-generate --accept-data-loss >"$DIAG_OUT" 2>&1; then
  echo "ERROR: prisma db push failed." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2
fi

echo "Dropping db-push-created D4A/D4B/D4C-B1 tables/columns so the real migrations' own idempotent-create logic runs from scratch..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL' >"$DIAG_OUT" 2>&1
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
if [ $? -ne 0 ]; then echo "ERROR: drift normalization failed." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2; fi

echo "Applying D4A (unmodified)..."
if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$D4A_MIGRATION" >"$DIAG_OUT" 2>&1; then
  echo "ERROR: D4A migration failed to apply." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2
fi
echo "Applying D4B (unmodified)..."
if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$D4B_MIGRATION" >"$DIAG_OUT" 2>&1; then
  echo "ERROR: D4B migration failed to apply." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2
fi
expect_success "1. D4C-B1 migration applies cleanly on top of D4A+D4B" \
  "$(cat "$D4C_B1_MIGRATION")"
expect_success "2. D4C-B1 migration re-applies idempotently (zero drift)" \
  "$(cat "$D4C_B1_MIGRATION")"

echo ""
echo "=== INDEX DRIFT CHECKING (remediation) — every D4C-B1 index is now pg_temp.ensure_index-checked ==="
expect_success "2c setup: drop one real D4C-B1 index and pre-create a same-named index with the WRONG columns" \
  "DROP INDEX IF EXISTS idx_data_hub_normalized_cells_column;
   CREATE INDEX idx_data_hub_normalized_cells_column ON public.data_hub_normalized_cells (organisation_id);"
expect_failure "2d. migration fails loudly on a same-named index with the wrong shape (no silent pass)" \
  "$(cat "$D4C_B1_MIGRATION")" \
  "Migration drift: index public.idx_data_hub_normalized_cells_column is"
expect_success "2e. restoring the correct index lets the migration succeed again (clean re-apply)" \
  "DROP INDEX idx_data_hub_normalized_cells_column;
   $(cat "$D4C_B1_MIGRATION")"

echo ""
echo "=== FIXTURE WORLD: org-a tenant, one SUCCEEDED raw staging run with one row/cell ==="
expect_success "3. seed organisations/users" \
  "INSERT INTO organisations (id, name, slug, updated_at) VALUES ('org-a','Org A','org-a', now()), ('org-b','Org B','org-b', now());
   INSERT INTO users (id, organisation_id, username, email, name, password_hash, role, updated_at)
     VALUES ('user-a','org-a','user-a','a@x.com','User A','x','MANAGER', now()),
            ('user-b','org-b','user-b','b@x.com','User B','x','MANAGER', now());"

expect_success "4. seed governed D3A/D3B world + import batch + upload" \
  "INSERT INTO source_systems (id, organisation_id, name, updated_at) VALUES ('ss-1','org-a','SS', now());
   INSERT INTO dataset_types (id, organisation_id, source_system_id, name, updated_at) VALUES ('dt-1','org-a','ss-1','DT', now());
   INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('sv-1','org-a','dt-1',1,'v1');
   INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role, ordinal_hint)
     VALUES ('ws-1','org-a','sv-1','runs','Runs','OPTIONAL','DATA',0);
   INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class)
     VALUES ('col-1','org-a','ws-1',0,'Id','OPTIONAL','UNKNOWN','CONFIDENTIAL');
   INSERT INTO worksheet_mapping_profiles (id, organisation_id, source_schema_worksheet_id, name, active, updated_at)
     VALUES ('wp-1','org-a','ws-1','treatment', true, now());
   INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document)
     VALUES ('pv-1','org-a','wp-1',1,'STAGING_DATASET','{\"documentVersion\":1,\"schemaStatus\":\"DRAFT\",\"headerRowOneBased\":3}'),
            ('pv-2','org-a','wp-1',2,'STAGING_DATASET','{\"documentVersion\":1,\"schemaStatus\":\"DRAFT\",\"headerRowOneBased\":3}');
   UPDATE worksheet_mapping_profiles SET active_profile_version_id='pv-2' WHERE id='wp-1';
   INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, status, sha256, source_schema_version_id, updated_at)
     VALUES ('batch-1','org-a','user-a','f.xlsx','xlsx',1,'vercel-blob','k1','READY', repeat('a',64), 'sv-1', now());
   INSERT INTO uploads (id, organisation_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, worksheet_name, lineage_kind, updated_at)
     VALUES ('up-1','org-a','f.xlsx','p','x',1,'batch-1',0,'Runs','DATA_HUB', now());"

expect_success "5. seed a SUCCEEDED raw staging run pinned to pv-1 (NOT the now-active pv-2) with one raw row/cell" \
  "INSERT INTO data_hub_raw_staging_runs (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id,
      worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, source_sha256, parser_version, status,
      execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, completed_at)
     VALUES ('run-1','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1',1, repeat('a',64), 'v1', 'SUCCEEDED', 'tok-1', now() + interval '1 hour', now(), 1, 1, 1, 1, now());
   UPDATE uploads SET raw_staged_at = now(), raw_staged_by='user-a', raw_profile_version_id='pv-1', raw_row_count=1, raw_cell_count=1, raw_staging_run_id='run-1' WHERE id='up-1';
   INSERT INTO data_hub_raw_rows (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id,
      worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, staging_run_id, source_row_number)
     VALUES ('rr-1','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1','run-1',4);
   INSERT INTO data_hub_raw_cells (id, organisation_id, raw_row_id, source_schema_worksheet_id, source_schema_column_id, column_ordinal, source_header, raw_value, raw_value_type, sensitivity_class, original_unit)
     VALUES ('rc-1','org-a','rr-1','ws-1','col-1',0,'Id','\"abc\"','STRING','CONFIDENTIAL', NULL);"

echo ""
echo "=== EXACT PINNED PROFILE (invariant 3) ==="
expect_failure "6. a normalization run cannot declare a worksheet_mapping_profile_version_id other than its raw run's own pin (pv-2, the now-ACTIVE version, is refused even though it is active)" \
  "INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count)
   VALUES ('norm-wrongpin','org-a','batch-1','up-1','run-1','sv-1','ws-1','wp-1','pv-2',1,'v1','RUNNING','ntok-x', now()+interval '1 hour', now(), 1, 1);" \
  "data_hub_normalization_runs_raw_run_pinned_version_fkey"

echo ""
echo "=== SUCCESSFUL RAW RUN REQUIRED (GOAL section) ==="
expect_success "7 setup: a RUNNING (not yet SUCCEEDED) raw staging run" \
  "INSERT INTO data_hub_raw_staging_runs (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id,
      worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, source_sha256, parser_version, status,
      execution_token, lease_expires_at, last_progress_at)
     VALUES ('run-running','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1',2, repeat('b',64), 'v1', 'RUNNING', 'tok-2', now() + interval '1 hour', now());"
expect_failure "7. a normalization run cannot be created against a non-SUCCEEDED raw staging run" \
  "INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count)
   VALUES ('norm-notsucceeded','org-a','batch-1','up-1','run-running','sv-1','ws-1','wp-1','pv-1',1,'v1','RUNNING','ntok-y', now()+interval '1 hour', now(), 1, 1);" \
  "raw_staging_run_id must reference a SUCCEEDED raw staging run"

echo ""
echo "=== CROSS-TENANT REJECTION ==="
expect_failure "8. a normalization run cannot be created under a different tenant than its raw staging run" \
  "INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count)
   VALUES ('norm-crosstenant','org-b','batch-1','up-1','run-1','sv-1','ws-1','wp-1','pv-1',1,'v1','RUNNING','ntok-z', now()+interval '1 hour', now(), 1, 1);" \
  "raw_staging_run_id must reference a SUCCEEDED raw staging run|violates foreign key constraint"

echo ""
echo "=== AUTHORITATIVE Upload.raw_staging_run_id (remediation) ==="
expect_success "8c setup: a SECOND SUCCEEDED raw staging run on the SAME upload, pinned to the same pv-1, but NOT the one uploads.raw_staging_run_id points to (still 'run-1')" \
  "INSERT INTO data_hub_raw_staging_runs (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id,
      worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, source_sha256, parser_version, status,
      execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, completed_at)
     VALUES ('run-superseded','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1',4, repeat('d',64), 'v1', 'SUCCEEDED', 'tok-sup', now()+interval '1 hour', now(), 1, 1, 1, 1, now());
   SELECT 1/CASE WHEN (SELECT raw_staging_run_id FROM uploads WHERE id='up-1') = 'run-1' THEN 1 ELSE 0 END;"
expect_failure "8d. a normalization run cannot be created against a SUCCEEDED raw run that belongs to the same upload but is NOT Upload's own authoritative raw_staging_run_id" \
  "INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count)
   VALUES ('norm-notauthoritative','org-a','batch-1','up-1','run-superseded','sv-1','ws-1','wp-1','pv-1',1,'v1','RUNNING','ntok-nonauth', now()+interval '1 hour', now(), 1, 1);" \
  "data_hub_normalization_runs_upload_authoritative_raw_run_fkey"

echo ""
echo "=== ACTOR TENANT SAFETY — normalization run created_by (remediation) ==="
expect_failure "8e. a normalization run cannot be created with created_by belonging to a DIFFERENT tenant (user-b is org-b; the run is org-a)" \
  "INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, created_by)
   VALUES ('norm-crossactor','org-a','batch-1','up-1','run-1','sv-1','ws-1','wp-1','pv-1',1,'v1','RUNNING','ntok-crossactor', now()+interval '1 hour', now(), 1, 1, 'user-b');" \
  "created_by must belong to the same organisation_id"

echo ""
echo "=== NEW-RUN CREATION + ONE RUNNING PER UPLOAD ==="
expect_success "9. create a normalization run against the SUCCEEDED run-1, pinned to run-1's own pv-1 (never the active pv-2), created_by a SAME-tenant user (user-a, org-a)" \
  "INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, created_by)
   VALUES ('norm-1','org-a','batch-1','up-1','run-1','sv-1','ws-1','wp-1','pv-1',1,'v1','RUNNING','ntok-1', now()+interval '1 hour', now(), 1, 1, 'user-a');"
expect_failure "10. a second RUNNING normalization run for the same Upload is rejected" \
  "INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count)
   VALUES ('norm-2','org-a','batch-1','up-1','run-1','sv-1','ws-1','wp-1','pv-1',2,'v1','RUNNING','ntok-2', now()+interval '1 hour', now(), 1, 1);" \
  "data_hub_normalization_runs_one_active_per_upload"

echo ""
echo "=== NORMALIZATION-RUN LIFECYCLE IMMUTABILITY ==="
expect_failure "11. identity/pin columns are immutable while RUNNING" \
  "UPDATE data_hub_normalization_runs SET raw_staging_run_id='run-running' WHERE id='norm-1';" \
  "identity/pin columns are immutable"
expect_failure "12. DELETE is never permitted" \
  "DELETE FROM data_hub_normalization_runs WHERE id='norm-1';" \
  "DELETE is not permitted"
expect_success "13a. fail norm-1 (a legitimate RUNNING -> FAILED transition)" \
  "UPDATE data_hub_normalization_runs SET status='FAILED', failed_at=now(), failure_code='TEST' WHERE id='norm-1';"
expect_failure "13b. once FAILED (terminal), the row is immutable — cannot flip back to RUNNING" \
  "UPDATE data_hub_normalization_runs SET status='RUNNING', failed_at=NULL, failure_code=NULL WHERE id='norm-1';" \
  "run is FAILED \(terminal\) and immutable"
expect_success "13c. a later NEW attempt (attempt_number=2) coexists with the FAILED attempt 1 — also proves NULL created_by remains valid (no tenant check runs against a NULL actor)" \
  "INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count)
   VALUES ('norm-2','org-a','batch-1','up-1','run-1','sv-1','ws-1','wp-1','pv-1',2,'v1','RUNNING','ntok-2', now()+interval '1 hour', now(), 2, 1);"

echo ""
echo "=== NORMALIZED ROW/CELL LINEAGE + IMMUTABILITY ==="
expect_success "14. insert a normalized row + cell under norm-2, deriving from rr-1/rc-1" \
  "INSERT INTO data_hub_normalized_rows (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number)
     VALUES ('nr-1','org-a','norm-2','run-1','rr-1',4);
   INSERT INTO data_hub_normalized_cells (id, organisation_id, normalized_row_id, raw_row_id, raw_cell_id, source_schema_column_id, value_kind, normalized_value, source_unit, normalized_unit)
     VALUES ('nc-1','org-a','nr-1','rr-1','rc-1','col-1','STRING','\"abc\"', NULL, NULL);
   UPDATE data_hub_normalization_runs SET persisted_row_count=1, persisted_cell_count=1 WHERE id='norm-2';"

expect_success "15 setup: a second, unrelated SUCCEEDED raw staging run + row on the same upload" \
  "INSERT INTO data_hub_raw_staging_runs (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id,
      worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, source_sha256, parser_version, status,
      execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, completed_at)
     VALUES ('run-other','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1',3, repeat('c',64), 'v1', 'SUCCEEDED', 'tok-o', now()+interval '1 hour', now(), 1, 1, 1, 1, now());
   INSERT INTO data_hub_raw_rows (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, staging_run_id, source_row_number)
     VALUES ('rr-other','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1','run-other',5);"
expect_failure "15. a normalized row pinned to run-1 (via norm-2) cannot claim a raw_row_id that actually belongs to run-other" \
  "INSERT INTO data_hub_normalized_rows (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number)
   VALUES ('nr-bad','org-a','norm-2','run-1','rr-other',6);" \
  "data_hub_normalized_rows_raw_row_fkey"

expect_success "16 setup: an unrelated raw cell on a DIFFERENT raw row (rr-other), for the wrong-raw-cell-lineage proof" \
  "INSERT INTO data_hub_raw_cells (id, organisation_id, raw_row_id, source_schema_worksheet_id, source_schema_column_id, column_ordinal, source_header, raw_value, raw_value_type, sensitivity_class, original_unit)
   VALUES ('rc-other','org-a','rr-other','ws-1','col-1',0,'Id','\"zzz\"','STRING','CONFIDENTIAL', NULL);"
expect_failure "16. a normalized cell under nr-1 (raw_row_id=rr-1) cannot claim raw_cell_id=rc-other (belongs to rr-other, not rr-1)" \
  "INSERT INTO data_hub_normalized_cells (id, organisation_id, normalized_row_id, raw_row_id, raw_cell_id, source_schema_column_id, value_kind, normalized_value, source_unit, normalized_unit)
   VALUES ('nc-bad','org-a','nr-1','rr-1','rc-other','col-1','STRING','\"zzz\"', NULL, NULL);" \
  "data_hub_normalized_cells_raw_cell_row_fkey"

echo ""
echo "=== RAW ROW PHYSICAL SOURCE-ROW IDENTITY (remediation) ==="
expect_success "16c setup: a second raw row (rr-10) under run-1 with physical source_row_number=10" \
  "INSERT INTO data_hub_raw_rows (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, staging_run_id, source_row_number)
   VALUES ('rr-10','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1','run-1',10);"
expect_failure "16d. raw row 10 cannot be normalized while claiming source_row_number 11 (physical identity mismatch)" \
  "INSERT INTO data_hub_normalized_rows (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number)
   VALUES ('nr-mismatch','org-a','norm-2','run-1','rr-10',11);" \
  "data_hub_normalized_rows_raw_row_fkey"
expect_success "16e. raw row 10 CAN be normalized while correctly claiming its own source_row_number=10" \
  "INSERT INTO data_hub_normalized_rows (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number)
     VALUES ('nr-10','org-a','norm-2','run-1','rr-10',10);
   UPDATE data_hub_normalization_runs SET persisted_row_count=2 WHERE id='norm-2';"

# Note: since a normalization run is always pinned to exactly ONE raw
# staging run, and source_row_number is unique WITHIN that raw run
# (D4A/D4B), a duplicate raw_row_id under one normalization run
# necessarily ALSO duplicates (normalization_run_id, source_row_number) —
# the two UNIQUE constraints below overlap by construction in this design
# (the task explicitly asks to retain both regardless, for defense in
# depth / future decoupling). Whichever one Postgres reports first still
# proves the same invariant: the duplicate is rejected either way.
expect_failure "16f. the SAME raw_row_id (rr-1) cannot appear twice within the SAME normalization run (norm-2 already derived rr-1 as nr-1)" \
  "INSERT INTO data_hub_normalized_rows (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number)
   VALUES ('nr-1-dup','org-a','norm-2','run-1','rr-1',4);" \
  "data_hub_normalized_rows_run_raw_row_key|data_hub_normalized_rows_run_source_row_key"

expect_failure "17. UPDATE on a normalized row is rejected (immutable evidence)" \
  "UPDATE data_hub_normalized_rows SET source_row_number=99 WHERE id='nr-1';" \
  "normalized evidence is immutable; UPDATE"
expect_failure "18. DELETE on a normalized cell is rejected (immutable evidence)" \
  "DELETE FROM data_hub_normalized_cells WHERE id='nc-1';" \
  "normalized evidence is immutable; DELETE"

echo ""
echo "=== COMPLETION + UPLOAD METADATA COHERENCE/FREEZE ==="
expect_success "19. datahub_complete_normalization_run reconciles counts and atomically completes the run + Upload metadata" \
  "SELECT * FROM datahub_complete_normalization_run('norm-2','org-a','user-a','ntok-2');"
expect_success "19b. Upload's normalization completion metadata is exactly correct (2 rows: rr-1 + rr-10; 1 cell: nc-1)" \
  "SELECT 1/CASE WHEN (SELECT normalized_at IS NOT NULL AND normalized_by='user-a' AND normalized_profile_version_id='pv-1'
       AND normalized_row_count=2 AND normalized_cell_count=1 AND normalization_run_id='norm-2' FROM uploads WHERE id='up-1') THEN 1 ELSE 0 END;"
expect_failure "20. completion metadata is frozen after completion" \
  "UPDATE uploads SET normalized_row_count=99 WHERE id='up-1';" \
  "normalization metadata is immutable once completed"
expect_failure "21. re-completing an already-SUCCEEDED run is rejected" \
  "SELECT * FROM datahub_complete_normalization_run('norm-2','org-a','user-a','ntok-2');" \
  "run is not RUNNING"

echo ""
echo "=== TWO ATTEMPTS MAY EACH DERIVE THE SAME RAW ROW (remediation) ==="
expect_success "21c. a brand-new normalization attempt (norm-2 is now SUCCEEDED/terminal, freeing the one-RUNNING-per-upload slot) can ALSO derive rr-1 — uniqueness is per-run, not global" \
  "INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count)
     VALUES ('norm-3','org-a','batch-1','up-1','run-1','sv-1','ws-1','wp-1','pv-1',3,'v1','RUNNING','ntok-3', now()+interval '1 hour', now(), 1, 1);
   INSERT INTO data_hub_normalized_rows (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number)
     VALUES ('nr-1-again','org-a','norm-3','run-1','rr-1',4);"

echo ""
echo "=== ACTOR DELETION SEMANTICS ==="
expect_success "22. deleting the SAME-TENANT actor (after completion) nulls normalized_by, raw_staged_by, and norm-1's own created_by ('user-a', set at 9.) — organisation_id is unchanged on both rows, nothing else changes" \
  "DELETE FROM users WHERE id='user-a';
   SELECT 1/CASE WHEN (SELECT normalized_by IS NULL AND raw_staged_by IS NULL AND normalized_row_count=2 AND organisation_id='org-a' FROM uploads WHERE id='up-1')
       AND (SELECT created_by IS NULL AND status='SUCCEEDED' FROM data_hub_normalization_runs WHERE id='norm-2')
       AND (SELECT created_by IS NULL AND organisation_id='org-a' FROM data_hub_normalization_runs WHERE id='norm-1')
     THEN 1 ELSE 0 END;"

echo ""
echo "=== ACTOR TENANT SAFETY — completion (remediation) ==="
expect_success "22c setup: a same-tenant replacement actor (user-a was deleted at 22.), a SECOND fully independent upload (up-2) with its own SUCCEEDED raw run, and a fresh RUNNING normalization run, for a clean pre-completion state" \
  "INSERT INTO users (id, organisation_id, username, email, name, password_hash, role, updated_at)
     VALUES ('user-a2','org-a','user-a2','a2@x.com','User A2','x','MANAGER', now());
   INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, status, sha256, source_schema_version_id, updated_at)
     VALUES ('batch-2','org-a','user-a2','g.xlsx','xlsx',1,'vercel-blob','k2','READY', repeat('e',64), 'sv-1', now());
   INSERT INTO uploads (id, organisation_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, worksheet_name, lineage_kind, updated_at)
     VALUES ('up-2','org-a','g.xlsx','p2','x',1,'batch-2',0,'Runs','DATA_HUB', now());
   INSERT INTO data_hub_raw_staging_runs (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id,
      worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, source_sha256, parser_version, status,
      execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, completed_at)
     VALUES ('run-2fresh','org-a','batch-2','up-2','sv-1','ws-1','wp-1','pv-1',1, repeat('f',64), 'v1', 'SUCCEEDED', 'tok-2fresh', now()+interval '1 hour', now(), 0, 0, 0, 0, now());
   UPDATE uploads SET raw_staged_at = now(), raw_staged_by='user-a2', raw_profile_version_id='pv-1', raw_row_count=0, raw_cell_count=0, raw_staging_run_id='run-2fresh' WHERE id='up-2';
   INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count)
     VALUES ('norm-fresh','org-a','batch-2','up-2','run-2fresh','sv-1','ws-1','wp-1','pv-1',1,'v1','RUNNING','ntok-fresh', now()+interval '1 hour', now(), 0, 0);"
expect_failure "22d. completion with a CROSS-TENANT p_completed_by (user-b, org-b) is rejected by datahub_complete_normalization_run() itself — defense in depth, before any state changes" \
  "SELECT * FROM datahub_complete_normalization_run('norm-fresh','org-a','user-b','ntok-fresh');" \
  "completing actor does not belong to this organisation"
expect_success "22e. the rejected cross-tenant completion left norm-fresh RUNNING, up-2's normalization metadata all NULL, and zero normalized evidence for norm-fresh — untouched" \
  "SELECT 1/CASE WHEN (SELECT status='RUNNING' FROM data_hub_normalization_runs WHERE id='norm-fresh')
       AND (SELECT normalized_at IS NULL AND normalized_by IS NULL AND normalized_profile_version_id IS NULL
            AND normalized_row_count IS NULL AND normalized_cell_count IS NULL AND normalization_run_id IS NULL
            FROM uploads WHERE id='up-2')
       AND (SELECT count(*) FROM data_hub_normalized_rows WHERE normalization_run_id='norm-fresh') = 0
     THEN 1 ELSE 0 END;"
expect_success "22f. completion with the SAME-TENANT p_completed_by (user-a2, org-a) succeeds" \
  "SELECT * FROM datahub_complete_normalization_run('norm-fresh','org-a','user-a2','ntok-fresh');"

echo ""
echo "=== NO SYNTHETIC BACKFILL ==="
expect_success "23. an Upload never touched by normalization still has every normalization column NULL" \
  "INSERT INTO organisations (id, name, slug, updated_at) VALUES ('org-c','Org C','org-c', now());
   INSERT INTO uploads (id, organisation_id, original_name, stored_path, mimetype, size_bytes, updated_at)
     VALUES ('up-untouched','org-c','x','p','x',1, now());
   SELECT 1/CASE WHEN (SELECT normalized_at IS NULL AND normalized_by IS NULL AND normalized_profile_version_id IS NULL
       AND normalized_row_count IS NULL AND normalized_cell_count IS NULL AND normalization_run_id IS NULL
       FROM uploads WHERE id='up-untouched') THEN 1 ELSE 0 END;"

echo ""
echo "=== ROLLBACK — refuses once evidence exists, succeeds on a clean slate ==="
expect_failure "24. rollback refuses while data_hub_normalization_runs has rows" \
  "$(cat "$D4C_B1_ROLLBACK")" \
  "Refusing rollback: data_hub_normalization_runs contains"

# Normalized evidence is immutable by design (proven above) — there is no
# legitimate way to "clear" it to test a clean rollback. Proving rollback
# succeeds on a clean slate therefore requires a FRESH database (D4A+D4B+
# D4C-B1 applied, no evidence ever created), not a hand-wiped one.
echo "Resetting to a fresh database for the clean-rollback proof..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND pid<>pg_backend_pid();" >/dev/null 2>&1
docker exec -i "$CONTAINER" psql -X -q -U postgres -d template1 -v ON_ERROR_STOP=1 -c "DROP DATABASE postgres;" >"$DIAG_OUT" 2>&1
if [ $? -ne 0 ]; then echo "ERROR: database drop failed." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2; fi
docker exec -i "$CONTAINER" psql -X -q -U postgres -d template1 -v ON_ERROR_STOP=1 -c "CREATE DATABASE postgres;" >"$DIAG_OUT" 2>&1
if [ $? -ne 0 ]; then echo "ERROR: database create failed." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2; fi
if ! npx prisma db push --skip-generate --accept-data-loss >"$DIAG_OUT" 2>&1; then
  echo "ERROR: prisma db push failed on reset." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2
fi
docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL' >"$DIAG_OUT" 2>&1
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
if [ $? -ne 0 ]; then echo "ERROR: drift normalization failed on reset." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2; fi
if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$D4A_MIGRATION" >"$DIAG_OUT" 2>&1; then
  echo "ERROR: D4A migration failed to reapply on reset." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2
fi
if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$D4B_MIGRATION" >"$DIAG_OUT" 2>&1; then
  echo "ERROR: D4B migration failed to reapply on reset." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2
fi
expect_success "24b. D4C-B1 migration reapplies on the fresh reset database" \
  "$(cat "$D4C_B1_MIGRATION")"

expect_success "25. rollback succeeds on a clean slate (no evidence/completion metadata was ever created)" \
  "$(cat "$D4C_B1_ROLLBACK")"

expect_success "26. D4A and D4B objects are completely untouched by the rollback (their own tables/columns/functions still exist and work)" \
  "SELECT 1/CASE WHEN to_regclass('public.data_hub_raw_staging_runs') IS NOT NULL
       AND to_regclass('public.data_hub_raw_rows') IS NOT NULL
       AND to_regclass('public.data_hub_raw_cells') IS NOT NULL
       AND to_regproc('public.datahub_complete_raw_staging_run') IS NOT NULL
       AND to_regclass('public.data_hub_normalization_runs') IS NULL
       AND to_regclass('public.data_hub_normalized_rows') IS NULL
       AND to_regclass('public.data_hub_normalized_cells') IS NULL
     THEN 1 ELSE 0 END;"

expect_success "27. the D4C-B1 migration re-applies cleanly after rollback (round-trip)" \
  "$(cat "$D4C_B1_MIGRATION")"

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo "Failed checks:"
  for f in "${FAILURES[@]}"; do [ -n "$f" ] && echo "  - $f"; done
  exit 1
fi
exit 0
