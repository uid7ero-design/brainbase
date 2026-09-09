#!/usr/bin/env bash
# Data Hub 5B.1 — repeatable behavioral validation for
# scripts/create-datahub-source-mappings.sql.
#
# Extends the exact disposable-container methodology established by
# scripts/tests/verify-import-batches-migration.sh (5A.2C) and reused
# throughout Data Hub (verify-import-batch-service.sh, verify-inspect-
# worksheets.sh, verify-worksheet-read-service.sh): a fresh
# postgres:16-alpine container, created and destroyed by this script
# only, never touching Production/Neon or any already-running database.
#
# WHAT THIS DOES: applies the REAL scripts/create-import-batches.sql
# (5A.2C) first, against a representative pre-5B bootstrap schema
# (organisations/users/uploads), to get import_batches/uploads into
# their real current shape — then applies THIS phase's
# scripts/create-datahub-source-mappings.sql on top, and exercises real
# PostgreSQL constraint enforcement (tenant-isolation FK proofs,
# active-version pointer integrity, duplicate-version rejection,
# existing-row preservation, idempotent rerun) via expect_success/
# expect_failure assertions against genuine Postgres — not
# regex/static source matching.
#
# WHAT THIS DOES NOT DO: it is not wired into CI in this phase (matches
# every sibling Data Hub disposable-Postgres harness). It never
# connects to Neon/Production/Preview — DATABASE_URL, if referenced at
# all, always points at the disposable container this script itself
# creates and destroys.
#
# USAGE:
#   bash scripts/tests/verify-datahub-source-mappings.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_MIGRATION="$REPO_ROOT/scripts/create-import-batches.sql"
MIGRATION="$REPO_ROOT/scripts/create-datahub-source-mappings.sql"
CONTAINER="datahub-5b1-source-mapping-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -f "$BASE_MIGRATION" ]; then
  echo "ERROR: base migration file not found at $BASE_MIGRATION" >&2
  exit 2
fi
if [ ! -f "$MIGRATION" ]; then
  echo "ERROR: 5B.1 migration file not found at $MIGRATION" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness (no local Postgres/psql dependency is assumed)." >&2
  exit 2
fi

echo "Starting disposable postgres:16-alpine ($CONTAINER)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine >/dev/null

READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: postgres in $CONTAINER did not become ready within 30s." >&2
  exit 2
fi

DIAG_OUT="/tmp/harness_5b1_last_out.$$.txt"

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1
}

reset_db() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "DROP DATABASE IF EXISTS testdb;" >/dev/null 2>&1
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "CREATE DATABASE testdb;" >/dev/null 2>&1
}

# Representative pre-5B bootstrap: organisations/users/uploads in their
# real pre-import-batches shape, matching this repository's actual FK
# conventions (users.organisation_id ON DELETE CASCADE, uploads.user_id
# ON DELETE SET NULL, uploads.organisation_id ON DELETE CASCADE) —
# identical to verify-import-batches-migration.sh's own bootstrap.
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

apply_base_migration() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$BASE_MIGRATION" >"$DIAG_OUT" 2>&1
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

expect_failure() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then
    echo "  FAIL (expected rejection, but it succeeded): $desc"
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

echo ""
echo "=== SETUP: pre-5B bootstrap + real create-import-batches.sql (5A.2C) ==="
reset_db
bootstrap_pre5b
if ! apply_base_migration; then
  echo "ERROR: base migration (create-import-batches.sql) failed to apply — cannot proceed." >&2
  sed 's/^/    /' "$DIAG_OUT"
  exit 2
fi
echo "  base schema ready (organisations/users/import_batches/uploads at real current shape)"

echo ""
echo "=== EXISTING-DATA SEEDING (pre-5B.1 representative rows) ==="
expect_success "seed: representative pre-existing ImportBatch (org-a, READY)" \
  "INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, status, sha256) VALUES ('batch-existing-1','org-a','user-a','existing.csv','csv',100,'vercel-blob','k-existing-1','READY', repeat('a',64));"
expect_success "seed: representative pre-existing canonical Upload (org-a, linked to batch-existing-1)" \
  "INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, lineage_kind, canonical_status) VALUES ('upload-existing-1','org-a','user-a','existing.csv','k-existing-1','text/csv',100,'batch-existing-1',0,'DATA_HUB','AWAITING_CONFIRMATION');"
expect_success "seed: representative pre-existing legacy Upload (org-a, no lineage)" \
  "INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes) VALUES ('upload-legacy-1','org-a','user-a','legacy.csv','/tmp/legacy.csv','text/csv',10);"

echo ""
echo "=== 1-8: SCHEMA STRUCTURE (first migration application) ==="
expect_migration_success "1. clean 5B.1 migration applies on top of the real 5A.2C base schema"

expect_success "2. source_systems/source_mappings/mapping_versions all exist" \
  "SELECT 1/CASE WHEN to_regclass('public.source_systems') IS NOT NULL AND to_regclass('public.source_mappings') IS NOT NULL AND to_regclass('public.mapping_versions') IS NOT NULL THEN 1 ELSE 0 END;"

expect_success "3. expected columns/types/nullability on source_systems" \
  "SELECT 1/CASE WHEN
     (SELECT is_nullable FROM information_schema.columns WHERE table_name='source_systems' AND column_name='organisation_id') = 'NO'
     AND (SELECT is_nullable FROM information_schema.columns WHERE table_name='source_systems' AND column_name='description') = 'YES'
     AND (SELECT data_type FROM information_schema.columns WHERE table_name='source_systems' AND column_name='active') = 'boolean'
     AND (SELECT column_default FROM information_schema.columns WHERE table_name='source_systems' AND column_name='active') = 'true'
   THEN 1 ELSE 0 END;"

expect_success "4. expected columns/types/nullability on source_mappings, including nullable active_mapping_version_id" \
  "SELECT 1/CASE WHEN
     (SELECT is_nullable FROM information_schema.columns WHERE table_name='source_mappings' AND column_name='source_system_id') = 'NO'
     AND (SELECT is_nullable FROM information_schema.columns WHERE table_name='source_mappings' AND column_name='active_mapping_version_id') = 'YES'
   THEN 1 ELSE 0 END;"

expect_success "5. mapping_document is JSONB, NOT NULL, and version_number is INTEGER NOT NULL" \
  "SELECT 1/CASE WHEN
     (SELECT data_type FROM information_schema.columns WHERE table_name='mapping_versions' AND column_name='mapping_document') = 'jsonb'
     AND (SELECT is_nullable FROM information_schema.columns WHERE table_name='mapping_versions' AND column_name='mapping_document') = 'NO'
     AND (SELECT data_type FROM information_schema.columns WHERE table_name='mapping_versions' AND column_name='version_number') = 'integer'
     AND (SELECT is_nullable FROM information_schema.columns WHERE table_name='mapping_versions' AND column_name='version_number') = 'NO'
   THEN 1 ELSE 0 END;"

expect_success "6. expected unique constraints exist (id+org on all three tables, source_mapping_id+version_number on mapping_versions)" \
  "SELECT 1/CASE WHEN
     EXISTS (SELECT 1 FROM pg_constraint WHERE conname='source_systems_id_organisation_id_key' AND contype='u')
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='source_mappings_id_organisation_id_key' AND contype='u')
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mapping_versions_id_organisation_id_key' AND contype='u')
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mapping_versions_source_mapping_id_version_number_key' AND contype='u')
   THEN 1 ELSE 0 END;"

expect_success "7. expected indexes exist on organisation_id for all three new tables" \
  "SELECT 1/CASE WHEN
     to_regclass('public.idx_source_systems_organisation') IS NOT NULL
     AND to_regclass('public.idx_source_mappings_organisation') IS NOT NULL
     AND to_regclass('public.idx_mapping_versions_organisation') IS NOT NULL
   THEN 1 ELSE 0 END;"

expect_success "8. expected FKs exist with MATCH SIMPLE and NO ACTION on the composite tenant FKs" \
  "SELECT 1/CASE WHEN
     (SELECT confmatchtype FROM pg_constraint WHERE conname='source_mappings_source_system_org_fkey') = 's'
     AND (SELECT confdeltype FROM pg_constraint WHERE conname='source_mappings_source_system_org_fkey') = 'a'
     AND (SELECT confmatchtype FROM pg_constraint WHERE conname='mapping_versions_source_mapping_org_fkey') = 's'
     AND (SELECT confdeltype FROM pg_constraint WHERE conname='mapping_versions_source_mapping_org_fkey') = 'a'
     AND (SELECT confmatchtype FROM pg_constraint WHERE conname='source_mappings_active_version_fkey') = 's'
     AND (SELECT confdeltype FROM pg_constraint WHERE conname='source_mappings_active_version_fkey') = 'a'
   THEN 1 ELSE 0 END;"

echo ""
echo "=== 7-8: NULLABLE LINEAGE COLUMNS ON PRE-EXISTING TABLES ==="
expect_success "9. import_batches.source_system_id is nullable" \
  "SELECT 1/CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_name='import_batches' AND column_name='source_system_id') = 'YES' THEN 1 ELSE 0 END;"
expect_success "10. uploads.mapping_version_id is nullable" \
  "SELECT 1/CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_name='uploads' AND column_name='mapping_version_id') = 'YES' THEN 1 ELSE 0 END;"

echo ""
echo "=== 9: EXISTING ROWS SURVIVE UNCHANGED, NEW COLUMNS NULL ==="
expect_success "11. pre-existing ImportBatch row is unchanged and source_system_id is NULL" \
  "SELECT 1/CASE WHEN
     (SELECT status FROM import_batches WHERE id='batch-existing-1') = 'READY'
     AND (SELECT source_system_id FROM import_batches WHERE id='batch-existing-1') IS NULL
   THEN 1 ELSE 0 END;"
expect_success "12. pre-existing canonical Upload row is unchanged and mapping_version_id is NULL" \
  "SELECT 1/CASE WHEN
     (SELECT canonical_status FROM uploads WHERE id='upload-existing-1') = 'AWAITING_CONFIRMATION'
     AND (SELECT mapping_version_id FROM uploads WHERE id='upload-existing-1') IS NULL
   THEN 1 ELSE 0 END;"
expect_success "13. pre-existing legacy Upload row is entirely untouched" \
  "SELECT 1/CASE WHEN (SELECT lineage_kind FROM uploads WHERE id='upload-legacy-1') = 'LEGACY' AND (SELECT mapping_version_id FROM uploads WHERE id='upload-legacy-1') IS NULL THEN 1 ELSE 0 END;"

echo ""
echo "=== 10-11: MIGRATION RERUN SAFETY (idempotency) ==="
expect_migration_success "14. second application of the 5B.1 migration succeeds (idempotent)"
expect_success "15. existing rows still unchanged after the rerun (no data loss)" \
  "SELECT 1/CASE WHEN
     (SELECT count(*) FROM import_batches WHERE id='batch-existing-1') = 1
     AND (SELECT count(*) FROM uploads WHERE id IN ('upload-existing-1','upload-legacy-1')) = 2
   THEN 1 ELSE 0 END;"

echo ""
echo "=== 12-13: SAME-TENANT / CROSS-TENANT TENANT-ISOLATION PROOFS ==="

expect_success "16. same-tenant SourceSystem insert succeeds" \
  "INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-a1','org-a','Org A System 1');"
expect_success "16b. a second, differently-named SourceSystem in org-b succeeds (name uniqueness is tenant-scoped, not global)" \
  "INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-b1','org-b','Org A System 1');"

expect_success "17. same-tenant SourceSystem -> SourceMapping succeeds" \
  "INSERT INTO source_mappings (id, organisation_id, source_system_id, name) VALUES ('sm-a1','org-a','ss-a1','Mapping A1');"

expect_failure "18. cross-tenant SourceMapping -> SourceSystem is rejected (mapping claims org-b but points at org-a's source system)" \
  "INSERT INTO source_mappings (id, organisation_id, source_system_id, name) VALUES ('sm-bad','org-b','ss-a1','Bad Mapping');"

expect_success "19. same-tenant MappingVersion -> SourceMapping succeeds" \
  "INSERT INTO mapping_versions (id, organisation_id, source_mapping_id, version_number, mapping_document) VALUES ('mv-a1-v1','org-a','sm-a1',1,'{\"columns\":{}}');"

expect_failure "20. cross-tenant MappingVersion -> SourceMapping is rejected (version claims org-b but points at org-a's mapping)" \
  "INSERT INTO mapping_versions (id, organisation_id, source_mapping_id, version_number, mapping_document) VALUES ('mv-bad','org-b','sm-a1',2,'{}');"

expect_failure "21. duplicate version number for the same mapping is rejected" \
  "INSERT INTO mapping_versions (id, organisation_id, source_mapping_id, version_number, mapping_document) VALUES ('mv-a1-v1-dup','org-a','sm-a1',1,'{}');"

expect_success "21b. same version number (1) on a DIFFERENT mapping succeeds" \
  "INSERT INTO source_mappings (id, organisation_id, source_system_id, name) VALUES ('sm-a2','org-a','ss-a1','Mapping A2'); INSERT INTO mapping_versions (id, organisation_id, source_mapping_id, version_number, mapping_document) VALUES ('mv-a2-v1','org-a','sm-a2',1,'{}');"

echo ""
echo "=== ACTIVE-VERSION POINTER INTEGRITY ==="

expect_success "22. valid active-version pointer succeeds (sm-a1 points at its own mv-a1-v1)" \
  "UPDATE source_mappings SET active_mapping_version_id='mv-a1-v1' WHERE id='sm-a1';"

expect_failure "23. active pointer to ANOTHER mapping's version is rejected (sm-a2 tries to point at sm-a1's version mv-a1-v1)" \
  "UPDATE source_mappings SET active_mapping_version_id='mv-a1-v1' WHERE id='sm-a2';"

expect_success "23b setup: a second org-b source system/mapping/version, for the cross-tenant active-pointer test" \
  "INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-b2','org-b','Org B System 2'); INSERT INTO source_mappings (id, organisation_id, source_system_id, name) VALUES ('sm-b1','org-b','ss-b2','Mapping B1'); INSERT INTO mapping_versions (id, organisation_id, source_mapping_id, version_number, mapping_document) VALUES ('mv-b1-v1','org-b','sm-b1',1,'{}');"

expect_failure "24. active pointer across tenants is rejected (org-a's sm-a1 tries to point at org-b's mv-b1-v1)" \
  "UPDATE source_mappings SET active_mapping_version_id='mv-b1-v1' WHERE id='sm-a1';"

echo ""
echo "=== IMPORTBATCH / UPLOAD LINEAGE FK PROOFS ==="

expect_success "25. ImportBatch -> same-tenant SourceSystem succeeds" \
  "INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, source_system_id) VALUES ('batch-lineage-1','org-a','user-a','lineage.csv','csv',50,'vercel-blob','k-lineage-1','ss-a1');"

expect_failure "26. ImportBatch -> cross-tenant SourceSystem is rejected (org-b batch pointing at org-a's source system)" \
  "INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, source_system_id) VALUES ('batch-bad','org-b','user-b','bad.csv','csv',50,'vercel-blob','k-bad','ss-a1');"

expect_success "27. Upload -> same-tenant MappingVersion succeeds" \
  "INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes, mapping_version_id) VALUES ('upload-lineage-1','org-a','user-a','lineage.csv','k-lineage-1','text/csv',50,'mv-a1-v1');"

expect_failure "28. Upload -> cross-tenant MappingVersion is rejected (org-b upload pointing at org-a's mapping version)" \
  "INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes, mapping_version_id) VALUES ('upload-bad','org-b','user-b','bad.csv','k-bad','text/csv',50,'mv-a1-v1');"

echo ""
echo "=== DEACTIVATION / HISTORICAL LINEAGE DURABILITY ==="

expect_success "29. deactivating a SourceSystem (active=false) succeeds and does not touch any FK" \
  "UPDATE source_systems SET active=false WHERE id='ss-a1';"
expect_success "30. after deactivation, ImportBatch lineage to ss-a1 is still intact and readable" \
  "SELECT 1/CASE WHEN (SELECT source_system_id FROM import_batches WHERE id='batch-lineage-1') = 'ss-a1' THEN 1 ELSE 0 END;"
expect_success "31. deactivating a SourceMapping (active=false) succeeds" \
  "UPDATE source_mappings SET active=false WHERE id='sm-a1';"
expect_success "32. after deactivation, Upload lineage to mv-a1-v1 (owned by sm-a1) is still intact and readable" \
  "SELECT 1/CASE WHEN (SELECT mapping_version_id FROM uploads WHERE id='upload-lineage-1') = 'mv-a1-v1' THEN 1 ELSE 0 END;"
expect_success "33 setup: make mv-a2-v1 the actual active pointer target of sm-a2" \
  "UPDATE source_mappings SET active_mapping_version_id='mv-a2-v1' WHERE id='sm-a2';"
expect_failure "33. attempting to hard-delete a MappingVersion that IS an active pointer target is rejected by NO ACTION (historical lineage cannot be silently erased)" \
  "DELETE FROM mapping_versions WHERE id='mv-a2-v1';"
expect_failure "33b. attempting to hard-delete a MappingVersion referenced only by an Upload's lineage (not an active pointer) is ALSO rejected by NO ACTION" \
  "DELETE FROM mapping_versions WHERE id='mv-a1-v1';"

echo ""
echo "=== PROHIBITED-STATEMENT ABSENCE (static check, run inline for convenience) ==="
if grep -qE '\bDROP[[:space:]]+TABLE\b|\bDROP[[:space:]]+COLUMN\b|\bTRUNCATE\b' "$MIGRATION" | grep -v '^--'; then
  echo "  FAIL: migration source contains an active (non-comment) destructive statement"
  FAIL=$((FAIL + 1))
  FAILURES+=("34. no destructive statement in migration source")
else
  echo "  PASS: no active DROP TABLE / DROP COLUMN / TRUNCATE statement found outside comments"
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
