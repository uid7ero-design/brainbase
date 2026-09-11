#!/usr/bin/env bash
# HR-1 People Foundation — real-Postgres migration proof for
# scripts/create-hr-teams.sql, scripts/create-hr-people.sql,
# scripts/create-hr-administrators.sql, and scripts/seed-hr-module-
# registry.sql. Same disposable-container harness pattern as
# scripts/tests/verify-migrate-modules-registry-alignment.sh — real
# Postgres, not a mock.
#
# WHAT THIS PROVES: (1) a fresh bootstrap creates all three hr_* tables
# in the exact intended shape, with the exact intended FKs/constraints;
# (2) hr_teams.manager_person_id's deferred FK to hr_people is
# correctly completed by create-hr-people.sql's own ALTER TABLE, and is
# idempotent on re-run; (3) the whole sequence is safe to re-run
# end-to-end with zero data loss/duplication; (4) real FK/CHECK
# enforcement: a reference to a NON-EXISTENT row (team_id/manager_
# person_id/linked_user_id) is rejected, self-management is rejected,
# and the (organisation_id, linked_user_id) uniqueness rule behaves
# exactly as designed (blocks a duplicate real link within one org,
# never blocks two unlinked/NULL rows); (4b) DOCUMENTED LIMITATION,
# proven explicitly, not merely asserted: none of team_id/manager_
# person_id/linked_user_id (on either hr_people or hr_teams) has any
# DB-level same-organisation check — a plain FK only proves the
# referenced row exists SOMEWHERE, in any organisation, so a direct SQL
# write bypassing the API CAN create a cross-organisation reference
# and it will satisfy every current DB constraint. Same-organisation
# enforcement for all four of these relationships lives entirely in the
# API layer (lib/hr/validation.ts's isTeamInOrganisation/
# isPersonInOrganisation/isUserInOrganisation, called by every write
# route before its SQL write — see tests/containment/hrPeopleRoute.
# test.ts's and hrTeamsRoute.test.ts's own "tenant isolation" coverage
# for proof every API route rejects it). This is an accepted, explicit
# HR-1 design decision (matching how every other cross-org check in
# this codebase already works — none of them uses a DB trigger either),
# not an oversight; (5) the
# module registry seed registers 'people' additively, granting no
# organisation any entitlement.
#
# USAGE:
#   bash scripts/tests/verify-hr-people-foundation-migration.sh

set -uo pipefail

CONTAINER="hr1-migration-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 2
fi

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

echo "Starting disposable postgres:16 ($CONTAINER)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16 >/dev/null

READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: postgres did not become ready within 30s." >&2
  exit 2
fi

psql_exec() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1; }
psql_query() { docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1; }

echo ""
echo "=== SETUP: minimal organisations/users/modules fixtures ==="
cat <<'SQL' | psql_exec
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, name TEXT);
CREATE TABLE modules (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO organisations (id, name) VALUES ('org-a', 'Org A'), ('org-b', 'Org B');
INSERT INTO users (id, organisation_id, name) VALUES
  ('user-a1', 'org-a', 'Org A User 1'), ('user-a2', 'org-a', 'Org A User 2'), ('user-b1', 'org-b', 'Org B User 1');
SQL

echo ""
echo "=== APPLY: create-hr-teams.sql, create-hr-people.sql, create-hr-administrators.sql, seed-hr-module-registry.sql ==="
psql_exec < scripts/create-hr-teams.sql
psql_exec < scripts/create-hr-people.sql
psql_exec < scripts/create-hr-administrators.sql
psql_exec < scripts/seed-hr-module-registry.sql

echo ""
echo "=== SCHEMA SHAPE ==="
TEAMS_COLS="$(echo "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='hr_teams';" | psql_query)"
check "hr_teams columns" "$TEAMS_COLS" "id,organisation_id,name,description,manager_person_id,created_at,updated_at"

PEOPLE_COLS="$(echo "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='hr_people';" | psql_query)"
check "hr_people columns" "$PEOPLE_COLS" "id,organisation_id,linked_user_id,first_name,last_name,preferred_name,work_email,work_phone,job_title,worker_type,employment_status,team_id,manager_person_id,start_date,end_date,created_at,updated_at"

ADMINS_COLS="$(echo "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='hr_administrators';" | psql_query)"
check "hr_administrators columns" "$ADMINS_COLS" "id,organisation_id,user_id,created_at,created_by"

TEAMS_FK="$(echo "
SELECT ccu.table_name || '.' || ccu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_name='hr_teams' AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='manager_person_id';
" | psql_query | tr -d '[:space:]')"
check "hr_teams.manager_person_id FK targets hr_people.id (deferred FK completed)" "$TEAMS_FK" "hr_people.id"

SEED_ROWS="$(echo "SELECT string_agg(key, ',' ORDER BY key) FROM modules;" | psql_query)"
check "module registry has exactly 'people' (this harness's fixtures had none before)" "$SEED_ROWS" "people"

ENTITLEMENT_COUNT="$(echo "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='organisation_modules';" | psql_query | tr -d '[:space:]')"
check "seeding the registry creates no organisation_modules row/table (grants nothing)" "$ENTITLEMENT_COUNT" "0"

echo ""
echo "=== CONSTRAINT ENFORCEMENT: real inserts against the real tables ==="

TEAM_ID="$(echo "INSERT INTO hr_teams (organisation_id, name) VALUES ('org-a', 'Engineering') RETURNING id;" | psql_query | tr -d '[:space:]')"
check "team insert succeeds" "$([ -n "$TEAM_ID" ] && echo ok)" "ok"

PERSON1_ID="$(echo "INSERT INTO hr_people (organisation_id, first_name, last_name, team_id, linked_user_id) VALUES ('org-a', 'Ada', 'Lovelace', '$TEAM_ID', 'user-a1') RETURNING id;" | psql_query | tr -d '[:space:]')"
check "person insert (linked to a same-org user, same-org team) succeeds" "$([ -n "$PERSON1_ID" ] && echo ok)" "ok"

PERSON2_ID="$(echo "INSERT INTO hr_people (organisation_id, first_name, last_name, manager_person_id) VALUES ('org-a', 'Grace', 'Hopper', '$PERSON1_ID') RETURNING id;" | psql_query | tr -d '[:space:]')"
check "person insert with a manager_person_id succeeds" "$([ -n "$PERSON2_ID" ] && echo ok)" "ok"

SELF_MANAGE_REJECT="$(echo "UPDATE hr_people SET manager_person_id = id WHERE id = '$PERSON1_ID';" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$SELF_MANAGE_REJECT" | grep -q "violates check constraint"; then
  echo "  PASS: self-management (manager_person_id = own id) is rejected by the CHECK constraint"
  PASS=$((PASS + 1))
else
  echo "  FAIL: self-management was not rejected: $SELF_MANAGE_REJECT"
  FAIL=$((FAIL + 1))
  FAILURES+=("self-management not rejected")
fi

DUP_LINK_REJECT="$(echo "INSERT INTO hr_people (organisation_id, first_name, last_name, linked_user_id) VALUES ('org-a', 'Second', 'Record', 'user-a1');" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$DUP_LINK_REJECT" | grep -q "violates unique constraint"; then
  echo "  PASS: linking the SAME user to a second person record in the SAME org is rejected"
  PASS=$((PASS + 1))
else
  echo "  FAIL: duplicate (organisation_id, linked_user_id) was not rejected: $DUP_LINK_REJECT"
  FAIL=$((FAIL + 1))
  FAILURES+=("duplicate linked_user_id not rejected")
fi

TWO_UNLINKED_OK="$(echo "
INSERT INTO hr_people (organisation_id, first_name, last_name) VALUES ('org-a', 'Unlinked', 'One') RETURNING id;
INSERT INTO hr_people (organisation_id, first_name, last_name) VALUES ('org-a', 'Unlinked', 'Two') RETURNING id;
" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$TWO_UNLINKED_OK" | grep -q "EXIT:0"; then
  echo "  PASS: two people records with NULL linked_user_id in the same org are both allowed (NULL is never a uniqueness collision)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: two unlinked people records in the same org were incorrectly rejected: $TWO_UNLINKED_OK"
  FAIL=$((FAIL + 1))
  FAILURES+=("two unlinked people records incorrectly rejected")
fi

BAD_TEAM_REJECT="$(echo "INSERT INTO hr_people (organisation_id, first_name, last_name, team_id) VALUES ('org-a', 'Bad', 'Team', '00000000-0000-0000-0000-000000000000');" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$BAD_TEAM_REJECT" | grep -q "violates foreign key constraint"; then
  echo "  PASS: a non-existent team_id is rejected by the FK"
  PASS=$((PASS + 1))
else
  echo "  FAIL: a non-existent team_id was not rejected: $BAD_TEAM_REJECT"
  FAIL=$((FAIL + 1))
  FAILURES+=("non-existent team_id not rejected")
fi

BAD_USER_REJECT="$(echo "INSERT INTO hr_people (organisation_id, first_name, last_name, linked_user_id) VALUES ('org-a', 'Bad', 'User', 'no-such-user');" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$BAD_USER_REJECT" | grep -q "violates foreign key constraint"; then
  echo "  PASS: a non-existent linked_user_id is rejected by the FK"
  PASS=$((PASS + 1))
else
  echo "  FAIL: a non-existent linked_user_id was not rejected: $BAD_USER_REJECT"
  FAIL=$((FAIL + 1))
  FAILURES+=("non-existent linked_user_id not rejected")
fi

echo ""
echo "=== DOCUMENTED LIMITATION: the DB alone does NOT enforce same-organisation membership for team_id/manager_person_id/linked_user_id ==="
echo "    (a plain FK only proves the referenced row EXISTS, not that it belongs to the same org — see each script's own header comment;"
echo "    same-org enforcement for these three lives entirely in the API layer: lib/hr/validation.ts's isTeamInOrganisation/"
echo "    isPersonInOrganisation/isUserInOrganisation, called by every write route before the SQL write. These checks below are NOT"
echo "    failures of a security control — they PROVE the documented limitation is real, so the report's wording matches reality.)"

ORG_B_TEAM_ID="$(echo "INSERT INTO hr_teams (organisation_id, name) VALUES ('org-b', 'Org B Team') RETURNING id;" | psql_query | tr -d '[:space:]')"
ORG_B_PERSON_ID="$(echo "INSERT INTO hr_people (organisation_id, first_name, last_name) VALUES ('org-b', 'Org B', 'Person') RETURNING id;" | psql_query | tr -d '[:space:]')"

CROSS_ORG_TEAM="$(echo "INSERT INTO hr_people (organisation_id, first_name, last_name, team_id) VALUES ('org-a', 'CrossOrg', 'Team', '$ORG_B_TEAM_ID');" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$CROSS_ORG_TEAM" | grep -q "EXIT:0"; then
  echo "  DOCUMENTED (not a bug): the DB alone accepts an org-A hr_people row referencing an org-B hr_teams row via team_id — no organisation-match constraint exists at the DB level for this column"
  PASS=$((PASS + 1))
else
  echo "  UNEXPECTED: a cross-org team_id was rejected at the DB level — the report's Section-C description of this column is now WRONG and must be re-verified: $CROSS_ORG_TEAM"
  FAIL=$((FAIL + 1))
  FAILURES+=("cross-org team_id behaviour no longer matches the documented limitation")
fi

CROSS_ORG_MANAGER="$(echo "INSERT INTO hr_people (organisation_id, first_name, last_name, manager_person_id) VALUES ('org-a', 'CrossOrg', 'Manager', '$ORG_B_PERSON_ID');" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$CROSS_ORG_MANAGER" | grep -q "EXIT:0"; then
  echo "  DOCUMENTED (not a bug): the DB alone accepts an org-A hr_people row referencing an org-B hr_people row via manager_person_id — no organisation-match constraint exists at the DB level for this column"
  PASS=$((PASS + 1))
else
  echo "  UNEXPECTED: a cross-org manager_person_id was rejected at the DB level — the report's Section-C description of this column is now WRONG and must be re-verified: $CROSS_ORG_MANAGER"
  FAIL=$((FAIL + 1))
  FAILURES+=("cross-org manager_person_id behaviour no longer matches the documented limitation")
fi

CROSS_ORG_LINK="$(echo "INSERT INTO hr_people (organisation_id, first_name, last_name, linked_user_id) VALUES ('org-a', 'CrossOrg', 'Link', 'user-b1');" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$CROSS_ORG_LINK" | grep -q "EXIT:0"; then
  echo "  DOCUMENTED (not a bug): the DB alone accepts an org-A hr_people row linked to an org-B user via linked_user_id — UNIQUE(organisation_id, linked_user_id) only blocks the SAME user being linked twice within one org, it does not check the user's own organisation_id"
  PASS=$((PASS + 1))
else
  echo "  UNEXPECTED: a cross-org linked_user_id was rejected at the DB level — the report's Section-C description of this column is now WRONG and must be re-verified: $CROSS_ORG_LINK"
  FAIL=$((FAIL + 1))
  FAILURES+=("cross-org linked_user_id behaviour no longer matches the documented limitation")
fi

CROSS_ORG_TEAM_MANAGER="$(echo "INSERT INTO hr_teams (organisation_id, name, manager_person_id) VALUES ('org-a', 'Cross Org Team', '$ORG_B_PERSON_ID');" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$CROSS_ORG_TEAM_MANAGER" | grep -q "EXIT:0"; then
  echo "  DOCUMENTED (not a bug): the DB alone accepts an org-A hr_teams row referencing an org-B hr_people row via manager_person_id — same limitation as hr_people.manager_person_id above, enforced only by lib/hr/validation.ts's isPersonInOrganisation() inside POST /api/hr/teams"
  PASS=$((PASS + 1))
else
  echo "  UNEXPECTED: a cross-org hr_teams.manager_person_id was rejected at the DB level — the report's Section-C description of this column is now WRONG and must be re-verified: $CROSS_ORG_TEAM_MANAGER"
  FAIL=$((FAIL + 1))
  FAILURES+=("cross-org hr_teams.manager_person_id behaviour no longer matches the documented limitation")
fi

ADMIN_ID="$(echo "INSERT INTO hr_administrators (organisation_id, user_id, created_by) VALUES ('org-a', 'user-a1', 'user-a1') RETURNING id;" | psql_query | tr -d '[:space:]')"
check "hr_administrators insert succeeds" "$([ -n "$ADMIN_ID" ] && echo ok)" "ok"

DUP_ADMIN_REJECT="$(echo "INSERT INTO hr_administrators (organisation_id, user_id) VALUES ('org-a', 'user-a1');" | psql_exec 2>&1; echo "EXIT:$?")"
if echo "$DUP_ADMIN_REJECT" | grep -q "violates unique constraint"; then
  echo "  PASS: re-granting the same (org, user) HR-administrator pair is rejected as a duplicate"
  PASS=$((PASS + 1))
else
  echo "  FAIL: duplicate hr_administrators grant was not rejected: $DUP_ADMIN_REJECT"
  FAIL=$((FAIL + 1))
  FAILURES+=("duplicate hr_administrators grant not rejected")
fi

echo ""
echo "=== IDEMPOTENCY: re-run all four scripts a second time ==="
PEOPLE_COUNT_BEFORE="$(echo "SELECT COUNT(*) FROM hr_people;" | psql_query | tr -d '[:space:]')"
TEAMS_COUNT_BEFORE="$(echo "SELECT COUNT(*) FROM hr_teams;" | psql_query | tr -d '[:space:]')"
MODULES_COUNT_BEFORE="$(echo "SELECT COUNT(*) FROM modules;" | psql_query | tr -d '[:space:]')"

SECOND_RUN_OUTPUT="$( (psql_exec < scripts/create-hr-teams.sql; psql_exec < scripts/create-hr-people.sql; psql_exec < scripts/create-hr-administrators.sql; psql_exec < scripts/seed-hr-module-registry.sql) 2>&1; echo "EXIT:$?")"
if echo "$SECOND_RUN_OUTPUT" | grep -q "EXIT:0"; then
  echo "  PASS: second run of all four scripts succeeded with ZERO errors"
  PASS=$((PASS + 1))
else
  echo "  FAIL: second run failed"
  echo "$SECOND_RUN_OUTPUT" | tail -30
  FAIL=$((FAIL + 1))
  FAILURES+=("second run failed — see output above")
fi

PEOPLE_COUNT_AFTER="$(echo "SELECT COUNT(*) FROM hr_people;" | psql_query | tr -d '[:space:]')"
check "no data loss/duplication: hr_people row count unchanged after re-apply" "$PEOPLE_COUNT_AFTER" "$PEOPLE_COUNT_BEFORE"
TEAMS_COUNT_AFTER="$(echo "SELECT COUNT(*) FROM hr_teams;" | psql_query | tr -d '[:space:]')"
check "no data loss/duplication: hr_teams row count unchanged after re-apply" "$TEAMS_COUNT_AFTER" "$TEAMS_COUNT_BEFORE"
MODULES_COUNT_AFTER="$(echo "SELECT COUNT(*) FROM modules;" | psql_query | tr -d '[:space:]')"
check "no data loss/duplication: modules row count unchanged after re-apply" "$MODULES_COUNT_AFTER" "$MODULES_COUNT_BEFORE"

echo ""
echo "=== SUMMARY ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
exit 0
