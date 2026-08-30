#!/usr/bin/env bash
# Data Hub 5A.2C — repeatable behavioral validation for
# scripts/create-import-batches.sql.
#
# WHY THIS EXISTS: two rounds of independent review (5A.2C-R1, R2) each
# found a real PostgreSQL migration-safety regression that the static
# (source-text) containment test suite did not and structurally cannot
# detect — a same-named-but-differently-defined object silently
# accepted, and a required constraint silently absent because a
# boolean validation result was discarded. This script exercises the
# migration against a REAL PostgreSQL 16 instance so those defect
# classes are caught mechanically instead of by re-deriving scratch SQL
# by hand every review round.
#
# WHAT THIS DOES NOT DO: it is not wired into CI in this phase (adding
# Docker to the standard CI workflow was explicitly out of scope for
# this slice). It requires only Docker (no new npm dependency, no
# Neon/Production access, no local psql client — all SQL runs inside
# the disposable container via `docker exec`). It creates and destroys
# its own disposable container; it never touches Production or any
# already-running database.
#
# USAGE:
#   bash scripts/tests/verify-import-batches-migration.sh
#
# Exits 0 if every check passes, non-zero and prints a summary of what
# failed otherwise. Always removes the disposable container it created,
# even on failure (trap on EXIT).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION="$REPO_ROOT/scripts/create-import-batches.sql"
CONTAINER="datahub-5a2c-migration-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -f "$MIGRATION" ]; then
  echo "ERROR: migration file not found at $MIGRATION" >&2
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

DIAG_OUT="/tmp/harness_last_out.$$.txt"

psql_exec() {
  # Runs SQL via stdin inside the container. Returns psql's exit code.
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1
}

reset_db() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "DROP DATABASE IF EXISTS testdb;" >/dev/null 2>&1
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "CREATE DATABASE testdb;" >/dev/null 2>&1
}

bootstrap() {
  # Minimal pre-migration schema mirroring the real live shapes of
  # organisations/users/uploads (confirmed via read-only information_
  # schema inspection during Phase 5A.2A discovery), matching this
  # repository's actual FK conventions exactly: users.organisation_id
  # ON DELETE CASCADE, uploads.user_id ON DELETE SET NULL,
  # uploads.organisation_id ON DELETE CASCADE.
  psql_exec <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes)
  VALUES ('upload-legacy-1','org-a','user-a','legacy.csv','/tmp/legacy.csv','text/csv',123);
SQL
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

expect_migration_failure() {
  local desc="$1"
  if apply_migration; then
    echo "  FAIL (migration unexpectedly SUCCEEDED against a drift scenario it should reject): $desc"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  else
    echo "  PASS (migration correctly rejected the drift): $desc"
    PASS=$((PASS + 1))
  fi
}

echo ""
echo "=== NORMAL PATH ==="
reset_db
bootstrap
expect_migration_success "1. clean migration applies"
expect_migration_success "2. second migration application succeeds (idempotent)"

expect_success "3. AWAITING_UPLOAD with NULL sha256 is allowed" \
  "INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key) VALUES ('b1','org-a','user-a','a.xlsx','xlsx',100,'vercel-blob','k1');"

expect_failure "4. READY with NULL sha256 is rejected" \
  "INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, status) VALUES ('b2','org-a','user-a','b.xlsx','xlsx',100,'vercel-blob','k2','READY');"

expect_success "5. legacy uploads row remains insertable" \
  "INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes) VALUES ('u-legacy','org-a','user-a','legacy.csv','/tmp/x','text/csv',10);"

expect_success "5b. READY with sha256 populated succeeds" \
  "INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, status, sha256) VALUES ('b3','org-a','user-a','c.xlsx','xlsx',100,'vercel-blob','k3','READY',repeat('a',64));"

expect_success "6. canonical same-tenant Upload row is valid" \
  "INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, worksheet_name, lineage_kind, canonical_status) VALUES ('u-canon','org-a','user-a','x.xlsx','n/a','application/vnd.ms-excel',10,'b3',0,'Sheet1','DATA_HUB','AWAITING_CONFIRMATION');"

expect_failure "7. cross-tenant Upload->ImportBatch is rejected" \
  "INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, lineage_kind, canonical_status) VALUES ('u-cross','org-b','user-b','x.xlsx','n/a','application/vnd.ms-excel',10,'b3',5,'DATA_HUB','AWAITING_CONFIRMATION');"

expect_failure "8. duplicate (import_batch_id, worksheet_index) is rejected" \
  "INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, lineage_kind, canonical_status) VALUES ('u-dup','org-a','user-a','x.xlsx','n/a','application/vnd.ms-excel',10,'b3',0,'DATA_HUB','AWAITING_CONFIRMATION');"

expect_success "9a. tenant idempotency: first key insert succeeds" \
  "INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, idempotency_key) VALUES ('bi1','org-a','user-a','i.csv','csv',10,'vercel-blob','ki1','idem-1');"
expect_failure "9b. tenant idempotency: same key same tenant rejected" \
  "INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, idempotency_key) VALUES ('bi2','org-a','user-a','j.csv','csv',10,'vercel-blob','ki2','idem-1');"
expect_success "9c. tenant idempotency: same key different tenant succeeds" \
  "INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, idempotency_key) VALUES ('bi3','org-b','user-b','k.csv','csv',10,'vercel-blob','ki3','idem-1');"

expect_success "10. uploader deletion sets ImportBatch.uploaded_by to NULL" \
  "DELETE FROM users WHERE id = 'user-a'; SELECT 1/CASE WHEN (SELECT uploaded_by FROM import_batches WHERE id='b1') IS NULL THEN 1 ELSE 0 END;"

expect_failure "11. organisation deletion is blocked while ImportBatch rows exist" \
  "DELETE FROM organisations WHERE id = 'org-a';"

echo ""
echo "=== DRIFT SCENARIOS ==="

reset_db; bootstrap
expect_success "12. decoy same-name FK on an unrelated table does not suppress the real FK" \
  "CREATE TABLE decoy (id TEXT PRIMARY KEY, ref TEXT REFERENCES organisations(id)); ALTER TABLE decoy RENAME CONSTRAINT decoy_ref_fkey TO uploads_import_batch_org_fkey;"
expect_migration_success "12b. migration still creates the correct FK on uploads"
expect_success "12c. verify the real FK now exists on uploads, not just the decoy" \
  "SELECT 1 FROM pg_constraint WHERE conrelid='public.uploads'::regclass AND conname='uploads_import_batch_org_fkey';"

reset_db; bootstrap
expect_success "13 setup: wrong same-name FK on uploads (single-column, wrong ref)" \
  "ALTER TABLE uploads ADD COLUMN import_batch_id TEXT; ALTER TABLE uploads ADD CONSTRAINT uploads_import_batch_org_fkey FOREIGN KEY (import_batch_id) REFERENCES organisations(id);"
expect_migration_failure "13. same-name wrong-definition FK on uploads is rejected"

reset_db; bootstrap
# NOT VALID skips validating the constraint against upload-legacy-1 (which
# has import_batch_id NULL / organisation_id NOT NULL — a combination
# MATCH FULL would itself reject if asked to validate existing rows). We
# only need confmatchtype='f' to exist in the catalog to test the
# migration's own rejection of it; whether Postgres has separately
# validated old rows against it is irrelevant to that.
expect_success "14 setup: minimal import_batches + uploads.import_batch_id + a MATCH FULL composite FK" \
  "CREATE TABLE import_batches (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, UNIQUE(id, organisation_id)); ALTER TABLE uploads ADD COLUMN import_batch_id TEXT; ALTER TABLE uploads ADD CONSTRAINT uploads_import_batch_org_fkey FOREIGN KEY (import_batch_id, organisation_id) REFERENCES import_batches(id, organisation_id) MATCH FULL NOT VALID;"
expect_migration_failure "14. same-definition-but-MATCH-FULL FK is rejected"

reset_db; bootstrap
expect_success "15 setup: same-name NON-UNIQUE worksheet index" \
  "ALTER TABLE uploads ADD COLUMN import_batch_id TEXT; ALTER TABLE uploads ADD COLUMN worksheet_index INTEGER; CREATE INDEX uploads_import_batch_worksheet_key ON uploads (import_batch_id, worksheet_index);"
expect_migration_failure "15. same-name non-unique worksheet index is rejected"

reset_db; bootstrap
expect_success "16 setup: same-name UNIQUE worksheet index, wrong columns" \
  "ALTER TABLE uploads ADD COLUMN import_batch_id TEXT; ALTER TABLE uploads ADD COLUMN worksheet_index INTEGER; CREATE UNIQUE INDEX uploads_import_batch_worksheet_key ON uploads (import_batch_id);"
expect_migration_failure "16. same-name unique index with wrong columns is rejected"

reset_db; bootstrap
expect_success "17 setup: import_batches pre-exists missing every CHECK constraint" \
  "CREATE TABLE import_batches (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL, original_filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT, storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, storage_etag TEXT, status TEXT NOT NULL DEFAULT 'AWAITING_UPLOAD', idempotency_key TEXT, expected_sha256 TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ, storage_deletion_status TEXT, storage_deleted_at TIMESTAMPTZ, UNIQUE(id, organisation_id), UNIQUE(organisation_id, idempotency_key));"
expect_migration_success "17. migration adds the missing CHECK constraints to the pre-existing table"
expect_success "17b setup: insert a row with NULL sha256 to test the newly-added CHECK against" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key) VALUES ('b17','org-a','a.csv','csv',1,'vercel-blob','k17');"
expect_failure "17c. the newly-added READY-requires-sha256 CHECK is now genuinely enforced" \
  "UPDATE import_batches SET status = 'READY' WHERE id = 'b17';"

reset_db; bootstrap
expect_success "18 setup: import_batches pre-exists with no FKs at all" \
  "CREATE TABLE import_batches (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, uploaded_by TEXT, original_filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT, storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, storage_etag TEXT, status TEXT NOT NULL DEFAULT 'AWAITING_UPLOAD', idempotency_key TEXT, expected_sha256 TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ, storage_deletion_status TEXT, storage_deleted_at TIMESTAMPTZ, UNIQUE(id, organisation_id), UNIQUE(organisation_id, idempotency_key));"
expect_migration_success "18. migration adds the missing FKs to the pre-existing table"
expect_failure "18b. the newly-added organisation FK is now genuinely enforced" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key) VALUES ('bad-org','org-does-not-exist','x.csv','csv',1,'vercel-blob','k-bad-org');"

reset_db; bootstrap
expect_success "19 setup: import_batches pre-exists with no idempotency uniqueness" \
  "CREATE TABLE import_batches (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL, original_filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT, storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, storage_etag TEXT, status TEXT NOT NULL DEFAULT 'AWAITING_UPLOAD', idempotency_key TEXT, expected_sha256 TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ, storage_deletion_status TEXT, storage_deleted_at TIMESTAMPTZ, UNIQUE(id, organisation_id));"
expect_migration_success "19. migration adds the missing idempotency uniqueness"
expect_success "19b setup: first idempotency key" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, idempotency_key) VALUES ('bi-a','org-a','a.csv','csv',1,'vercel-blob','k-idem-a','same-key');"
expect_failure "19c. the newly-added idempotency uniqueness is now genuinely enforced" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, idempotency_key) VALUES ('bi-b','org-a','b.csv','csv',1,'vercel-blob','k-idem-b','same-key');"

reset_db; bootstrap
expect_success "20 setup: import_batches pre-exists with WRONG primary key (on organisation_id, not id)" \
  "CREATE TABLE import_batches (id TEXT NOT NULL, organisation_id TEXT NOT NULL REFERENCES organisations(id), uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL, original_filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT, storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, storage_etag TEXT, status TEXT NOT NULL DEFAULT 'AWAITING_UPLOAD', idempotency_key TEXT, expected_sha256 TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ, storage_deletion_status TEXT, storage_deleted_at TIMESTAMPTZ, PRIMARY KEY (organisation_id), UNIQUE(id, organisation_id), UNIQUE(organisation_id, idempotency_key));"
expect_migration_failure "20. wrong existing PRIMARY KEY (wrong column) is rejected"

reset_db; bootstrap
expect_success "21 setup: import_batches pre-exists with status missing its default" \
  "CREATE TABLE import_batches (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL, original_filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT, storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, storage_etag TEXT, status TEXT NOT NULL, idempotency_key TEXT, expected_sha256 TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ, storage_deletion_status TEXT, storage_deleted_at TIMESTAMPTZ, UNIQUE(id, organisation_id), UNIQUE(organisation_id, idempotency_key));"
expect_migration_failure "21. import_batches.status missing its required default is rejected"

reset_db; bootstrap
expect_success "22 setup: uploads.lineage_kind pre-exists with no default" \
  "ALTER TABLE uploads ADD COLUMN lineage_kind TEXT NOT NULL DEFAULT 'x'; ALTER TABLE uploads ALTER COLUMN lineage_kind DROP DEFAULT; UPDATE uploads SET lineage_kind = 'LEGACY';"
expect_migration_failure "22. uploads.lineage_kind missing its required default is rejected"

reset_db; bootstrap
expect_success "23 setup: uploads.attempt_count pre-exists with no default" \
  "ALTER TABLE uploads ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0; ALTER TABLE uploads ALTER COLUMN attempt_count DROP DEFAULT;"
expect_migration_failure "23. uploads.attempt_count missing its required default is rejected"

reset_db; bootstrap
expect_success "24 setup: pre-existing uploads.worksheet_index has the wrong type" \
  "ALTER TABLE uploads ADD COLUMN worksheet_index TEXT;"
expect_migration_failure "24. wrong existing column type (worksheet_index TEXT) is rejected"

reset_db; bootstrap
expect_success "25 setup: import_batches pre-exists with storage_etag as the wrong type" \
  "CREATE TABLE import_batches (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL, original_filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT, storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, storage_etag INTEGER, status TEXT NOT NULL DEFAULT 'AWAITING_UPLOAD', idempotency_key TEXT, expected_sha256 TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ, storage_deletion_status TEXT, storage_deleted_at TIMESTAMPTZ, UNIQUE(id, organisation_id), UNIQUE(organisation_id, idempotency_key));"
expect_migration_failure "25. omitted-column regression (storage_etag wrong type) is rejected"

reset_db; bootstrap
# A NOT VALID foreign key is structurally identical to a fully-validated
# one in every column ensure_fk otherwise inspects (conrelid/confrelid/
# conkey/confkey/confdeltype/confupdtype/confmatchtype) — only
# convalidated distinguishes it. Insert the violating row BEFORE adding
# the constraint, exactly as a real drift incident would: NOT VALID skips
# the creation-time full-table scan, so Postgres accepts the ALTER TABLE
# despite the row already violating it.
expect_success "26 setup: import_batches pre-exists with a NOT VALID organisation FK and a pre-existing row that already violates it" \
  "CREATE TABLE import_batches (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL, original_filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT, storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, storage_etag TEXT, status TEXT NOT NULL DEFAULT 'AWAITING_UPLOAD', idempotency_key TEXT, expected_sha256 TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ, storage_deletion_status TEXT, storage_deleted_at TIMESTAMPTZ, UNIQUE(id, organisation_id), UNIQUE(organisation_id, idempotency_key)); INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key) VALUES ('batch-orphan','org-does-not-exist','x.xlsx','xlsx',10,'vercel-blob','k-orphan'); ALTER TABLE import_batches ADD CONSTRAINT import_batches_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) NOT VALID;"
expect_migration_failure "26. NOT VALID foreign key (structurally correct, but never confirmed against a pre-existing violating row) is rejected"

echo ""
echo "=== DEFAULT-CONTRACT DRIFT SCENARIOS (5A.2C-R4) ==="
# ensure_column's p_check_default/p_expected_default separation (R4) means
# NULL can no longer be read as "skip validation" — it must mean "this
# column must have NO database default." These scenarios reproduce
# Codex's exact R3 push-gate findings (27, 28) plus every other category
# from the same defect class: an unexpected DEFAULT quietly added to a
# column whose entire safety property is that the application (or SQL
# CHECK logic elsewhere) fully controls its value, never Postgres.

reset_db; bootstrap
expect_migration_success "27 setup: clean migration establishes the baseline schema"
expect_success "27 setup: add an unexpected fabricated default to import_batches.sha256" \
  "ALTER TABLE import_batches ALTER COLUMN sha256 SET DEFAULT repeat('0', 64);"
expect_migration_failure "27. unexpected import_batches.sha256 default (fabricated authoritative hash) is rejected"

reset_db; bootstrap
expect_migration_success "28 setup: clean migration establishes the baseline schema"
expect_success "28 setup: add an unexpected default to uploads.import_batch_id" \
  "ALTER TABLE uploads ALTER COLUMN import_batch_id SET DEFAULT 'bogus-batch';"
expect_migration_failure "28. unexpected uploads.import_batch_id default (fabricated tenant/batch linkage) is rejected"

reset_db; bootstrap
expect_migration_success "29 setup: clean migration establishes the baseline schema"
expect_success "29 setup: add an unexpected default to import_batches.expected_sha256" \
  "ALTER TABLE import_batches ALTER COLUMN expected_sha256 SET DEFAULT repeat('a', 64);"
expect_migration_failure "29. unexpected import_batches.expected_sha256 default (client-hint field) is rejected"

reset_db; bootstrap
expect_migration_success "30 setup: clean migration establishes the baseline schema"
expect_success "30 setup: add an unexpected, allowed-vocabulary-looking default to uploads.canonical_status" \
  "ALTER TABLE uploads ALTER COLUMN canonical_status SET DEFAULT 'AWAITING_CONFIRMATION';"
expect_migration_failure "30. unexpected uploads.canonical_status default is rejected"

reset_db; bootstrap
expect_migration_success "31 setup: clean migration establishes the baseline schema"
expect_success "31 setup: drop import_batches.status's required default" \
  "ALTER TABLE import_batches ALTER COLUMN status DROP DEFAULT;"
expect_migration_failure "31. required import_batches.status default missing is rejected"

reset_db; bootstrap
expect_migration_success "32 setup: clean migration establishes the baseline schema"
expect_success "32 setup: drop uploads.lineage_kind's required default" \
  "ALTER TABLE uploads ALTER COLUMN lineage_kind DROP DEFAULT;"
expect_migration_failure "32. required uploads.lineage_kind default missing is rejected"

reset_db; bootstrap
expect_migration_success "33 setup: clean migration establishes the baseline schema"
expect_success "33 setup: drop uploads.attempt_count's required default" \
  "ALTER TABLE uploads ALTER COLUMN attempt_count DROP DEFAULT;"
expect_migration_failure "33. required uploads.attempt_count default missing is rejected"

reset_db; bootstrap
expect_migration_success "34 setup: clean migration establishes the baseline schema"
expect_success "34 setup: change import_batches.status's default to an unexpected value" \
  "ALTER TABLE import_batches ALTER COLUMN status SET DEFAULT 'FAILED';"
expect_migration_failure "34. wrong import_batches.status default (FAILED instead of AWAITING_UPLOAD) is rejected"

reset_db; bootstrap
expect_migration_success "35 setup: clean migration establishes the baseline schema"
expect_success "35 setup: add an unexpected SQL default to the application-generated import_batches.id column (Prisma supplies cuid() app-side; no DB default was ever intended)" \
  "ALTER TABLE import_batches ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;"
expect_migration_failure "35. unexpected SQL default on the application-generated id column is rejected"

reset_db; bootstrap
expect_migration_success "36 setup: clean migration establishes the baseline schema"
expect_success "36 setup: add an unexpected default to the nullable-metadata column import_batches.storage_etag (representative of the broader no-default nullable/tombstone/failure category)" \
  "ALTER TABLE import_batches ALTER COLUMN storage_etag SET DEFAULT 'unexpected-etag';"
expect_migration_failure "36. unexpected default on a representative nullable-metadata column (storage_etag) is rejected"

echo ""
echo "=== 5A.2G.0 ATTEMPT/FAILURE METADATA SCENARIOS ==="
# Data Hub 5A.2G.0 — ImportBatch attempt/failure metadata. The critical
# scenario here (37) is the pre-existing-FAILED-row migration-safety
# question: does the migration safely apply to a database that already
# has a status='FAILED' ImportBatch row from before these columns/
# constraints existed? Scenario 1 above ("clean migration applies")
# already re-validates the whole extended migration file — including
# these new columns/constraints/backfill — against a freshly-created
# 5A.2C-era schema (satisfying the "full historical schema shape"
# compatibility requirement), so it is not repeated here.

reset_db; bootstrap
expect_success "37 setup: import_batches pre-exists in its exact pre-5A.2G.0 shape (no attempt/failure columns at all) with an existing FAILED row — simulating a row that predates this migration phase" \
  "CREATE TABLE import_batches (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL, original_filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT, storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, storage_etag TEXT, status TEXT NOT NULL DEFAULT 'AWAITING_UPLOAD', idempotency_key TEXT, expected_sha256 TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ, storage_deletion_status TEXT, storage_deleted_at TIMESTAMPTZ, UNIQUE(id, organisation_id), UNIQUE(organisation_id, idempotency_key)); INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, status, sha256) VALUES ('old-failed-batch', 'org-a', 'old.xlsx', 'xlsx', 10, 'vercel-blob', 'k-old-failed', 'FAILED', repeat('b',64));"
expect_migration_success "37. THE PRE-EXISTING-FAILED-ROW MIGRATION-SAFETY SCENARIO: migration safely applies despite a pre-existing FAILED row with no attempt/failure columns — the targeted backfill (option a) prevents the naive CHECK-constraint failure"
expect_success "37b. the pre-existing FAILED row was backfilled to attempt_count=0 and last_failure_retryable=true, while last_attempt_at/last_failure_code/last_failure_message correctly remain NULL (no fabricated diagnostic text)" \
  "SELECT 1/CASE WHEN (SELECT attempt_count FROM import_batches WHERE id='old-failed-batch') = 0 AND (SELECT last_failure_retryable FROM import_batches WHERE id='old-failed-batch') = true AND (SELECT last_attempt_at FROM import_batches WHERE id='old-failed-batch') IS NULL AND (SELECT last_failure_code FROM import_batches WHERE id='old-failed-batch') IS NULL AND (SELECT last_failure_message FROM import_batches WHERE id='old-failed-batch') IS NULL THEN 1 ELSE 0 END;"

reset_db; bootstrap
expect_success "38 setup: import_batches pre-exists in its exact pre-5A.2G.0 shape with an existing NON-FAILED (AWAITING_UPLOAD) row" \
  "CREATE TABLE import_batches (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL, original_filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT, storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, storage_etag TEXT, status TEXT NOT NULL DEFAULT 'AWAITING_UPLOAD', idempotency_key TEXT, expected_sha256 TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ, storage_deletion_status TEXT, storage_deleted_at TIMESTAMPTZ, UNIQUE(id, organisation_id), UNIQUE(organisation_id, idempotency_key)); INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key) VALUES ('old-pending-batch', 'org-a', 'old2.xlsx', 'xlsx', 10, 'vercel-blob', 'k-old-pending');"
expect_migration_success "38. migration applies cleanly to a pre-existing NON-FAILED row"
expect_success "38b. the pre-existing NON-FAILED row stays fully NULL/zero for every new column — the backfill correctly excludes it" \
  "SELECT 1/CASE WHEN (SELECT attempt_count FROM import_batches WHERE id='old-pending-batch') = 0 AND (SELECT last_failure_retryable FROM import_batches WHERE id='old-pending-batch') IS NULL AND (SELECT last_attempt_at FROM import_batches WHERE id='old-pending-batch') IS NULL AND (SELECT last_failure_code FROM import_batches WHERE id='old-pending-batch') IS NULL AND (SELECT last_failure_message FROM import_batches WHERE id='old-pending-batch') IS NULL THEN 1 ELSE 0 END;"

reset_db; bootstrap
expect_migration_success "39 setup: clean migration establishes the 5A.2G.0 schema"
expect_success "39. all five new columns exist with the correct types" \
  "SELECT 1/CASE WHEN (SELECT data_type FROM information_schema.columns WHERE table_name='import_batches' AND column_name='last_attempt_at') = 'timestamp with time zone' AND (SELECT data_type FROM information_schema.columns WHERE table_name='import_batches' AND column_name='attempt_count') = 'integer' AND (SELECT data_type FROM information_schema.columns WHERE table_name='import_batches' AND column_name='last_failure_code') = 'text' AND (SELECT data_type FROM information_schema.columns WHERE table_name='import_batches' AND column_name='last_failure_message') = 'text' AND (SELECT data_type FROM information_schema.columns WHERE table_name='import_batches' AND column_name='last_failure_retryable') = 'boolean' THEN 1 ELSE 0 END;"

expect_success "40. attempt_count defaults to exactly 0 for a newly-inserted row" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key) VALUES ('b40','org-a','d.xlsx','xlsx',10,'vercel-blob','k40'); SELECT 1/CASE WHEN (SELECT attempt_count FROM import_batches WHERE id='b40') = 0 THEN 1 ELSE 0 END;"

expect_failure "41. attempt_count = -1 is rejected" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, attempt_count) VALUES ('b41','org-a','e.xlsx','xlsx',10,'vercel-blob','k41', -1);"

expect_success "42. a valid attempt_count (3) is accepted" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, attempt_count) VALUES ('b42','org-a','f.xlsx','xlsx',10,'vercel-blob','k42', 3);"

expect_failure "43. a non-FAILED (AWAITING_UPLOAD) row with last_failure_retryable = true is rejected" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, last_failure_retryable) VALUES ('b43','org-a','g.xlsx','xlsx',10,'vercel-blob','k43', true);"

expect_failure "44. a non-FAILED (AWAITING_UPLOAD) row with last_failure_retryable = false is rejected" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, last_failure_retryable) VALUES ('b44','org-a','h.xlsx','xlsx',10,'vercel-blob','k44', false);"

expect_success "45. a FAILED row with last_failure_retryable = true is accepted" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, status, last_failure_retryable) VALUES ('b45','org-a','i.xlsx','xlsx',10,'vercel-blob','k45','FAILED', true);"

expect_success "46. a FAILED row with last_failure_retryable = false is accepted" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, status, last_failure_retryable) VALUES ('b46','org-a','j.xlsx','xlsx',10,'vercel-blob','k46','FAILED', false);"

expect_failure "46b. a FAILED row with last_failure_retryable omitted (NULL) is rejected" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, status) VALUES ('b46b','org-a','j2.xlsx','xlsx',10,'vercel-blob','k46b','FAILED');"

expect_success "47. a last_failure_message of exactly 500 characters is accepted" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, status, last_failure_retryable, last_failure_message) VALUES ('b47','org-a','k.xlsx','xlsx',10,'vercel-blob','k47','FAILED', true, repeat('x', 500));"

expect_failure "48. a last_failure_message of 501 characters is rejected" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, status, last_failure_retryable, last_failure_message) VALUES ('b48','org-a','l.xlsx','xlsx',10,'vercel-blob','k48','FAILED', true, repeat('x', 501));"

expect_success "49 setup: insert a fully-populated attempt/failure metadata row" \
  "INSERT INTO import_batches (id, organisation_id, original_filename, content_type, size_bytes, storage_provider, storage_key, status, last_failure_retryable, last_failure_code, last_failure_message, attempt_count, last_attempt_at) VALUES ('b49','org-a','m.xlsx','xlsx',10,'vercel-blob','k49','FAILED', false, 'HASH_MISMATCH', 'sha256 did not match expected value', 2, now());"
expect_migration_success "49b. rerunning the migration after real populated attempt/failure metadata already exists succeeds (idempotent)"
expect_success "49c. the populated metadata is preserved unchanged by the rerun — the backfill's WHERE clause correctly excludes it" \
  "SELECT 1/CASE WHEN (SELECT attempt_count FROM import_batches WHERE id='b49') = 2 AND (SELECT last_failure_retryable FROM import_batches WHERE id='b49') = false AND (SELECT last_failure_code FROM import_batches WHERE id='b49') = 'HASH_MISMATCH' AND (SELECT last_failure_message FROM import_batches WHERE id='b49') = 'sha256 did not match expected value' AND (SELECT last_attempt_at FROM import_batches WHERE id='b49') IS NOT NULL THEN 1 ELSE 0 END;"

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo "Failed checks:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
