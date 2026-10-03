#!/usr/bin/env bash
# BrainBase Assurance — Settings → Reference data: disposable PostgreSQL 17 proof.
#
# Starts a throwaway postgres:17 container, creates the same minimal
# stand-ins for pre-existing platform tables as verify-assurance-ui-services.sh,
# applies the REAL Assurance migrations (A0.1B, A0.1C, A0.1D-1..3, A0.1E-1, A0.1F),
# then runs scripts/tests/assuranceReferenceDataSettings.integration.test.ts
# (shared locations / assets / external organisations: list, create, edit,
# deactivate, reactivate, permissions, tenant isolation, active-only selectors,
# historical display, concurrency and audit) through the Neon-compatible `pg` seam.
#
# Never touches Neon Preview/Production. The spec itself refuses any
# non-localhost DATABASE_URL.
#
# Usage:   bash scripts/tests/verify-assurance-reference-data-settings.sh
# Exit:    0 = pass, 1 = test failure, 2 = harness/setup failure.
# Always destroys its own container.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

CONTAINER="brainbase-assurance-refdata-$$"
HOST_PORT=$((20000 + RANDOM % 20000))

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for f in scripts/create-shared-foundations-a01b.sql scripts/create-assurance-core-a01c.sql \
         scripts/create-assurance-incidents-a01d1.sql scripts/create-assurance-investigations-a01d2.sql \
         scripts/create-assurance-inspections-a01d3.sql scripts/create-assurance-audits-a01e1.sql \
         scripts/create-assurance-template-lifecycle-a01f.sql; do
  [ -f "$f" ] || { echo "ERROR: $f not found." >&2; exit 2; }
done

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required." >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon is not reachable." >&2; exit 2; }

echo "Starting disposable postgres:17 ($CONTAINER) on 127.0.0.1:$HOST_PORT ..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb \
  -p "127.0.0.1:${HOST_PORT}:5432" postgres:17 >/dev/null || { echo "ERROR: could not start postgres:17." >&2; exit 2; }

READY=0
for _ in $(seq 1 60); do
  if echo "SELECT 1;" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
[ "$READY" -eq 1 ] || { echo "ERROR: postgres did not become ready." >&2; exit 2; }

psql_exec() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1; }

cat <<'SQL' | psql_exec >/dev/null || { echo "ERROR: base schema failed." >&2; exit 2; }
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Stand-ins for pre-existing platform tables, shaped like the real ones
-- (prisma @updatedAt columns have NO database default, exactly as in
-- Production; organiser tables mirror verify-organiser-confirmation-replay.sh).
CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'VIEWER',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE modules (key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, active BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE organisation_modules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  module_key TEXT NOT NULL REFERENCES modules(key),
  enabled BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, module_key)
);

CREATE TABLE organiser_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE organiser_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES organiser_boards(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE organiser_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES organiser_boards(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  group_id UUID REFERENCES organiser_groups(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Not Started',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT organiser_items_organisation_id_id_key UNIQUE (organisation_id, id)
);

CREATE TABLE hr_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  preferred_name TEXT,
  job_title TEXT,
  work_email TEXT,
  CONSTRAINT hr_people_organisation_id_id_key UNIQUE (organisation_id, id)
);

-- Mirrors prisma AuditLog (id TEXT, created_at default now()).
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

echo "Applying real Assurance migrations (A0.1B, A0.1C, A0.1D-1..3, A0.1E-1, A0.1F) ..."
for f in scripts/create-shared-foundations-a01b.sql scripts/create-assurance-core-a01c.sql \
         scripts/create-assurance-incidents-a01d1.sql scripts/create-assurance-investigations-a01d2.sql \
         scripts/create-assurance-inspections-a01d3.sql scripts/create-assurance-audits-a01e1.sql \
         scripts/create-assurance-template-lifecycle-a01f.sql; do
  psql_exec < "$f" >/dev/null || { echo "ERROR: $f failed to apply." >&2; exit 2; }
  echo "  applied $f"
done

export DATABASE_URL="postgresql://postgres:test@127.0.0.1:${HOST_PORT}/testdb"
echo "Running Settings → Reference data integration suite ..."
npx vitest run --config vitest.integration.config.ts scripts/tests/assuranceReferenceDataSettings.integration.test.ts
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "Reference data settings proof FAILED."
  exit 1
fi
echo "Reference data settings proof passed."
exit 0
