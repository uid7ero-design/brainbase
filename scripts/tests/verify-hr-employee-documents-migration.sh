#!/usr/bin/env bash
# HR-7D1 employee-document schema proof. Runs only against disposable postgres:16.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

CONTAINER="hr7d1-employee-doc-harness-$$"
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

MIGRATION="scripts/create-hr-employee-documents.sql"
[ -f "$MIGRATION" ] || { echo "ERROR: missing $MIGRATION" >&2; exit 2; }

echo "=== STATIC: additive-only migration ==="
FORBIDDEN="$(code_only "$MIGRATION" | grep -n -i -w -E 'DROP|DELETE|TRUNCATE|UPDATE|INSERT|GRANT|REVOKE|ALTER' || true)"
check "no destructive/DML/ALTER statements outside comments" "$FORBIDDEN" ""
TABLES="$(code_only "$MIGRATION" | grep -o -i -E 'CREATE TABLE IF NOT EXISTS [a-z_]+' | awk '{print $6}' | LC_ALL=C sort | paste -sd, -)"
check "creates exactly two employee-document tables" "$TABLES" "hr_employee_document_versions,hr_employee_documents"
BARE_CREATE="$(code_only "$MIGRATION" | grep -i -E 'CREATE[[:space:]]+(UNIQUE[[:space:]]+)?(TABLE|INDEX)' | grep -i -v 'IF NOT EXISTS' || true)"
check "every table/index CREATE is idempotent" "$BARE_CREATE" ""
TX_BEGIN="$(code_only "$MIGRATION" | grep -c -E '^[[:space:]]*BEGIN;[[:space:]]*$')"
TX_COMMIT="$(code_only "$MIGRATION" | grep -c -E '^[[:space:]]*COMMIT;[[:space:]]*$')"
check "migration has one explicit transaction wrapper" "$TX_BEGIN/$TX_COMMIT" "1/1"
REMINDER_COLUMNS="$(code_only "$MIGRATION" | grep -i -E 'reminder_sent_at|reminder_claimed_at' || true)"
check "does not embed reminder delivery state on document versions" "$REMINDER_COLUMNS" ""
TYPE_UNIQUENESS="$(code_only "$MIGRATION" | grep -i -E 'UNIQUE[[:space:]]*\([^)]*document_type' || true)"
check "does not merge logical documents by document_type" "$TYPE_UNIQUENESS" ""

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

psql_db() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 "$@"; }
scalar() { echo "$1" | psql_db -t -A | tr -d '\r'; }
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

cat <<'SQL' | psql_db
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

CREATE TABLE hr_lifecycle_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id)
);
ALTER TABLE hr_lifecycle_tasks
  ADD CONSTRAINT hr_lifecycle_tasks_organisation_id_id_key UNIQUE (organisation_id, id);
SQL

echo ""
echo "=== APPLY + IDEMPOTENCY ==="
if cat "$MIGRATION" | psql_db >/dev/null; then record_pass "first migration apply"; else record_fail "first migration apply"; fi
if cat "$MIGRATION" | psql_db >/dev/null; then record_pass "second migration apply"; else record_fail "second migration apply"; fi

check "document tables exist" "$(scalar "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('hr_employee_documents','hr_employee_document_versions');")" "2"
check "logical documents have tenant identity anchor" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_documents_organisation_id_id_key';")" "UNIQUE (organisation_id, id)"
check "versions have tenant identity anchor" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_versions_organisation_id_id_key';")" "UNIQUE (organisation_id, id)"
check "logical document owns person tenant-safely" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_documents_org_person_fkey';")" "FOREIGN KEY (organisation_id, person_id) REFERENCES hr_people(organisation_id, id)"
check "optional lifecycle task is tenant-safe" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_documents_org_lifecycle_task_fkey';")" "FOREIGN KEY (organisation_id, lifecycle_task_id) REFERENCES hr_lifecycle_tasks(organisation_id, id)"
check "version owns document tenant-safely" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_versions_org_document_fkey';")" "FOREIGN KEY (organisation_id, document_id) REFERENCES hr_employee_documents(organisation_id, id)"
check "version number unique per tenant document" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_versions_org_document_version_key';")" "UNIQUE (organisation_id, document_id, version_number)"
check "storage key globally unique" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_versions_storage_key_key';")" "UNIQUE (storage_key)"
check "one-current partial index exists" "$(scalar "SELECT indexdef FROM pg_indexes WHERE indexname='hr_employee_document_versions_one_current';")" "CREATE UNIQUE INDEX hr_employee_document_versions_one_current ON public.hr_employee_document_versions USING btree (organisation_id, document_id) WHERE (is_current = true)"
check "expiry lookup partial index exists" "$(scalar "SELECT indexdef FROM pg_indexes WHERE indexname='idx_hr_employee_document_versions_expires_at';")" "CREATE INDEX idx_hr_employee_document_versions_expires_at ON public.hr_employee_document_versions USING btree (organisation_id, expires_at) WHERE (expires_at IS NOT NULL)"
check "no reminder columns exist" "$(scalar "SELECT count(*) FROM information_schema.columns WHERE table_name='hr_employee_document_versions' AND column_name LIKE 'reminder_%';")" "0"

cat <<'SQL' | psql_db >/dev/null
INSERT INTO organisations(id) VALUES ('org-a'), ('org-b');
INSERT INTO users(id, organisation_id) VALUES ('user-a', 'org-a'), ('user-b', 'org-b');

INSERT INTO hr_people(id, organisation_id, linked_user_id)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'org-a', 'user-a'),
  ('22222222-2222-4222-8222-222222222222', 'org-b', 'user-b');

INSERT INTO hr_lifecycle_tasks(id, organisation_id)
VALUES
  ('33333333-3333-4333-8333-333333333333', 'org-a'),
  ('44444444-4444-4444-8444-444444444444', 'org-b');

INSERT INTO hr_employee_documents(
  id, organisation_id, person_id, document_type, title, lifecycle_task_id
) VALUES (
  '55555555-5555-4555-8555-555555555555',
  'org-a',
  '11111111-1111-4111-8111-111111111111',
  'certification',
  'Forklift certificate',
  '33333333-3333-4333-8333-333333333333'
);

INSERT INTO hr_employee_document_versions(
  id, organisation_id, document_id, version_number, uploaded_by,
  original_filename, content_type, byte_size, storage_key, expires_at, is_current
) VALUES (
  '66666666-6666-4666-8666-666666666666',
  'org-a',
  '55555555-5555-4555-8555-555555555555',
  1,
  'user-a',
  'forklift.pdf',
  'application/pdf',
  1024,
  'org_org-a/hr_employee_111/document_555/version_666',
  DATE '2027-09-26',
  true
);
SQL
record_pass "valid logical document + first immutable version insert"

expect_error   "cross-tenant person relation rejected"   "23503"   "hr_employee_documents_org_person_fkey"   "INSERT INTO hr_employee_documents(id,organisation_id,person_id,document_type,title) VALUES ('77777777-7777-4777-8777-777777777777','org-a','22222222-2222-4222-8222-222222222222','other','Cross tenant');"

expect_error   "cross-tenant lifecycle task relation rejected"   "23503"   "hr_employee_documents_org_lifecycle_task_fkey"   "INSERT INTO hr_employee_documents(id,organisation_id,person_id,document_type,title,lifecycle_task_id) VALUES ('88888888-8888-4888-8888-888888888888','org-a','11111111-1111-4111-8111-111111111111','other','Wrong task','44444444-4444-4444-8444-444444444444');"

expect_error   "cross-tenant version/document relation rejected"   "23503"   "hr_employee_document_versions_org_document_fkey"   "INSERT INTO hr_employee_document_versions(id,organisation_id,document_id,version_number,uploaded_by,original_filename,content_type,byte_size,storage_key) VALUES ('99999999-9999-4999-8999-999999999999','org-b','55555555-5555-4555-8555-555555555555',2,'user-b','x.pdf','application/pdf',1,'cross-tenant-key');"

expect_error   "second current version rejected"   "23505"   "hr_employee_document_versions_one_current"   "INSERT INTO hr_employee_document_versions(id,organisation_id,document_id,version_number,uploaded_by,original_filename,content_type,byte_size,storage_key,is_current) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','org-a','55555555-5555-4555-8555-555555555555',2,'user-a','new.pdf','application/pdf',2,'org-a-new-key',true);"

cat <<'SQL' | psql_db >/dev/null
UPDATE hr_employee_document_versions
SET is_current = false
WHERE id = '66666666-6666-4666-8666-666666666666';

INSERT INTO hr_employee_document_versions(
  id, organisation_id, document_id, version_number, uploaded_by,
  original_filename, content_type, byte_size, storage_key, is_current
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'org-a',
  '55555555-5555-4555-8555-555555555555',
  2,
  'user-a',
  'new.pdf',
  'application/pdf',
  2048,
  'org-a-new-key',
  true
);

INSERT INTO hr_employee_documents(
  id, organisation_id, person_id, document_type, title
) VALUES (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'org-a',
  '11111111-1111-4111-8111-111111111111',
  'certification',
  'Second independent certification'
);
SQL

check "history preserves two version rows" "$(scalar "SELECT count(*) FROM hr_employee_document_versions WHERE organisation_id='org-a' AND document_id='55555555-5555-4555-8555-555555555555';")" "2"
check "exactly one current version after replacement" "$(scalar "SELECT count(*) FROM hr_employee_document_versions WHERE organisation_id='org-a' AND document_id='55555555-5555-4555-8555-555555555555' AND is_current;")" "1"
check "same person + same document_type permits independent logical documents" "$(scalar "SELECT count(*) FROM hr_employee_documents WHERE organisation_id='org-a' AND person_id='11111111-1111-4111-8111-111111111111' AND document_type='certification';")" "2"

expect_error   "duplicate version number rejected"   "23505"   "hr_employee_document_versions_org_document_version_key"   "INSERT INTO hr_employee_document_versions(id,organisation_id,document_id,version_number,uploaded_by,original_filename,content_type,byte_size,storage_key,is_current) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','org-a','55555555-5555-4555-8555-555555555555',2,'user-a','dup.pdf','application/pdf',1,'dup-version-key',false);"

expect_error   "blank document type rejected"   "23514"   "hr_employee_documents_document_type_not_blank_check"   "INSERT INTO hr_employee_documents(id,organisation_id,person_id,document_type,title) VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','org-a','11111111-1111-4111-8111-111111111111','   ','Bad');"

expect_error   "negative byte size rejected"   "23514"   "hr_employee_document_versions_byte_size_check"   "INSERT INTO hr_employee_document_versions(id,organisation_id,document_id,version_number,uploaded_by,original_filename,content_type,byte_size,storage_key,is_current) VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','org-a','55555555-5555-4555-8555-555555555555',3,'user-a','bad.pdf','application/pdf',-1,'negative-key',false);"

echo ""
echo "=== SUMMARY ==="
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf 'Failures:\n'
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
echo "HR-7D1 employee-document migration proof passed."
