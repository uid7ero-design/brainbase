#!/usr/bin/env bash
# Data Hub 5B.4A remediation — real disposable-Postgres proof of the atomic
# create+active-gate transaction in lib/data-hub/importBatch/initiate.ts.
#
# This is a NARROW, SEPARATE, correctly-bootstrapped harness (following the
# exact bootstrap methodology already established by
# scripts/tests/verify-datahub-source-mapping-services.sh: organisations/
# users/uploads bootstrap, then the real scripts/create-import-batches.sql,
# then the real scripts/create-datahub-source-mappings.sql). It does NOT
# modify, does NOT reuse, and does NOT fix the separate, already-known-
# broken scripts/tests/verify-datahub-initiate-finalize-routes.sh harness —
# that remains tracked debt, out of scope for this remediation.
#
# WHAT THIS PROVES (against real Postgres, not mocks — this is exactly the
# kind of cross-connection/transaction-visibility property a mocked-Prisma
# unit test cannot faithfully exercise):
#   1. A transaction that creates an ImportBatch row for an INACTIVE
#      SourceSystem, then throws to trigger rollback, leaves the row
#      genuinely INVISIBLE to a fully separate database connection while
#      the transaction is still open (uncommitted) — not merely "we didn't
#      happen to look" but actually queried from a second, independent
#      PrismaClient/connection.
#   2. After the rollback, zero rows exist in import_batches for that
#      attempt — no compensating delete was needed or used.
#   3. An active-source creation still commits normally and becomes visible
#      to a second connection afterward.
#   4. A duplicate idempotency-key attempt against an INACTIVE source still
#      raises the real unique-constraint violation (P2002-class), proving
#      the active-gate does not mask/shadow real key-collision detection —
#      this is the specific correctness property a naive
#      "INSERT...SELECT...WHERE active" raw-SQL design was found (during
#      this remediation's own design phase) to get WRONG.
#
# Destroys the container on exit regardless of outcome. Never touches
# Production/Preview/Neon.
#
# USAGE:
#   bash scripts/tests/verify-5b4a-source-atomicity.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_MIGRATION="$REPO_ROOT/scripts/create-import-batches.sql"
SOURCE_MAPPING_MIGRATION="$REPO_ROOT/scripts/create-datahub-source-mappings.sql"
CONTAINER="datahub-5b4a-atomicity-harness-$$"
HOST_PORT=$((20000 + RANDOM % 20000))

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "$REPO_ROOT/scripts/tests/.5b4a-atomicity-probe.mjs"
}
trap cleanup EXIT

if [ ! -f "$BASE_MIGRATION" ]; then
  echo "ERROR: base migration file not found at $BASE_MIGRATION" >&2
  exit 2
fi
if [ ! -f "$SOURCE_MAPPING_MIGRATION" ]; then
  echo "ERROR: 5B.1 migration file not found at $SOURCE_MAPPING_MIGRATION" >&2
  exit 2
fi
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

echo "Applying bootstrap schema (organisations/users/uploads)..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TYPE "SchemaType" AS ENUM (
  'MISSED_COLLECTIONS', 'ILLEGAL_DUMPING', 'DEBTORS', 'SERVICE_REQUESTS',
  'BIN_MAINTENANCE', 'WASTE_METRICS', 'FINANCIAL', 'GENERIC', 'UNKNOWN'
);
CREATE TYPE "UploadStatus" AS ENUM (
  'PENDING', 'DETECTING', 'VALIDATING', 'PREVIEW_READY', 'IMPORTING', 'COMPLETE', 'FAILED'
);
CREATE TYPE "Module" AS ENUM (
  'WASTE', 'DUMPING', 'FORECASTING', 'MISSED_COLLECTIONS', 'DEBTORS',
  'BIN_MAINTENANCE', 'CONTRACTS', 'OPERATIONS'
);
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
SQL
if [ $? -ne 0 ]; then
  echo "ERROR: bootstrap schema failed to apply." >&2
  exit 2
fi

echo "Applying scripts/create-import-batches.sql..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$BASE_MIGRATION"
if [ $? -ne 0 ]; then
  echo "ERROR: create-import-batches.sql failed to apply." >&2
  exit 2
fi

echo "Applying scripts/create-datahub-source-mappings.sql (5B.1, unmodified)..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 < "$SOURCE_MAPPING_MIGRATION"
if [ $? -ne 0 ]; then
  echo "ERROR: create-datahub-source-mappings.sql failed to apply." >&2
  exit 2
fi

echo "Seeding minimal tenant/actor/SourceSystem fixture rows..."
docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO organisations (id, name, slug) VALUES ('org-1', 'Org One', 'org-one');
INSERT INTO users (id, organisation_id, username, name) VALUES ('user-1', 'org-1', 'user1', 'User One');
INSERT INTO source_systems (id, organisation_id, name, active, created_at, updated_at)
  VALUES ('ss-active', 'org-1', 'Active Source', true, now(), now());
INSERT INTO source_systems (id, organisation_id, name, active, created_at, updated_at)
  VALUES ('ss-inactive', 'org-1', 'Inactive Source', false, now(), now());
SQL
if [ $? -ne 0 ]; then
  echo "ERROR: fixture seed failed to apply." >&2
  exit 2
fi

DATABASE_URL="postgresql://postgres:test@localhost:${HOST_PORT}/testdb"
export DATABASE_URL
export DIRECT_URL="$DATABASE_URL"

cat > "$REPO_ROOT/scripts/tests/.5b4a-atomicity-probe.mjs" <<'EOF'
import { PrismaClient, Prisma } from "@prisma/client";
const url = process.env.DATABASE_URL;
const clientA = new PrismaClient({ datasources: { db: { url } } });
const clientB = new PrismaClient({ datasources: { db: { url } } });

class SourceSystemUnavailableForCreationError extends Error {}

function mkData(id, key, ssid) {
  return {
    id, organisation_id: "org-1", uploaded_by: "user-1",
    storage_key: `key-for-${id}`, original_filename: "f.csv", content_type: "csv",
    size_bytes: 1, storage_provider: "p", status: "AWAITING_UPLOAD",
    idempotency_key: key, source_system_id: ssid,
  };
}

// Mirrors initiate.ts's real transactional create+gate exactly.
async function createGated(client, id, key, ssid) {
  return client.$transaction(async (tx) => {
    const created = await tx.importBatch.create({ data: mkData(id, key, ssid) });
    if (ssid !== null) {
      const src = await tx.sourceSystem.findUnique({
        where: { id_organisation_id: { id: ssid, organisation_id: "org-1" } },
        select: { active: true },
      });
      if (!src || !src.active) throw new SourceSystemUnavailableForCreationError();
    }
    return created;
  });
}

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

// --- Proof 1: non-visibility of uncommitted row to a SEPARATE connection, rollback for inactive source ---
let bSawRowDuringA = null;
try {
  await clientA.$transaction(async (tx) => {
    await tx.importBatch.create({ data: mkData("batch-1", "key-1", "ss-inactive") });
    bSawRowDuringA = await clientB.importBatch.findUnique({
      where: { organisation_id_idempotency_key: { organisation_id: "org-1", idempotency_key: "key-1" } },
    });
    const src = await tx.sourceSystem.findUnique({
      where: { id_organisation_id: { id: "ss-inactive", organisation_id: "org-1" } },
      select: { active: true },
    });
    if (!src || !src.active) throw new SourceSystemUnavailableForCreationError();
  });
  check("Proof1 — transaction rejected inactive-source creation (should not reach here)", false);
} catch (err) {
  check("Proof1 — transaction threw SourceSystemUnavailableForCreationError", err instanceof SourceSystemUnavailableForCreationError);
}
check("Proof1 — a SEPARATE connection saw NOTHING while A's transaction was open (uncommitted)", bSawRowDuringA === null);
const afterCount = await clientA.$queryRaw`SELECT count(*)::int as c FROM import_batches WHERE id = 'batch-1';`;
check("Proof1 — zero rows exist after rollback (no compensating delete needed/used)", Number(afterCount[0].c) === 0);

// --- Proof 2: active source commits, becomes visible to a separate connection afterward ---
await createGated(clientA, "batch-2", "key-2", "ss-active");
const seenAfterCommit = await clientB.importBatch.findUnique({
  where: { organisation_id_idempotency_key: { organisation_id: "org-1", idempotency_key: "key-2" } },
});
check("Proof2 — active-source creation committed and is visible to a separate connection", seenAfterCommit !== null);

// --- Proof 3: duplicate idempotency key against an INACTIVE source still raises a real unique violation, not silently swallowed by the active gate ---
try {
  await createGated(clientA, "batch-3", "key-2", "ss-inactive");
  check("Proof3 — duplicate key + inactive source raised unique violation (should not reach here)", false);
} catch (err) {
  const isRealUniqueViolation =
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
  check("Proof3 — duplicate key + inactive source raises the REAL P2002 unique violation (key-collision detection unaffected by active gate)", isRealUniqueViolation);
}

await clientA.$disconnect();
await clientB.$disconnect();

if (failures > 0) {
  console.error(`\n${failures} proof(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll atomicity proofs PASSED.");
EOF

echo "Running atomicity proof against real Postgres..."
node "$REPO_ROOT/scripts/tests/.5b4a-atomicity-probe.mjs"
RESULT=$?

if [ "$RESULT" -eq 0 ]; then
  echo "PASS: Data Hub 5B.4A source-system creation atomicity proof."
else
  echo "FAIL: Data Hub 5B.4A source-system creation atomicity proof."
fi

exit "$RESULT"
