#!/usr/bin/env bash
# BrainBase Assurance A0.1D-1 — disposable PostgreSQL 17 behavioral proof.
#
# Applies the REAL migrations in order:
#   A0.1B shared foundations
#   A0.1C Assurance core
#   A0.1D-1 Incident foundation
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
#   bash scripts/tests/verify-assurance-incidents-a01d1-migration.sh
#
# Requires Docker. Exit 0 = all checks passed; 1 = assertion failure;
# 2 = harness/setup failure. Always destroys its own container.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

A01B="scripts/create-shared-foundations-a01b.sql"
A01C="scripts/create-assurance-core-a01c.sql"
A01D1="scripts/create-assurance-incidents-a01d1.sql"
CONTAINER="brainbase-a01d1-incidents-$$"
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
    echo "  FAIL: $label — expected '$expected', got '$actual'"
    FAIL=$((FAIL + 1))
    FAILURES+=("$label — expected '$expected', got '$actual'")
  fi
}

for f in "$A01B" "$A01C" "$A01D1"; do
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

echo ""
echo "=== STATIC SHAPE ==="

check "exactly four A0.1D-1 tables exist"   "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_incidents','assurance_incident_people','assurance_incident_findings','assurance_evidence_incidents');")"   "4"

check "A0.1D-1 FKs are all NO ACTION"   "$(q "SELECT count(*)::text || ':' || count(*) FILTER (WHERE confdeltype='a')::text FROM pg_constraint WHERE contype='f' AND conrelid::regclass::text IN ('assurance_incidents','assurance_incident_people','assurance_incident_findings','assurance_evidence_incidents');")"   "23:23"

check "zero A0.1D-2/A0.1D-3 leakage"   "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_investigations','assurance_investigation_incidents','assurance_investigation_people','assurance_inspections','assurance_inspection_templates','assurance_inspection_template_versions','assurance_inspection_responses');")"   "0"

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

check "reapply still has zero A0.1D-2/A0.1D-3 leakage"   "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_investigations','assurance_investigation_incidents','assurance_investigation_people','assurance_inspections','assurance_inspection_templates','assurance_inspection_template_versions','assurance_inspection_responses');")"   "0"

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

echo "A0.1D-1 behavioral proof passed."
exit 0
