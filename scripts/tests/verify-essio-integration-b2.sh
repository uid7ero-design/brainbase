#!/usr/bin/env bash
# Essio integration B2 — real disposable-Postgres proof for the Essio API
# surface (create-work, target discovery, super_admin credential management):
# scripts/tests/essioIntegrationB2.integration.test.ts.
#
# Same methodology as verify-essio-integration-b1.sh: a fresh
# postgres:17-alpine container (Production is 17), created and destroyed by
# this script only. Never touches Production/Neon or any running database.
# The database gets the shared base schema, then the real A0.1A + B1
# migrations and the essio_integration capability seed, exactly as they would
# be applied in order.

set -uo pipefail
cd "$(dirname "$0")/../.."

CONTAINER="essio-b2-harness-$$"
HOST_PORT=$((20000 + RANDOM % 20000))

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 1
fi

echo "Starting disposable postgres:17-alpine ($CONTAINER) on 127.0.0.1:$HOST_PORT..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=postgres \
  -p "127.0.0.1:${HOST_PORT}:5432" postgres:17-alpine >/dev/null
READY=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 0.5
done
[ "$READY" = 1 ] || { echo "ERROR: postgres did not become ready" >&2; exit 1; }
sleep 1

apply_file() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d essio_b2 -v ON_ERROR_STOP=1 < "$1"; }

docker exec "$CONTAINER" createdb -U postgres essio_b2
for f in scripts/tests/essio-integration-base-schema.sql \
         scripts/create-organiser-items-org-id-key-a01a.sql \
         scripts/create-essio-integration-b1.sql \
         scripts/seed-essio-integration-capability.sql; do
  if ! apply_file "$f" >/dev/null 2>&1; then
    echo "FAIL: could not apply $f" >&2
    exit 1
  fi
  echo "applied $f"
done

export DATABASE_URL="postgresql://postgres:test@localhost:${HOST_PORT}/essio_b2"
export NEXT_PUBLIC_APP_URL="https://brainbase.example"
if npx vitest run --config vitest.integration.config.ts scripts/tests/essioIntegrationB2.integration.test.ts; then
  echo "ALL ESSIO B2 CHECKS PASSED"
  exit 0
fi
echo "FAILED: vitest integration suite"
exit 1
