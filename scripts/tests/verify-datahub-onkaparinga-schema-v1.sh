#!/usr/bin/env bash
# Data Hub 6.2D3B — repeatable behavioral validation for
# scripts/seed-datahub-onkaparinga-schema-v1.sql (governed configuration
# seed; NOT a schema migration).
#
# Same disposable-container methodology as
# scripts/tests/verify-datahub-source-schema-profiles.sh (6.2D3A): a fresh
# postgres:16-alpine container, created and destroyed by this script
# only, never touching Production/Neon/Preview or any already-running
# database.
#
# WHAT THIS DOES: bootstraps the same representative pre-5B schema as the
# D3A harness, applies the REAL prerequisite scripts INCLUDING the D3A
# foundation (create-datahub-source-schema-profiles.sql), seeds a
# representative SourceSystem / SourceMapping / MappingVersion /
# ImportBatch world using DISPOSABLE test ids only, then applies the D3B
# seed and proves: clean apply, zero-write idempotent rerun, exact
# governed row counts/values, DRAFT/inactive state, sensitivity policy,
# literal duplicate/typo headers, untouched ImportBatch/SourceSystem/
# SourceMapping/MappingVersion rows, fail-loud partial/manual drift,
# fail-loud SourceSystem resolution, and atomic rollback.
#
# WHAT THIS DOES NOT DO: it is not wired into CI (matches every sibling
# Data Hub disposable-Postgres harness). It never connects to
# Neon/Production/Preview.
#
# USAGE:
#   bash scripts/tests/verify-datahub-onkaparinga-schema-v1.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREREQS=(
  "$REPO_ROOT/scripts/create-import-batches.sql"
  "$REPO_ROOT/scripts/create-datahub-source-mappings.sql"
  "$REPO_ROOT/scripts/create-datahub-reporting-period.sql"
)
D3A_MIGRATION="$REPO_ROOT/scripts/create-datahub-source-schema-profiles.sql"
SEED="$REPO_ROOT/scripts/seed-datahub-onkaparinga-schema-v1.sql"
CONTAINER="datahub-6-2d3b-onkaparinga-schema-harness-$$"
PASS=0
FAIL=0
FAILURES=()

# Test-only fixture values. The source system NAME is the governed lookup
# key; every id below is a disposable harness id, never a real one.
SS_NAME="City of Onkaparinga operational export"
EXPECTED_COLUMNS=295

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
}
trap cleanup EXIT

for f in "${PREREQS[@]}" "$D3A_MIGRATION" "$SEED"; do
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

DIAG_OUT="$(mktemp 2>/dev/null || echo "/tmp/harness_6_2d3b_last_out.$$.txt")"

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1
}

reset_db() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "DROP DATABASE IF EXISTS testdb;" >/dev/null 2>&1
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "CREATE DATABASE testdb;" >/dev/null 2>&1
}

# Identical to verify-datahub-source-schema-profiles.sh's own pre-5B bootstrap.
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
  for f in "${PREREQS[@]}" "$D3A_MIGRATION"; do
    if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$f" >"$DIAG_OUT" 2>&1; then
      echo "ERROR: prerequisite $(basename "$f") failed to apply — cannot proceed." >&2
      sed 's/^/    /' "$DIAG_OUT"
      exit 2
    fi
  done
}

apply_prereqs_without_d3a() {
  local f
  for f in "${PREREQS[@]}"; do
    if ! docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$f" >"$DIAG_OUT" 2>&1; then
      echo "ERROR: prerequisite $(basename "$f") failed to apply — cannot proceed." >&2
      sed 's/^/    /' "$DIAG_OUT"
      exit 2
    fi
  done
}

IB_COLS="organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key"

# Representative world: target SourceSystem (reporting_period_required=true,
# with an active 5B.1 mapping), an unrelated SourceSystem, and ImportBatches
# with and without source lineage. $1 = optional SQL replacing the target
# SourceSystem insert (for the SourceSystem-resolution failure cases).
seed_world() {
  local ss_sql="${1:-INSERT INTO source_systems (id, organisation_id, name, reporting_period_required) VALUES ('ss-target','org-a','$SS_NAME',true);}"
  psql_exec <<SQL
$ss_sql
INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-other','org-a','Other System'), ('ss-b','org-b','B System');
INSERT INTO source_mappings (id, organisation_id, source_system_id, name) VALUES ('sm-other','org-a','ss-other','Other Mapping');
INSERT INTO mapping_versions (id, organisation_id, source_mapping_id, version_number, mapping_document) VALUES ('mv-other','org-a','sm-other',1,'{"fields":{}}');
UPDATE source_mappings SET active_mapping_version_id='mv-other' WHERE id='sm-other';
INSERT INTO import_batches (id, $IB_COLS, status, sha256) VALUES ('batch-plain','org-a','user-a','plain.csv','csv',100,'vercel-blob','k-plain','READY', repeat('a',64));
INSERT INTO import_batches (id, $IB_COLS, source_system_id) VALUES ('batch-other','org-a','user-a','other.xlsx','xlsx',200,'vercel-blob','k-other','ss-other');
SQL
  if [ -z "${1:-}" ]; then
    psql_exec <<SQL
INSERT INTO source_mappings (id, organisation_id, source_system_id, name) VALUES ('sm-target','org-a','ss-target','Target Mapping');
INSERT INTO mapping_versions (id, organisation_id, source_mapping_id, version_number, mapping_document) VALUES ('mv-target','org-a','sm-target',1,'{"fields":{}}');
UPDATE source_mappings SET active_mapping_version_id='mv-target' WHERE id='sm-target';
INSERT INTO import_batches (id, $IB_COLS, source_system_id) VALUES ('batch-target','org-a','user-a','june.xlsx','xlsx',300,'vercel-blob','k-target','ss-target');
SQL
  fi
}

fresh_world() {
  reset_db
  bootstrap_pre5b
  apply_prereqs
  seed_world "${1:-}"
}

apply_seed() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$SEED" >"$DIAG_OUT" 2>&1
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

expect_seed_success() {
  local desc="$1"
  if apply_seed; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL (seed unexpectedly failed): $desc"
    sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

expect_seed_failure() {
  local desc="$1" pattern="$2"
  if apply_seed; then
    echo "  FAIL (seed unexpectedly succeeded): $desc"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  elif ! grep -qE "$pattern" "$DIAG_OUT"; then
    echo "  FAIL (seed failed, but not with the expected message /$pattern/): $desc"
    sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  else
    echo "  PASS (fail-loud): $desc"
    PASS=$((PASS + 1))
  fi
}

CFG_TABLES="dataset_types source_schema_versions source_schema_worksheets source_schema_columns worksheet_mapping_profiles worksheet_mapping_profile_versions"

# Every row of every config table, INCLUDING xmin — any INSERT/UPDATE/
# DELETE (even a no-op UPDATE) changes this fingerprint.
cfg_fingerprint_sql() {
  local t out=""
  for t in $CFG_TABLES; do
    [ -n "$out" ] && out="$out || '#' || "
    out="$out(SELECT coalesce(md5(string_agg(t.xmin::text || ':' || to_jsonb(t)::text, '|' ORDER BY t.id)), 'empty') FROM public.$t t)"
  done
  echo "$out"
}

# All six config tables completely empty (fresh-DB failure cases).
ZERO_CFG="SELECT 1/CASE WHEN (SELECT count(*) FROM dataset_types) + (SELECT count(*) FROM source_schema_versions)
    + (SELECT count(*) FROM source_schema_worksheets) + (SELECT count(*) FROM source_schema_columns)
    + (SELECT count(*) FROM worksheet_mapping_profiles) + (SELECT count(*) FROM worksheet_mapping_profile_versions) = 0
  THEN 1 ELSE 0 END;"

# No D3B-prefixed row in any config table.
ZERO_D3B="SELECT 1/CASE WHEN (SELECT count(*) FROM dataset_types WHERE id LIKE 'dhcfg-onk-mwco-%') + (SELECT count(*) FROM source_schema_versions WHERE id LIKE 'dhcfg-onk-mwco-%')
    + (SELECT count(*) FROM source_schema_worksheets WHERE id LIKE 'dhcfg-onk-mwco-%') + (SELECT count(*) FROM source_schema_columns WHERE id LIKE 'dhcfg-onk-mwco-%')
    + (SELECT count(*) FROM worksheet_mapping_profiles WHERE id LIKE 'dhcfg-onk-mwco-%') + (SELECT count(*) FROM worksheet_mapping_profile_versions WHERE id LIKE 'dhcfg-onk-mwco-%') = 0
  THEN 1 ELSE 0 END;"

echo ""
echo "=== SETUP: pre-5B bootstrap + real prerequisites + D3A foundation + representative world ==="
fresh_world
echo "  base schema + D3A foundation ready; target SourceSystem, unrelated source, mappings and batches seeded"
expect_success "snapshot: ImportBatch / SourceSystem / SourceMapping / MappingVersion / Upload rows before the seed" \
  "CREATE TABLE _snap_rows AS SELECT
     (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM import_batches t) AS ib,
     (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM source_systems t) AS ss,
     (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM source_mappings t) AS sm,
     (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM mapping_versions t) AS mv,
     (SELECT coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)), 'empty') FROM uploads t) AS up;"

echo ""
echo "=== APPLY + ZERO-WRITE IDEMPOTENT RERUN ==="
expect_seed_success "1. seed applies cleanly on the D3A foundation (FRESH path)"
expect_success "1b. snapshot config-table fingerprint (all rows incl. xmin) after first application" \
  "CREATE TABLE _snap_cfg AS SELECT $(cfg_fingerprint_sql) AS fp;"
expect_seed_success "2. rerun succeeds (COMPLETE path, validation only)"
expect_seed_success "2b. third run succeeds"
if grep -q "existing D3B state detected" "$DIAG_OUT" && ! grep -q "FRESH" "$DIAG_OUT"; then
  echo "  PASS: 2c. rerun took the validation-only path (no FRESH insert)"; PASS=$((PASS + 1))
else
  echo "  FAIL: 2c. rerun did not report the validation-only path"; sed 's/^/    /' "$DIAG_OUT"; FAIL=$((FAIL + 1)); FAILURES+=("2c. rerun path notice")
fi
expect_success "2d. reruns performed ZERO writes (every config row, incl. xmin, byte-identical)" \
  "SELECT 1/CASE WHEN (SELECT fp FROM _snap_cfg) = $(cfg_fingerprint_sql) THEN 1 ELSE 0 END;"
expect_success "2e. negative control: the fingerprint DOES change on a no-op UPDATE (rolled back)" \
  "BEGIN;
   UPDATE source_schema_columns SET source_header = source_header WHERE id = 'dhcfg-onk-mwco-sv1-ws-runs-c000';
   SELECT 1/CASE WHEN (SELECT fp FROM _snap_cfg) <> $(cfg_fingerprint_sql) THEN 1 ELSE 0 END;
   ROLLBACK;"

echo ""
echo "=== EXACT ROW COUNTS (zero duplicates) ==="
expect_success "3. exactly 1 DatasetType, 1 SchemaVersion, 14 worksheets, $EXPECTED_COLUMNS columns, 14 profiles, 14 profile versions" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM dataset_types) = 1
     AND (SELECT count(*) FROM source_schema_versions) = 1
     AND (SELECT count(*) FROM source_schema_worksheets) = 14
     AND (SELECT count(*) FROM source_schema_columns) = $EXPECTED_COLUMNS
     AND (SELECT count(*) FROM worksheet_mapping_profiles) = 14
     AND (SELECT count(*) FROM worksheet_mapping_profile_versions) = 14
   THEN 1 ELSE 0 END;"
expect_success "3b. per-worksheet column counts are exact (Trends has none)" \
  "SELECT 1/CASE WHEN (SELECT array_agg(n ORDER BY ord) FROM (
       SELECT w.ordinal_hint AS ord, count(c.id) AS n FROM source_schema_worksheets w
       LEFT JOIN source_schema_columns c ON c.source_schema_worksheet_id = w.id GROUP BY w.ordinal_hint) x)
     = ARRAY[8,0,21,33,49,45,37,33,10,6,13,10,25,5]::bigint[]
   THEN 1 ELSE 0 END;"

echo ""
echo "=== GOVERNED VALUES ==="
expect_success "4. DatasetType: exact name, active, bound to the target SourceSystem and ITS organisation" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM dataset_types WHERE name='Monthly waste and collection operations' AND active
       AND source_system_id='ss-target' AND organisation_id='org-a' AND created_by IS NULL) = 1 THEN 1 ELSE 0 END;"
expect_success "5. SchemaVersion: version 1, exact label, status DRAFT, activated_at NULL" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM source_schema_versions WHERE version_number=1 AND label='Version derived from the June 2026 workbook'
       AND status='DRAFT' AND activated_at IS NULL) = 1 THEN 1 ELSE 0 END;"
expect_success "6. the 14 worksheets are exactly the approved names in order, every one OPTIONAL" \
  "SELECT 1/CASE WHEN (SELECT array_agg(expected_name ORDER BY ordinal_hint) FROM source_schema_worksheets) = ARRAY['Overview','Trends','Runs','Driver Run','Loads','Jobs','Tickets','Ticket Tasks','Vouchers','Prestart Checks','Contamination Inspections','Service Exception Totals','Service Exceptions','Definitions']
     AND (SELECT count(*) FROM source_schema_worksheets WHERE presence <> 'OPTIONAL') = 0
   THEN 1 ELSE 0 END;"
expect_success "7. exact roles and dispositions per worksheet" \
  "SELECT 1/CASE WHEN (SELECT array_agg(w.expected_name || '=' || w.role || '/' || v.disposition ORDER BY w.ordinal_hint)
       FROM source_schema_worksheets w JOIN worksheet_mapping_profiles p ON p.source_schema_worksheet_id = w.id
       JOIN worksheet_mapping_profile_versions v ON v.worksheet_mapping_profile_id = p.id)
     = ARRAY['Overview=SUMMARY/RECONCILIATION_SUMMARY','Trends=SUMMARY/RECONCILIATION_SUMMARY','Runs=DATA/STAGING_DATASET','Driver Run=DATA/STAGING_DATASET','Loads=DATA/STAGING_DATASET','Jobs=DATA/STAGING_DATASET','Tickets=DATA/STAGING_DATASET','Ticket Tasks=DATA/STAGING_DATASET','Vouchers=DATA/STAGING_DATASET','Prestart Checks=DATA/STAGING_DATASET','Contamination Inspections=DATA/STAGING_DATASET','Service Exception Totals=SUMMARY/RECONCILIATION_SUMMARY','Service Exceptions=DATA/STAGING_DATASET','Definitions=METADATA/METADATA']
   THEN 1 ELSE 0 END;"
expect_success "8. every profile is 'June-v1 treatment', active=false, active_profile_version_id NULL; one version 1 each" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM worksheet_mapping_profiles WHERE name='June-v1 treatment' AND active = false AND active_profile_version_id IS NULL) = 14
     AND (SELECT count(*) FROM worksheet_mapping_profile_versions WHERE version_number = 1) = 14
     AND (SELECT count(DISTINCT worksheet_mapping_profile_id) FROM worksheet_mapping_profile_versions) = 14
   THEN 1 ELSE 0 END;"
expect_success "9. every column is OPTIONAL, UNKNOWN-typed, with a NULL logical_field_key" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM source_schema_columns WHERE presence <> 'OPTIONAL' OR declared_type <> 'UNKNOWN' OR logical_field_key IS NOT NULL) = 0 THEN 1 ELSE 0 END;"
expect_success "10. no column sensitivity outside CONFIDENTIAL / PERSONALLY_IDENTIFIABLE (never PUBLIC/INTERNAL/HIGHLY_SENSITIVE)" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM source_schema_columns WHERE sensitivity_class NOT IN ('CONFIDENTIAL','PERSONALLY_IDENTIFIABLE')) = 0
     AND (SELECT count(DISTINCT sensitivity_class) FROM source_schema_columns) = 2
   THEN 1 ELSE 0 END;"
expect_success "11. representative person/contact/address/property/location/notes headers are PERSONALLY_IDENTIFIABLE" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM source_schema_columns WHERE source_header IN
       ('Driver Name','Employee Id','Drivers','Driver','Customer Name','Phone Number','Contact Number','Full Address','Address','Site Full Address','Geocoded Address',
        'Street Name','Street No','Suburb','Postcode','Property Id','Account Number','Lot Number','Unit Number','Unit No','Created By','Reported By','Booked By',
        'User','Username','Notes','Auth Note','Driver Notes','Resolution Note','Lat','Lng','Job Lat','Col Start Location','Google Maps Link')
       AND sensitivity_class <> 'PERSONALLY_IDENTIFIABLE') = 0
     AND (SELECT count(DISTINCT source_header) FROM source_schema_columns WHERE source_header IN
       ('Driver Name','Employee Id','Drivers','Driver','Customer Name','Phone Number','Contact Number','Full Address','Address','Site Full Address','Geocoded Address',
        'Street Name','Street No','Suburb','Postcode','Property Id','Account Number','Lot Number','Unit Number','Unit No','Created By','Reported By','Booked By',
        'User','Username','Notes','Auth Note','Driver Notes','Resolution Note','Lat','Lng','Job Lat','Col Start Location','Google Maps Link')) = 34
   THEN 1 ELSE 0 END;"
expect_success "11b. representative operational-measure headers are CONFIDENTIAL (policy does not over-trigger on substrings)" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM source_schema_columns WHERE source_header IN
       ('Total Weight','Service Type','Id','Contam Rate','Collections Performed','Allocated Sequence','Vehicle','Status','Run','Loads','Garbage','Defintion')
       AND sensitivity_class <> 'CONFIDENTIAL') = 0 THEN 1 ELSE 0 END;"
expect_success "12. duplicate headers preserved at separate ordinals (Ticket Tasks 'Notes' 27/32; Service Exception Totals 'Garbage' 1/5)" \
  "SELECT 1/CASE WHEN (SELECT array_agg(c.ordinal ORDER BY c.ordinal) FROM source_schema_columns c JOIN source_schema_worksheets w ON w.id = c.source_schema_worksheet_id
       WHERE w.expected_name='Ticket Tasks' AND c.source_header='Notes') = ARRAY[27,32]
     AND (SELECT array_agg(c.ordinal ORDER BY c.ordinal) FROM source_schema_columns c JOIN source_schema_worksheets w ON w.id = c.source_schema_worksheet_id
       WHERE w.expected_name='Service Exception Totals' AND c.source_header='Garbage') = ARRAY[1,5]
   THEN 1 ELSE 0 END;"
expect_success "12b. literal typo 'Defintion' preserved (no header normalization); ordinals contiguous from 0 in every sheet" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM source_schema_columns WHERE source_header='Defintion') = 1
     AND (SELECT count(*) FROM source_schema_columns WHERE source_header='Definition') = 0
     AND (SELECT count(*) FROM (SELECT source_schema_worksheet_id FROM source_schema_columns GROUP BY 1 HAVING max(ordinal) <> count(*) - 1 OR min(ordinal) <> 0) x) = 0
   THEN 1 ELSE 0 END;"
expect_success "13. Trends has zero column rows and headerRowOneBased null; every other profile document is the exact small DRAFT contract" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM source_schema_columns c JOIN source_schema_worksheets w ON w.id = c.source_schema_worksheet_id WHERE w.expected_name='Trends') = 0
     AND (SELECT v.profile_document FROM worksheet_mapping_profile_versions v JOIN worksheet_mapping_profiles p ON p.id = v.worksheet_mapping_profile_id
          JOIN source_schema_worksheets w ON w.id = p.source_schema_worksheet_id WHERE w.expected_name='Trends') = '{\"documentVersion\":1,\"schemaStatus\":\"DRAFT\",\"headerRowOneBased\":null}'::jsonb
     AND (SELECT count(*) FROM worksheet_mapping_profile_versions v JOIN worksheet_mapping_profiles p ON p.id = v.worksheet_mapping_profile_id
          JOIN source_schema_worksheets w ON w.id = p.source_schema_worksheet_id
          WHERE w.expected_name <> 'Trends' AND v.profile_document = '{\"documentVersion\":1,\"schemaStatus\":\"DRAFT\",\"headerRowOneBased\":3}'::jsonb) = 13
   THEN 1 ELSE 0 END;"
expect_success "13b. every created row carries the deterministic D3B id prefix and the target tenant" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM (
       SELECT id, organisation_id FROM dataset_types UNION ALL SELECT id, organisation_id FROM source_schema_versions
       UNION ALL SELECT id, organisation_id FROM source_schema_worksheets UNION ALL SELECT id, organisation_id FROM source_schema_columns
       UNION ALL SELECT id, organisation_id FROM worksheet_mapping_profiles UNION ALL SELECT id, organisation_id FROM worksheet_mapping_profile_versions) x
     WHERE id NOT LIKE 'dhcfg-onk-mwco-%' OR organisation_id <> 'org-a') = 0
   THEN 1 ELSE 0 END;"

echo ""
echo "=== NOTHING ELSE TOUCHED ==="
expect_success "14. no ImportBatch lineage populated; every ImportBatch row byte-identical" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM import_batches WHERE dataset_type_id IS NOT NULL OR source_schema_version_id IS NOT NULL) = 0
     AND (SELECT ib FROM _snap_rows) = (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM import_batches t)
   THEN 1 ELSE 0 END;"
expect_success "15. SourceSystem rows byte-identical (reporting_period_required unchanged: target still true, others false)" \
  "SELECT 1/CASE WHEN (SELECT ss FROM _snap_rows) = (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM source_systems t)
     AND (SELECT reporting_period_required FROM source_systems WHERE id='ss-target') = true
     AND (SELECT reporting_period_required FROM source_systems WHERE id='ss-other') = false
   THEN 1 ELSE 0 END;"
expect_success "16. SourceMapping / MappingVersion / Upload rows byte-identical" \
  "SELECT 1/CASE WHEN (SELECT sm FROM _snap_rows) = (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM source_mappings t)
     AND (SELECT mv FROM _snap_rows) = (SELECT md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) FROM mapping_versions t)
     AND (SELECT up FROM _snap_rows) = (SELECT coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)), 'empty') FROM uploads t)
   THEN 1 ELSE 0 END;"
if docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$D3A_MIGRATION" >"$DIAG_OUT" 2>&1; then
  echo "  PASS: 17. D3A foundation migration still reruns cleanly with the D3B rows present"; PASS=$((PASS + 1))
else
  echo "  FAIL: 17. D3A foundation migration failed to rerun with D3B rows present"; sed 's/^/    /' "$DIAG_OUT"; FAIL=$((FAIL + 1)); FAILURES+=("17. D3A rerun")
fi
expect_success "17b. the governed rows are consumable by the D3A lineage FKs (proof only, inside a rolled-back transaction)" \
  "BEGIN;
   UPDATE import_batches SET dataset_type_id='dhcfg-onk-mwco-dt', source_schema_version_id='dhcfg-onk-mwco-sv1' WHERE id='batch-target';
   ROLLBACK;
   SELECT 1/CASE WHEN (SELECT count(*) FROM import_batches WHERE dataset_type_id IS NOT NULL) = 0 THEN 1 ELSE 0 END;"

echo ""
echo "=== PARTIAL / MANUAL DRIFT AFTER A SUCCESSFUL SEED — rerun must fail loud and write nothing ==="
# Each case: fresh world, successful seed, ONE manual tamper, fingerprint,
# rerun (must RAISE), fingerprint unchanged (the failed rerun wrote nothing
# and repaired nothing).
drift_case() {
  local desc="$1" tamper="$2" pattern="$3"
  fresh_world
  if ! apply_seed; then
    echo "  FAIL: $desc — setup seed failed"; sed 's/^/    /' "$DIAG_OUT"; FAIL=$((FAIL + 1)); FAILURES+=("$desc (setup)"); return
  fi
  if ! echo "$tamper; CREATE TABLE _snap_drift AS SELECT $(cfg_fingerprint_sql) AS fp;" | psql_exec; then
    echo "  FAIL: $desc — tamper failed"; sed 's/^/    /' "$DIAG_OUT"; FAIL=$((FAIL + 1)); FAILURES+=("$desc (tamper)"); return
  fi
  expect_seed_failure "$desc" "$pattern"
  expect_success "$desc — failed rerun wrote nothing (fingerprint unchanged)" \
    "SELECT 1/CASE WHEN (SELECT fp FROM _snap_drift) = $(cfg_fingerprint_sql) THEN 1 ELSE 0 END;"
}

drift_case "D1. a column's sensitivity_class downgraded" \
  "UPDATE source_schema_columns SET sensitivity_class='CONFIDENTIAL' WHERE id='dhcfg-onk-mwco-sv1-ws-vouchers-c001'" \
  "D3B seed: source_schema_columns differ"
drift_case "D2. one governed column deleted (partial state)" \
  "DELETE FROM source_schema_columns WHERE id='dhcfg-onk-mwco-sv1-ws-jobs-c044'" \
  "D3B seed: source_schema_columns differ"
drift_case "D3. extra manual column added under Trends" \
  "INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class)
   VALUES ('manual-col','org-a','dhcfg-onk-mwco-sv1-ws-trends',0,'Invented','OPTIONAL','UNKNOWN','CONFIDENTIAL')" \
  "D3B seed: source_schema_columns differ"
drift_case "D4. a column header edited (e.g. typo 'fixed')" \
  "UPDATE source_schema_columns SET source_header='Definition' WHERE source_header='Defintion'" \
  "D3B seed: source_schema_columns differ"
drift_case "D5. extra manual worksheet added under schema version 1" \
  "INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role)
   VALUES ('manual-ws','org-a','dhcfg-onk-mwco-sv1','extra','Extra','OPTIONAL','DATA')" \
  "D3B seed: source_schema_worksheets differ"
drift_case "D6. a worksheet made REQUIRED" \
  "UPDATE source_schema_worksheets SET presence='REQUIRED' WHERE id='dhcfg-onk-mwco-sv1-ws-overview'" \
  "D3B seed: source_schema_worksheets differ"
drift_case "D7. extra manual profile on a D3B worksheet" \
  "INSERT INTO worksheet_mapping_profiles (id, organisation_id, source_schema_worksheet_id, name, active)
   VALUES ('manual-wp','org-a','dhcfg-onk-mwco-sv1-ws-runs','Other treatment',false)" \
  "D3B seed: worksheet_mapping_profiles differ"
drift_case "D8. a profile activated" \
  "UPDATE worksheet_mapping_profiles SET active=true WHERE id='dhcfg-onk-mwco-sv1-ws-runs-wp'" \
  "D3B seed: worksheet_mapping_profiles differ"
drift_case "D9. a profile's active pointer set to its version" \
  "UPDATE worksheet_mapping_profiles SET active_profile_version_id='dhcfg-onk-mwco-sv1-ws-runs-wp-v1' WHERE id='dhcfg-onk-mwco-sv1-ws-runs-wp'" \
  "D3B seed: worksheet_mapping_profiles differ"
drift_case "D10. extra profile version 2 added" \
  "INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document)
   VALUES ('manual-wpv','org-a','dhcfg-onk-mwco-sv1-ws-runs-wp',2,'IGNORE','{}')" \
  "D3B seed: worksheet_mapping_profile_versions differ"
drift_case "D11. a profile document edited" \
  "UPDATE worksheet_mapping_profile_versions SET profile_document='{\"documentVersion\":1,\"schemaStatus\":\"DRAFT\",\"headerRowOneBased\":3,\"canonicalImport\":true}' WHERE id='dhcfg-onk-mwco-sv1-ws-jobs-wp-v1'" \
  "D3B seed: worksheet_mapping_profile_versions differ"
drift_case "D12. schema version activated" \
  "UPDATE source_schema_versions SET status='ACTIVE', activated_at=now() WHERE id='dhcfg-onk-mwco-sv1'" \
  "D3B seed: source_schema_versions row dhcfg-onk-mwco-sv1 does not match"
drift_case "D13. dataset type description edited" \
  "UPDATE dataset_types SET description='edited' WHERE id='dhcfg-onk-mwco-dt'" \
  "D3B seed: dataset_types row dhcfg-onk-mwco-dt does not match"

echo ""
echo "=== PARTIAL / AMBIGUOUS PRE-EXISTING STATE ON A FRESH DATABASE — fail loud, adopt nothing ==="
fresh_world
expect_success "P1 setup: a manual DatasetType already holds the natural key under a DIFFERENT id" \
  "INSERT INTO dataset_types (id, organisation_id, source_system_id, name) VALUES ('dt-manual','org-a','ss-target','Monthly waste and collection operations');"
expect_seed_failure "P1. natural-key row with a different id is never silently adopted" \
  "D3B seed: dataset_types row dhcfg-onk-mwco-dt does not match"
expect_success "P1b. nothing D3B was written" "$ZERO_D3B"

fresh_world
expect_success "P2 setup: only the D3B DatasetType exists (manual partial state)" \
  "INSERT INTO dataset_types (id, organisation_id, source_system_id, name, description) VALUES ('dhcfg-onk-mwco-dt','org-a','ss-target','Monthly waste and collection operations','Governed monthly workbook dataset for the City of Onkaparinga operational export.');"
expect_seed_failure "P2. dataset type without its schema version is partial state — not filled in" \
  "D3B seed: expected exactly one D3B source_schema_versions row"
expect_success "P2b. still exactly the one manual row; no schema/worksheet/column/profile rows written" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM dataset_types) = 1 AND (SELECT count(*) FROM source_schema_versions) = 0
     AND (SELECT count(*) FROM source_schema_worksheets) = 0 AND (SELECT count(*) FROM worksheet_mapping_profiles) = 0 THEN 1 ELSE 0 END;"

fresh_world
expect_success "P3 setup: a stray row already uses a D3B fixed worksheet id under an unrelated schema version" \
  "INSERT INTO dataset_types (id, organisation_id, source_system_id, name) VALUES ('dt-x','org-a','ss-other','X');
   INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('sv-x','org-a','dt-x',1,'x');
   INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role)
     VALUES ('dhcfg-onk-mwco-sv1-ws-overview','org-a','sv-x','overview','Overview','OPTIONAL','SUMMARY');"
expect_seed_failure "P3. fixed-id collision is detected (never overwritten or adopted)" \
  "D3B seed: expected exactly one D3B dataset_types row"
expect_success "P3b. no D3B DatasetType/SchemaVersion written" \
  "SELECT 1/CASE WHEN (SELECT count(*) FROM dataset_types WHERE id LIKE 'dhcfg-%') = 0 AND (SELECT count(*) FROM source_schema_versions WHERE id LIKE 'dhcfg-%') = 0 THEN 1 ELSE 0 END;"

echo ""
echo "=== SOURCE SYSTEM RESOLUTION — exact name, exactly one ACTIVE row ==="
fresh_world "SELECT 1;"
expect_seed_failure "S1. missing SourceSystem" "expected exactly one active source_systems row named \"$SS_NAME\", found 0"
expect_success "S1b. zero config rows" "$ZERO_CFG"

fresh_world "INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-case','org-a','city of onkaparinga operational export');"
expect_seed_failure "S2. case-different name is not a match (exact name only)" "found 0"
expect_success "S2b. zero config rows" "$ZERO_CFG"

fresh_world "INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-space','org-a','$SS_NAME ');"
expect_seed_failure "S3. trailing-space name is not a match" "found 0"
expect_success "S3b. zero config rows" "$ZERO_CFG"

fresh_world "INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-dup-a','org-a','$SS_NAME'), ('ss-dup-b','org-b','$SS_NAME');"
expect_seed_failure "S4. duplicate active SourceSystems (two tenants) — ambiguous, refused" "found 2"
expect_success "S4b. zero config rows" "$ZERO_CFG"

fresh_world "INSERT INTO source_systems (id, organisation_id, name, active) VALUES ('ss-inactive','org-a','$SS_NAME',false);"
expect_seed_failure "S5. only an INACTIVE matching SourceSystem" "found 0"
expect_success "S5b. zero config rows" "$ZERO_CFG"

echo ""
echo "=== ATOMICITY — a failure after inserts began rolls EVERYTHING back ==="
fresh_world
expect_success "R1 setup: test-only CHECK that rejects the LAST insert (the Definitions METADATA profile version)" \
  "ALTER TABLE worksheet_mapping_profile_versions ADD CONSTRAINT _harness_block_metadata CHECK (disposition <> 'METADATA');"
expect_seed_failure "R1. seed fails on its final INSERT" "_harness_block_metadata"
expect_success "R1b. transaction rollback left ZERO rows in all six config tables" "$ZERO_CFG"
expect_success "R1c. remove the test-only CHECK" \
  "ALTER TABLE worksheet_mapping_profile_versions DROP CONSTRAINT _harness_block_metadata;"
expect_seed_success "R1d. seed then applies cleanly (no residue from the failed attempt)"

reset_db; bootstrap_pre5b; apply_prereqs_without_d3a
expect_seed_failure "R2. seed refuses to run without the D3A foundation (it is not a migration)" \
  "6.2D3A source-schema foundation tables are missing"

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo "Failed checks:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
