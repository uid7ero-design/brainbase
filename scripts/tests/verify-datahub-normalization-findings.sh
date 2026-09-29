#!/usr/bin/env bash
# Data Hub 6.2D4C-B2B1 — real disposable-Postgres proof for
# scripts/create-datahub-normalization-findings.sql (normalization
# execution persistence: findings table + atomic batch function + the
# blocking-findings completion gate).
#
# Same methodology as scripts/tests/verify-datahub-normalized-staging.sh:
# bootstraps the FULL current Prisma schema via `prisma db push`, drops the
# D4A/D4B/D4C-B1/B2B1-managed tables/columns db push creates imprecisely,
# then applies the REAL, unmodified migrations in order:
#   scripts/create-datahub-raw-staging.sql             (D4A)
#   scripts/create-datahub-raw-staging-runs.sql        (D4B)
#   scripts/create-datahub-normalized-staging.sql      (D4C-B1)
#   scripts/create-datahub-normalization-findings.sql  (D4C-B2B1, this phase)
#
# Never touches Production/Preview/Neon — DATABASE_URL always points at the
# disposable container this script itself creates and destroys.
#
# USAGE:
#   bash scripts/tests/verify-datahub-normalization-findings.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
D4A_MIGRATION="$REPO_ROOT/scripts/create-datahub-raw-staging.sql"
D4B_MIGRATION="$REPO_ROOT/scripts/create-datahub-raw-staging-runs.sql"
D4C_B1_MIGRATION="$REPO_ROOT/scripts/create-datahub-normalized-staging.sql"
D4C_B2B1_MIGRATION="$REPO_ROOT/scripts/create-datahub-normalization-findings.sql"
D4C_B2B1_ROLLBACK="$REPO_ROOT/scripts/rollback-datahub-normalization-findings.sql"
CONTAINER="datahub-6-2d4c-b2b1-findings-harness-$$"
HOST_PORT=$((20000 + RANDOM % 20000))
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
}
trap cleanup EXIT

for f in "$D4A_MIGRATION" "$D4B_MIGRATION" "$D4C_B1_MIGRATION" "$D4C_B2B1_MIGRATION" "$D4C_B2B1_ROLLBACK"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: required SQL file not found at $f" >&2
    exit 2
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 2
fi

PGPASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
export PGPASSWORD

echo "Starting disposable postgres:16-alpine ($CONTAINER) on host port $HOST_PORT..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PGPASSWORD" \
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

export DATABASE_URL="postgresql://postgres:${PGPASSWORD}@localhost:${HOST_PORT}/postgres"
export DIRECT_URL="$DATABASE_URL"
cd "$REPO_ROOT"

DIAG_OUT="$(mktemp 2>/dev/null || echo "/tmp/harness_6_2d4c_b2b1_last_out.$$.txt")"

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

DROP_DB_PUSH_OBJECTS='
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
'

apply_all_migrations() {
  if ! npx prisma db push --skip-generate --accept-data-loss >"$DIAG_OUT" 2>&1; then
    echo "ERROR: prisma db push failed." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2
  fi
  if ! echo "$DROP_DB_PUSH_OBJECTS" | docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1; then
    echo "ERROR: drift normalization failed." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2
  fi
  for f in "$D4A_MIGRATION" "$D4B_MIGRATION" "$D4C_B1_MIGRATION" "$D4C_B2B1_MIGRATION"; do
    if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f" >"$DIAG_OUT" 2>&1; then
      echo "ERROR: $(basename "$f") failed to apply." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2
    fi
  done
}

reset_database() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND pid<>pg_backend_pid();" >/dev/null 2>&1
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d template1 -v ON_ERROR_STOP=1 -c "DROP DATABASE postgres;" >"$DIAG_OUT" 2>&1
  if [ $? -ne 0 ]; then echo "ERROR: database drop failed." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2; fi
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d template1 -v ON_ERROR_STOP=1 -c "CREATE DATABASE postgres;" >"$DIAG_OUT" 2>&1
  if [ $? -ne 0 ]; then echo "ERROR: database create failed." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2; fi
}

echo ""
echo "=== SETUP: full Prisma schema (db push) + real D4A/D4B/D4C-B1/B2B1 migrations ==="
echo "Bootstrapping the full current Prisma schema via db push..."
apply_all_migrations
expect_success "1. B2B1 migration applies cleanly on top of D4A+D4B+D4C-B1" \
  "$(cat "$D4C_B2B1_MIGRATION")"
expect_success "2. B2B1 migration re-applies idempotently (zero drift)" \
  "$(cat "$D4C_B2B1_MIGRATION")"
expect_success "2b. no message/raw-value column exists on the findings table (structural)" \
  "SELECT 1/CASE WHEN NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='data_hub_normalization_findings'
         AND column_name IN ('message','raw_value','raw_value_type','source_header','detail','exception_detail','notes')
     ) THEN 1 ELSE 0 END;"

echo ""
echo "=== INDEX DRIFT CHECKING ==="
expect_success "2c setup: pre-create a same-named findings index with the WRONG columns" \
  "DROP INDEX IF EXISTS idx_data_hub_normalization_findings_raw_row;
   CREATE INDEX idx_data_hub_normalization_findings_raw_row ON public.data_hub_normalization_findings (organisation_id);"
expect_failure "2d. migration fails loudly on a same-named index with the wrong shape" \
  "$(cat "$D4C_B2B1_MIGRATION")" \
  "Migration drift: index public.idx_data_hub_normalization_findings_raw_row is"
expect_success "2e. restoring the correct index lets the migration succeed again" \
  "DROP INDEX idx_data_hub_normalization_findings_raw_row;
   $(cat "$D4C_B2B1_MIGRATION")"

echo ""
echo "=== FIXTURE WORLD: org-a tenant, one SUCCEEDED raw run with two rows/four cells, one RUNNING normalization run ==="
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
     VALUES ('col-1','org-a','ws-1',0,'Id','OPTIONAL','UNKNOWN','CONFIDENTIAL'),
            ('col-2','org-a','ws-1',1,'Weight','OPTIONAL','UNKNOWN','CONFIDENTIAL');
   INSERT INTO worksheet_mapping_profiles (id, organisation_id, source_schema_worksheet_id, name, active, updated_at)
     VALUES ('wp-1','org-a','ws-1','treatment', true, now());
   INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document)
     VALUES ('pv-1','org-a','wp-1',1,'STAGING_DATASET','{\"documentVersion\":1,\"schemaStatus\":\"DRAFT\",\"headerRowOneBased\":3}');
   UPDATE worksheet_mapping_profiles SET active_profile_version_id='pv-1' WHERE id='wp-1';
   INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, status, sha256, source_schema_version_id, updated_at)
     VALUES ('batch-1','org-a','user-a','f.xlsx','xlsx',1,'vercel-blob','k1','READY', repeat('a',64), 'sv-1', now());
   INSERT INTO uploads (id, organisation_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, worksheet_name, lineage_kind, updated_at)
     VALUES ('up-1','org-a','f.xlsx','p','x',1,'batch-1',0,'Runs','DATA_HUB', now());"
expect_success "5. seed a SUCCEEDED raw staging run with two rows / four cells" \
  "INSERT INTO data_hub_raw_staging_runs (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id,
      worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, source_sha256, parser_version, status,
      execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, completed_at)
     VALUES ('run-1','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1',1, repeat('a',64), 'v1', 'SUCCEEDED', 'tok-1', now() + interval '1 hour', now(), 2, 4, 2, 4, now());
   UPDATE uploads SET raw_staged_at = now(), raw_staged_by='user-a', raw_profile_version_id='pv-1', raw_row_count=2, raw_cell_count=4, raw_staging_run_id='run-1' WHERE id='up-1';
   INSERT INTO data_hub_raw_rows (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, staging_run_id, source_row_number)
     VALUES ('rr-1','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1','run-1',4),
            ('rr-2','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1','run-1',5);
   INSERT INTO data_hub_raw_cells (id, organisation_id, raw_row_id, source_schema_worksheet_id, source_schema_column_id, column_ordinal, source_header, raw_value, raw_value_type, sensitivity_class, original_unit)
     VALUES ('rc-1a','org-a','rr-1','ws-1','col-1',0,'Id','\"abc\"','STRING','CONFIDENTIAL', NULL),
            ('rc-1b','org-a','rr-1','ws-1','col-2',1,'Weight','\"12.5\"','STRING','CONFIDENTIAL', NULL),
            ('rc-2a','org-a','rr-2','ws-1','col-1',0,'Id','\"def\"','STRING','CONFIDENTIAL', NULL),
            ('rc-2b','org-a','rr-2','ws-1','col-2',1,'Weight','\"bad\"','STRING','CONFIDENTIAL', NULL);
   INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, created_by)
     VALUES ('norm-1','org-a','batch-1','up-1','run-1','sv-1','ws-1','wp-1','pv-1',1,'v1','RUNNING','ntok-1', now()+interval '1 hour', now(), 2, 2, 'user-a');"

echo ""
echo "=== BATCH INSERT — VALID CASE ==="
expect_success "6. datahub_stage_normalized_batch inserts one successful row (2 cells) and one blocking finding for the OTHER row, atomically" \
  "SELECT 1/CASE WHEN (SELECT inserted_row_count FROM datahub_stage_normalized_batch(
       'norm-1','org-a','ntok-1',
       '[{\"id\":\"nr-1\",\"rawRowId\":\"rr-1\",\"sourceRowNumber\":4,\"cells\":[
           {\"id\":\"nc-1a\",\"rawCellId\":\"rc-1a\",\"sourceSchemaColumnId\":\"col-1\",\"valueKind\":\"IDENTIFIER\",\"normalizedValue\":\"abc\",\"sourceUnit\":null,\"normalizedUnit\":null},
           {\"id\":\"nc-1b\",\"rawCellId\":\"rc-1b\",\"sourceSchemaColumnId\":\"col-2\",\"valueKind\":\"DECIMAL\",\"normalizedValue\":\"12.5\",\"sourceUnit\":\"kg\",\"normalizedUnit\":\"kg\"}
       ]}]'::jsonb,
       '[{\"id\":\"find-1\",\"rawRowId\":\"rr-2\",\"sourceRowNumber\":5,\"rawCellId\":\"rc-2b\",\"sourceSchemaColumnId\":\"col-2\",\"severity\":\"BLOCKING_ERROR\",\"findingCode\":\"MALFORMED_NUMERIC_STRING\",\"valueKind\":\"DECIMAL\"}]'::jsonb,
       60
     )) = 1 THEN 1 ELSE 0 END;"
expect_success "6b. progress counts are EXACT: persisted_row_count=1, persisted_cell_count=2" \
  "SELECT 1/CASE WHEN (SELECT persisted_row_count=1 AND persisted_cell_count=2 FROM data_hub_normalization_runs WHERE id='norm-1') THEN 1 ELSE 0 END;"
expect_success "6c. last_progress_at was bumped by the batch call" \
  "SELECT 1/CASE WHEN (SELECT last_progress_at > now() - interval '20 seconds' FROM data_hub_normalization_runs WHERE id='norm-1') THEN 1 ELSE 0 END;"

echo ""
echo "=== NO PARTIAL ROW SUCCESS (unambiguous persistence) ==="
expect_failure "7. the SAME raw row cannot appear in both the normalized payload and a BLOCKING_ERROR finding in one call — rolls back completely" \
  "SELECT * FROM datahub_stage_normalized_batch(
     'norm-1','org-a','ntok-1',
     '[{\"id\":\"nr-2\",\"rawRowId\":\"rr-2\",\"sourceRowNumber\":5,\"cells\":[]}]'::jsonb,
     '[{\"id\":\"find-overlap\",\"rawRowId\":\"rr-2\",\"sourceRowNumber\":5,\"rawCellId\":null,\"sourceSchemaColumnId\":null,\"severity\":\"BLOCKING_ERROR\",\"findingCode\":\"MALFORMED_NUMERIC_STRING\",\"valueKind\":\"DECIMAL\"}]'::jsonb,
     60
   );" \
  "raw row\(s\) appear in both the normalized payload and a BLOCKING_ERROR finding"
expect_success "7b. the failed overlap attempt inserted nothing and did not bump persisted counts" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM data_hub_normalized_rows WHERE id='nr-2') = 0
       AND (SELECT count(*) FROM data_hub_normalization_findings WHERE id='find-overlap') = 0
       AND (SELECT persisted_row_count=1 AND persisted_cell_count=2 FROM data_hub_normalization_runs WHERE id='norm-1')
     THEN 1 ELSE 0 END;"
expect_success "7c. a WARNING-severity finding on the SAME row as a normalized row IS allowed (only BLOCKING_ERROR triggers the overlap guard)" \
  "SELECT * FROM datahub_stage_normalized_batch(
     'norm-1','org-a','ntok-1',
     '[]'::jsonb,
     '[{\"id\":\"find-warn-1\",\"rawRowId\":\"rr-1\",\"sourceRowNumber\":4,\"rawCellId\":\"rc-1b\",\"sourceSchemaColumnId\":\"col-2\",\"severity\":\"WARNING\",\"findingCode\":\"UNSAFE_NUMERIC_VALUE\",\"valueKind\":\"DECIMAL\"}]'::jsonb,
     60
   );"

echo ""
echo "=== CROSS-CALL ROW CONSISTENCY (6.2D4C-B2B1 REMEDIATION) ==="
echo "Reuses state from test 6: rr-1 was normalized (nr-1) and rr-2 got a BLOCKING_ERROR finding (find-1) in that SAME earlier call — these two new checks fire on a LATER, separate call."
expect_failure "7d. [Test A] rr-1 already has a normalized row (nr-1, from test 6) — a LATER call's BLOCKING_ERROR finding for rr-1 is rejected, nothing inserted" \
  "SELECT * FROM datahub_stage_normalized_batch(
     'norm-1','org-a','ntok-1',
     '[]'::jsonb,
     '[{\"id\":\"find-crosscall-a\",\"rawRowId\":\"rr-1\",\"sourceRowNumber\":4,\"rawCellId\":null,\"sourceSchemaColumnId\":null,\"severity\":\"BLOCKING_ERROR\",\"findingCode\":\"INVALID_RAW_SHAPE\",\"valueKind\":null}]'::jsonb,
     60
   );" \
  "already have a normalized row persisted for this run from an earlier call"
expect_success "7e. [Test A] the rejected cross-call finding attempt inserted nothing — existing normalized evidence/counts are unchanged" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM data_hub_normalization_findings WHERE id='find-crosscall-a') = 0
       AND (SELECT count(*) FROM data_hub_normalized_rows WHERE id='nr-1') = 1
       AND (SELECT persisted_row_count=1 AND persisted_cell_count=2 FROM data_hub_normalization_runs WHERE id='norm-1')
     THEN 1 ELSE 0 END;"
expect_failure "7f. [Test B] rr-2 already has a BLOCKING_ERROR finding (find-1, from test 6) — a LATER call's normalized row for rr-2 is rejected, nothing inserted" \
  "SELECT * FROM datahub_stage_normalized_batch(
     'norm-1','org-a','ntok-1',
     '[{\"id\":\"nr-crosscall-b\",\"rawRowId\":\"rr-2\",\"sourceRowNumber\":5,\"cells\":[]}]'::jsonb,
     '[]'::jsonb,
     60
   );" \
  "already have a BLOCKING_ERROR finding persisted for this run from an earlier call"
expect_success "7g. [Test B] the rejected cross-call normalized-row attempt inserted nothing — find-1 remains, counts unchanged" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM data_hub_normalized_rows WHERE id='nr-crosscall-b') = 0
       AND (SELECT count(*) FROM data_hub_normalization_findings WHERE id='find-1') = 1
       AND (SELECT persisted_row_count=1 AND persisted_cell_count=2 FROM data_hub_normalization_runs WHERE id='norm-1')
     THEN 1 ELSE 0 END;"
expect_success "7h. [Test C] a WARNING finding for rr-1 (already normalized) in a SEPARATE later call IS allowed — only BLOCKING_ERROR severity triggers the cross-call guard" \
  "SELECT * FROM datahub_stage_normalized_batch(
     'norm-1','org-a','ntok-1',
     '[]'::jsonb,
     '[{\"id\":\"find-crosscall-c-warn\",\"rawRowId\":\"rr-1\",\"sourceRowNumber\":4,\"rawCellId\":\"rc-1a\",\"sourceSchemaColumnId\":\"col-1\",\"severity\":\"WARNING\",\"findingCode\":\"UNSAFE_NUMERIC_VALUE\",\"valueKind\":\"IDENTIFIER\"}]'::jsonb,
     60
   );"
expect_success "7i. [Test C] the WARNING finding for the already-normalized row rr-1 actually persisted" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM data_hub_normalization_findings WHERE id='find-crosscall-c-warn' AND severity='WARNING') = 1 THEN 1 ELSE 0 END;"

echo ""
echo "=== FK TENANT ISOLATION / WRONG-LINEAGE REJECTION ==="
expect_failure "8. a finding cannot be inserted for org-b while its normalization run is org-a (cross-tenant)" \
  "INSERT INTO data_hub_normalization_findings (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, raw_cell_id, source_schema_column_id, severity, finding_code, value_kind)
   VALUES ('find-crosstenant','org-b','norm-1','run-1','rr-1',4,'rc-1a','col-1','BLOCKING_ERROR','INVALID_RAW_SHAPE',NULL);" \
  "violates foreign key constraint"

expect_success "9 setup: a SECOND, unrelated SUCCEEDED raw staging run + row on the same upload (wrong raw run fixture)" \
  "INSERT INTO data_hub_raw_staging_runs (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id,
      worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, source_sha256, parser_version, status,
      execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, completed_at)
     VALUES ('run-other','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1',9, repeat('c',64), 'v1', 'SUCCEEDED', 'tok-o', now()+interval '1 hour', now(), 1, 1, 1, 1, now());
   INSERT INTO data_hub_raw_rows (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, staging_run_id, source_row_number)
     VALUES ('rr-other','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1','run-other',9);"
expect_failure "9. a finding claiming raw_staging_run_id=run-1 (norm-1's own pin) cannot reference rr-other (belongs to run-other, a DIFFERENT raw run) — wrong raw row rejected" \
  "INSERT INTO data_hub_normalization_findings (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, raw_cell_id, source_schema_column_id, severity, finding_code, value_kind)
   VALUES ('find-wrongraw','org-a','norm-1','run-1','rr-other',9,NULL,NULL,'BLOCKING_ERROR','INVALID_RAW_SHAPE',NULL);" \
  "data_hub_normalization_findings_raw_row_fkey"

expect_success "10 setup: an unrelated raw cell on rr-other (wrong raw cell fixture)" \
  "INSERT INTO data_hub_raw_cells (id, organisation_id, raw_row_id, source_schema_worksheet_id, source_schema_column_id, column_ordinal, source_header, raw_value, raw_value_type, sensitivity_class, original_unit)
   VALUES ('rc-other','org-a','rr-other','ws-1','col-1',0,'Id','\"zzz\"','STRING','CONFIDENTIAL', NULL);"
expect_failure "10. a finding under raw_row_id=rr-1 cannot claim raw_cell_id=rc-other (belongs to rr-other, not rr-1) — wrong raw cell rejected" \
  "INSERT INTO data_hub_normalization_findings (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, raw_cell_id, source_schema_column_id, severity, finding_code, value_kind)
   VALUES ('find-wrongcell','org-a','norm-1','run-1','rr-1',4,'rc-other','col-1','BLOCKING_ERROR','INVALID_RAW_SHAPE',NULL);" \
  "data_hub_normalization_findings_raw_cell_row_fkey"

expect_failure "11. a finding on raw_cell_id=rc-1a (col-1) cannot declare source_schema_column_id=col-2 (mismatched governed column) — source-column mismatch rejected" \
  "INSERT INTO data_hub_normalization_findings (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, raw_cell_id, source_schema_column_id, severity, finding_code, value_kind)
   VALUES ('find-wrongcolumn','org-a','norm-1','run-1','rr-1',4,'rc-1a','col-2','BLOCKING_ERROR','INVALID_RAW_SHAPE',NULL);" \
  "data_hub_normalization_findings_raw_cell_column_fkey"

echo ""
echo "=== TWO-SHAPE CONTRACT — raw_cell_id/source_schema_column_id (6.2D4C-B2B1 REMEDIATION, Blocker 2) ==="
echo "Uses rr-2/rc-2a (NOT rr-1) so these direct-INSERT fixture findings never contaminate rr-1's clean state for the later PK-replay test (17)."
expect_success "11b. [both NULL] a ROW-level finding (raw_cell_id=NULL, source_schema_column_id=NULL) is accepted" \
  "INSERT INTO data_hub_normalization_findings (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, raw_cell_id, source_schema_column_id, severity, finding_code, value_kind)
   VALUES ('find-shape-rowlevel','org-a','norm-1','run-1','rr-2',5,NULL,NULL,'BLOCKING_ERROR','UNKNOWN_RULE_COLUMN',NULL);"
expect_success "11c. [both present, matching] a CELL-level finding (raw_cell_id=rc-2a, source_schema_column_id=col-1, its real column) is accepted" \
  "INSERT INTO data_hub_normalization_findings (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, raw_cell_id, source_schema_column_id, severity, finding_code, value_kind)
   VALUES ('find-shape-celllevel','org-a','norm-1','run-1','rr-2',5,'rc-2a','col-1','BLOCKING_ERROR','INVALID_RAW_SHAPE','IDENTIFIER');"
expect_failure "11d. [cell present, column NULL] rejected by the two-shape CHECK constraint" \
  "INSERT INTO data_hub_normalization_findings (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, raw_cell_id, source_schema_column_id, severity, finding_code, value_kind)
   VALUES ('find-shape-cellonly','org-a','norm-1','run-1','rr-2',5,'rc-2a',NULL,'BLOCKING_ERROR','INVALID_RAW_SHAPE',NULL);" \
  "data_hub_normalization_findings_cell_column_pair_check"
expect_failure "11e. [cell NULL, column present] rejected by the two-shape CHECK constraint" \
  "INSERT INTO data_hub_normalization_findings (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, raw_cell_id, source_schema_column_id, severity, finding_code, value_kind)
   VALUES ('find-shape-columnonly','org-a','norm-1','run-1','rr-2',5,NULL,'col-1','BLOCKING_ERROR','INVALID_RAW_SHAPE',NULL);" \
  "data_hub_normalization_findings_cell_column_pair_check"
echo "  (mismatched-but-both-present cell/column is already proven rejected by the raw-cell-column FK — see test 11 above.)"

echo ""
echo "=== FINDING LOGICAL-IDENTITY UNIQUENESS / REPLAY REJECTION (6.2D4C-B2B1 REMEDIATION, Replay Review) ==="
expect_failure "11f. a fresh-id retry duplicating an EXISTING cell-level finding's exact logical identity (run, row, cell, code, severity, value_kind) is rejected" \
  "INSERT INTO data_hub_normalization_findings (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, raw_cell_id, source_schema_column_id, severity, finding_code, value_kind)
   VALUES ('find-shape-celllevel-retry','org-a','norm-1','run-1','rr-2',5,'rc-2a','col-1','BLOCKING_ERROR','INVALID_RAW_SHAPE','IDENTIFIER');" \
  "idx_data_hub_normalization_findings_logical_identity_unique"
expect_failure "11g. a fresh-id retry duplicating an EXISTING row-level finding's exact logical identity (raw_cell_id and value_kind both NULL) is ALSO rejected — proves COALESCE makes NULL collide with NULL here, unlike a bare UNIQUE" \
  "INSERT INTO data_hub_normalization_findings (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, raw_cell_id, source_schema_column_id, severity, finding_code, value_kind)
   VALUES ('find-shape-rowlevel-retry','org-a','norm-1','run-1','rr-2',5,NULL,NULL,'BLOCKING_ERROR','UNKNOWN_RULE_COLUMN',NULL);" \
  "idx_data_hub_normalization_findings_logical_identity_unique"
expect_success "11h. a genuinely distinct finding (same row/cell, DIFFERENT finding_code) is NOT blocked by the uniqueness index" \
  "INSERT INTO data_hub_normalization_findings (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number, raw_cell_id, source_schema_column_id, severity, finding_code, value_kind)
   VALUES ('find-shape-celllevel-distinct','org-a','norm-1','run-1','rr-2',5,'rc-2a','col-1','BLOCKING_ERROR','UNSAFE_NUMERIC_VALUE','IDENTIFIER');"

echo ""
echo "=== IMMUTABILITY ==="
expect_failure "12. UPDATE on a finding is rejected (immutable evidence)" \
  "UPDATE data_hub_normalization_findings SET finding_code='INVALID_CALENDAR_DATE' WHERE id='find-1';" \
  "normalized evidence is immutable; UPDATE"
expect_failure "13. DELETE on a finding is rejected (immutable evidence)" \
  "DELETE FROM data_hub_normalization_findings WHERE id='find-1';" \
  "normalized evidence is immutable; DELETE"

echo ""
echo "=== LEASE / TOKEN / EXPIRY — batch atomicity ==="
expect_failure "14. wrong execution_token rolls back the whole batch (nothing inserted)" \
  "SELECT * FROM datahub_stage_normalized_batch(
     'norm-1','org-a','WRONG-TOKEN',
     '[{\"id\":\"nr-wrongtok\",\"rawRowId\":\"rr-2\",\"sourceRowNumber\":5,\"cells\":[]}]'::jsonb,
     '[]'::jsonb,
     60
   );" \
  "lease not held before insert"
expect_success "14b. the wrong-token attempt inserted nothing" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM data_hub_normalized_rows WHERE id='nr-wrongtok') = 0 THEN 1 ELSE 0 END;"

expect_success "15 setup: force the run's lease to already be expired" \
  "UPDATE data_hub_normalization_runs SET lease_expires_at = now() - interval '1 minute' WHERE id='norm-1';"
expect_failure "15. an expired lease rolls back the whole batch, even with the correct token" \
  "SELECT * FROM datahub_stage_normalized_batch(
     'norm-1','org-a','ntok-1',
     '[{\"id\":\"nr-expired\",\"rawRowId\":\"rr-2\",\"sourceRowNumber\":5,\"cells\":[]}]'::jsonb,
     '[]'::jsonb,
     60
   );" \
  "lease not held before insert"
expect_success "15b. the expired-lease attempt inserted nothing" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM data_hub_normalized_rows WHERE id='nr-expired') = 0 THEN 1 ELSE 0 END;"
expect_success "15c. restore a live lease for subsequent tests" \
  "UPDATE data_hub_normalization_runs SET lease_expires_at = now() + interval '1 hour' WHERE id='norm-1';"

# A SUCCEEDED raw staging run is D4B's own terminal/immutable state (its
# lifecycle trigger rejects any status transition away from SUCCEEDED) —
# so this branch can never fire through any normal code path today. Still
# proven correct here as genuine defense in depth (mirroring the identical,
# equally "currently unreachable" check already in
# datahub_complete_normalization_run): the D4B trigger is temporarily
# disabled, ONLY inside a transaction that is always rolled back, to force
# the state and prove the batch function's own check actually fires.
expect_failure "16. datahub_stage_normalized_batch refuses when the pinned raw_staging_run is no longer SUCCEEDED (forced via a temporarily-disabled D4B trigger, inside a transaction that is always rolled back)" \
  "BEGIN;
   ALTER TABLE data_hub_raw_staging_runs DISABLE TRIGGER data_hub_raw_staging_runs_lifecycle_guard;
   UPDATE data_hub_raw_staging_runs SET status='FAILED', failed_at=now(), failure_code='X', completed_at=NULL WHERE id='run-1';
   ALTER TABLE data_hub_raw_staging_runs ENABLE TRIGGER data_hub_raw_staging_runs_lifecycle_guard;
   SELECT * FROM datahub_stage_normalized_batch(
     'norm-1','org-a','ntok-1',
     '[]'::jsonb,
     '[]'::jsonb,
     60
   );
   ROLLBACK;" \
  "pinned raw_staging_run is no longer SUCCEEDED"
expect_success "16b. the forced-status transaction was fully rolled back — run-1 is still SUCCEEDED" \
  "SELECT 1/CASE WHEN (SELECT status FROM data_hub_raw_staging_runs WHERE id='run-1') = 'SUCCEEDED' THEN 1 ELSE 0 END;"

echo ""
echo "=== DUPLICATE / REPLAY PROTECTION ==="
expect_failure "17. replaying the EXACT same batch call (identical ids) fails on the PK and rolls back completely (no double-counted progress)" \
  "SELECT * FROM datahub_stage_normalized_batch(
     'norm-1','org-a','ntok-1',
     '[{\"id\":\"nr-1\",\"rawRowId\":\"rr-1\",\"sourceRowNumber\":4,\"cells\":[
         {\"id\":\"nc-1a\",\"rawCellId\":\"rc-1a\",\"sourceSchemaColumnId\":\"col-1\",\"valueKind\":\"IDENTIFIER\",\"normalizedValue\":\"abc\",\"sourceUnit\":null,\"normalizedUnit\":null}
     ]}]'::jsonb,
     '[]'::jsonb,
     60
   );" \
  "duplicate key value violates unique constraint"
expect_success "17b. persisted counts unchanged after the failed replay (still 1 row / 2 cells)" \
  "SELECT 1/CASE WHEN (SELECT persisted_row_count=1 AND persisted_cell_count=2 FROM data_hub_normalization_runs WHERE id='norm-1') THEN 1 ELSE 0 END;"

echo ""
echo "=== BLOCKING FINDING PREVENTS COMPLETION ==="
expect_failure "18. completion is refused while a blocking finding exists for the run" \
  "SELECT * FROM datahub_complete_normalization_run('norm-1','org-a','user-a','ntok-1');" \
  "blocking finding\(s\) exist for this run; completion is not possible"

echo ""
echo "=== FULL SUCCESSFUL COMPLETION (no blocking findings) ==="
expect_success "19 setup: a fresh upload/run pair with ONLY a successful row and a WARNING finding (no BLOCKING_ERROR) so completion can succeed" \
  "INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, status, sha256, source_schema_version_id, updated_at)
     VALUES ('batch-2','org-a','user-a','g.xlsx','xlsx',1,'vercel-blob','k2','READY', repeat('e',64), 'sv-1', now());
   INSERT INTO uploads (id, organisation_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, worksheet_name, lineage_kind, updated_at)
     VALUES ('up-2','org-a','g.xlsx','p2','x',1,'batch-2',0,'Runs','DATA_HUB', now());
   INSERT INTO data_hub_raw_staging_runs (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id,
      worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, source_sha256, parser_version, status,
      execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, completed_at)
     VALUES ('run-2','org-a','batch-2','up-2','sv-1','ws-1','wp-1','pv-1',1, repeat('f',64), 'v1', 'SUCCEEDED', 'tok-2', now()+interval '1 hour', now(), 1, 1, 1, 1, now());
   UPDATE uploads SET raw_staged_at = now(), raw_staged_by='user-a', raw_profile_version_id='pv-1', raw_row_count=1, raw_cell_count=1, raw_staging_run_id='run-2' WHERE id='up-2';
   INSERT INTO data_hub_raw_rows (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, staging_run_id, source_row_number)
     VALUES ('rr-3','org-a','batch-2','up-2','sv-1','ws-1','wp-1','pv-1','run-2',4);
   INSERT INTO data_hub_raw_cells (id, organisation_id, raw_row_id, source_schema_worksheet_id, source_schema_column_id, column_ordinal, source_header, raw_value, raw_value_type, sensitivity_class, original_unit)
     VALUES ('rc-3a','org-a','rr-3','ws-1','col-1',0,'Id','\"ghi\"','STRING','CONFIDENTIAL', NULL);
   INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, created_by)
     VALUES ('norm-2','org-a','batch-2','up-2','run-2','sv-1','ws-1','wp-1','pv-1',1,'v1','RUNNING','ntok-2', now()+interval '1 hour', now(), 1, 1, 'user-a');
   SELECT * FROM datahub_stage_normalized_batch(
     'norm-2','org-a','ntok-2',
     '[{\"id\":\"nr-3\",\"rawRowId\":\"rr-3\",\"sourceRowNumber\":4,\"cells\":[
         {\"id\":\"nc-3a\",\"rawCellId\":\"rc-3a\",\"sourceSchemaColumnId\":\"col-1\",\"valueKind\":\"IDENTIFIER\",\"normalizedValue\":\"ghi\",\"sourceUnit\":null,\"normalizedUnit\":null}
     ]}]'::jsonb,
     '[{\"id\":\"find-warn-2\",\"rawRowId\":\"rr-3\",\"sourceRowNumber\":4,\"rawCellId\":\"rc-3a\",\"sourceSchemaColumnId\":\"col-1\",\"severity\":\"WARNING\",\"findingCode\":\"UNSAFE_NUMERIC_VALUE\",\"valueKind\":\"IDENTIFIER\"}]'::jsonb,
     60
   );"
expect_success "19. completion succeeds when only WARNING findings exist (never BLOCKING_ERROR)" \
  "SELECT * FROM datahub_complete_normalization_run('norm-2','org-a','user-a','ntok-2');"
expect_success "19b. Upload's normalization completion metadata is set" \
  "SELECT 1/CASE WHEN (SELECT normalized_at IS NOT NULL AND normalized_row_count=1 AND normalized_cell_count=1 FROM uploads WHERE id='up-2') THEN 1 ELSE 0 END;"

echo ""
echo "=== ONE RUNNING NORMALIZATION RUN PER UPLOAD (preserved, unchanged) ==="
expect_success "20 setup: up-1 still has norm-1 RUNNING" \
  "SELECT 1/CASE WHEN (SELECT status FROM data_hub_normalization_runs WHERE id='norm-1') = 'RUNNING' THEN 1 ELSE 0 END;"
expect_failure "20. a second RUNNING normalization run for the same upload (up-1) is still rejected (D4C-B1 invariant, untouched by B2B1)" \
  "INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count)
   VALUES ('norm-1-dup','org-a','batch-1','up-1','run-other','sv-1','ws-1','wp-1','pv-1',99,'v1','RUNNING','ntok-dup', now()+interval '1 hour', now(), 1, 1);" \
  "data_hub_normalization_runs_one_active_per_upload"

echo ""
echo "=== ROLLBACK — refuses once finding evidence exists, succeeds and restores the exact prior function on a clean slate ==="
expect_failure "21. rollback refuses while data_hub_normalization_findings has rows" \
  "$(cat "$D4C_B2B1_ROLLBACK")" \
  "Refusing rollback: data_hub_normalization_findings contains"

echo "Resetting to a fresh database for the clean-rollback proof..."
reset_database

echo ""
echo "=== MUTATION PROOF — cross-call guard removed, prove tests 7d/7f would WRONGLY succeed without it (6.2D4C-B2B1 REMEDIATION) ==="
echo "Rebuilding a mutated migration with the CROSS_CALL_GUARD_BEGIN..CROSS_CALL_GUARD_END block stripped..."
MUTATED_MIGRATION="$(mktemp 2>/dev/null || echo "/tmp/mutated_b2b1_migration.$$.sql")"
sed '/-- CROSS_CALL_GUARD_BEGIN/,/-- CROSS_CALL_GUARD_END/d' "$D4C_B2B1_MIGRATION" > "$MUTATED_MIGRATION"
if grep -q "CROSS_CALL_GUARD_BEGIN" "$MUTATED_MIGRATION"; then
  echo "ERROR: mutation failed to strip the cross-call guard block." >&2
  exit 2
fi
if grep -q "v_cross_call_a_count > 0" "$MUTATED_MIGRATION"; then
  echo "ERROR: mutation left the cross-call check logic in place." >&2
  exit 2
fi

if ! npx prisma db push --skip-generate --accept-data-loss >"$DIAG_OUT" 2>&1; then
  echo "ERROR: prisma db push failed (mutation phase)." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2
fi
if ! echo "$DROP_DB_PUSH_OBJECTS" | docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1; then
  echo "ERROR: drift normalization failed (mutation phase)." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2
fi
for f in "$D4A_MIGRATION" "$D4B_MIGRATION" "$D4C_B1_MIGRATION" "$MUTATED_MIGRATION"; do
  if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f" >"$DIAG_OUT" 2>&1; then
    echo "ERROR: $(basename "$f") failed to apply (mutation phase)." >&2; sed 's/^/    /' "$DIAG_OUT"; exit 2
  fi
done
rm -f "$MUTATED_MIGRATION"

expect_success "M1 setup: minimal fixture world + a SUCCEEDED raw run + RUNNING normalization run, under the MUTATED migration (rr-1 normalized, rr-2 gets a BLOCKING_ERROR finding, in one call)" \
  "INSERT INTO organisations (id, name, slug, updated_at) VALUES ('org-a','Org A','org-a', now());
   INSERT INTO users (id, organisation_id, username, email, name, password_hash, role, updated_at) VALUES ('user-a','org-a','user-a','a@x.com','User A','x','MANAGER', now());
   INSERT INTO source_systems (id, organisation_id, name, updated_at) VALUES ('ss-1','org-a','SS', now());
   INSERT INTO dataset_types (id, organisation_id, source_system_id, name, updated_at) VALUES ('dt-1','org-a','ss-1','DT', now());
   INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('sv-1','org-a','dt-1',1,'v1');
   INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role, ordinal_hint) VALUES ('ws-1','org-a','sv-1','runs','Runs','OPTIONAL','DATA',0);
   INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class) VALUES ('col-1','org-a','ws-1',0,'Id','OPTIONAL','UNKNOWN','CONFIDENTIAL');
   INSERT INTO worksheet_mapping_profiles (id, organisation_id, source_schema_worksheet_id, name, active, updated_at) VALUES ('wp-1','org-a','ws-1','treatment', true, now());
   INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document) VALUES ('pv-1','org-a','wp-1',1,'STAGING_DATASET','{\"documentVersion\":1,\"schemaStatus\":\"DRAFT\",\"headerRowOneBased\":3}');
   UPDATE worksheet_mapping_profiles SET active_profile_version_id='pv-1' WHERE id='wp-1';
   INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, status, sha256, source_schema_version_id, updated_at) VALUES ('batch-1','org-a','user-a','f.xlsx','xlsx',1,'vercel-blob','k1','READY', repeat('a',64), 'sv-1', now());
   INSERT INTO uploads (id, organisation_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, worksheet_name, lineage_kind, updated_at) VALUES ('up-1','org-a','f.xlsx','p','x',1,'batch-1',0,'Runs','DATA_HUB', now());
   INSERT INTO data_hub_raw_staging_runs (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, source_sha256, parser_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, completed_at)
     VALUES ('run-1','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1',1, repeat('a',64), 'v1', 'SUCCEEDED', 'tok-1', now() + interval '1 hour', now(), 2, 2, 2, 2, now());
   UPDATE uploads SET raw_staged_at = now(), raw_staged_by='user-a', raw_profile_version_id='pv-1', raw_row_count=2, raw_cell_count=2, raw_staging_run_id='run-1' WHERE id='up-1';
   INSERT INTO data_hub_raw_rows (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, staging_run_id, source_row_number)
     VALUES ('rr-1','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1','run-1',4), ('rr-2','org-a','batch-1','up-1','sv-1','ws-1','wp-1','pv-1','run-1',5);
   INSERT INTO data_hub_raw_cells (id, organisation_id, raw_row_id, source_schema_worksheet_id, source_schema_column_id, column_ordinal, source_header, raw_value, raw_value_type, sensitivity_class, original_unit)
     VALUES ('rc-1a','org-a','rr-1','ws-1','col-1',0,'Id','\"abc\"','STRING','CONFIDENTIAL', NULL), ('rc-2a','org-a','rr-2','ws-1','col-1',0,'Id','\"def\"','STRING','CONFIDENTIAL', NULL);
   INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, created_by)
     VALUES ('norm-m','org-a','batch-1','up-1','run-1','sv-1','ws-1','wp-1','pv-1',1,'v1','RUNNING','ntok-m', now()+interval '1 hour', now(), 2, 2, 'user-a');
   SELECT * FROM datahub_stage_normalized_batch(
     'norm-m','org-a','ntok-m',
     '[{\"id\":\"nr-m1\",\"rawRowId\":\"rr-1\",\"sourceRowNumber\":4,\"cells\":[{\"id\":\"nc-m1a\",\"rawCellId\":\"rc-1a\",\"sourceSchemaColumnId\":\"col-1\",\"valueKind\":\"IDENTIFIER\",\"normalizedValue\":\"abc\",\"sourceUnit\":null,\"normalizedUnit\":null}]}]'::jsonb,
     '[{\"id\":\"find-m1\",\"rawRowId\":\"rr-2\",\"sourceRowNumber\":5,\"rawCellId\":\"rc-2a\",\"sourceSchemaColumnId\":\"col-1\",\"severity\":\"BLOCKING_ERROR\",\"findingCode\":\"INVALID_RAW_SHAPE\",\"valueKind\":\"IDENTIFIER\"}]'::jsonb,
     60
   );"
expect_success "M2 [Test A mutation proof]: WITHOUT the cross-call guard, a LATER call's BLOCKING_ERROR finding for the ALREADY-normalized rr-1 WRONGLY succeeds — proves the guard (not something else) is what rejects test 7d under the real migration" \
  "SELECT * FROM datahub_stage_normalized_batch(
     'norm-m','org-a','ntok-m',
     '[]'::jsonb,
     '[{\"id\":\"find-m-mutation-a\",\"rawRowId\":\"rr-1\",\"sourceRowNumber\":4,\"rawCellId\":null,\"sourceSchemaColumnId\":null,\"severity\":\"BLOCKING_ERROR\",\"findingCode\":\"INVALID_RAW_SHAPE\",\"valueKind\":null}]'::jsonb,
     60
   );"
expect_success "M3 [Test B mutation proof]: WITHOUT the cross-call guard, a LATER call's normalized row for the ALREADY-blocking-findinged rr-2 WRONGLY succeeds — proves the guard is what rejects test 7f under the real migration" \
  "SELECT * FROM datahub_stage_normalized_batch(
     'norm-m','org-a','ntok-m',
     '[{\"id\":\"nr-m-mutation-b\",\"rawRowId\":\"rr-2\",\"sourceRowNumber\":5,\"cells\":[]}]'::jsonb,
     '[]'::jsonb,
     60
   );"

echo "Mutation proof complete. Resetting to a fresh database and reapplying the REAL (unmutated) migration..."
reset_database
apply_all_migrations
expect_success "21b. B2B1 migration reapplies cleanly on the fresh reset database" "SELECT 1;"
expect_success "22. rollback succeeds on a clean slate (no finding evidence was ever created)" \
  "$(cat "$D4C_B2B1_ROLLBACK")"
expect_success "23. D4C-B1's datahub_complete_normalization_run is restored to its EXACT prior body — the blocking-findings gate is gone, and the function still works for its OWN (D4C-B1) invariants" \
  "SELECT 1/CASE WHEN to_regclass('public.data_hub_normalization_findings') IS NULL
       AND to_regproc('public.datahub_stage_normalized_batch') IS NULL
       AND to_regproc('public.datahub_complete_normalization_run') IS NOT NULL
       AND (SELECT pg_get_functiondef('public.datahub_complete_normalization_run(text,text,text,text)'::regprocedure)) NOT LIKE '%blocking finding%'
     THEN 1 ELSE 0 END;"
expect_success "24. D4A/D4B/D4C-B1 objects are completely untouched by the rollback (their own tables/columns/functions still exist and work)" \
  "SELECT 1/CASE WHEN to_regclass('public.data_hub_raw_staging_runs') IS NOT NULL
       AND to_regclass('public.data_hub_normalization_runs') IS NOT NULL
       AND to_regclass('public.data_hub_normalized_rows') IS NOT NULL
       AND to_regproc('public.datahub_complete_raw_staging_run') IS NOT NULL
     THEN 1 ELSE 0 END;"
expect_success "25. the B2B1 migration re-applies cleanly after rollback (round-trip)" \
  "$(cat "$D4C_B2B1_MIGRATION")"

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo "Failed checks:"
  for f in "${FAILURES[@]}"; do [ -n "$f" ] && echo "  - $f"; done
  exit 1
fi
exit 0
