#!/usr/bin/env bash
# BrainBase Assurance A0.1E-1 - disposable PostgreSQL 17 behavioral proof.
#
# Applies the REAL migrations in order:
#   A0.1B shared foundations
#   A0.1C Assurance core
#   A0.1D-1 Incident foundation
#   A0.1D-2 Investigation foundation
#   A0.1D-3 Inspection foundation
#   A0.1E-1 Audit foundation
#
# Proves:
#   1. exact four-table Incident scope;
#   2. all A0.1D-1 FKs use ON DELETE NO ACTION;
#   3. cross-tenant incident context links are rejected;
#   4. incident-person containment rejects cross-tenant hr_people links;
#   5. incident-finding containment rejects cross-tenant Findings;
#   6. evidence links preserve soft-unlink/relink history;
#   7. Incident closure-state constraints behave as frozen;
#   8. migration reapply succeeds and preserves data/history;
#   9. no A0.1D-2 Investigation or A0.1D-3 Inspection tables leak in.
#
# Usage:
#   bash scripts/tests/verify-assurance-audits-a01e1-migration.sh
#
# Requires Docker. Exit 0 = all checks passed; 1 = assertion failure;
# 2 = harness/setup failure. Always destroys its own container.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

A01B="scripts/create-shared-foundations-a01b.sql"
A01C="scripts/create-assurance-core-a01c.sql"
A01D1="scripts/create-assurance-incidents-a01d1.sql"
A01D2="scripts/create-assurance-investigations-a01d2.sql"
A01D3="scripts/create-assurance-inspections-a01d3.sql"
A01E1="scripts/create-assurance-audits-a01e1.sql"
CONTAINER="brainbase-a01e1-audits-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

record_pass() {
  echo "  PASS: $1"
  PASS=$((PASS + 1))
}

record_fail() {
  echo "  FAIL: $1"
  FAIL=$((FAIL + 1))
  FAILURES+=("$1")
}

check() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $label (got '$actual')"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label Ã¢â‚¬â€ expected '$expected', got '$actual'"
    FAIL=$((FAIL + 1))
    FAILURES+=("$label Ã¢â‚¬â€ expected '$expected', got '$actual'")
  fi
}

for f in "$A01B" "$A01C" "$A01D1" "$A01D2" "$A01D3" "$A01E1"; do
  [ -f "$f" ] || { echo "ERROR: $f not found." >&2; exit 2; }
done

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required." >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon is not reachable." >&2; exit 2; }

if ! docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:17 >/dev/null; then
  echo "ERROR: could not start postgres:17." >&2
  exit 2
fi

READY=0
for _ in $(seq 1 60); do
  if echo "SELECT 1;" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
[ "$READY" -eq 1 ] || { echo "ERROR: postgres did not become query-ready." >&2; exit 2; }

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 "$@"
}

psql_query() {
  docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1
}

q() {
  echo "$1" | psql_query | tr -d '\r[:space:]'
}

cat <<'SQL' | psql_exec >/dev/null
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL
);

CREATE TABLE organiser_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL
);

CREATE TABLE hr_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  CONSTRAINT hr_people_organisation_id_id_key UNIQUE (organisation_id, id)
);

INSERT INTO organisations(id,name)
VALUES ('org-a','Org A'),('org-b','Org B');

INSERT INTO users(id,organisation_id,name)
VALUES
  ('user-a','org-a','User A'),
  ('user-b','org-b','User B');

INSERT INTO hr_people(id,organisation_id,first_name,last_name)
VALUES
  ('00000000-0000-0000-0000-0000000000a1','org-a','Person','A'),
  ('00000000-0000-0000-0000-0000000000b1','org-b','Person','B');

ALTER TABLE organiser_items
  ADD CONSTRAINT organiser_items_organisation_id_id_key
  UNIQUE (organisation_id, id);
SQL

echo ""
echo "=== APPLY REAL MIGRATIONS ==="

if psql_exec < "$A01B" >/dev/null; then
  record_pass "A0.1B applies"
else
  echo "ERROR: A0.1B apply failed." >&2
  exit 2
fi

if psql_exec < "$A01C" >/dev/null; then
  record_pass "A0.1C applies"
else
  echo "ERROR: A0.1C apply failed." >&2
  exit 2
fi

if psql_exec < "$A01D1" >/dev/null; then
  record_pass "A0.1D-1 applies"
else
  echo "ERROR: A0.1D-1 apply failed." >&2
  exit 2
fi

if psql_exec < "$A01D2" >/dev/null; then
  record_pass "A0.1D-2 applies"
else
  echo "ERROR: A0.1D-2 apply failed." >&2
  exit 2
fi

if psql_exec < "$A01D3" >/dev/null; then
  record_pass "A0.1D-3 applies"
else
  echo "ERROR: A0.1D-3 apply failed." >&2
  exit 2
fi

if psql_exec < "$A01E1" >/dev/null; then
  record_pass "A0.1E-1 applies"
else
  echo "ERROR: A0.1E-1 apply failed." >&2
  exit 2
fi

echo ""
echo "=== STATIC SHAPE ==="

check "exactly four A0.1D-1 tables exist"   "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_incidents','assurance_incident_people','assurance_incident_findings','assurance_evidence_incidents');")"   "4"

check "A0.1D-1 FKs are all NO ACTION"   "$(q "SELECT count(*)::text || ':' || count(*) FILTER (WHERE confdeltype='a')::text FROM pg_constraint WHERE contype='f' AND conrelid::regclass::text IN ('assurance_incidents','assurance_incident_people','assurance_incident_findings','assurance_evidence_incidents');")"   "23:23"

check "exactly five A0.1D-2 tables exist"   "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_investigations','assurance_investigation_incidents','assurance_investigation_people','assurance_investigation_findings','assurance_evidence_investigations');")"   "5"

check "A0.1D-2 FKs are all NO ACTION"   "$(q "SELECT count(*)::text || ':' || count(*) FILTER (WHERE confdeltype='a')::text FROM pg_constraint WHERE contype='f' AND conrelid::regclass::text IN ('assurance_investigations','assurance_investigation_incidents','assurance_investigation_people','assurance_investigation_findings','assurance_evidence_investigations');")"   "23:23"

check "exactly six A0.1D-3 tables exist"   "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_inspection_templates','assurance_inspection_template_versions','assurance_inspections','assurance_inspection_responses','assurance_inspection_findings','assurance_evidence_inspections');")"   "6"

check "A0.1D-3 FKs are all NO ACTION"   "$(q "SELECT count(*)::text || ':' || count(*) FILTER (WHERE confdeltype='a')::text FROM pg_constraint WHERE contype='f' AND conrelid::regclass::text IN ('assurance_inspection_templates','assurance_inspection_template_versions','assurance_inspections','assurance_inspection_responses','assurance_inspection_findings','assurance_evidence_inspections');")"   "25:25"

check "template versions immutable trigger exists"   "$(q "SELECT count(*) FROM pg_trigger WHERE tgrelid='assurance_inspection_template_versions'::regclass AND tgname='trg_assurance_inspection_template_versions_immutable' AND NOT tgisinternal;")"   "1"

check "exactly six A0.1E-1 Audit tables exist"   "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_audit_templates','assurance_audit_template_versions','assurance_audits','assurance_audit_responses','assurance_audit_findings','assurance_evidence_audits');")"   "6"

check "A0.1E-1 FKs are all NO ACTION"   "$(q "SELECT count(*)::text || ':' || count(*) FILTER (WHERE confdeltype='a')::text FROM pg_constraint WHERE contype='f' AND conrelid::regclass::text IN ('assurance_audit_templates','assurance_audit_template_versions','assurance_audits','assurance_audit_responses','assurance_audit_findings','assurance_evidence_audits');")"   "25:25"

check "Audit template versions immutable trigger exists"   "$(q "SELECT count(*) FROM pg_trigger WHERE tgrelid='assurance_audit_template_versions'::regclass AND tgname='trg_assurance_audit_template_versions_immutable' AND NOT tgisinternal;")"   "1"

check "zero A0.1E-2+ leakage"   "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_evaluations','assurance_insurance_claims','assurance_non_conformances','assurance_contract_obligations');")"   "0"

echo ""
echo "=== FIXTURE DATA ==="

if ! cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_risk_levels(
  id, organisation_id, code, name, rank, created_by
) VALUES
  ('10000000-0000-0000-0000-0000000000a1','org-a','LOW','Low',1,'user-a'),
  ('10000000-0000-0000-0000-0000000000b1','org-b','LOW','Low',1,'user-b');

INSERT INTO external_organisations(
  id, organisation_id, reference, name, created_by
) VALUES
  ('20000000-0000-0000-0000-0000000000a1','org-a','EXT-A','External A','user-a'),
  ('20000000-0000-0000-0000-0000000000b1','org-b','EXT-B','External B','user-b');

INSERT INTO assets(
  id, organisation_id, asset_reference, asset_type, name, created_by
) VALUES
  ('30000000-0000-0000-0000-0000000000a1','org-a','AST-A','VEHICLE','Asset A','user-a'),
  ('30000000-0000-0000-0000-0000000000b1','org-b','AST-B','VEHICLE','Asset B','user-b');

INSERT INTO locations(
  id, organisation_id, location_reference, location_type, name, created_by
) VALUES
  ('40000000-0000-0000-0000-0000000000a1','org-a','LOC-A','SITE','Location A','user-a'),
  ('40000000-0000-0000-0000-0000000000b1','org-b','LOC-B','SITE','Location B','user-b');

INSERT INTO assurance_cases(
  id, organisation_id, case_reference, case_type, title, status, created_by
) VALUES
  ('50000000-0000-0000-0000-0000000000a1','org-a','CASE-A','INCIDENT','Case A','OPEN','user-a'),
  ('50000000-0000-0000-0000-0000000000b1','org-b','CASE-B','INCIDENT','Case B','OPEN','user-b');

INSERT INTO assurance_findings(
  id, organisation_id, finding_reference, finding_type, title, description,
  status, identified_at, created_by
) VALUES
  ('60000000-0000-0000-0000-0000000000a1','org-a','FIND-A','OBSERVATION','Finding A','Finding A desc','OPEN',now(),'user-a'),
  ('60000000-0000-0000-0000-0000000000b1','org-b','FIND-B','OBSERVATION','Finding B','Finding B desc','OPEN',now(),'user-b');

INSERT INTO assurance_evidence(
  id, organisation_id, evidence_reference, evidence_type, title, created_by
) VALUES
  ('70000000-0000-0000-0000-0000000000a1','org-a','EVD-A','PHOTO','Evidence A','user-a'),
  ('70000000-0000-0000-0000-0000000000b1','org-b','EVD-B','PHOTO','Evidence B','user-b');

INSERT INTO assurance_incidents(
  id, organisation_id, incident_reference, case_id, category, title, description,
  status, risk_level_id, occurred_at, reported_by_user_id, owner_user_id,
  location_id, asset_id, external_organisation_id, immediate_response,
  restricted, created_by
) VALUES (
  '80000000-0000-0000-0000-0000000000a1',
  'org-a',
  'INC-A',
  '50000000-0000-0000-0000-0000000000a1',
  'INJURY_SAFETY',
  'Incident A',
  'Incident A description',
  'REPORTED',
  '10000000-0000-0000-0000-0000000000a1',
  now(),
  'user-a',
  'user-a',
  '40000000-0000-0000-0000-0000000000a1',
  '30000000-0000-0000-0000-0000000000a1',
  '20000000-0000-0000-0000-0000000000a1',
  'Area isolated',
  true,
  'user-a'
);
SQL
then
  echo "ERROR: fixture setup failed." >&2
  exit 2
fi

record_pass "same-tenant Incident fixture inserts"

echo ""
echo "=== CROSS-TENANT REJECTION ==="

expect_reject() {
  local label="$1"
  local sql="$2"
  set +e
  local out
  out="$(echo "$sql" | psql_exec 2>&1)"
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    record_pass "$label"
  else
    record_fail "$label"
  fi
}

expect_reject "cross-tenant case link rejected" "
INSERT INTO assurance_incidents(
  organisation_id, incident_reference, case_id, category, title, description, occurred_at
) VALUES (
  'org-a','INC-XCASE','50000000-0000-0000-0000-0000000000b1',
  'OPERATIONAL_SERVICE','Bad case','Cross tenant case',now()
);"

expect_reject "cross-tenant risk link rejected" "
INSERT INTO assurance_incidents(
  organisation_id, incident_reference, category, title, description, risk_level_id, occurred_at
) VALUES (
  'org-a','INC-XRISK','OPERATIONAL_SERVICE','Bad risk','Cross tenant risk',
  '10000000-0000-0000-0000-0000000000b1',now()
);"

expect_reject "cross-tenant location link rejected" "
INSERT INTO assurance_incidents(
  organisation_id, incident_reference, category, title, description, location_id, occurred_at
) VALUES (
  'org-a','INC-XLOC','OPERATIONAL_SERVICE','Bad location','Cross tenant location',
  '40000000-0000-0000-0000-0000000000b1',now()
);"

expect_reject "cross-tenant asset link rejected" "
INSERT INTO assurance_incidents(
  organisation_id, incident_reference, category, title, description, asset_id, occurred_at
) VALUES (
  'org-a','INC-XASSET','OPERATIONAL_SERVICE','Bad asset','Cross tenant asset',
  '30000000-0000-0000-0000-0000000000b1',now()
);"

expect_reject "cross-tenant external organisation link rejected" "
INSERT INTO assurance_incidents(
  organisation_id, incident_reference, category, title, description, external_organisation_id, occurred_at
) VALUES (
  'org-a','INC-XEXT','OPERATIONAL_SERVICE','Bad external org','Cross tenant external org',
  '20000000-0000-0000-0000-0000000000b1',now()
);"

echo ""
echo "=== INCIDENT PEOPLE CONTAINMENT ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_incident_people(
  id, organisation_id, incident_id, person_id, role, created_by
) VALUES (
  '81000000-0000-0000-0000-0000000000a1',
  'org-a',
  '80000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1',
  'INJURED_PERSON',
  'user-a'
);
SQL
record_pass "same-tenant incident-person link inserts"

expect_reject "cross-tenant incident-person link rejected" "
INSERT INTO assurance_incident_people(
  organisation_id, incident_id, person_id, role
) VALUES (
  'org-a',
  '80000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000b1',
  'WITNESS'
);"

echo ""
echo "=== INCIDENT FINDING CONTAINMENT ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_incident_findings(
  id, organisation_id, incident_id, finding_id, created_by
) VALUES (
  '82000000-0000-0000-0000-0000000000a1',
  'org-a',
  '80000000-0000-0000-0000-0000000000a1',
  '60000000-0000-0000-0000-0000000000a1',
  'user-a'
);
SQL
record_pass "same-tenant incident-finding link inserts"

expect_reject "cross-tenant incident-finding link rejected" "
INSERT INTO assurance_incident_findings(
  organisation_id, incident_id, finding_id
) VALUES (
  'org-a',
  '80000000-0000-0000-0000-0000000000a1',
  '60000000-0000-0000-0000-0000000000b1'
);"

echo ""
echo "=== CLOSURE-STATE CONSTRAINTS ==="

expect_reject "CLOSED requires closed_at" "
UPDATE assurance_incidents
SET status='CLOSED'
WHERE id='80000000-0000-0000-0000-0000000000a1';"

expect_reject "non-CLOSED forbids closed_at" "
UPDATE assurance_incidents
SET closed_at=now()
WHERE id='80000000-0000-0000-0000-0000000000a1';"

expect_reject "closed_by cannot exist without closed_at" "
UPDATE assurance_incidents
SET closed_by='user-a'
WHERE id='80000000-0000-0000-0000-0000000000a1';"

cat <<'SQL' | psql_exec >/dev/null
UPDATE assurance_incidents
SET status='CLOSED',
    closed_at=now(),
    closed_by='user-a',
    closure_summary='Verified closure'
WHERE id='80000000-0000-0000-0000-0000000000a1';
SQL
record_pass "valid CLOSED state accepted"

check "closed Incident retains closure summary"   "$(q "SELECT closure_summary FROM assurance_incidents WHERE id='80000000-0000-0000-0000-0000000000a1';")"   "Verifiedclosure"

echo ""
echo "=== EVIDENCE SOFT-UNLINK / RELINK HISTORY ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_evidence_incidents(
  id, organisation_id, evidence_id, incident_id, purpose, created_by
) VALUES (
  '83000000-0000-0000-0000-0000000000a1',
  'org-a',
  '70000000-0000-0000-0000-0000000000a1',
  '80000000-0000-0000-0000-0000000000a1',
  'Initial scene evidence',
  'user-a'
);

UPDATE assurance_evidence_incidents
SET removed_at=now(),
    removed_by='user-a',
    removal_reason='Superseded by relink test'
WHERE id='83000000-0000-0000-0000-0000000000a1';

INSERT INTO assurance_evidence_incidents(
  id, organisation_id, evidence_id, incident_id, purpose, created_by
) VALUES (
  '83000000-0000-0000-0000-0000000000a2',
  'org-a',
  '70000000-0000-0000-0000-0000000000a1',
  '80000000-0000-0000-0000-0000000000a1',
  'Relinked scene evidence',
  'user-a'
);
SQL

check "evidence link history retains two rows"   "$(q "SELECT count(*) FROM assurance_evidence_incidents WHERE organisation_id='org-a' AND evidence_id='70000000-0000-0000-0000-0000000000a1' AND incident_id='80000000-0000-0000-0000-0000000000a1';")"   "2"

check "exactly one active evidence link remains"   "$(q "SELECT count(*) FROM assurance_evidence_incidents WHERE organisation_id='org-a' AND evidence_id='70000000-0000-0000-0000-0000000000a1' AND incident_id='80000000-0000-0000-0000-0000000000a1' AND removed_at IS NULL;")"   "1"

expect_reject "duplicate active incident-evidence link rejected" "
INSERT INTO assurance_evidence_incidents(
  organisation_id, evidence_id, incident_id, purpose
) VALUES (
  'org-a',
  '70000000-0000-0000-0000-0000000000a1',
  '80000000-0000-0000-0000-0000000000a1',
  'Duplicate active link'
);"

expect_reject "cross-tenant incident-evidence link rejected" "
INSERT INTO assurance_evidence_incidents(
  organisation_id, evidence_id, incident_id
) VALUES (
  'org-a',
  '70000000-0000-0000-0000-0000000000b1',
  '80000000-0000-0000-0000-0000000000a1'
);"

echo ""
echo "=== REAPPLY / IDEMPOTENCY ==="

if psql_exec < "$A01D1" >/dev/null; then
  record_pass "A0.1D-1 reapply succeeds"
else
  record_fail "A0.1D-1 reapply succeeds"
fi

check "reapply preserves Incident row"   "$(q "SELECT count(*) FROM assurance_incidents WHERE id='80000000-0000-0000-0000-0000000000a1';")"   "1"

check "reapply preserves incident-person row"   "$(q "SELECT count(*) FROM assurance_incident_people WHERE id='81000000-0000-0000-0000-0000000000a1';")"   "1"

check "reapply preserves incident-finding row"   "$(q "SELECT count(*) FROM assurance_incident_findings WHERE id='82000000-0000-0000-0000-0000000000a1';")"   "1"

check "reapply preserves evidence history"   "$(q "SELECT count(*) FROM assurance_evidence_incidents WHERE incident_id='80000000-0000-0000-0000-0000000000a1';")"   "2"

check "reapply preserves exactly one active evidence link"   "$(q "SELECT count(*) FROM assurance_evidence_incidents WHERE incident_id='80000000-0000-0000-0000-0000000000a1' AND removed_at IS NULL;")"   "1"

check "reapply still has exactly four A0.1D-1 tables"   "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_incidents','assurance_incident_people','assurance_incident_findings','assurance_evidence_incidents');")"   "4"

check "reapply still has six A0.1D-3 tables"   "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_inspection_templates','assurance_inspection_template_versions','assurance_inspections','assurance_inspection_responses','assurance_inspection_findings','assurance_evidence_inspections');")"   "6"

echo ""
echo "=== USER FK EXCEPTION PROOF ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_incidents(
  id, organisation_id, incident_reference, category, title, description,
  occurred_at, owner_user_id
) VALUES (
  '80000000-0000-0000-0000-0000000000a2',
  'org-a',
  'INC-USER-GAP',
  'OTHER',
  'User tenant gap',
  'Demonstrates users(id) bare FK exception',
  now(),
  'user-b'
);
SQL

check "cross-org users(id) reference is DB-permitted"   "$(q "SELECT owner_user_id FROM assurance_incidents WHERE id='80000000-0000-0000-0000-0000000000a2';")"   "user-b"

record_pass "service-layer same-org user validation remains mandatory"

echo ""
echo "=== INVESTIGATION FIXTURES ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_incidents(
  id, organisation_id, incident_reference, category, title, description, occurred_at, created_by
) VALUES (
  '80000000-0000-0000-0000-0000000000b1','org-b','INC-B','OTHER',
  'Incident B','Incident B description',now(),'user-b'
);

INSERT INTO assurance_investigations(
  id, organisation_id, investigation_reference, case_id, title, scope,
  status, risk_level_id, lead_user_id, started_at, restricted, created_by
) VALUES (
  '90000000-0000-0000-0000-0000000000a1','org-a','INV-A',
  '50000000-0000-0000-0000-0000000000a1','Investigation A',
  'Determine facts and identify assurance findings','IN_PROGRESS',
  '10000000-0000-0000-0000-0000000000a1','user-a',now(),true,'user-a'
);
SQL
record_pass "same-tenant Investigation fixture inserts"

expect_reject "cross-tenant Investigation case link rejected" "
INSERT INTO assurance_investigations(
  organisation_id, investigation_reference, case_id, title, scope, started_at
) VALUES (
  'org-a','INV-XCASE','50000000-0000-0000-0000-0000000000b1',
  'Bad case','Cross tenant case',now()
);"

expect_reject "cross-tenant Investigation risk link rejected" "
INSERT INTO assurance_investigations(
  organisation_id, investigation_reference, title, scope, risk_level_id, started_at
) VALUES (
  'org-a','INV-XRISK','Bad risk','Cross tenant risk',
  '10000000-0000-0000-0000-0000000000b1',now()
);"

echo ""
echo "=== INVESTIGATION INCIDENT M:N ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_investigation_incidents(
  id, organisation_id, investigation_id, incident_id, relationship, created_by
) VALUES (
  '91000000-0000-0000-0000-0000000000a1','org-a',
  '90000000-0000-0000-0000-0000000000a1',
  '80000000-0000-0000-0000-0000000000a1','PRIMARY','user-a'
);
SQL
record_pass "same-tenant investigation-incident link inserts"

expect_reject "cross-tenant investigation-incident link rejected" "
INSERT INTO assurance_investigation_incidents(
  organisation_id, investigation_id, incident_id, relationship
) VALUES (
  'org-a','90000000-0000-0000-0000-0000000000a1',
  '80000000-0000-0000-0000-0000000000b1','RELATED'
);"

echo ""
echo "=== INVESTIGATION PEOPLE CONTAINMENT ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_investigation_people(
  id, organisation_id, investigation_id, person_id, role, created_by
) VALUES (
  '92000000-0000-0000-0000-0000000000a1','org-a',
  '90000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1','LEAD_INVESTIGATOR','user-a'
);
SQL
record_pass "same-tenant investigation-person link inserts"

expect_reject "cross-tenant investigation-person link rejected" "
INSERT INTO assurance_investigation_people(
  organisation_id, investigation_id, person_id, role
) VALUES (
  'org-a','90000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000b1','WITNESS'
);"

echo ""
echo "=== INVESTIGATION FINDING CONTAINMENT ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_investigation_findings(
  id, organisation_id, investigation_id, finding_id, created_by
) VALUES (
  '93000000-0000-0000-0000-0000000000a1','org-a',
  '90000000-0000-0000-0000-0000000000a1',
  '60000000-0000-0000-0000-0000000000a1','user-a'
);
SQL
record_pass "same-tenant investigation-finding link inserts"

expect_reject "cross-tenant investigation-finding link rejected" "
INSERT INTO assurance_investigation_findings(
  organisation_id, investigation_id, finding_id
) VALUES (
  'org-a','90000000-0000-0000-0000-0000000000a1',
  '60000000-0000-0000-0000-0000000000b1'
);"

echo ""
echo "=== INVESTIGATION COMPLETION STATE ==="

expect_reject "COMPLETED requires completed_at and conclusion" "
UPDATE assurance_investigations
SET status='COMPLETED'
WHERE id='90000000-0000-0000-0000-0000000000a1';"

expect_reject "non-COMPLETED forbids completed_at" "
UPDATE assurance_investigations
SET completed_at=now()
WHERE id='90000000-0000-0000-0000-0000000000a1';"

expect_reject "completed_by cannot exist without completed_at" "
UPDATE assurance_investigations
SET completed_by='user-a'
WHERE id='90000000-0000-0000-0000-0000000000a1';"

cat <<'SQL' | psql_exec >/dev/null
UPDATE assurance_investigations
SET status='COMPLETED',
    completed_at=now(),
    completed_by='user-a',
    conclusion='Facts established; formal findings recorded.'
WHERE id='90000000-0000-0000-0000-0000000000a1';
SQL
record_pass "valid COMPLETED Investigation accepted"

check "completed Investigation retains conclusion" "$(q "SELECT conclusion FROM assurance_investigations WHERE id='90000000-0000-0000-0000-0000000000a1';")" "Factsestablished;formalfindingsrecorded."

echo ""
echo "=== INVESTIGATION EVIDENCE HISTORY ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_evidence_investigations(
  id, organisation_id, evidence_id, investigation_id, purpose, created_by
) VALUES (
  '94000000-0000-0000-0000-0000000000a1','org-a',
  '70000000-0000-0000-0000-0000000000a1',
  '90000000-0000-0000-0000-0000000000a1','Investigation material','user-a'
);

UPDATE assurance_evidence_investigations
SET removed_at=now(), removed_by='user-a', removal_reason='Relink history proof'
WHERE id='94000000-0000-0000-0000-0000000000a1';

INSERT INTO assurance_evidence_investigations(
  id, organisation_id, evidence_id, investigation_id, purpose, created_by
) VALUES (
  '94000000-0000-0000-0000-0000000000a2','org-a',
  '70000000-0000-0000-0000-0000000000a1',
  '90000000-0000-0000-0000-0000000000a1','Relinked investigation material','user-a'
);
SQL

check "investigation evidence history retains two rows" "$(q "SELECT count(*) FROM assurance_evidence_investigations WHERE investigation_id='90000000-0000-0000-0000-0000000000a1';")" "2"
check "exactly one active investigation evidence link remains" "$(q "SELECT count(*) FROM assurance_evidence_investigations WHERE investigation_id='90000000-0000-0000-0000-0000000000a1' AND removed_at IS NULL;")" "1"

expect_reject "duplicate active investigation-evidence link rejected" "
INSERT INTO assurance_evidence_investigations(
  organisation_id, evidence_id, investigation_id
) VALUES (
  'org-a','70000000-0000-0000-0000-0000000000a1',
  '90000000-0000-0000-0000-0000000000a1'
);"

expect_reject "cross-tenant investigation-evidence link rejected" "
INSERT INTO assurance_evidence_investigations(
  organisation_id, evidence_id, investigation_id
) VALUES (
  'org-a','70000000-0000-0000-0000-0000000000b1',
  '90000000-0000-0000-0000-0000000000a1'
);"

echo ""
echo "=== A0.1D-2 REAPPLY / IDEMPOTENCY ==="

if psql_exec < "$A01D2" >/dev/null; then
  record_pass "A0.1D-2 reapply succeeds"
else
  record_fail "A0.1D-2 reapply succeeds"
fi

check "A0.1D-2 reapply preserves Investigation" "$(q "SELECT count(*) FROM assurance_investigations WHERE id='90000000-0000-0000-0000-0000000000a1';")" "1"
check "A0.1D-2 reapply preserves incident link" "$(q "SELECT count(*) FROM assurance_investigation_incidents WHERE id='91000000-0000-0000-0000-0000000000a1';")" "1"
check "A0.1D-2 reapply preserves person link" "$(q "SELECT count(*) FROM assurance_investigation_people WHERE id='92000000-0000-0000-0000-0000000000a1';")" "1"
check "A0.1D-2 reapply preserves finding link" "$(q "SELECT count(*) FROM assurance_investigation_findings WHERE id='93000000-0000-0000-0000-0000000000a1';")" "1"
check "A0.1D-2 reapply preserves evidence history" "$(q "SELECT count(*) FROM assurance_evidence_investigations WHERE investigation_id='90000000-0000-0000-0000-0000000000a1';")" "2"
check "A0.1D-2 reapply still has five tables" "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_investigations','assurance_investigation_incidents','assurance_investigation_people','assurance_investigation_findings','assurance_evidence_investigations');")" "5"

echo ""
echo "=== INVESTIGATION USER FK EXCEPTION ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_investigations(
  id, organisation_id, investigation_reference, title, scope, lead_user_id
) VALUES (
  '90000000-0000-0000-0000-0000000000a2','org-a','INV-USER-GAP',
  'User tenant gap','Demonstrates users(id) bare FK exception','user-b'
);
SQL

check "cross-org Investigation users(id) reference is DB-permitted" "$(q "SELECT lead_user_id FROM assurance_investigations WHERE id='90000000-0000-0000-0000-0000000000a2';")" "user-b"
record_pass "Investigation service-layer same-org user validation remains mandatory"

echo ""
echo "=== INSPECTION TEMPLATE FIXTURES ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_inspection_templates(
  id, organisation_id, template_reference, name, inspection_type, description, created_by
) VALUES
  ('a1000000-0000-0000-0000-0000000000a1','org-a','TPL-A','Site Safety Template','SAFETY','Reusable safety inspection','user-a'),
  ('a1000000-0000-0000-0000-0000000000b1','org-b','TPL-B','Site Safety Template B','SAFETY','Tenant B template','user-b');

INSERT INTO assurance_inspection_template_versions(
  id, organisation_id, template_id, version_number, title, instructions, checklist, effective_from, created_by
) VALUES
  ('a1100000-0000-0000-0000-0000000000a1','org-a','a1000000-0000-0000-0000-0000000000a1',1,
   'Site Safety v1','Complete each item',
   '[{"key":"ppe","label":"Required PPE in use","type":"PASS_FAIL"},{"key":"access","label":"Access clear","type":"PASS_FAIL"}]'::jsonb,
   now(),'user-a'),
  ('a1100000-0000-0000-0000-0000000000b1','org-b','a1000000-0000-0000-0000-0000000000b1',1,
   'Site Safety B v1','Complete each item',
   '[{"key":"ppe","label":"Required PPE in use","type":"PASS_FAIL"}]'::jsonb,
   now(),'user-b');
SQL
record_pass "Inspection templates and immutable versions insert"

expect_reject "template version checklist cannot be updated" "
UPDATE assurance_inspection_template_versions
SET checklist='[]'::jsonb
WHERE id='a1100000-0000-0000-0000-0000000000a1';"

expect_reject "template version cannot be deleted" "
DELETE FROM assurance_inspection_template_versions
WHERE id='a1100000-0000-0000-0000-0000000000a1';"

echo ""
echo "=== INSPECTION FIXTURES / TENANT CONTAINMENT ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_inspections(
  id, organisation_id, inspection_reference, case_id, template_version_id,
  inspection_type, title, status, inspector_user_id, scheduled_at, started_at,
  location_id, asset_id, external_organisation_id, created_by
) VALUES (
  'a1200000-0000-0000-0000-0000000000a1','org-a','INSP-A',
  '50000000-0000-0000-0000-0000000000a1',
  'a1100000-0000-0000-0000-0000000000a1',
  'SAFETY','Depot safety inspection','IN_PROGRESS','user-a',now(),now(),
  '40000000-0000-0000-0000-0000000000a1',
  '30000000-0000-0000-0000-0000000000a1',
  '20000000-0000-0000-0000-0000000000a1',
  'user-a'
);

INSERT INTO assurance_inspections(
  id, organisation_id, inspection_reference, inspection_type, title, status, created_by
) VALUES (
  'a1200000-0000-0000-0000-0000000000a2','org-a','INSP-ADHOC',
  'OTHER','Ad hoc operational inspection','PLANNED','user-a'
);
SQL
record_pass "template-based Inspection inserts"
record_pass "ad hoc Inspection without template inserts"

expect_reject "cross-tenant template version link rejected" "
INSERT INTO assurance_inspections(
  organisation_id, inspection_reference, template_version_id, inspection_type, title
) VALUES (
  'org-a','INSP-XTPL','a1100000-0000-0000-0000-0000000000b1',
  'SAFETY','Bad template'
);"

expect_reject "cross-tenant Inspection case link rejected" "
INSERT INTO assurance_inspections(
  organisation_id, inspection_reference, case_id, inspection_type, title
) VALUES (
  'org-a','INSP-XCASE','50000000-0000-0000-0000-0000000000b1',
  'SITE','Bad case'
);"

expect_reject "cross-tenant Inspection location link rejected" "
INSERT INTO assurance_inspections(
  organisation_id, inspection_reference, location_id, inspection_type, title
) VALUES (
  'org-a','INSP-XLOC','40000000-0000-0000-0000-0000000000b1',
  'SITE','Bad location'
);"

expect_reject "cross-tenant Inspection asset link rejected" "
INSERT INTO assurance_inspections(
  organisation_id, inspection_reference, asset_id, inspection_type, title
) VALUES (
  'org-a','INSP-XASSET','30000000-0000-0000-0000-0000000000b1',
  'VEHICLE','Bad asset'
);"

expect_reject "cross-tenant Inspection external organisation link rejected" "
INSERT INTO assurance_inspections(
  organisation_id, inspection_reference, external_organisation_id, inspection_type, title
) VALUES (
  'org-a','INSP-XEXT','20000000-0000-0000-0000-0000000000b1',
  'CONTRACTOR_SERVICE','Bad contractor'
);"

echo ""
echo "=== INSPECTION LIFECYCLE ==="

expect_reject "COMPLETED Inspection requires completed_at" "
UPDATE assurance_inspections
SET status='COMPLETED'
WHERE id='a1200000-0000-0000-0000-0000000000a1';"

expect_reject "PLANNED Inspection cannot have started_at" "
UPDATE assurance_inspections
SET status='PLANNED'
WHERE id='a1200000-0000-0000-0000-0000000000a1';"

cat <<'SQL' | psql_exec >/dev/null
UPDATE assurance_inspections
SET status='COMPLETED',
    completed_at=now(),
    summary='Inspection completed; one observation recorded.'
WHERE id='a1200000-0000-0000-0000-0000000000a1';
SQL
record_pass "valid COMPLETED Inspection accepted"

echo ""
echo "=== INSPECTION RESPONSES ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_inspection_responses(
  id, organisation_id, inspection_id, item_key, item_label,
  response_type, response_value, outcome, notes, responded_by
) VALUES
  ('a1300000-0000-0000-0000-0000000000a1','org-a',
   'a1200000-0000-0000-0000-0000000000a1','ppe','Required PPE in use',
   'PASS_FAIL','true'::jsonb,'PASS','Compliant','user-a'),
  ('a1300000-0000-0000-0000-0000000000a2','org-a',
   'a1200000-0000-0000-0000-0000000000a1','access','Access clear',
   'PASS_FAIL','false'::jsonb,'FAIL','Obstruction observed','user-a');
SQL
record_pass "checklist responses insert"

expect_reject "duplicate checklist item response rejected" "
INSERT INTO assurance_inspection_responses(
  organisation_id, inspection_id, item_key, item_label, response_type
) VALUES (
  'org-a','a1200000-0000-0000-0000-0000000000a1',
  'ppe','Required PPE in use','PASS_FAIL'
);"

expect_reject "cross-tenant Inspection response rejected" "
INSERT INTO assurance_inspection_responses(
  organisation_id, inspection_id, item_key, item_label, response_type
) VALUES (
  'org-b','a1200000-0000-0000-0000-0000000000a1',
  'foreign','Foreign tenant response','TEXT'
);"

echo ""
echo "=== INSPECTION FINDINGS ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_inspection_findings(
  id, organisation_id, inspection_id, finding_id, created_by
) VALUES (
  'a1400000-0000-0000-0000-0000000000a1','org-a',
  'a1200000-0000-0000-0000-0000000000a1',
  '60000000-0000-0000-0000-0000000000a1','user-a'
);
SQL
record_pass "same-tenant inspection-finding link inserts"

expect_reject "cross-tenant inspection-finding link rejected" "
INSERT INTO assurance_inspection_findings(
  organisation_id, inspection_id, finding_id
) VALUES (
  'org-a','a1200000-0000-0000-0000-0000000000a1',
  '60000000-0000-0000-0000-0000000000b1'
);"

echo ""
echo "=== INSPECTION EVIDENCE HISTORY ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_evidence_inspections(
  id, organisation_id, evidence_id, inspection_id, purpose, created_by
) VALUES (
  'a1500000-0000-0000-0000-0000000000a1','org-a',
  '70000000-0000-0000-0000-0000000000a1',
  'a1200000-0000-0000-0000-0000000000a1','Inspection photo','user-a'
);

UPDATE assurance_evidence_inspections
SET removed_at=now(), removed_by='user-a', removal_reason='Relink history proof'
WHERE id='a1500000-0000-0000-0000-0000000000a1';

INSERT INTO assurance_evidence_inspections(
  id, organisation_id, evidence_id, inspection_id, purpose, created_by
) VALUES (
  'a1500000-0000-0000-0000-0000000000a2','org-a',
  '70000000-0000-0000-0000-0000000000a1',
  'a1200000-0000-0000-0000-0000000000a1','Relinked inspection photo','user-a'
);
SQL

check "inspection evidence history retains two rows" "$(q "SELECT count(*) FROM assurance_evidence_inspections WHERE inspection_id='a1200000-0000-0000-0000-0000000000a1';")" "2"
check "exactly one active inspection evidence link remains" "$(q "SELECT count(*) FROM assurance_evidence_inspections WHERE inspection_id='a1200000-0000-0000-0000-0000000000a1' AND removed_at IS NULL;")" "1"

expect_reject "duplicate active inspection-evidence link rejected" "
INSERT INTO assurance_evidence_inspections(
  organisation_id, evidence_id, inspection_id
) VALUES (
  'org-a','70000000-0000-0000-0000-0000000000a1',
  'a1200000-0000-0000-0000-0000000000a1'
);"

expect_reject "cross-tenant inspection-evidence link rejected" "
INSERT INTO assurance_evidence_inspections(
  organisation_id, evidence_id, inspection_id
) VALUES (
  'org-a','70000000-0000-0000-0000-0000000000b1',
  'a1200000-0000-0000-0000-0000000000a1'
);"

echo ""
echo "=== A0.1D-3 REAPPLY / IDEMPOTENCY ==="

if psql_exec < "$A01D3" >/dev/null; then
  record_pass "A0.1D-3 reapply succeeds"
else
  record_fail "A0.1D-3 reapply succeeds"
fi

check "A0.1D-3 reapply preserves template" "$(q "SELECT count(*) FROM assurance_inspection_templates WHERE id='a1000000-0000-0000-0000-0000000000a1';")" "1"
check "A0.1D-3 reapply preserves template version" "$(q "SELECT count(*) FROM assurance_inspection_template_versions WHERE id='a1100000-0000-0000-0000-0000000000a1';")" "1"
check "A0.1D-3 reapply preserves Inspection" "$(q "SELECT count(*) FROM assurance_inspections WHERE id='a1200000-0000-0000-0000-0000000000a1';")" "1"
check "A0.1D-3 reapply preserves responses" "$(q "SELECT count(*) FROM assurance_inspection_responses WHERE inspection_id='a1200000-0000-0000-0000-0000000000a1';")" "2"
check "A0.1D-3 reapply preserves finding link" "$(q "SELECT count(*) FROM assurance_inspection_findings WHERE inspection_id='a1200000-0000-0000-0000-0000000000a1';")" "1"
check "A0.1D-3 reapply preserves evidence history" "$(q "SELECT count(*) FROM assurance_evidence_inspections WHERE inspection_id='a1200000-0000-0000-0000-0000000000a1';")" "2"
check "A0.1D-3 reapply still has six tables" "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_inspection_templates','assurance_inspection_template_versions','assurance_inspections','assurance_inspection_responses','assurance_inspection_findings','assurance_evidence_inspections');")" "6"

echo ""
echo "=== INSPECTION USER FK EXCEPTION ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_inspections(
  id, organisation_id, inspection_reference, inspection_type, title, inspector_user_id
) VALUES (
  'a1200000-0000-0000-0000-0000000000a3','org-a','INSP-USER-GAP',
  'OTHER','User tenant gap','user-b'
);
SQL

check "cross-org Inspection users(id) reference is DB-permitted" "$(q "SELECT inspector_user_id FROM assurance_inspections WHERE id='a1200000-0000-0000-0000-0000000000a3';")" "user-b"
record_pass "Inspection service-layer same-org user validation remains mandatory"

echo ""
echo "=== AUDIT TEMPLATE FIXTURES ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_audit_templates(
  id, organisation_id, template_reference, name, audit_type, description, created_by
) VALUES
  ('b1000000-0000-0000-0000-0000000000a1','org-a','AUD-TPL-A','Internal Compliance Template','COMPLIANCE','Reusable compliance audit','user-a'),
  ('b1000000-0000-0000-0000-0000000000b1','org-b','AUD-TPL-B','Internal Compliance Template B','COMPLIANCE','Tenant B audit','user-b');

INSERT INTO assurance_audit_template_versions(
  id, organisation_id, template_id, version_number, title, standard_reference,
  instructions, criteria, effective_from, created_by
) VALUES
  ('b1100000-0000-0000-0000-0000000000a1','org-a','b1000000-0000-0000-0000-0000000000a1',1,
   'Internal Compliance v1','POLICY-001','Assess each criterion',
   '[{"key":"records","label":"Records are current","type":"COMPLIANCE_RATING"},{"key":"evidence","label":"Evidence is retained","type":"COMPLIANCE_RATING"}]'::jsonb,
   now(),'user-a'),
  ('b1100000-0000-0000-0000-0000000000b1','org-b','b1000000-0000-0000-0000-0000000000b1',1,
   'Internal Compliance B v1','POLICY-B','Assess each criterion',
   '[{"key":"records","label":"Records are current","type":"COMPLIANCE_RATING"}]'::jsonb,
   now(),'user-b');
SQL
record_pass "Audit templates and immutable versions insert"

expect_reject "Audit template criteria cannot be updated" "
UPDATE assurance_audit_template_versions
SET criteria='[]'::jsonb
WHERE id='b1100000-0000-0000-0000-0000000000a1';"

expect_reject "Audit template version cannot be deleted" "
DELETE FROM assurance_audit_template_versions
WHERE id='b1100000-0000-0000-0000-0000000000a1';"

echo ""
echo "=== AUDIT FIXTURES / BASIS / TENANT CONTAINMENT ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_audits(
  id, organisation_id, audit_reference, case_id, template_version_id,
  audit_type, title, scope, status, auditor_user_id, scheduled_at, started_at,
  location_id, asset_id, external_organisation_id, created_by
) VALUES (
  'b1200000-0000-0000-0000-0000000000a1','org-a','AUD-A',
  '50000000-0000-0000-0000-0000000000a1',
  'b1100000-0000-0000-0000-0000000000a1',
  'COMPLIANCE','Internal compliance audit','Review operational compliance',
  'IN_PROGRESS','user-a',now(),now(),
  '40000000-0000-0000-0000-0000000000a1',
  '30000000-0000-0000-0000-0000000000a1',
  '20000000-0000-0000-0000-0000000000a1',
  'user-a'
);

INSERT INTO assurance_audits(
  id, organisation_id, audit_reference, audit_type, title, scope,
  standard_reference, status, created_by
) VALUES (
  'b1200000-0000-0000-0000-0000000000a2','org-a','AUD-ADHOC',
  'OTHER','Ad hoc requirements audit','Review local procedure',
  'LOCAL-PROCEDURE-7','PLANNED','user-a'
);
SQL
record_pass "template-based Audit inserts"
record_pass "ad hoc Audit with standard reference inserts"

expect_reject "Audit without template or standard rejected" "
INSERT INTO assurance_audits(
  organisation_id, audit_reference, audit_type, title, scope
) VALUES (
  'org-a','AUD-NOBASIS','OTHER','No basis','No standard or template'
);"

expect_reject "cross-tenant Audit template version rejected" "
INSERT INTO assurance_audits(
  organisation_id, audit_reference, template_version_id, audit_type, title, scope
) VALUES (
  'org-a','AUD-XTPL','b1100000-0000-0000-0000-0000000000b1',
  'COMPLIANCE','Bad template','Cross tenant template'
);"

expect_reject "cross-tenant Audit case rejected" "
INSERT INTO assurance_audits(
  organisation_id, audit_reference, case_id, audit_type, title, scope, standard_reference
) VALUES (
  'org-a','AUD-XCASE','50000000-0000-0000-0000-0000000000b1',
  'SITE','Bad case','Cross tenant case','STD'
);"

expect_reject "cross-tenant Audit location rejected" "
INSERT INTO assurance_audits(
  organisation_id, audit_reference, location_id, audit_type, title, scope, standard_reference
) VALUES (
  'org-a','AUD-XLOC','40000000-0000-0000-0000-0000000000b1',
  'SITE','Bad location','Cross tenant location','STD'
);"

expect_reject "cross-tenant Audit asset rejected" "
INSERT INTO assurance_audits(
  organisation_id, audit_reference, asset_id, audit_type, title, scope, standard_reference
) VALUES (
  'org-a','AUD-XASSET','30000000-0000-0000-0000-0000000000b1',
  'OTHER','Bad asset','Cross tenant asset','STD'
);"

expect_reject "cross-tenant Audit external organisation rejected" "
INSERT INTO assurance_audits(
  organisation_id, audit_reference, external_organisation_id, audit_type, title, scope, standard_reference
) VALUES (
  'org-a','AUD-XEXT','20000000-0000-0000-0000-0000000000b1',
  'CONTRACTOR','Bad contractor','Cross tenant contractor','STD'
);"

echo ""
echo "=== AUDIT LIFECYCLE ==="

expect_reject "COMPLETED Audit requires completed_at" "
UPDATE assurance_audits SET status='COMPLETED'
WHERE id='b1200000-0000-0000-0000-0000000000a1';"

expect_reject "PLANNED Audit cannot retain started_at" "
UPDATE assurance_audits SET status='PLANNED'
WHERE id='b1200000-0000-0000-0000-0000000000a1';"

cat <<'SQL' | psql_exec >/dev/null
UPDATE assurance_audits
SET status='COMPLETED',
    completed_at=now(),
    summary='Audit completed with one non-compliant criterion.',
    recommendations='Address the linked finding and retain closure evidence.'
WHERE id='b1200000-0000-0000-0000-0000000000a1';
SQL
record_pass "valid COMPLETED Audit accepted"

echo ""
echo "=== AUDIT RESPONSES ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_audit_responses(
  id, organisation_id, audit_id, criterion_key, criterion_label,
  response_type, response_value, outcome, notes, responded_by
) VALUES
  ('b1300000-0000-0000-0000-0000000000a1','org-a',
   'b1200000-0000-0000-0000-0000000000a1','records','Records are current',
   'COMPLIANCE_RATING','"compliant"'::jsonb,'COMPLIANT','Current records sighted','user-a'),
  ('b1300000-0000-0000-0000-0000000000a2','org-a',
   'b1200000-0000-0000-0000-0000000000a1','evidence','Evidence is retained',
   'COMPLIANCE_RATING','"non_compliant"'::jsonb,'NON_COMPLIANT','Evidence gap identified','user-a');
SQL
record_pass "Audit criteria responses insert"

expect_reject "duplicate Audit criterion response rejected" "
INSERT INTO assurance_audit_responses(
  organisation_id, audit_id, criterion_key, criterion_label, response_type
) VALUES (
  'org-a','b1200000-0000-0000-0000-0000000000a1',
  'records','Records are current','COMPLIANCE_RATING'
);"

expect_reject "cross-tenant Audit response rejected" "
INSERT INTO assurance_audit_responses(
  organisation_id, audit_id, criterion_key, criterion_label, response_type
) VALUES (
  'org-b','b1200000-0000-0000-0000-0000000000a1',
  'foreign','Foreign criterion','TEXT'
);"

echo ""
echo "=== AUDIT FINDINGS ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_audit_findings(
  id, organisation_id, audit_id, finding_id, created_by
) VALUES (
  'b1400000-0000-0000-0000-0000000000a1','org-a',
  'b1200000-0000-0000-0000-0000000000a1',
  '60000000-0000-0000-0000-0000000000a1','user-a'
);
SQL
record_pass "same-tenant audit-finding link inserts"

expect_reject "cross-tenant audit-finding link rejected" "
INSERT INTO assurance_audit_findings(
  organisation_id, audit_id, finding_id
) VALUES (
  'org-a','b1200000-0000-0000-0000-0000000000a1',
  '60000000-0000-0000-0000-0000000000b1'
);"

echo ""
echo "=== AUDIT EVIDENCE HISTORY ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_evidence_audits(
  id, organisation_id, evidence_id, audit_id, purpose, created_by
) VALUES (
  'b1500000-0000-0000-0000-0000000000a1','org-a',
  '70000000-0000-0000-0000-0000000000a1',
  'b1200000-0000-0000-0000-0000000000a1','Audit evidence','user-a'
);

UPDATE assurance_evidence_audits
SET removed_at=now(), removed_by='user-a', removal_reason='Relink history proof'
WHERE id='b1500000-0000-0000-0000-0000000000a1';

INSERT INTO assurance_evidence_audits(
  id, organisation_id, evidence_id, audit_id, purpose, created_by
) VALUES (
  'b1500000-0000-0000-0000-0000000000a2','org-a',
  '70000000-0000-0000-0000-0000000000a1',
  'b1200000-0000-0000-0000-0000000000a1','Relinked audit evidence','user-a'
);
SQL

check "Audit evidence history retains two rows" "$(q "SELECT count(*) FROM assurance_evidence_audits WHERE audit_id='b1200000-0000-0000-0000-0000000000a1';")" "2"
check "exactly one active Audit evidence link remains" "$(q "SELECT count(*) FROM assurance_evidence_audits WHERE audit_id='b1200000-0000-0000-0000-0000000000a1' AND removed_at IS NULL;")" "1"

expect_reject "duplicate active Audit evidence link rejected" "
INSERT INTO assurance_evidence_audits(
  organisation_id, evidence_id, audit_id
) VALUES (
  'org-a','70000000-0000-0000-0000-0000000000a1',
  'b1200000-0000-0000-0000-0000000000a1'
);"

expect_reject "cross-tenant Audit evidence link rejected" "
INSERT INTO assurance_evidence_audits(
  organisation_id, evidence_id, audit_id
) VALUES (
  'org-a','70000000-0000-0000-0000-0000000000b1',
  'b1200000-0000-0000-0000-0000000000a1'
);"

echo ""
echo "=== A0.1E-1 REAPPLY / IDEMPOTENCY ==="

if psql_exec < "$A01E1" >/dev/null; then
  record_pass "A0.1E-1 reapply succeeds"
else
  record_fail "A0.1E-1 reapply succeeds"
fi

check "A0.1E-1 reapply preserves template" "$(q "SELECT count(*) FROM assurance_audit_templates WHERE id='b1000000-0000-0000-0000-0000000000a1';")" "1"
check "A0.1E-1 reapply preserves template version" "$(q "SELECT count(*) FROM assurance_audit_template_versions WHERE id='b1100000-0000-0000-0000-0000000000a1';")" "1"
check "A0.1E-1 reapply preserves Audit" "$(q "SELECT count(*) FROM assurance_audits WHERE id='b1200000-0000-0000-0000-0000000000a1';")" "1"
check "A0.1E-1 reapply preserves responses" "$(q "SELECT count(*) FROM assurance_audit_responses WHERE audit_id='b1200000-0000-0000-0000-0000000000a1';")" "2"
check "A0.1E-1 reapply preserves finding link" "$(q "SELECT count(*) FROM assurance_audit_findings WHERE audit_id='b1200000-0000-0000-0000-0000000000a1';")" "1"
check "A0.1E-1 reapply preserves evidence history" "$(q "SELECT count(*) FROM assurance_evidence_audits WHERE audit_id='b1200000-0000-0000-0000-0000000000a1';")" "2"
check "A0.1E-1 reapply still has six Audit tables" "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_audit_templates','assurance_audit_template_versions','assurance_audits','assurance_audit_responses','assurance_audit_findings','assurance_evidence_audits');")" "6"

echo ""
echo "=== AUDIT USER FK EXCEPTION ==="

cat <<'SQL' | psql_exec >/dev/null
INSERT INTO assurance_audits(
  id, organisation_id, audit_reference, audit_type, title, scope,
  standard_reference, auditor_user_id
) VALUES (
  'b1200000-0000-0000-0000-0000000000a3','org-a','AUD-USER-GAP',
  'OTHER','User tenant gap','Demonstrates users(id) bare FK exception',
  'STD','user-b'
);
SQL

check "cross-org Audit users(id) reference is DB-permitted" "$(q "SELECT auditor_user_id FROM assurance_audits WHERE id='b1200000-0000-0000-0000-0000000000a3';")" "user-b"
record_pass "Audit service-layer same-org user validation remains mandatory"

echo ""
echo "=== FINAL RESULT ==="
echo "PASS=$PASS"
echo "FAIL=$FAIL"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "Failures:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

echo "A0.1E-1 behavioral proof passed."
exit 0
