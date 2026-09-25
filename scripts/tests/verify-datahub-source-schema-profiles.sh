#!/usr/bin/env bash
# Data Hub 6.2D3A — repeatable behavioral validation for
# scripts/create-datahub-source-schema-profiles.sql.
#
# Same disposable-container methodology as
# scripts/tests/verify-datahub-source-mappings.sh (5B.1): a fresh
# postgres:16-alpine container, created and destroyed by this script
# only, never touching Production/Neon/Preview or any already-running
# database.
#
# WHAT THIS DOES: bootstraps a representative pre-5B schema
# (organisations/users/uploads), applies the REAL prerequisite scripts
# (create-import-batches.sql, create-datahub-source-mappings.sql,
# create-datahub-reporting-period.sql), seeds representative pre-existing
# rows (including 5B.1 SourceSystem/SourceMapping/MappingVersion lineage),
# then applies THIS phase's migration twice and exercises real PostgreSQL
# constraint enforcement via expect_success/expect_failure assertions:
# tenant isolation, uniqueness, CHECK allowlists, active-pointer integrity,
# ImportBatch lineage coherence, zero backfill, and fail-loud drift
# detection.
#
# WHAT THIS DOES NOT DO: it is not wired into CI (matches every sibling
# Data Hub disposable-Postgres harness). It never connects to
# Neon/Production/Preview.
#
# USAGE:
#   bash scripts/tests/verify-datahub-source-schema-profiles.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREREQS=(
  "$REPO_ROOT/scripts/create-import-batches.sql"
  "$REPO_ROOT/scripts/create-datahub-source-mappings.sql"
  "$REPO_ROOT/scripts/create-datahub-reporting-period.sql"
)
MIGRATION="$REPO_ROOT/scripts/create-datahub-source-schema-profiles.sql"
CONTAINER="datahub-6-2d3a-source-schema-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
}
trap cleanup EXIT

for f in "${PREREQS[@]}" "$MIGRATION"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: required SQL file not found at $f" >&2
    exit 2
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness (no local Postgres/psql dependency is assumed)." >&2
  exit 2
fi

echo "Starting disposable postgres:16-alpine ($CONTAINER)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine >/dev/null

READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d testdb >/dev/null 2>&1 \
    && docker exec "$CONTAINER" psql -X -q -U postgres -d testdb -c "SELECT 1" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: postgres in $CONTAINER did not become ready within 30s." >&2
  exit 2
fi

DIAG_OUT="$(mktemp 2>/dev/null || echo "/tmp/harness_6_2d3a_last_out.$$.txt")"

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1
}

reset_db() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "DROP DATABASE IF EXISTS testdb;" >/dev/null 2>&1
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "CREATE DATABASE testdb;" >/dev/null 2>&1
}

# Identical to verify-datahub-source-mappings.sh's own pre-5B bootstrap.
bootstrap_pre5b() {
  psql_exec <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TYPE "SchemaType" AS ENUM ('MISSED_COLLECTIONS','ILLEGAL_DUMPING','DEBTORS','SERVICE_REQUESTS','BIN_MAINTENANCE','WASTE_METRICS','FINANCIAL','GENERIC','UNKNOWN');
CREATE TYPE "Module" AS ENUM ('WASTE','DUMPING','FORECASTING','MISSED_COLLECTIONS','DEBTORS','BIN_MAINTENANCE','CONTRACTS','OPERATIONS');
CREATE TYPE "UploadStatus" AS ENUM ('PENDING','DETECTING','VALIDATING','PREVIEW_READY','IMPORTING','COMPLETE','FAILED');
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
INSERT INTO organisations (id, name, slug) VALUES ('org-a','Org A','org-a'), ('org-b','Org B','org-b');
INSERT INTO users (id, organisation_id, username, name) VALUES ('user-a','org-a','user-a','User A'), ('user-b','org-b','user-b','User B');
SQL
}

apply_prereqs() {
  local f
  for f in "${PREREQS[@]}"; do
    if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$f" >"$DIAG_OUT" 2>&1; then
      echo "ERROR: prerequisite $(basename "$f") failed to apply — cannot proceed." >&2
      sed 's/^/    /' "$DIAG_OUT"
      exit 2
    fi
  done
}

apply_migration() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$MIGRATION" >"$DIAG_OUT" 2>&1
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

# Optional third argument: a regex the Postgres error text must match, so a
# rejection for the WRONG reason (e.g. a typo'd column) never counts as a pass.
expect_failure() {
  local desc="$1" sql="$2" pattern="${3:-}"
  if echo "$sql" | psql_exec; then
    echo "  FAIL (expected rejection, but it succeeded): $desc"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  elif [ -n "$pattern" ] && ! grep -qE "$pattern" "$DIAG_OUT"; then
    echo "  FAIL (rejected, but not by the expected constraint /$pattern/): $desc"
    sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  else
    echo "  PASS (correctly rejected): $desc"
    PASS=$((PASS + 1))
  fi
}

expect_migration_success() {
  local desc="$1"
  if apply_migration; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL (migration unexpectedly failed): $desc"
    sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

expect_migration_failure() {
  local desc="$1" pattern="$2"
  if apply_migration; then
    echo "  FAIL (migration unexpectedly succeeded despite drift): $desc"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  elif ! grep -qE "$pattern" "$DIAG_OUT"; then
    echo "  FAIL (migration failed, but not with the expected drift message /$pattern/): $desc"
    sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  else
    echo "  PASS (fail-loud drift detected): $desc"
    PASS=$((PASS + 1))
  fi
}

IB_COLS="organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key"

echo ""
echo "=== SETUP: pre-5B bootstrap + real prerequisite migrations ==="
reset_db
bootstrap_pre5b
apply_prereqs
echo "  base schema ready (import_batches/uploads/source_systems/source_mappings/mapping_versions at real current shape)"

echo ""
echo "=== EXISTING-DATA SEEDING (pre-6.2D3A representative rows) ==="
expect_success "seed: pre-existing READY ImportBatch with no source lineage" \
  "INSERT INTO import_batches (id, $IB_COLS, status, sha256) VALUES ('batch-existing-1','org-a','user-a','existing.csv','csv',100,'vercel-blob','k-existing-1','READY', repeat('a',64));"
expect_success "seed: pre-existing 5B.1 SourceSystem/SourceMapping/MappingVersion + active pointer" \
  "INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-old','org-a','Old System');
   INSERT INTO source_mappings (id, organisation_id, source_system_id, name) VALUES ('sm-old','org-a','ss-old','Old Mapping');
   INSERT INTO mapping_versions (id, organisation_id, source_mapping_id, version_number, mapping_document) VALUES ('mv-old','org-a','sm-old',1,'{\"columns\":{}}');
   UPDATE source_mappings SET active_mapping_version_id='mv-old' WHERE id='sm-old';"
expect_success "seed: pre-existing xlsx ImportBatch WITH 5B.1 source_system lineage" \
  "INSERT INTO import_batches (id, $IB_COLS, source_system_id) VALUES ('batch-existing-2','org-a','user-a','existing.xlsx','xlsx',200,'vercel-blob','k-existing-2','ss-old');"
expect_success "seed: pre-existing canonical Upload with MappingVersion lineage" \
  "INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, lineage_kind, canonical_status, mapping_version_id) VALUES ('upload-existing-1','org-a','user-a','existing.csv','k-existing-1','text/csv',100,'batch-existing-1',0,'DATA_HUB','AWAITING_CONFIRMATION','mv-old');"
expect_success "snapshot: capture pre-migration rows and 5B.1/import_batches constraint definitions" \
  "CREATE TABLE _snap_import_batches AS SELECT * FROM import_batches;
   CREATE TABLE _snap_rows AS SELECT
     (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM source_systems t) AS ss,
     (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM source_mappings t) AS sm,
     (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM mapping_versions t) AS mv,
     (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM uploads t) AS up;
   CREATE TABLE _snap_constraints AS
     SELECT c.conrelid::regclass::text AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c
     WHERE c.conrelid IN ('public.source_systems'::regclass, 'public.source_mappings'::regclass, 'public.mapping_versions'::regclass, 'public.uploads'::regclass, 'public.import_batches'::regclass);"

echo ""
echo "=== MIGRATION APPLY + IDEMPOTENT RERUN ==="
expect_migration_success "1. clean 6.2D3A migration applies on top of the real prerequisite schema"
expect_migration_success "2. second application succeeds (idempotent rerun, every ensure_* validates exact definitions)"
expect_migration_success "2b. third application succeeds (still idempotent)"

expect_success "3. all six new tables exist" \
  "SELECT 1/CASE WHEN to_regclass('public.dataset_types') IS NOT NULL AND to_regclass('public.source_schema_versions') IS NOT NULL
     AND to_regclass('public.source_schema_worksheets') IS NOT NULL AND to_regclass('public.source_schema_columns') IS NOT NULL
     AND to_regclass('public.worksheet_mapping_profiles') IS NOT NULL AND to_regclass('public.worksheet_mapping_profile_versions') IS NOT NULL
   THEN 1 ELSE 0 END;"

expect_success "4. import_batches.dataset_type_id / source_schema_version_id are nullable TEXT with no default" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='import_batches'
     AND column_name IN ('dataset_type_id','source_schema_version_id') AND data_type='text' AND is_nullable='YES' AND column_default IS NULL) = 2
   THEN 1 ELSE 0 END;"

expect_success "5. every new FK is MATCH SIMPLE; lineage FKs NO ACTION; actor FKs SET NULL; none CASCADE" \
  "SELECT 1/CASE WHEN
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype='f' AND confmatchtype <> 's' AND conrelid::regclass::text IN
       ('dataset_types','source_schema_versions','source_schema_worksheets','source_schema_columns','worksheet_mapping_profiles','worksheet_mapping_profile_versions'))
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype='f' AND confdeltype = 'c' AND conrelid::regclass::text IN
       ('dataset_types','source_schema_versions','source_schema_worksheets','source_schema_columns','worksheet_mapping_profiles','worksheet_mapping_profile_versions'))
     AND (SELECT count(*) FROM pg_constraint WHERE contype='f' AND conname LIKE '%created_by_fkey' AND confdeltype='n' AND conrelid::regclass::text IN
       ('dataset_types','source_schema_versions','worksheet_mapping_profiles','worksheet_mapping_profile_versions')) = 4
     AND (SELECT confdeltype FROM pg_constraint WHERE conname='import_batches_dataset_type_fkey') = 'a'
     AND (SELECT confdeltype FROM pg_constraint WHERE conname='import_batches_source_schema_version_fkey') = 'a'
     AND (SELECT confdeltype FROM pg_constraint WHERE conname='worksheet_mapping_profiles_active_version_fkey') = 'a'
   THEN 1 ELSE 0 END;"

echo ""
echo "=== ZERO BACKFILL / PRE-EXISTING ROWS AND CONSTRAINTS UNCHANGED ==="
expect_success "6. every pre-existing ImportBatch survives with BOTH new lineage columns NULL" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM import_batches) = 2
     AND (SELECT count(*) FROM import_batches WHERE dataset_type_id IS NOT NULL OR source_schema_version_id IS NOT NULL) = 0
   THEN 1 ELSE 0 END;"
expect_success "7. every pre-existing ImportBatch column value is byte-identical (only the two new NULL keys added)" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM import_batches b JOIN _snap_import_batches s USING (id)
       WHERE (to_jsonb(b) - 'dataset_type_id' - 'source_schema_version_id') = to_jsonb(s)) = 2
   THEN 1 ELSE 0 END;"
expect_success "8. source_systems/source_mappings/mapping_versions/uploads rows are byte-identical" \
  "SELECT 1/CASE WHEN (SELECT ss FROM _snap_rows) = (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM source_systems t)
     AND (SELECT sm FROM _snap_rows) = (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM source_mappings t)
     AND (SELECT mv FROM _snap_rows) = (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM mapping_versions t)
     AND (SELECT up FROM _snap_rows) = (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM uploads t)
   THEN 1 ELSE 0 END;"
expect_success "9. every pre-existing constraint on source_systems/source_mappings/mapping_versions/uploads/import_batches is unchanged (none dropped/altered)" \
  "SELECT 1/CASE WHEN NOT EXISTS (
     SELECT tbl, conname, def FROM _snap_constraints
     EXCEPT
     SELECT c.conrelid::regclass::text, c.conname, pg_get_constraintdef(c.oid) FROM pg_constraint c)
   THEN 1 ELSE 0 END;"
expect_success "10. the ONLY new constraints on pre-existing tables are the two import_batches lineage FKs + two implication CHECKs" \
  "SELECT 1/CASE WHEN (
     SELECT array_agg(conname ORDER BY conname) FROM (
       SELECT c.conname FROM pg_constraint c WHERE c.conrelid IN ('public.source_systems'::regclass, 'public.source_mappings'::regclass, 'public.mapping_versions'::regclass, 'public.uploads'::regclass, 'public.import_batches'::regclass)
       EXCEPT SELECT conname FROM _snap_constraints) x
   ) = ARRAY['import_batches_dataset_type_fkey','import_batches_dataset_type_requires_source_system_check','import_batches_schema_version_requires_dataset_type_check','import_batches_source_schema_version_fkey']::name[]
   THEN 1 ELSE 0 END;"
expect_success "11. 5B.1's active-mapping pointer and Upload mapping lineage still intact" \
  "SELECT 1/CASE WHEN (SELECT active_mapping_version_id FROM source_mappings WHERE id='sm-old') = 'mv-old'
     AND (SELECT mapping_version_id FROM uploads WHERE id='upload-existing-1') = 'mv-old'
   THEN 1 ELSE 0 END;"

echo ""
echo "=== A. DatasetType ==="
expect_success "12. seed: org-a SourceSystems ss-a1/ss-a2, org-b SourceSystem ss-b1" \
  "INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-a1','org-a','A1'), ('ss-a2','org-a','A2'), ('ss-b1','org-b','B1');"
expect_success "13. same-tenant DatasetType accepted (defaults: active=true)" \
  "INSERT INTO dataset_types (id, organisation_id, source_system_id, name, created_by) VALUES ('dt-a1','org-a','ss-a1','Service Requests','user-a');
   SELECT 1/CASE WHEN (SELECT active FROM dataset_types WHERE id='dt-a1') THEN 1 ELSE 0 END;"
expect_failure "14. cross-tenant DatasetType -> SourceSystem rejected (org-b row pointing at org-a source)" \
  "INSERT INTO dataset_types (id, organisation_id, source_system_id, name) VALUES ('dt-bad','org-b','ss-a1','X');" \
  "dataset_types_source_system_org_fkey"
expect_failure "15. duplicate DatasetType name within the same SourceSystem rejected" \
  "INSERT INTO dataset_types (id, organisation_id, source_system_id, name) VALUES ('dt-dup','org-a','ss-a1','Service Requests');" \
  "dataset_types_source_system_id_name_key"
expect_success "16. same DatasetType name on a different SourceSystem / tenant accepted (no global name uniqueness)" \
  "INSERT INTO dataset_types (id, organisation_id, source_system_id, name) VALUES ('dt-a2','org-a','ss-a2','Service Requests'), ('dt-b1','org-b','ss-b1','Service Requests');"

echo ""
echo "=== B. SourceSchemaVersion ==="
expect_success "17. valid DRAFT schema version accepted (status defaults to DRAFT)" \
  "INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('sv-a1-1','org-a','dt-a1',1,'v1');
   SELECT 1/CASE WHEN (SELECT status FROM source_schema_versions WHERE id='sv-a1-1') = 'DRAFT' THEN 1 ELSE 0 END;"
expect_failure "18. duplicate schema version number for the same DatasetType rejected" \
  "INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('sv-dup','org-a','dt-a1',1,'dup');" \
  "source_schema_versions_dataset_type_id_version_number_key"
expect_failure "19. version_number 0 rejected" \
  "INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('sv-zero','org-a','dt-a1',0,'zero');" \
  "source_schema_versions_version_number_check"
expect_failure "19b. negative version_number rejected" \
  "INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('sv-neg','org-a','dt-a1',-1,'neg');" \
  "source_schema_versions_version_number_check"
# An out-of-allowlist status also fails the activation CHECK (it matches
# none of its three branches), and Postgres reports whichever CHECK it
# evaluates first. To prove the status allowlist ON ITS OWN, 20/20b drop
# the activation CHECK inside a transaction that the failing INSERT aborts
# (rolled back — this disposable database keeps the constraint).
expect_failure "20. invalid schema status rejected (by the status allowlist itself)" \
  "BEGIN; ALTER TABLE source_schema_versions DROP CONSTRAINT source_schema_versions_activation_check;
   INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label, status) VALUES ('sv-bad','org-a','dt-a1',2,'bad','PUBLISHED'); COMMIT;" \
  "source_schema_versions_status_check"
expect_failure "20b. lowercase status rejected (allowlist is exact)" \
  "BEGIN; ALTER TABLE source_schema_versions DROP CONSTRAINT source_schema_versions_activation_check;
   INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label, status) VALUES ('sv-lc','org-a','dt-a1',2,'lc','draft'); COMMIT;" \
  "source_schema_versions_status_check"
expect_success "20c. activation CHECK still present after the aborted transactions" \
  "SELECT 1/CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='source_schema_versions_activation_check') THEN 1 ELSE 0 END;"
expect_failure "20d. invalid status also rejected with every constraint in place" \
  "INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label, status) VALUES ('sv-bad2','org-a','dt-a1',2,'bad','PUBLISHED');" \
  "source_schema_versions_(status|activation)_check"
expect_failure "21. ACTIVE without activated_at rejected" \
  "INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label, status) VALUES ('sv-act','org-a','dt-a1',2,'a','ACTIVE');" \
  "source_schema_versions_activation_check"
expect_failure "21b. DRAFT with activated_at rejected" \
  "INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label, activated_at) VALUES ('sv-dr','org-a','dt-a1',2,'d',now());" \
  "source_schema_versions_activation_check"
expect_success "21c. ACTIVE with activated_at, and RETIRED with/without activated_at, accepted" \
  "INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label, status, activated_at) VALUES ('sv-a1-2','org-a','dt-a1',2,'v2','ACTIVE',now());
   INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label, status) VALUES ('sv-a1-3','org-a','dt-a1',3,'v3','RETIRED');
   INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label, status, activated_at) VALUES ('sv-a1-4','org-a','dt-a1',4,'v4','RETIRED',now());"
expect_failure "22. cross-tenant SchemaVersion -> DatasetType rejected" \
  "INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('sv-x','org-b','dt-a1',9,'x');" \
  "source_schema_versions_dataset_type_org_fkey"
expect_success "23. same version_number on a different DatasetType accepted; org-b chain seeded" \
  "INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('sv-a2-1','org-a','dt-a2',1,'v1'), ('sv-b1-1','org-b','dt-b1',1,'v1');"

echo ""
echo "=== C. SourceSchemaWorksheet ==="
expect_success "24. valid worksheets accepted (ordinal_hint nullable)" \
  "INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, ordinal_hint, presence, role)
     VALUES ('ws-a1','org-a','sv-a1-1','requests','Requests',0,'REQUIRED','DATA'),
            ('ws-a2','org-a','sv-a1-1','summary','Summary',NULL,'OPTIONAL','SUMMARY'),
            ('ws-b1','org-b','sv-b1-1','requests','Requests',0,'REQUIRED','DATA');"
expect_failure "25. duplicate logical_key within one schema version rejected" \
  "INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role) VALUES ('ws-d1','org-a','sv-a1-1','requests','Other','REQUIRED','DATA');" \
  "source_schema_worksheets_version_logical_key_key"
expect_failure "26. duplicate expected_name within one schema version rejected" \
  "INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role) VALUES ('ws-d2','org-a','sv-a1-1','other','Requests','REQUIRED','DATA');" \
  "source_schema_worksheets_version_expected_name_key"
expect_success "26b. same logical_key/expected_name in a DIFFERENT schema version accepted" \
  "INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role) VALUES ('ws-a1v2','org-a','sv-a1-2','requests','Requests','REQUIRED','DATA');"
expect_failure "27. negative ordinal_hint rejected" \
  "INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, ordinal_hint, presence, role) VALUES ('ws-n','org-a','sv-a1-1','neg','Neg',-1,'REQUIRED','DATA');" \
  "source_schema_worksheets_ordinal_hint_check"
expect_failure "28. invalid worksheet presence rejected" \
  "INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role) VALUES ('ws-p','org-a','sv-a1-1','p','P','MAYBE','DATA');" \
  "source_schema_worksheets_presence_check"
expect_failure "29. invalid worksheet role rejected" \
  "INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role) VALUES ('ws-r','org-a','sv-a1-1','r','R','REQUIRED','LOOKUP');" \
  "source_schema_worksheets_role_check"
expect_failure "30. cross-tenant Worksheet -> SchemaVersion rejected" \
  "INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role) VALUES ('ws-x','org-b','sv-a1-1','x','X','REQUIRED','DATA');" \
  "source_schema_worksheets_version_org_fkey"

echo ""
echo "=== D. SourceSchemaColumn ==="
expect_success "31. valid columns accepted (logical_field_key nullable; duplicate source_header allowed at distinct ordinals, by design)" \
  "INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, logical_field_key, presence, declared_type, sensitivity_class)
     VALUES ('col-a1','org-a','ws-a1',0,'Ref',NULL,'REQUIRED','STRING','INTERNAL'),
            ('col-a2','org-a','ws-a1',1,'Notes',NULL,'OPTIONAL','STRING','CONFIDENTIAL'),
            ('col-a3','org-a','ws-a1',2,'Notes',NULL,'OPTIONAL','STRING','CONFIDENTIAL');"
expect_failure "32. duplicate ordinal within one worksheet rejected" \
  "INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class) VALUES ('col-d','org-a','ws-a1',0,'Dup','REQUIRED','STRING','PUBLIC');" \
  "source_schema_columns_worksheet_ordinal_key"
expect_failure "33. negative column ordinal rejected" \
  "INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class) VALUES ('col-n','org-a','ws-a1',-1,'Neg','REQUIRED','STRING','PUBLIC');" \
  "source_schema_columns_ordinal_check"
expect_failure "34. invalid column presence rejected" \
  "INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class) VALUES ('col-p','org-a','ws-a1',9,'P','SOMETIMES','STRING','PUBLIC');" \
  "source_schema_columns_presence_check"
expect_failure "35. invalid declared_type rejected" \
  "INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class) VALUES ('col-t','org-a','ws-a1',9,'T','REQUIRED','TEXT','PUBLIC');" \
  "source_schema_columns_declared_type_check"
expect_failure "36. invalid sensitivity_class rejected" \
  "INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class) VALUES ('col-s','org-a','ws-a1',9,'S','REQUIRED','STRING','SECRET');" \
  "source_schema_columns_sensitivity_class_check"
expect_failure "36b. sensitivity_class has no default (omitting it is rejected, never silently classified)" \
  "INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type) VALUES ('col-nd','org-a','ws-a1',9,'ND','REQUIRED','STRING');" \
  "sensitivity_class"
expect_success "36c. every allowed declared_type and sensitivity_class value accepted" \
  "INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class)
     SELECT 'col-all-' || n, 'org-a', 'ws-a2', n, 'H' || n, 'OPTIONAL',
            (ARRAY['STRING','DATE_TIME','DATE','INTEGER','DECIMAL','BOOLEAN','UNKNOWN'])[1 + (n % 7)],
            (ARRAY['PUBLIC','INTERNAL','CONFIDENTIAL','PERSONALLY_IDENTIFIABLE','HIGHLY_SENSITIVE'])[1 + (n % 5)]
     FROM generate_series(0, 34) AS n;"
expect_failure "37. cross-tenant Column -> Worksheet rejected" \
  "INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class) VALUES ('col-x','org-b','ws-a1',9,'X','REQUIRED','STRING','PUBLIC');" \
  "source_schema_columns_worksheet_org_fkey"

echo ""
echo "=== E. Worksheet mapping profile / version ==="
expect_success "38. valid profiles accepted (active pointer NULL by default)" \
  "INSERT INTO worksheet_mapping_profiles (id, organisation_id, source_schema_worksheet_id, name, created_by)
     VALUES ('wp-a1','org-a','ws-a1','Requests treatment','user-a'), ('wp-a2','org-a','ws-a2','Summary treatment',NULL), ('wp-b1','org-b','ws-b1','B treatment',NULL);
   SELECT 1/CASE WHEN (SELECT active_profile_version_id FROM worksheet_mapping_profiles WHERE id='wp-a1') IS NULL THEN 1 ELSE 0 END;"
expect_failure "39. cross-tenant Profile -> Worksheet rejected" \
  "INSERT INTO worksheet_mapping_profiles (id, organisation_id, source_schema_worksheet_id, name) VALUES ('wp-x','org-b','ws-a1','X');" \
  "worksheet_mapping_profiles_worksheet_org_fkey"
expect_failure "40. duplicate profile name on the same worksheet rejected" \
  "INSERT INTO worksheet_mapping_profiles (id, organisation_id, source_schema_worksheet_id, name) VALUES ('wp-dup','org-a','ws-a1','Requests treatment');" \
  "worksheet_mapping_profiles_worksheet_name_key"
expect_success "41. valid profile versions accepted" \
  "INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document)
     VALUES ('pv-a1-1','org-a','wp-a1',1,'STAGING_DATASET','{}'),
            ('pv-a1-2','org-a','wp-a1',2,'IGNORE','{}'),
            ('pv-a2-1','org-a','wp-a2',1,'RECONCILIATION_SUMMARY','{}'),
            ('pv-b1-1','org-b','wp-b1',1,'METADATA','{}');"
expect_failure "42. cross-tenant ProfileVersion -> Profile rejected" \
  "INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document) VALUES ('pv-x','org-b','wp-a1',9,'IGNORE','{}');" \
  "worksheet_mapping_profile_versions_profile_org_fkey"
expect_failure "43. duplicate profile version number rejected" \
  "INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document) VALUES ('pv-dup','org-a','wp-a1',1,'IGNORE','{}');" \
  "worksheet_mapping_profile_versions_profile_version_key"
expect_failure "44. profile version_number 0 rejected" \
  "INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document) VALUES ('pv-0','org-a','wp-a1',0,'IGNORE','{}');" \
  "worksheet_mapping_profile_versions_version_number_check"
expect_failure "45. invalid disposition rejected" \
  "INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document) VALUES ('pv-d','org-a','wp-a1',9,'CANONICAL_IMPORT','{}');" \
  "worksheet_mapping_profile_versions_disposition_check"
expect_failure "46. non-object profile_document rejected" \
  "INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document) VALUES ('pv-arr','org-a','wp-a1',9,'IGNORE','[]');" \
  "worksheet_mapping_profile_versions_document_object_check"
expect_success "47. active pointer to the profile's OWN version accepted" \
  "UPDATE worksheet_mapping_profiles SET active_profile_version_id='pv-a1-2' WHERE id='wp-a1';"
expect_failure "48. active pointer to ANOTHER profile's version (same tenant) rejected" \
  "UPDATE worksheet_mapping_profiles SET active_profile_version_id='pv-a1-1' WHERE id='wp-a2';" \
  "worksheet_mapping_profiles_active_version_fkey"
# 49/53/56: the target belongs to another tenant AND another parent
# (profile/source/dataset). The organisation_id column of these composite
# FKs cannot be tested in isolation: each parent FK already pins its
# parent's tenant, so the tenant part is implied by the parent chain.
expect_failure "49. active pointer to ANOTHER tenant's (and profile's) version rejected" \
  "UPDATE worksheet_mapping_profiles SET active_profile_version_id='pv-b1-1' WHERE id='wp-a1';" \
  "worksheet_mapping_profiles_active_version_fkey"
expect_failure "50. hard-deleting an active-pointer target version rejected (NO ACTION)" \
  "DELETE FROM worksheet_mapping_profile_versions WHERE id='pv-a1-2';" \
  "worksheet_mapping_profiles_active_version_fkey"

echo ""
echo "=== F. ImportBatch lineage coherence ==="
expect_failure "51. ImportBatch dataset_type with NULL source_system rejected (implication CHECK, MATCH SIMPLE hole closed)" \
  "INSERT INTO import_batches (id, $IB_COLS, dataset_type_id) VALUES ('ib-1','org-a','user-a','f.xlsx','xlsx',1,'vercel-blob','k-ib-1','dt-a1');" \
  "import_batches_dataset_type_requires_source_system_check"
expect_failure "52. ImportBatch dataset_type from the WRONG source system (same tenant) rejected" \
  "INSERT INTO import_batches (id, $IB_COLS, source_system_id, dataset_type_id) VALUES ('ib-2','org-a','user-a','f.xlsx','xlsx',1,'vercel-blob','k-ib-2','ss-a2','dt-a1');" \
  "import_batches_dataset_type_fkey"
expect_failure "53. ImportBatch dataset_type from another tenant (and source system) rejected" \
  "INSERT INTO import_batches (id, $IB_COLS, source_system_id, dataset_type_id) VALUES ('ib-3','org-a','user-a','f.xlsx','xlsx',1,'vercel-blob','k-ib-3','ss-a1','dt-b1');" \
  "import_batches_dataset_type_fkey"
expect_failure "54. ImportBatch schema_version with NULL dataset_type rejected (implication CHECK)" \
  "INSERT INTO import_batches (id, $IB_COLS, source_system_id, source_schema_version_id) VALUES ('ib-4','org-a','user-a','f.xlsx','xlsx',1,'vercel-blob','k-ib-4','ss-a1','sv-a1-1');" \
  "import_batches_schema_version_requires_dataset_type_check"
expect_failure "54b. ImportBatch schema_version with NULL dataset_type AND NULL source_system rejected" \
  "INSERT INTO import_batches (id, $IB_COLS, source_schema_version_id) VALUES ('ib-4b','org-a','user-a','f.xlsx','xlsx',1,'vercel-blob','k-ib-4b','sv-a1-1');" \
  "import_batches_schema_version_requires_dataset_type_check"
expect_failure "55. ImportBatch schema_version from the WRONG dataset_type (same source, same tenant) rejected" \
  "INSERT INTO dataset_types (id, organisation_id, source_system_id, name) VALUES ('dt-a1b','org-a','ss-a1','Other dataset');
   INSERT INTO import_batches (id, $IB_COLS, source_system_id, dataset_type_id, source_schema_version_id) VALUES ('ib-5','org-a','user-a','f.xlsx','xlsx',1,'vercel-blob','k-ib-5','ss-a1','dt-a1b','sv-a1-1');" \
  "import_batches_source_schema_version_fkey"
expect_failure "56. ImportBatch schema_version from another tenant (and dataset type) rejected" \
  "INSERT INTO import_batches (id, $IB_COLS, source_system_id, dataset_type_id, source_schema_version_id) VALUES ('ib-6','org-a','user-a','f.xlsx','xlsx',1,'vercel-blob','k-ib-6','ss-a1','dt-a1','sv-b1-1');" \
  "import_batches_source_schema_version_fkey"
# Defense in depth, not a D3A-specific proof: this row is first rejected
# by 5B.1's own import_batches_source_system_org_fkey.
expect_failure "56b. org-b ImportBatch claiming org-a's coherent chain rejected (by the tenant-scoped FK chain)" \
  "INSERT INTO import_batches (id, $IB_COLS, source_system_id, dataset_type_id, source_schema_version_id) VALUES ('ib-6b','org-b','user-b','f.xlsx','xlsx',1,'vercel-blob','k-ib-6b','ss-a1','dt-a1','sv-a1-1');" \
  "import_batches_(source_system_org|dataset_type|source_schema_version)_fkey"
expect_success "57. valid coherent source -> dataset -> schema chain accepted" \
  "INSERT INTO import_batches (id, $IB_COLS, source_system_id, dataset_type_id, source_schema_version_id) VALUES ('ib-ok','org-a','user-a','f.xlsx','xlsx',1,'vercel-blob','k-ib-ok','ss-a1','dt-a1','sv-a1-1');"
expect_success "58. source + dataset without a schema version accepted (schema version optional)" \
  "INSERT INTO import_batches (id, $IB_COLS, source_system_id, dataset_type_id) VALUES ('ib-ok2','org-a','user-a','f.xlsx','xlsx',1,'vercel-blob','k-ib-ok2','ss-a1','dt-a1');"
expect_success "59. source-only batch (5B.1 shape) still accepted" \
  "INSERT INTO import_batches (id, $IB_COLS, source_system_id) VALUES ('ib-ok3','org-a','user-a','f.csv','csv',1,'vercel-blob','k-ib-ok3','ss-a1');"
expect_failure "60. re-pointing a lineage batch to another source system (leaving dataset_type stale) rejected" \
  "UPDATE import_batches SET source_system_id='ss-a2' WHERE id='ib-ok';" \
  "import_batches_dataset_type_fkey"
expect_failure "61. clearing source_system_id on a batch with dataset lineage rejected" \
  "UPDATE import_batches SET source_system_id=NULL WHERE id='ib-ok2';" \
  "import_batches_dataset_type_requires_source_system_check"
expect_failure "62. clearing dataset_type_id on a batch with schema lineage rejected" \
  "UPDATE import_batches SET dataset_type_id=NULL WHERE id='ib-ok';" \
  "import_batches_schema_version_requires_dataset_type_check"
# 63/64 use a DatasetType / SourceSchemaVersion that has NO child schema
# rows, so the ONLY thing that can block the delete is the import_batches
# lineage FK itself (dt-a1/sv-a1-1 would also be blocked by their own
# child versions/worksheets and prove nothing about the lineage FK).
expect_success "63/64 setup: childless dataset types / schema version referenced only by ImportBatch lineage" \
  "INSERT INTO dataset_types (id, organisation_id, source_system_id, name) VALUES ('dt-solo1','org-a','ss-a1','Solo 1'), ('dt-solo2','org-a','ss-a1','Solo 2');
   INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('sv-solo2','org-a','dt-solo2',1,'solo');
   INSERT INTO import_batches (id, $IB_COLS, source_system_id, dataset_type_id) VALUES ('ib-solo1','org-a','user-a','s.xlsx','xlsx',1,'vercel-blob','k-ib-solo1','ss-a1','dt-solo1');
   INSERT INTO import_batches (id, $IB_COLS, source_system_id, dataset_type_id, source_schema_version_id) VALUES ('ib-solo2','org-a','user-a','s.xlsx','xlsx',1,'vercel-blob','k-ib-solo2','ss-a1','dt-solo2','sv-solo2');"
expect_failure "63. hard-deleting a DatasetType referenced ONLY by ImportBatch lineage rejected (NO ACTION)" \
  "DELETE FROM dataset_types WHERE id='dt-solo1';" \
  "import_batches_dataset_type_fkey"
expect_failure "64. hard-deleting a SourceSchemaVersion referenced ONLY by ImportBatch lineage rejected (NO ACTION)" \
  "DELETE FROM source_schema_versions WHERE id='sv-solo2';" \
  "import_batches_source_schema_version_fkey"
expect_success "65. deleting a creator User nulls created_by (SET NULL) without touching the definition" \
  "INSERT INTO users (id, organisation_id, username, name) VALUES ('user-tmp','org-a','user-tmp','Tmp');
   INSERT INTO dataset_types (id, organisation_id, source_system_id, name, created_by) VALUES ('dt-tmp','org-a','ss-a2','Tmp','user-tmp');
   DELETE FROM users WHERE id='user-tmp';
   SELECT 1/CASE WHEN (SELECT created_by FROM dataset_types WHERE id='dt-tmp') IS NULL THEN 1 ELSE 0 END;"

echo ""
echo "=== RERUN WITH DATA PRESENT ==="
expect_migration_success "66. migration reruns cleanly with real lineage rows present"
expect_success "67. pre-existing batches still NULL lineage; new lineage rows intact after rerun" \
  "SELECT 1/CASE WHEN (SELECT dataset_type_id FROM import_batches WHERE id='batch-existing-1') IS NULL
     AND (SELECT dataset_type_id FROM import_batches WHERE id='batch-existing-2') IS NULL
     AND (SELECT source_schema_version_id FROM import_batches WHERE id='ib-ok') = 'sv-a1-1'
   THEN 1 ELSE 0 END;"

echo ""
echo "=== FAIL-LOUD DRIFT DETECTION (fresh database per case) ==="
reset_db; bootstrap_pre5b; apply_prereqs
expect_success "68 setup: pre-create idx_dataset_types_organisation with the WRONG column" \
  "CREATE TABLE public.dataset_types (id TEXT NOT NULL, name TEXT NOT NULL); CREATE INDEX idx_dataset_types_organisation ON public.dataset_types (name);"
expect_migration_failure "68. index definition drift is detected (ensure_index exact pg_get_indexdef comparison)" \
  "Migration drift: index public\.idx_dataset_types_organisation"

reset_db; bootstrap_pre5b; apply_prereqs
expect_success "69 setup: pre-create source_schema_versions with a WEAKER status CHECK under the expected name" \
  "CREATE TABLE public.source_schema_versions (status TEXT NOT NULL DEFAULT 'DRAFT'); ALTER TABLE public.source_schema_versions ADD CONSTRAINT source_schema_versions_status_check CHECK (status IS NOT NULL);"
expect_migration_failure "69. CHECK definition drift is detected" \
  "Migration drift: public\.source_schema_versions\.source_schema_versions_status_check CHECK"

reset_db; bootstrap_pre5b; apply_prereqs
expect_success "70 setup: pre-create import_batches.dataset_type_id with the WRONG type" \
  "ALTER TABLE public.import_batches ADD COLUMN dataset_type_id INTEGER;"
expect_migration_failure "70. column type drift on a pre-existing table is detected" \
  "Migration drift: public\.import_batches\.dataset_type_id has type integer"

# 72-76: apply the real migration, tamper with ONE object so it keeps its
# expected name but not its expected definition, then rerun. Each rerun
# must RAISE rather than silently accept the weaker object.
reset_db; bootstrap_pre5b; apply_prereqs; apply_migration
expect_success "72 setup: same-named index on the SAME column but with a partial predicate" \
  "DROP INDEX public.idx_dataset_types_source_system; CREATE INDEX idx_dataset_types_source_system ON public.dataset_types (source_system_id) WHERE active;"
expect_migration_failure "72. partial-predicate index drift is detected (same column, extra WHERE)" \
  "Migration drift: index public\.idx_dataset_types_source_system"

reset_db; bootstrap_pre5b; apply_prereqs; apply_migration
expect_success "73 setup: same-named index on the SAME column but DESC" \
  "DROP INDEX public.idx_source_schema_columns_worksheet; CREATE INDEX idx_source_schema_columns_worksheet ON public.source_schema_columns (source_schema_worksheet_id DESC);"
expect_migration_failure "73. index sort-order drift is detected" \
  "Migration drift: index public\.idx_source_schema_columns_worksheet"

reset_db; bootstrap_pre5b; apply_prereqs; apply_migration
expect_success "74 setup: lineage FK recreated under its expected name with ON DELETE CASCADE" \
  "ALTER TABLE public.import_batches DROP CONSTRAINT import_batches_dataset_type_fkey;
   ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_dataset_type_fkey FOREIGN KEY (dataset_type_id, source_system_id, organisation_id) REFERENCES public.dataset_types (id, source_system_id, organisation_id) ON DELETE CASCADE;"
expect_migration_failure "74. lineage FK ON DELETE drift (CASCADE) is detected" \
  "Migration drift: public\.import_batches\.import_batches_dataset_type_fkey ON DELETE is c"

reset_db; bootstrap_pre5b; apply_prereqs; apply_migration
expect_success "75 setup: dataset type name uniqueness widened to GLOBAL under its expected name" \
  "ALTER TABLE public.dataset_types DROP CONSTRAINT dataset_types_source_system_id_name_key;
   ALTER TABLE public.dataset_types ADD CONSTRAINT dataset_types_source_system_id_name_key UNIQUE (name);"
expect_migration_failure "75. UNIQUE constraint shape drift is detected" \
  "Migration drift: public\.dataset_types\.dataset_types_source_system_id_name_key UNIQUE"

reset_db; bootstrap_pre5b; apply_prereqs; apply_migration
expect_success "76 setup: implication CHECK weakened to CHECK (true) under its expected name" \
  "ALTER TABLE public.import_batches DROP CONSTRAINT import_batches_schema_version_requires_dataset_type_check;
   ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_schema_version_requires_dataset_type_check CHECK (true);"
expect_migration_failure "76. weakened lineage implication CHECK is detected" \
  "Migration drift: public\.import_batches\.import_batches_schema_version_requires_dataset_type_check CHECK"

echo ""
echo "=== COMMENTED ROLLBACK BLOCK IS TRUTHFUL (disposable DB only; never run by the migration) ==="
reset_db; bootstrap_pre5b; apply_prereqs
expect_migration_success "71 setup: fresh migration application for the rollback proof"
expect_success "71 setup: a pre-existing-shape batch with NULL lineage" \
  "INSERT INTO import_batches (id, $IB_COLS) VALUES ('batch-rb','org-a','user-a','rb.csv','csv',1,'vercel-blob','k-rb');"
ROLLBACK_SQL="$(sed -n '/^-- Rollback (manual, NOT executed/,$p' "$MIGRATION" | sed -n 's/^--   \(ALTER TABLE\|DROP TABLE\)/\1/p')"
expect_success "71. the commented rollback statements execute cleanly, in order, before any lineage reference exists" "$ROLLBACK_SQL"
expect_success "71b. after rollback: new tables/columns gone; 5B.1 schema and the batch intact" \
  "SELECT 1/CASE WHEN to_regclass('public.dataset_types') IS NULL AND to_regclass('public.worksheet_mapping_profile_versions') IS NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_batches' AND column_name IN ('dataset_type_id','source_schema_version_id'))
     AND to_regclass('public.source_mappings') IS NOT NULL AND to_regclass('public.mapping_versions') IS NOT NULL
     AND (SELECT count(*) FROM import_batches WHERE id='batch-rb') = 1
   THEN 1 ELSE 0 END;"
expect_migration_success "71c. migration re-applies cleanly after rollback"

echo ""
echo "=== PROHIBITED-STATEMENT ABSENCE (static, active SQL only) ==="
ACTIVE_SQL="$(grep -v '^[[:space:]]*--' "$MIGRATION")"
if echo "$ACTIVE_SQL" | grep -qiE '\bUPDATE[[:space:]]+(public\.)?[a-z_]+[[:space:]]+SET\b|\bDELETE[[:space:]]+FROM\b|\bDROP[[:space:]]+(TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)\b|\bTRUNCATE\b|\bINSERT[[:space:]]+INTO\b|ON[[:space:]]+DELETE[[:space:]]+CASCADE'; then
  echo "  FAIL: migration contains an active UPDATE/DELETE/DROP/TRUNCATE/INSERT/CASCADE statement"
  FAIL=$((FAIL + 1))
  FAILURES+=("71. no destructive/backfill statement in migration source")
else
  echo "  PASS: no active UPDATE/DELETE/DROP/TRUNCATE/INSERT/ON DELETE CASCADE in migration source"
  PASS=$((PASS + 1))
fi

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo "Failed checks:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
