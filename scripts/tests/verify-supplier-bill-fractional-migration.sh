#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER="supplier-bill-fractional-migration-$$"
HOST_PORT=$((20000 + RANDOM % 20000))

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required." >&2
  exit 2
fi

echo "Starting disposable postgres:16-alpine ($CONTAINER) on $HOST_PORT..."
docker run -d --name "$CONTAINER"   -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb   -p "127.0.0.1:${HOST_PORT}:5432"   postgres:16-alpine >/dev/null

READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: disposable postgres did not become ready." >&2
  exit 2
fi

export DATABASE_URL="postgresql://postgres:test@localhost:${HOST_PORT}/testdb"
cd "$REPO_ROOT"
npx vitest run --config vitest.integration.config.ts   scripts/tests/supplierBillFractionalQuantityMigration.integration.test.ts
RESULT=$?

if [ "$RESULT" -ne 0 ]; then
  echo "C7.5C fractional Supplier Bill migration verification FAILED."
  exit "$RESULT"
fi

echo "C7.5C fractional Supplier Bill migration verification PASSED."
