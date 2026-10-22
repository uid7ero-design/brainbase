#!/usr/bin/env bash
# Scheduling Phase 2B.0: disposable-Postgres proof of the capability registration (120), the CRM link (130), their
# rollbacks, the internal-test-organisation definition, CRM isolation, concurrent contact creation and capability isolation.
#
# Starts a FRESH postgres container (never touches Production, Neon or any running database), builds a BrainBase-shaped
# host (the real registry scripts plus crm_contacts as the production catalogue defines it), applies the approved
# migrations in the documented order, then runs the real-Postgres suite.
#
# USAGE   bash scripts/tests/verify-scheduling-phase2b0.sh [PG_MAJOR]      (default 17, the Neon major version)
# Not wired into CI (Docker is not part of the standard CI workflow in this repo).

set -uo pipefail

PG_MAJOR="${1:-17}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_DIR="$REPO_ROOT/packages/scheduling/sql"
HOST_DIR="$REPO_ROOT/scripts/scheduling"
NAME="sched2b0-proof-$$"
FAIL=0

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required." >&2; exit 2; }

step() { printf '\n== %s\n' "$*"; }
psql_c() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
check() { if [ "$1" -ne 0 ]; then echo "   FAIL: $2"; FAIL=1; else echo "   ok: $2"; fi; }

step "start postgres:${PG_MAJOR}-alpine"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=pw -p 127.0.0.1::5432 "postgres:${PG_MAJOR}-alpine" -c max_connections=300 >/dev/null || exit 2
for _ in $(seq 1 40); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
PORT="$(docker port "$NAME" 5432/tcp | head -n1 | sed 's/.*://')"
URL="postgres://postgres:pw@127.0.0.1:${PORT}/postgres"
echo "   version: $(docker exec "$NAME" psql -U postgres -Atc 'select version()' | cut -c1-40)"

step "1. BrainBase-shaped host (organisations, users, the REAL registry scripts, crm_contacts as in production)"
# organisations and users are reduced to the columns scheduling touches; everything else mirrors production.
psql_c <<'SQL'
CREATE TYPE "Plan" AS ENUM ('TRIAL','STARTER','PROFESSIONAL','ENTERPRISE');
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE','SUSPENDED','CHURNED');
CREATE TABLE organisations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, plan "Plan" NOT NULL DEFAULT 'TRIAL',
  status "OrgStatus" NOT NULL DEFAULT 'ACTIVE', settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL, timezone TEXT);
CREATE UNIQUE INDEX organisations_slug_key ON organisations (slug);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), email TEXT, name TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE crm_companies (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
-- crm_contacts exactly as the production catalogue defines it (columns, checks, keys, indexes).
CREATE TABLE crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  company_id UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT, phone TEXT, job_title TEXT, notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  classification TEXT,
  CONSTRAINT crm_contacts_classification_check CHECK (classification IS NULL OR classification = ANY (ARRAY['CLIENT','LEAD','EVENT_CONTACT','SUPPLIER','PARTNER','OTHER'])),
  CONSTRAINT crm_contacts_id_organisation_id_key UNIQUE (id, organisation_id));
CREATE INDEX idx_crm_contacts_classification ON crm_contacts (organisation_id, classification);
CREATE INDEX idx_crm_contacts_co ON crm_contacts (company_id);
CREATE INDEX idx_crm_contacts_org ON crm_contacts (organisation_id);
-- LD Tennis' own contacts table: a sentinel that nothing in 2B.0 may touch.
CREATE TABLE contacts (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, name TEXT, email TEXT);
INSERT INTO contacts VALUES ('ld-1', 'ld-org', 'LD Sentinel', 'ld@example.test');
SQL
check $? "host tables created"
psql_c < "$REPO_ROOT/scripts/create-modules.sql" >/dev/null; check $? "scripts/create-modules.sql"
psql_c < "$REPO_ROOT/scripts/create-organisation-modules.sql" >/dev/null; check $? "scripts/create-organisation-modules.sql"

step "2. approved migrations in the documented order, each applied twice"
psql_c < "$SQL_DIR/010_shared_schema.sql" >/dev/null; check $? "010 apply"
psql_c < "$HOST_DIR/110_brainbase_host.sql" >/dev/null; check $? "110 apply"
for f in 120_brainbase_capability 130_brainbase_crm_link; do
  psql_c < "$HOST_DIR/$f.sql" >/dev/null; check $? "$f first apply"
  psql_c < "$HOST_DIR/$f.sql" >/dev/null; check $? "$f second apply (idempotent)"
done
[ "$(docker exec "$NAME" psql -U postgres -Atc "select count(*) from modules where key='scheduling' and active")" = "1" ]; check $? "scheduling registered once, active"
[ "$(docker exec "$NAME" psql -U postgres -Atc "select count(*) from organisation_modules")" = "0" ]; check $? "no organisation entitled"
[ "$(docker exec "$NAME" psql -U postgres -Atc "select string_agg(version, ',' order by version) from scheduling_schema_migrations")" = "2a.1-brainbase,2a.2,2b.0-capability,2b.0-crm-link" ]; check $? "markers 2a.1-brainbase, 2a.2, 2b.0-capability, 2b.0-crm-link"
for f in 192_brainbase_crm_link_rollback 191_brainbase_capability_rollback; do
  psql_c < "$HOST_DIR/$f.sql" >/dev/null; check $? "$f"
done
[ "$(docker exec "$NAME" psql -U postgres -Atc "select count(*) from modules where key='scheduling'")" = "0" ]; check $? "rollback removed the registry row"
[ "$(docker exec "$NAME" psql -U postgres -Atc "select count(*) from pg_proc where proname='brainbase_scheduling_find_or_create_contact'")" = "0" ]; check $? "rollback removed the function"
for f in 120_brainbase_capability 130_brainbase_crm_link; do
  psql_c < "$HOST_DIR/$f.sql" >/dev/null; check $? "$f re-apply after rollback"
done

step "3. the real-Postgres suite (isolation, concurrency, capability, test organisation, rollbacks)"
cd "$REPO_ROOT" || exit 2
RC=1
# A vitest worker that DIES (no result at all) is retried; a suite that RUNS and fails an assertion is never retried.
for attempt in 1 2 3; do
  LOG="$(SCHEDULING_TEST_DATABASE_URL="$URL" npx vitest run --config vitest.integration.config.ts --reporter=verbose --silent=false scripts/tests/schedulingHost2b0.integration.test.ts 2>&1)"
  RC=$?
  echo "$LOG" | grep -E "^ +(Tests|Test Files) |FAIL|AssertionError|✓|×|CRM-EVIDENCE|CAP-EVIDENCE" | sed 's/^/      /'
  [ -n "${SCHED_REPORT_DIR:-}" ] && echo "$LOG" > "$SCHED_REPORT_DIR/suite-2b0-pg${PG_MAJOR}.log"
  if [ "$RC" -ne 0 ] && echo "$LOG" | grep -q "Worker exited unexpectedly"; then echo "      NOTE: the test worker died (attempt $attempt of 3); retrying after 20 s"; sleep 20; continue; fi
  break
done
check "$RC" "schedulingHost2b0 suite"

step "4. shared 2A schema suite still passes with 120 and 130 applied"
# The 2A suites run standalone-style, exactly as scripts/tests/verify-scheduling-phase2a.sh does: without the host
# foreign keys (110 rolled back by 190). 120 and 130 stay applied, which is the point of this step.
psql_c < "$HOST_DIR/190_brainbase_host_rollback.sql" >/dev/null; check $? "190 rollback (2A suites expect no host foreign keys)"
RC=1
for attempt in 1 2 3; do
  LOG="$(SCHEDULING_TEST_DATABASE_URL="$URL" npx vitest run --config vitest.integration.config.ts packages/scheduling-postgres/tests/schema.integration.test.ts 2>&1)"
  RC=$?
  echo "$LOG" | grep -E "^ +(Tests|Test Files) |FAIL|AssertionError" | sed 's/^/      /'
  if [ "$RC" -ne 0 ] && echo "$LOG" | grep -q "Worker exited unexpectedly"; then echo "      NOTE: the test worker died (attempt $attempt of 3); retrying after 20 s"; sleep 20; continue; fi
  break
done
check "$RC" "2A schema suite with the 2B.0 host files present"

step "5. foreign data untouched"
[ "$(docker exec "$NAME" psql -U postgres -Atc "select name||'|'||email from contacts where id='ld-1'")" = "LD Sentinel|ld@example.test" ]; check $? "LD Tennis contacts sentinel untouched"

echo
if [ "$FAIL" -eq 0 ]; then echo "PHASE 2B.0 DISPOSABLE-POSTGRES PROOF: PASS (postgres $PG_MAJOR)"; else echo "PHASE 2B.0 DISPOSABLE-POSTGRES PROOF: FAIL"; fi
exit "$FAIL"
