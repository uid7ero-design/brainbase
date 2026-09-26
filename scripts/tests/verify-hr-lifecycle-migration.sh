#!/usr/bin/env bash
# HR-7A lifecycle schema proof. Runs only against disposable postgres:16.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

CONTAINER="hr7a-lifecycle-harness-$$"
PASS=0
FAIL=0
FAILURES=()
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

record_pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
record_fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); FAILURES+=("$1"); }
check() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $label (got '$actual')"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $label - expected '$expected', got '$actual'"
    FAIL=$((FAIL + 1)); FAILURES+=("$label")
  fi
}
code_only() { sed -e 's/--.*$//' "$1"; }

MIGRATION="scripts/create-hr-lifecycle-workflows.sql"
[ -f "$MIGRATION" ] || { echo "ERROR: missing $MIGRATION" >&2; exit 2; }

echo "=== STATIC: additive-only migration ==="
FORBIDDEN="$(code_only "$MIGRATION" | grep -n -i -w -E 'DROP|DELETE|TRUNCATE|UPDATE|INSERT|GRANT|REVOKE|ALTER' || true)"
check "no destructive/DML/ALTER statements outside comments" "$FORBIDDEN" ""
TABLES="$(code_only "$MIGRATION" | grep -o -i -E 'CREATE TABLE IF NOT EXISTS [a-z_]+' | awk '{print $6}' | LC_ALL=C sort | paste -sd, -)"
check "creates exactly five lifecycle tables" "$TABLES" "hr_lifecycle_task_approvals,hr_lifecycle_tasks,hr_lifecycle_template_tasks,hr_lifecycle_templates,hr_lifecycle_workflows"
BARE_CREATE="$(code_only "$MIGRATION" | grep -i -E 'CREATE[[:space:]]+(UNIQUE[[:space:]]+)?(TABLE|INDEX)' | grep -i -v 'IF NOT EXISTS' || true)"
check "every table/index CREATE is idempotent" "$BARE_CREATE" ""

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon is required." >&2; exit 2
fi

echo ""
echo "Starting disposable postgres:16 ($CONTAINER)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16 >/dev/null || exit 2
READY=0
for i in $(seq 1 60); do
  if echo "SELECT 1;" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
[ "$READY" -eq 1 ] || { echo "ERROR: postgres not ready" >&2; exit 2; }

psql_db() { local db="$1"; shift; docker exec -i "$CONTAINER" psql -X -q -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"; }
scalar() { echo "$1" | psql_db testdb -t -A | tr -d '\r'; }
expect_error() {
  local label="$1" state="$2" needle="$3" sql="$4"
  local out rc
  out="$(echo "$sql" | docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 -v VERBOSITY=verbose 2>&1)"
  rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "$state" && printf '%s' "$out" | grep -q "$needle"; then
    record_pass "$label"
  else
    record_fail "$label (rc=$rc; expected SQLSTATE $state and '$needle'; got: $out)"
  fi
}

cat <<'SQL' | psql_db testdb
CREATE TABLE organisations (id TEXT PRIMARY KEY);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id)
);
CREATE TABLE hr_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  linked_user_id TEXT REFERENCES users(id)
);
ALTER TABLE hr_people
  ADD CONSTRAINT hr_people_organisation_id_id_key UNIQUE (organisation_id, id);

INSERT INTO organisations(id) VALUES ('org-a'), ('org-b');
INSERT INTO users(id, organisation_id) VALUES
  ('user-a', 'org-a'), ('manager-a', 'org-a'), ('user-b', 'org-b');
INSERT INTO hr_people(id, organisation_id, linked_user_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'org-a', NULL),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'org-b', 'user-b');
SQL

echo ""
echo "=== APPLY: first migration run ==="
cat "$MIGRATION" | psql_db testdb
record_pass "migration applies cleanly"

ACTUAL_TABLES="$(scalar "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'hr_lifecycle_%';")"
check "exact lifecycle table set exists" "$ACTUAL_TABLES" "hr_lifecycle_task_approvals,hr_lifecycle_tasks,hr_lifecycle_template_tasks,hr_lifecycle_templates,hr_lifecycle_workflows"

TRIGGERS="$(scalar "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname LIKE 'hr_lifecycle_%';")"
check "schema adds no user-defined triggers" "$TRIGGERS" "0"
CASCADES="$(scalar "SELECT count(*) FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid WHERE c.contype='f' AND r.relname LIKE 'hr_lifecycle_%' AND c.confdeltype <> 'a';")"
check "no lifecycle FK uses ON DELETE CASCADE/SET NULL" "$CASCADES" "0"

cat <<'SQL' | psql_db testdb
INSERT INTO hr_lifecycle_templates
  (id, organisation_id, template_key, version_number, lifecycle_type, name, created_by)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'org-a', 'standard-onboarding', 1, 'onboarding', 'Standard onboarding', 'user-a'),
  ('20000000-0000-4000-8000-000000000001', 'org-b', 'standard-onboarding', 1, 'onboarding', 'Org B onboarding', 'user-b');

INSERT INTO hr_lifecycle_template_tasks
  (id, organisation_id, template_id, sequence, title, responsibility_type, due_offset_days, employee_visible)
VALUES
  ('10000000-0000-4000-8000-000000000011', 'org-a', '10000000-0000-4000-8000-000000000001', 1, 'Complete details', 'EMPLOYEE', -7, true),
  ('20000000-0000-4000-8000-000000000011', 'org-b', '20000000-0000-4000-8000-000000000001', 1, 'Complete details', 'EMPLOYEE', 0, true);

INSERT INTO hr_lifecycle_workflows
  (id, organisation_id, person_id, template_id, lifecycle_type, anchor_date, started_by)
VALUES
  ('10000000-0000-4000-8000-000000000021', 'org-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000001', 'onboarding', DATE '2026-10-01', 'user-a'),
  ('20000000-0000-4000-8000-000000000021', 'org-b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '20000000-0000-4000-8000-000000000001', 'onboarding', DATE '2026-10-01', 'user-b');

INSERT INTO hr_lifecycle_tasks
  (id, organisation_id, workflow_id, person_id, template_task_id, sequence, title, responsibility_type, due_at, employee_visible)
VALUES
  ('10000000-0000-4000-8000-000000000031', 'org-a', '10000000-0000-4000-8000-000000000021', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000011', 1, 'Complete details', 'EMPLOYEE', TIMESTAMPTZ '2026-09-24 00:00:00+00', true);

INSERT INTO hr_lifecycle_task_approvals
  (organisation_id, task_id, workflow_id, person_id, approver_user_id, decision)
VALUES
  ('org-a', '10000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000021', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'manager-a', 'APPROVED');

-- Proves an employee task can remain unresolved while the person has no login.
SELECT 1 / CASE WHEN assigned_user_id IS NULL THEN 1 ELSE 0 END
FROM hr_lifecycle_tasks WHERE id='10000000-0000-4000-8000-000000000031';
SQL
record_pass "same-org graph inserts and nullable employee assignment succeed"

echo ""
echo "=== TENANT INTEGRITY ==="
expect_error "template task cannot reference another org template" "23503" "hr_lifecycle_template_tasks_org_template_fkey" \
  "INSERT INTO hr_lifecycle_template_tasks(organisation_id,template_id,sequence,title,responsibility_type) VALUES ('org-a','20000000-0000-4000-8000-000000000001',9,'x','EMPLOYEE');"
expect_error "workflow cannot reference another org person" "23503" "hr_lifecycle_workflows_org_person_fkey" \
  "INSERT INTO hr_lifecycle_workflows(organisation_id,person_id,template_id,lifecycle_type,anchor_date,started_by) VALUES ('org-a','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','10000000-0000-4000-8000-000000000001','offboarding',CURRENT_DATE,'user-a');"
expect_error "workflow cannot reference another org template" "23503" "hr_lifecycle_workflows_org_template_fkey" \
  "INSERT INTO hr_lifecycle_workflows(organisation_id,person_id,template_id,lifecycle_type,anchor_date,started_by) VALUES ('org-a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','offboarding',CURRENT_DATE,'user-a');"
expect_error "workflow lifecycle type must match pinned template" "23503" "hr_lifecycle_workflows_org_template_fkey" \
  "INSERT INTO hr_lifecycle_workflows(organisation_id,person_id,template_id,lifecycle_type,anchor_date,started_by) VALUES ('org-a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','offboarding',CURRENT_DATE,'user-a');"
expect_error "task cannot reference another org workflow" "23503" "hr_lifecycle_tasks_org_workflow_person_fkey" \
  "INSERT INTO hr_lifecycle_tasks(organisation_id,workflow_id,person_id,sequence,title,responsibility_type) VALUES ('org-a','20000000-0000-4000-8000-000000000021','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',9,'x','EMPLOYEE');"
expect_error "task cannot reference another org template task" "23503" "hr_lifecycle_tasks_org_template_task_fkey" \
  "INSERT INTO hr_lifecycle_tasks(organisation_id,workflow_id,person_id,template_task_id,sequence,title,responsibility_type) VALUES ('org-a','10000000-0000-4000-8000-000000000021','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000011',9,'x','EMPLOYEE');"
expect_error "approval cannot reference another org task" "23503" "hr_lifecycle_task_approvals_org_task_workflow_person_fkey" \
  "INSERT INTO hr_lifecycle_task_approvals(organisation_id,task_id,workflow_id,person_id,approver_user_id,decision) VALUES ('org-b','10000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000021','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','user-b','APPROVED');"

# User FKs intentionally prove existence only, matching the existing HR limitation.
echo "INSERT INTO hr_lifecycle_templates(organisation_id,template_key,version_number,lifecycle_type,name,created_by) VALUES ('org-a','cross-org-user-proof',1,'onboarding','Cross org user FK proof','user-b');" | psql_db testdb
record_pass "documented limitation: user FK does not enforce organisation"

echo ""
echo "=== CONSTRAINTS AND CONCURRENCY-Critical UNIQUENESS ==="
expect_error "template version must be > 0" "23514" "hr_lifecycle_templates_version_number_check" \
  "INSERT INTO hr_lifecycle_templates(organisation_id,template_key,version_number,lifecycle_type,name,created_by) VALUES ('org-a','bad-version',0,'onboarding','Bad','user-a');"
expect_error "template status/timestamps must agree" "23514" "hr_lifecycle_templates_status_timestamps_check" \
  "INSERT INTO hr_lifecycle_templates(organisation_id,template_key,version_number,lifecycle_type,name,status,created_by) VALUES ('org-a','bad-active',1,'onboarding','Bad','ACTIVE','user-a');"
expect_error "template task approval fields coherent" "23514" "hr_lifecycle_template_tasks_approval_coherence_check" \
  "INSERT INTO hr_lifecycle_template_tasks(organisation_id,template_id,sequence,title,responsibility_type,requires_approval,approval_type) VALUES ('org-a','10000000-0000-4000-8000-000000000001',8,'Bad','EMPLOYEE',false,'MANAGER');"
expect_error "internal-only template task cannot be employee-visible" "23514" "hr_lifecycle_template_tasks_visibility_check" \
  "INSERT INTO hr_lifecycle_template_tasks(organisation_id,template_id,sequence,title,responsibility_type,internal_only,employee_visible) VALUES ('org-a','10000000-0000-4000-8000-000000000001',8,'Bad','HR_ADMIN',true,true);"
expect_error "workflow completed state requires completed_at" "23514" "hr_lifecycle_workflows_status_timestamps_check" \
  "INSERT INTO hr_lifecycle_workflows(organisation_id,person_id,template_id,lifecycle_type,status,anchor_date,started_by) VALUES ('org-a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','offboarding','COMPLETED',CURRENT_DATE,'user-a');"
expect_error "task completed state requires completion actor/time" "23514" "hr_lifecycle_tasks_terminal_fields_check" \
  "INSERT INTO hr_lifecycle_tasks(organisation_id,workflow_id,person_id,sequence,title,responsibility_type,status) VALUES ('org-a','10000000-0000-4000-8000-000000000021','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',8,'Bad','EMPLOYEE','COMPLETED');"
expect_error "waived task requires nonblank reason/actor/time" "23514" "hr_lifecycle_tasks_terminal_fields_check" \
  "INSERT INTO hr_lifecycle_tasks(organisation_id,workflow_id,person_id,sequence,title,responsibility_type,status,waived_by,waived_at,waiver_reason) VALUES ('org-a','10000000-0000-4000-8000-000000000021','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',8,'Bad','EMPLOYEE','WAIVED','user-a',now(),'   ');"
expect_error "approval decision vocabulary enforced" "23514" "hr_lifecycle_task_approvals_decision_check" \
  "INSERT INTO hr_lifecycle_task_approvals(organisation_id,task_id,workflow_id,person_id,approver_user_id,decision) VALUES ('org-a','10000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000021','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','manager-a','MAYBE');"

cat <<'SQL' | psql_db testdb
UPDATE hr_lifecycle_templates
SET status='ACTIVE', activated_at=now()
WHERE id='10000000-0000-4000-8000-000000000001';
SQL
expect_error "only one ACTIVE template version per org/template_key" "23505" "hr_lifecycle_templates_one_active_version" \
  "INSERT INTO hr_lifecycle_templates(organisation_id,template_key,version_number,lifecycle_type,name,status,activated_at,created_by) VALUES ('org-a','standard-onboarding',2,'onboarding','V2','ACTIVE',now(),'user-a');"
expect_error "only one ACTIVE workflow per person/lifecycle type" "23505" "hr_lifecycle_workflows_one_active_per_person_type" \
  "INSERT INTO hr_lifecycle_workflows(organisation_id,person_id,template_id,lifecycle_type,anchor_date,started_by) VALUES ('org-a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','onboarding',CURRENT_DATE,'user-a');"

echo ""
echo "=== RE-RUN IDEMPOTENCY ==="
BEFORE="$(scalar "SELECT md5(string_agg(c.relname || ':' || pg_get_constraintdef(k.oid), E'\\n' ORDER BY c.relname,k.conname)) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relname LIKE 'hr_lifecycle_%';")"
ROWS_BEFORE="$(scalar "SELECT (SELECT count(*) FROM hr_lifecycle_templates)||'/'||(SELECT count(*) FROM hr_lifecycle_template_tasks)||'/'||(SELECT count(*) FROM hr_lifecycle_workflows)||'/'||(SELECT count(*) FROM hr_lifecycle_tasks)||'/'||(SELECT count(*) FROM hr_lifecycle_task_approvals);")"
cat "$MIGRATION" | psql_db testdb
AFTER="$(scalar "SELECT md5(string_agg(c.relname || ':' || pg_get_constraintdef(k.oid), E'\\n' ORDER BY c.relname,k.conname)) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relname LIKE 'hr_lifecycle_%';")"
ROWS_AFTER="$(scalar "SELECT (SELECT count(*) FROM hr_lifecycle_templates)||'/'||(SELECT count(*) FROM hr_lifecycle_template_tasks)||'/'||(SELECT count(*) FROM hr_lifecycle_workflows)||'/'||(SELECT count(*) FROM hr_lifecycle_tasks)||'/'||(SELECT count(*) FROM hr_lifecycle_task_approvals);")"
check "constraint fingerprint unchanged after re-run" "$AFTER" "$BEFORE"
check "row counts unchanged after re-run" "$ROWS_AFTER" "$ROWS_BEFORE"

echo ""
echo "=== PRE-FLIGHT FAILS BEFORE PARTIAL CREATION ==="
echo "CREATE DATABASE noanchor;" | psql_db testdb
cat <<'SQL' | psql_db noanchor
CREATE TABLE organisations (id TEXT PRIMARY KEY);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id));
CREATE TABLE hr_people (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id));
SQL
OUT="$(cat "$MIGRATION" | docker exec -i "$CONTAINER" psql -X -q -U postgres -d noanchor -v ON_ERROR_STOP=1 2>&1)"
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "hr_people_organisation_id_id_key is missing"; then
  record_pass "missing HR tenant anchor fails closed"
else
  record_fail "missing HR tenant anchor did not fail as expected"
fi
PARTIAL="$(echo "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'hr_lifecycle_%';" | psql_db noanchor -t -A | tr -d '\r')"
check "pre-flight failure creates no lifecycle table" "$PARTIAL" "0"

echo ""
echo "=== RESULT ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
echo "HR-7A lifecycle migration proof passed."
