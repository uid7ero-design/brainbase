#!/usr/bin/env bash
# HR-7C — real disposable-Postgres proof for lifecycle task completion.
# Starts and destroys its own postgres:16-alpine container, applies the exact
# HR-7A lifecycle migration, then runs the real completeLifecycleTask() SQL
# through a pg-backed lib/db test seam. Never connects to Neon/Production.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER="hr7c-task-completion-$$"
HOST_PORT=$((20000 + RANDOM % 20000))

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 2
fi

echo "Starting disposable postgres:16-alpine ($CONTAINER) on host port $HOST_PORT..."
docker run -d --name "$CONTAINER"   -e POSTGRES_PASSWORD=test   -e POSTGRES_DB=testdb   -p "127.0.0.1:${HOST_PORT}:5432"   postgres:16-alpine >/dev/null

READY=0
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d testdb >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "ERROR: postgres did not become ready within 30s." >&2
  exit 2
fi

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1
}

cat <<'SQL' | psql_exec
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE hr_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  linked_user_id TEXT REFERENCES users(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  manager_person_id UUID REFERENCES hr_people(id),
  CONSTRAINT hr_people_organisation_id_id_key UNIQUE (organisation_id, id)
);

CREATE TABLE hr_administrators (
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (organisation_id, user_id)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  before_state JSONB,
  after_state JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

echo "Applying exact HR-7A lifecycle migration..."
psql_exec < "$REPO_ROOT/scripts/create-hr-lifecycle-workflows.sql"

echo "Running real Postgres lifecycle task completion race proof..."
(
  cd "$REPO_ROOT"
  DATABASE_URL="postgresql://postgres:test@127.0.0.1:${HOST_PORT}/testdb" \
    npx vitest run scripts/tests/hrLifecycleTaskCompletion.integration.test.ts \
      --config vitest.integration.config.ts
)

echo "Running real Postgres lifecycle task actions/approvals proof..."
(
  cd "$REPO_ROOT"
  DATABASE_URL="postgresql://postgres:test@127.0.0.1:${HOST_PORT}/testdb" \
    npx vitest run scripts/tests/hrLifecycleTaskActionsApprovals.integration.test.ts \
      --config vitest.integration.config.ts
)

echo "HR-7C lifecycle task mutation proofs passed."
