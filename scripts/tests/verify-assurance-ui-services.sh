#!/usr/bin/env bash
# BrainBase Assurance UI foundation — disposable PostgreSQL 17 service proof.
#
# Starts a throwaway postgres:17 container, creates minimal stand-ins for
# the pre-existing platform tables (organisations, users, hr_people,
# organiser_items, audit_logs), applies the REAL Assurance migrations
# (A0.1B, A0.1C, A0.1D-1, A0.1D-2, A0.1D-3, A0.1E-1 Audit), then runs the Assurance
# service-layer integration suite (scripts/tests/assuranceUi.integration.test.ts)
# against it through a Neon-compatible `pg` seam. Also proves the synthetic
# demo fixture (scripts/assurance-demo/*.sql): its guard, that it loads, that
# the services render it coherently, and that cleanup removes only demo rows
# and restores the history triggers.
#
# Never touches Neon Preview/Production. The spec itself refuses any
# non-localhost DATABASE_URL.
#
# Usage:   bash scripts/tests/verify-assurance-ui-services.sh
# Exit:    0 = pass, 1 = test failure, 2 = harness/setup failure.
# Always destroys its own container.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

CONTAINER="brainbase-assurance-ui-$$"
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

psql_q() { docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1; }

echo "Demo fixture guard: seeding WITHOUT the disposable-only setting must be refused ..."
if psql_exec < scripts/assurance-demo/seed-assurance-demo.sql >/dev/null 2>&1; then
  echo "ERROR: demo fixture ran without its guard." >&2; exit 1
fi
[ "$(echo "SELECT count(*) FROM organisations WHERE id = 'assurance-demo-org';" | psql_q | tr -d '[:space:]')" = "0" ]   || { echo "ERROR: refused fixture left rows behind." >&2; exit 1; }
echo "  refused as expected"

seed_demo() { { echo "SET assurance.demo_fixture = 'disposable-only';"; cat scripts/assurance-demo/seed-assurance-demo.sql; } | psql_exec >/dev/null; }
cleanup_demo() { { echo "SET assurance.demo_fixture = 'disposable-only';"; cat scripts/assurance-demo/cleanup-assurance-demo.sql; } | psql_exec >/dev/null; }

echo "Seeding the synthetic Assurance demo fixture ..."
seed_demo || { echo "ERROR: demo fixture failed to apply." >&2; exit 1; }
if seed_demo 2>/dev/null; then echo "ERROR: demo fixture re-ran over existing demo data." >&2; exit 1; fi
echo "  seeded (and a second run is refused)"

export DATABASE_URL="postgresql://postgres:test@127.0.0.1:${HOST_PORT}/testdb"
echo "Running Assurance service integration suite ..."
npx vitest run --config vitest.integration.config.ts scripts/tests/assuranceUi.integration.test.ts
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "Assurance UI service proof FAILED."
  exit 1
fi

echo "Cleaning up the demo fixture (disposable-only) and proving history triggers are restored ..."
cleanup_demo || { echo "ERROR: demo cleanup failed." >&2; exit 1; }
[ "$(echo "SELECT count(*) FROM organisations WHERE id = 'assurance-demo-org';" | psql_q | tr -d '[:space:]')" = "0" ] || { echo "ERROR: demo org survived cleanup." >&2; exit 1; }
[ "$(echo "SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_assurance_verifications_append_only','trg_assurance_inspection_template_versions_lifecycle','trg_assurance_audit_template_versions_lifecycle') AND tgenabled = 'O';" | psql_q | tr -d '[:space:]')" = "3" ]   || { echo "ERROR: history triggers not re-enabled after cleanup." >&2; exit 1; }
[ "$(echo "SELECT count(*) FROM assurance_incidents WHERE organisation_id = 'org-a';" | psql_q | tr -d '[:space:]')" != "0" ] || { echo "ERROR: cleanup touched non-demo data." >&2; exit 1; }
if echo "UPDATE assurance_verifications SET notes = 'x' WHERE organisation_id = 'org-a';" | psql_exec >/dev/null 2>&1; then
  echo "ERROR: append-only trigger not active after cleanup." >&2; exit 1
fi
seed_demo || { echo "ERROR: demo fixture could not be re-seeded after cleanup." >&2; exit 1; }
echo "  cleanup complete, triggers active, non-demo data untouched, re-seed OK"
echo "Assurance UI service proof passed."
exit 0
