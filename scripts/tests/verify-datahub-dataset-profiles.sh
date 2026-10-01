#!/usr/bin/env bash
# Data Hub 6.2D4D1B1 — disposable-Postgres behavioral proof.
# Local throwaway postgres only. Never Production/Preview/Neon.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
D4A="$REPO_ROOT/scripts/create-datahub-raw-staging.sql"
D4B="$REPO_ROOT/scripts/create-datahub-raw-staging-runs.sql"
D4C_B1="$REPO_ROOT/scripts/create-datahub-normalized-staging.sql"
D4C_B2B1="$REPO_ROOT/scripts/create-datahub-normalization-findings.sql"
D4D1B1="$REPO_ROOT/scripts/create-datahub-dataset-profiles.sql"
D4D1B1_ROLLBACK="$REPO_ROOT/scripts/rollback-datahub-dataset-profiles.sql"
CONTAINER="datahub-6-2d4d1b1-profile-persistence-$$"
HOST_PORT=$((20000 + RANDOM % 20000))
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
}
trap cleanup EXIT

for f in "$D4A" "$D4B" "$D4C_B1" "$D4C_B2B1" "$D4D1B1" "$D4D1B1_ROLLBACK"; do
  [ -f "$f" ] || { echo "ERROR: missing $f" >&2; exit 2; }
done
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required" >&2; exit 2; }

PGPASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
[ -n "$PGPASSWORD" ] || { echo "ERROR: disposable password generation failed" >&2; exit 2; }
export PGPASSWORD

docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PGPASSWORD"   -p "127.0.0.1:${HOST_PORT}:5432" postgres:16-alpine >/dev/null
READY=0
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
[ "$READY" -eq 1 ] || { echo "ERROR: postgres did not become ready" >&2; exit 2; }

export DATABASE_URL="postgresql://postgres:${PGPASSWORD}@localhost:${HOST_PORT}/postgres"
export DIRECT_URL="$DATABASE_URL"
cd "$REPO_ROOT"
DIAG_OUT="$(mktemp 2>/dev/null || echo "/tmp/d4d1b1-last.$$.txt")"

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1
}
expect_success() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then
    echo "  PASS: $desc"; PASS=$((PASS+1))
  else
    echo "  FAIL (expected success): $desc"; sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL+1)); FAILURES+=("$desc")
  fi
}
expect_failure() {
  local desc="$1" sql="$2" pattern="$3"
  if echo "$sql" | psql_exec; then
    echo "  FAIL (expected failure): $desc"; FAIL=$((FAIL+1)); FAILURES+=("$desc")
  elif ! grep -qE "$pattern" "$DIAG_OUT"; then
    echo "  FAIL (wrong failure): $desc"; sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL+1)); FAILURES+=("$desc")
  else
    echo "  PASS (fail-loud): $desc"; PASS=$((PASS+1))
  fi
}

normalize_db_push_objects() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL' >"$DIAG_OUT" 2>&1
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
}

apply_chain() {
  for f in "$D4A" "$D4B" "$D4C_B1" "$D4C_B2B1" "$D4D1B1"; do
    if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f" >"$DIAG_OUT" 2>&1; then
      echo "ERROR: $(basename "$f") failed to apply" >&2
      sed 's/^/    /' "$DIAG_OUT"
      exit 2
    fi
  done
}

reset_database() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
SQL
  npx prisma db push --skip-generate --accept-data-loss >"$DIAG_OUT" 2>&1 || {
    echo "ERROR: prisma db push failed"; sed 's/^/    /' "$DIAG_OUT"; exit 2;
  }
  normalize_db_push_objects || {
    echo "ERROR: drift normalization failed"; sed 's/^/    /' "$DIAG_OUT"; exit 2;
  }
  apply_chain
}

echo "=== SETUP: current schema + real D4A/D4B/D4C/D4D1B1 chain ==="
reset_database
expect_success "1. D4D1B1 re-applies idempotently" "$(cat "$D4D1B1")"

echo ""
echo "=== SCHEMA / PRIVACY CONTRACT ==="
expect_success "2. both profile tables and partial RUNNING index exist"   "SELECT 1/CASE WHEN to_regclass('public.data_hub_dataset_profile_runs') IS NOT NULL
     AND to_regclass('public.data_hub_dataset_profile_columns') IS NOT NULL
     AND to_regclass('public.idx_data_hub_dataset_profile_runs_one_running_per_normalization') IS NOT NULL
   THEN 1 ELSE 0 END;"
expect_success "3. forbidden source/example fields do not exist"   "SELECT 1/CASE WHEN NOT EXISTS (
     SELECT 1 FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name IN ('data_hub_dataset_profile_runs','data_hub_dataset_profile_columns')
       AND column_name IN ('raw_value','normalized_value','sample_value','example_value','source_header','message','failure_detail')
   ) THEN 1 ELSE 0 END;"

echo ""
echo "=== FIXTURE WORLD + AUTHORITATIVE SUCCEEDED NORMALIZATION ==="
expect_success "4. seed tenant/schema/profile/import lineage"   "INSERT INTO organisations (id,name,slug,updated_at) VALUES
     ('org-a','Org A','org-a',now()), ('org-b','Org B','org-b',now());
   INSERT INTO users (id,organisation_id,username,email,name,password_hash,role,updated_at) VALUES
     ('user-a','org-a','user-a','a@example.test','User A','x','MANAGER',now()),
     ('user-b','org-b','user-b','b@example.test','User B','x','MANAGER',now());
   INSERT INTO source_systems (id,organisation_id,name,updated_at) VALUES ('ss-a','org-a','Source',now());
   INSERT INTO dataset_types (id,organisation_id,source_system_id,name,updated_at) VALUES ('dt-a','org-a','ss-a','Dataset',now());
   INSERT INTO source_schema_versions (id,organisation_id,dataset_type_id,version_number,label)
     VALUES ('sv-a','org-a','dt-a',1,'v1');
   INSERT INTO source_schema_worksheets
     (id,organisation_id,source_schema_version_id,logical_key,expected_name,presence,role,ordinal_hint)
     VALUES
     ('ws-a','org-a','sv-a','data','Data','REQUIRED','DATA',0),
     ('ws-b','org-a','sv-a','other','Other','OPTIONAL','DATA',1);
   INSERT INTO source_schema_columns
     (id,organisation_id,source_schema_worksheet_id,ordinal,source_header,presence,declared_type,sensitivity_class)
     VALUES
     ('col-string','org-a','ws-a',0,'Sensitive Name','REQUIRED','STRING','PERSONALLY_IDENTIFIABLE'),
     ('col-number','org-a','ws-a',1,'Amount','REQUIRED','DECIMAL','CONFIDENTIAL'),
     ('col-date','org-a','ws-a',2,'Date','OPTIONAL','DATE','INTERNAL'),
     ('col-other','org-a','ws-b',0,'Other','OPTIONAL','STRING','INTERNAL');
   INSERT INTO worksheet_mapping_profiles
     (id,organisation_id,source_schema_worksheet_id,name,active,updated_at)
     VALUES ('wp-a','org-a','ws-a','profile',true,now());
   INSERT INTO worksheet_mapping_profile_versions
     (id,organisation_id,worksheet_mapping_profile_id,version_number,disposition,profile_document)
     VALUES
     ('pv-a1','org-a','wp-a',1,'STAGING_DATASET','{"documentVersion":1,"schemaStatus":"DRAFT","headerRowOneBased":1}'),
     ('pv-a2','org-a','wp-a',2,'STAGING_DATASET','{"documentVersion":1,"schemaStatus":"DRAFT","headerRowOneBased":1}');
   UPDATE worksheet_mapping_profiles SET active_profile_version_id='pv-a2' WHERE id='wp-a';
   INSERT INTO import_batches
     (id,organisation_id,uploaded_by,original_filename,content_type,size_bytes,storage_provider,storage_key,status,sha256,source_schema_version_id,updated_at)
     VALUES ('batch-a','org-a','user-a','data.xlsx','xlsx',1,'vercel-blob','d4d1b1-key','READY',repeat('a',64),'sv-a',now());
   INSERT INTO uploads
     (id,organisation_id,original_name,stored_path,mimetype,size_bytes,import_batch_id,worksheet_index,worksheet_name,lineage_kind,updated_at)
     VALUES ('upload-a','org-a','data.xlsx','path','xlsx',1,'batch-a',0,'Data','DATA_HUB',now());"

expect_success "5. seed and complete raw staging"   "INSERT INTO data_hub_raw_staging_runs
     (id,organisation_id,import_batch_id,upload_id,source_schema_version_id,source_schema_worksheet_id,
      worksheet_mapping_profile_id,worksheet_mapping_profile_version_id,attempt_number,source_sha256,parser_version,status,
      execution_token,lease_expires_at,last_progress_at,expected_row_count,expected_cell_count,persisted_row_count,persisted_cell_count,completed_at)
     VALUES ('raw-a','org-a','batch-a','upload-a','sv-a','ws-a','wp-a','pv-a1',1,repeat('a',64),'v1','SUCCEEDED',
       'raw-token',now()+interval '1 hour',now(),2,6,2,6,now());
   UPDATE uploads SET raw_staged_at=now(),raw_staged_by='user-a',raw_profile_version_id='pv-a1',
     raw_row_count=2,raw_cell_count=6,raw_staging_run_id='raw-a' WHERE id='upload-a';
   INSERT INTO data_hub_raw_rows
     (id,organisation_id,import_batch_id,upload_id,source_schema_version_id,source_schema_worksheet_id,
      worksheet_mapping_profile_id,worksheet_mapping_profile_version_id,staging_run_id,source_row_number)
     VALUES
     ('rr-a1','org-a','batch-a','upload-a','sv-a','ws-a','wp-a','pv-a1','raw-a',2),
     ('rr-a2','org-a','batch-a','upload-a','sv-a','ws-a','wp-a','pv-a1','raw-a',3);
   INSERT INTO data_hub_raw_cells
     (id,organisation_id,raw_row_id,source_schema_worksheet_id,source_schema_column_id,column_ordinal,source_header,raw_value,raw_value_type,sensitivity_class,original_unit)
     VALUES
     ('rc-a10','org-a','rr-a1','ws-a','col-string',0,'Sensitive Name','"Alice"','STRING','PERSONALLY_IDENTIFIABLE',NULL),
     ('rc-a11','org-a','rr-a1','ws-a','col-number',1,'Amount','"10"','STRING','CONFIDENTIAL',NULL),
     ('rc-a12','org-a','rr-a1','ws-a','col-date',2,'Date','null','NULL','INTERNAL',NULL),
     ('rc-a20','org-a','rr-a2','ws-a','col-string',0,'Sensitive Name','"Bob"','STRING','PERSONALLY_IDENTIFIABLE',NULL),
     ('rc-a21','org-a','rr-a2','ws-a','col-number',1,'Amount','"20"','STRING','CONFIDENTIAL',NULL),
     ('rc-a22','org-a','rr-a2','ws-a','col-date',2,'Date','null','NULL','INTERNAL',NULL);"

expect_success "6. normalize through the real staging/completion functions"   "INSERT INTO data_hub_normalization_runs
     (id,organisation_id,import_batch_id,upload_id,raw_staging_run_id,source_schema_version_id,source_schema_worksheet_id,
      worksheet_mapping_profile_id,worksheet_mapping_profile_version_id,attempt_number,normalizer_version,status,
      execution_token,lease_expires_at,last_progress_at,expected_row_count,expected_cell_count,created_by)
     VALUES ('norm-a','org-a','batch-a','upload-a','raw-a','sv-a','ws-a','wp-a','pv-a1',1,'v1','RUNNING',
       'norm-token',now()+interval '1 hour',now(),2,6,'user-a');
   SELECT * FROM datahub_stage_normalized_batch(
     'norm-a','org-a','norm-token',
     '[
       {"id":"nr-a1","rawRowId":"rr-a1","sourceRowNumber":2,"cells":[
         {"id":"nc-a10","rawCellId":"rc-a10","sourceSchemaColumnId":"col-string","valueKind":"STRING","normalizedValue":"Alice","sourceUnit":null,"normalizedUnit":null},
         {"id":"nc-a11","rawCellId":"rc-a11","sourceSchemaColumnId":"col-number","valueKind":"DECIMAL","normalizedValue":"10","sourceUnit":null,"normalizedUnit":null},
         {"id":"nc-a12","rawCellId":"rc-a12","sourceSchemaColumnId":"col-date","valueKind":"DATE","normalizedValue":null,"sourceUnit":null,"normalizedUnit":null}
       ]},
       {"id":"nr-a2","rawRowId":"rr-a2","sourceRowNumber":3,"cells":[
         {"id":"nc-a20","rawCellId":"rc-a20","sourceSchemaColumnId":"col-string","valueKind":"STRING","normalizedValue":"Bob","sourceUnit":null,"normalizedUnit":null},
         {"id":"nc-a21","rawCellId":"rc-a21","sourceSchemaColumnId":"col-number","valueKind":"DECIMAL","normalizedValue":"20","sourceUnit":null,"normalizedUnit":null},
         {"id":"nc-a22","rawCellId":"rc-a22","sourceSchemaColumnId":"col-date","valueKind":"DATE","normalizedValue":null,"sourceUnit":null,"normalizedUnit":null}
       ]}
     ]'::jsonb,
     '[]'::jsonb,
     60
   );
   SELECT * FROM datahub_complete_normalization_run('norm-a','org-a','user-a','norm-token');"

expect_success "7. authoritative normalization is SUCCEEDED and Upload points to it"   "SELECT 1/CASE WHEN (
     SELECT n.status='SUCCEEDED' AND u.normalization_run_id='norm-a' AND u.normalized_at IS NOT NULL
     FROM data_hub_normalization_runs n JOIN uploads u ON u.id=n.upload_id
     WHERE n.id='norm-a'
   ) THEN 1 ELSE 0 END;"

echo ""
echo "=== TENANT / EXACT LINEAGE PROOFS ==="
expect_failure "8. cross-tenant actor rejected"   "INSERT INTO data_hub_dataset_profile_runs
     (id,organisation_id,import_batch_id,upload_id,normalization_run_id,source_schema_version_id,source_schema_worksheet_id,worksheet_mapping_profile_version_id,attempt_number,profiler_version,status,created_by)
     VALUES ('profile-crossactor','org-a','batch-a','upload-a','norm-a','sv-a','ws-a','pv-a1',1,'v1','RUNNING','user-b');"   "initiating actor must belong to the same organisation"

expect_failure "9. wrong pinned mapping-profile version rejected"   "INSERT INTO data_hub_dataset_profile_runs
     (id,organisation_id,import_batch_id,upload_id,normalization_run_id,source_schema_version_id,source_schema_worksheet_id,worksheet_mapping_profile_version_id,attempt_number,profiler_version,status,created_by)
     VALUES ('profile-wrongpin','org-a','batch-a','upload-a','norm-a','sv-a','ws-a','pv-a2',1,'v1','RUNNING','user-a');"   "normalization_lineage_fkey"

expect_failure "10. wrong upload rejected by exact normalization lineage"   "INSERT INTO uploads
     (id,organisation_id,original_name,stored_path,mimetype,size_bytes,import_batch_id,worksheet_index,worksheet_name,lineage_kind,updated_at)
     VALUES ('upload-other','org-a','other.xlsx','other','xlsx',1,'batch-a',1,'Data2','DATA_HUB',now());
   INSERT INTO data_hub_dataset_profile_runs
     (id,organisation_id,import_batch_id,upload_id,normalization_run_id,source_schema_version_id,source_schema_worksheet_id,worksheet_mapping_profile_version_id,attempt_number,profiler_version,status,created_by)
     VALUES ('profile-wrongupload','org-a','batch-a','upload-other','norm-a','sv-a','ws-a','pv-a1',1,'v1','RUNNING','user-a');"   "normalization_lineage_fkey"

expect_success "11. valid RUNNING profile attempt accepted"   "INSERT INTO data_hub_dataset_profile_runs
     (id,organisation_id,import_batch_id,upload_id,normalization_run_id,source_schema_version_id,source_schema_worksheet_id,worksheet_mapping_profile_version_id,attempt_number,profiler_version,status,created_by)
     VALUES ('profile-a1','org-a','batch-a','upload-a','norm-a','sv-a','ws-a','pv-a1',1,'v1','RUNNING','user-a');"

expect_failure "12. duplicate concurrent RUNNING profile for same normalization rejected"   "INSERT INTO data_hub_dataset_profile_runs
     (id,organisation_id,import_batch_id,upload_id,normalization_run_id,source_schema_version_id,source_schema_worksheet_id,worksheet_mapping_profile_version_id,attempt_number,profiler_version,status,created_by)
     VALUES ('profile-a2-running','org-a','batch-a','upload-a','norm-a','sv-a','ws-a','pv-a1',2,'v1','RUNNING','user-a');"   "idx_data_hub_dataset_profile_runs_one_running_per_normalization"

echo ""
echo "=== COLUMN SHAPE / LINEAGE / PRIVACY ==="
expect_success "13. valid STRING, numeric and all-null temporal profile columns accepted"   "INSERT INTO data_hub_dataset_profile_columns
     (id,organisation_id,profile_run_id,source_schema_worksheet_id,source_schema_column_id,ordinal,value_kind,
      source_unit,normalized_unit,row_count,non_null_count,null_count,distinct_non_null_count,
      null_ratio,non_null_ratio,distinct_ratio,is_constant,is_all_null,is_unique_among_non_null,is_complete,is_sparse,
      min_length,max_length,total_length,mean_length,empty_string_count)
     VALUES
     ('pc-string','org-a','profile-a1','ws-a','col-string',0,'STRING',NULL,NULL,2,2,0,2,'0','1','1',false,false,true,true,false,3,5,8,'4',0);
   INSERT INTO data_hub_dataset_profile_columns
     (id,organisation_id,profile_run_id,source_schema_worksheet_id,source_schema_column_id,ordinal,value_kind,
      source_unit,normalized_unit,row_count,non_null_count,null_count,distinct_non_null_count,
      null_ratio,non_null_ratio,distinct_ratio,is_constant,is_all_null,is_unique_among_non_null,is_complete,is_sparse,
      numeric_min,numeric_max,numeric_sum,numeric_mean)
     VALUES
     ('pc-number','org-a','profile-a1','ws-a','col-number',1,'DECIMAL',NULL,NULL,2,2,0,2,'0','1','1',false,false,true,true,false,'10','20','30','15');
   INSERT INTO data_hub_dataset_profile_columns
     (id,organisation_id,profile_run_id,source_schema_worksheet_id,source_schema_column_id,ordinal,value_kind,
      source_unit,normalized_unit,row_count,non_null_count,null_count,distinct_non_null_count,
      null_ratio,non_null_ratio,distinct_ratio,is_constant,is_all_null,is_unique_among_non_null,is_complete,is_sparse,
      temporal_min,temporal_max)
     VALUES
     ('pc-date','org-a','profile-a1','ws-a','col-date',2,'DATE',NULL,NULL,2,0,2,0,'1','0',NULL,false,true,false,false,false,NULL,NULL);"

expect_failure "14. profile column from a different worksheet is rejected"   "INSERT INTO data_hub_dataset_profile_columns
     (id,organisation_id,profile_run_id,source_schema_worksheet_id,source_schema_column_id,ordinal,value_kind,
      row_count,non_null_count,null_count,distinct_non_null_count,null_ratio,non_null_ratio,distinct_ratio,
      is_constant,is_all_null,is_unique_among_non_null,is_complete,is_sparse,min_length,max_length,total_length,mean_length,empty_string_count)
     VALUES ('pc-wrongws','org-a','profile-a1','ws-b','col-other',0,'STRING',2,2,0,2,'0','1','1',false,false,true,true,false,1,1,2,'1',0);"   "run_worksheet_fkey|source_column_fkey"

expect_failure "15. cross-kind statistic contamination is rejected"   "INSERT INTO data_hub_dataset_profile_columns
     (id,organisation_id,profile_run_id,source_schema_worksheet_id,source_schema_column_id,ordinal,value_kind,
      row_count,non_null_count,null_count,distinct_non_null_count,null_ratio,non_null_ratio,distinct_ratio,
      is_constant,is_all_null,is_unique_among_non_null,is_complete,is_sparse,min_length,max_length,total_length,mean_length,empty_string_count,numeric_min)
     VALUES ('pc-contaminated','org-a','profile-a1','ws-a','col-string',0,'STRING',2,2,0,2,'0','1','1',false,false,true,true,false,3,5,8,'4',0,'10');"   "kind_stats_check|run_ordinal_key|run_source_column_key"

expect_success "16. persisted STRING profile contains no source/example value"   "SELECT 1/CASE WHEN (
     SELECT to_jsonb(c)::text NOT LIKE '%Alice%' AND to_jsonb(c)::text NOT LIKE '%Bob%'
     FROM data_hub_dataset_profile_columns c WHERE id='pc-string'
   ) THEN 1 ELSE 0 END;"

expect_failure "17. profile column evidence UPDATE is rejected"   "UPDATE data_hub_dataset_profile_columns SET min_length=4 WHERE id='pc-string';"   "profile column evidence is immutable"
expect_failure "18. profile column evidence DELETE is rejected"   "DELETE FROM data_hub_dataset_profile_columns WHERE id='pc-string';"   "profile column evidence is immutable"

echo ""
echo "=== COMPLETION RECONCILIATION / TERMINAL IMMUTABILITY ==="
expect_failure "19. incorrect dataset totals cannot complete"   "UPDATE data_hub_dataset_profile_runs
   SET status='SUCCEEDED',completed_at=now(),row_count=2,column_count=3,total_cell_count=5,
       non_null_cell_count=4,null_cell_count=1,complete_row_count=0,incomplete_row_count=2
   WHERE id='profile-a1';"   "count reconciliation failed|state_coherence_check"

expect_success "20. exact reconciled dataset profile completes"   "UPDATE data_hub_dataset_profile_runs
   SET status='SUCCEEDED',completed_at=now(),row_count=2,column_count=3,total_cell_count=6,
       non_null_cell_count=4,null_cell_count=2,complete_row_count=0,incomplete_row_count=2
   WHERE id='profile-a1';"

expect_failure "21. SUCCEEDED profile run is terminal/immutable"   "UPDATE data_hub_dataset_profile_runs SET status='FAILED',completed_at=NULL,failed_at=now(),failure_code='PERSISTENCE_FAILURE',
       row_count=NULL,column_count=NULL,total_cell_count=NULL,non_null_cell_count=NULL,null_cell_count=NULL,
       complete_row_count=NULL,incomplete_row_count=NULL
   WHERE id='profile-a1';"   "Terminal dataset profile attempts are immutable"

expect_failure "22. profile run DELETE is rejected"   "DELETE FROM data_hub_dataset_profile_runs WHERE id='profile-a1';"   "attempt history is immutable"

expect_success "23. later historical attempt can be created after success and failed independently"   "INSERT INTO data_hub_dataset_profile_runs
     (id,organisation_id,import_batch_id,upload_id,normalization_run_id,source_schema_version_id,source_schema_worksheet_id,worksheet_mapping_profile_version_id,attempt_number,profiler_version,status,created_by)
     VALUES ('profile-a2','org-a','batch-a','upload-a','norm-a','sv-a','ws-a','pv-a1',2,'v1','RUNNING','user-a');
   UPDATE data_hub_dataset_profile_runs
   SET status='FAILED',failed_at=now(),failure_code='PERSISTENCE_FAILURE'
   WHERE id='profile-a2';"

expect_success "24. a subsequent new attempt can coexist with FAILED history"   "INSERT INTO data_hub_dataset_profile_runs
     (id,organisation_id,import_batch_id,upload_id,normalization_run_id,source_schema_version_id,source_schema_worksheet_id,worksheet_mapping_profile_version_id,attempt_number,profiler_version,status,created_by)
     VALUES ('profile-a3','org-a','batch-a','upload-a','norm-a','sv-a','ws-a','pv-a1',3,'v1','RUNNING','user-a');"

echo ""
echo "=== ROLLBACK GUARD / CLEAN ROUND TRIP ==="
expect_failure "25. rollback refuses while profile history exists"   "$(cat "$D4D1B1_ROLLBACK")"   "Refusing rollback: data_hub_dataset_profile_runs contains"

echo "Resetting for clean rollback proof..."
reset_database
expect_success "26. clean rollback succeeds" "$(cat "$D4D1B1_ROLLBACK")"
expect_success "27. D4D1B1 tables removed but normalization foundation remains"   "SELECT 1/CASE WHEN
     to_regclass('public.data_hub_dataset_profile_runs') IS NULL
     AND to_regclass('public.data_hub_dataset_profile_columns') IS NULL
     AND to_regclass('public.data_hub_normalization_runs') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid='public.data_hub_normalization_runs'::regclass
         AND conname='data_hub_normalization_runs_profile_lineage_key'
     )
   THEN 1 ELSE 0 END;"

echo ""
echo "=== RESULT ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
echo "All D4D1B1 disposable-Postgres checks passed."
