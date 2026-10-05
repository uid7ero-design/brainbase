#!/usr/bin/env bash
# HR-7E1 employee-document assurance schema proof. Runs only against disposable postgres:16.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

CONTAINER="hr7e1-document-assurance-harness-$$"
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

MIGRATION="scripts/create-hr-employee-document-assurance.sql"
[ -f "$MIGRATION" ] || { echo "ERROR: missing $MIGRATION" >&2; exit 2; }

echo "=== STATIC: additive-only migration ==="
FORBIDDEN="$(code_only "$MIGRATION" | grep -n -i -w -E 'DROP|DELETE|TRUNCATE|UPDATE|INSERT|GRANT|REVOKE|ALTER' || true)"
check "no destructive/DML/ALTER statements outside comments" "$FORBIDDEN" ""
TABLES="$(code_only "$MIGRATION" | grep -o -i -E 'CREATE TABLE IF NOT EXISTS [a-z_]+' | awk '{print $6}' | LC_ALL=C sort | paste -sd, -)"
check "creates exactly three HR-7E1 assurance tables" "$TABLES" "hr_employee_document_acknowledgements,hr_employee_document_reminder_deliveries,hr_employee_document_verifications"
BARE_CREATE="$(code_only "$MIGRATION" | grep -i -E 'CREATE[[:space:]]+(UNIQUE[[:space:]]+)?(TABLE|INDEX)' | grep -i -v 'IF NOT EXISTS' || true)"
check "every table/index CREATE is idempotent" "$BARE_CREATE" ""
TX_BEGIN="$(code_only "$MIGRATION" | grep -c -E '^[[:space:]]*BEGIN;[[:space:]]*$')"
TX_COMMIT="$(code_only "$MIGRATION" | grep -c -E '^[[:space:]]*COMMIT;[[:space:]]*$')"
check "migration has one explicit transaction wrapper" "$TX_BEGIN/$TX_COMMIT" "1/1"
CASCADE="$(code_only "$MIGRATION" | grep -i -E 'ON[[:space:]]+DELETE[[:space:]]+CASCADE' || true)"
check "no cascading deletes" "$CASCADE" ""
VERSION_MUTATION="$(code_only "$MIGRATION" | grep -i -E 'ALTER[[:space:]]+TABLE[[:space:]]+hr_employee_document_versions|reminder_sent_at|reminder_claimed_at' || true)"
check "does not mutate document-version schema or embed reminder state there" "$VERSION_MUTATION" ""

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
CREATE TABLE hr_employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id)
);
ALTER TABLE hr_employee_documents
  ADD CONSTRAINT hr_employee_documents_organisation_id_id_key UNIQUE (organisation_id, id);

CREATE TABLE hr_employee_document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  document_id UUID NOT NULL,
  version_number INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hr_employee_document_versions_org_document_fkey
    FOREIGN KEY (organisation_id, document_id)
    REFERENCES hr_employee_documents(organisation_id, id)
);
ALTER TABLE hr_employee_document_versions
  ADD CONSTRAINT hr_employee_document_versions_organisation_id_id_key
  UNIQUE (organisation_id, id);
SQL

echo ""
echo "=== APPLY + IDEMPOTENCY ==="
if cat "$MIGRATION" | psql_db >/dev/null; then record_pass "first migration apply"; else record_fail "first migration apply"; fi
if cat "$MIGRATION" | psql_db >/dev/null; then record_pass "second migration apply"; else record_fail "second migration apply"; fi

check "all three assurance tables exist" "$(scalar "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('hr_employee_document_acknowledgements','hr_employee_document_verifications','hr_employee_document_reminder_deliveries');")" "3"
check "acknowledgement has tenant identity anchor" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_acknowledgements_organisation_id_id_key';")" "UNIQUE (organisation_id, id)"
check "verification has tenant identity anchor" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_verifications_organisation_id_id_key';")" "UNIQUE (organisation_id, id)"
check "reminder delivery has tenant identity anchor" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_reminder_deliveries_organisation_id_id_key';")" "UNIQUE (organisation_id, id)"
check "acknowledgement references immutable version tenant-safely" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_acknowledgements_org_version_fkey';")" "FOREIGN KEY (organisation_id, document_version_id) REFERENCES hr_employee_document_versions(organisation_id, id)"
check "verification references immutable version tenant-safely" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_verifications_org_version_fkey';")" "FOREIGN KEY (organisation_id, document_version_id) REFERENCES hr_employee_document_versions(organisation_id, id)"
check "reminder references immutable version tenant-safely" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_reminder_deliveries_org_version_fkey';")" "FOREIGN KEY (organisation_id, document_version_id) REFERENCES hr_employee_document_versions(organisation_id, id)"
check "acknowledgement is one-per-user-per-version" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_acknowledgements_org_version_user_key';")" "UNIQUE (organisation_id, document_version_id, acknowledged_by)"
check "reminder delivery identity is concurrency-safe" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_reminder_deliveries_identity_key';")" "UNIQUE (organisation_id, document_version_id, recipient_user_id, reminder_type, scheduled_for)"
check "verification decision vocabulary is constrained" "$(scalar "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hr_employee_document_verifications_decision_check';")" "CHECK ((decision = ANY (ARRAY['VERIFIED'::text, 'REJECTED'::text])))"
check "reminder due lookup index exists" "$(scalar "SELECT count(*) FROM pg_indexes WHERE indexname='idx_hr_employee_document_reminder_deliveries_due';")" "1"
check "verification history index exists" "$(scalar "SELECT count(*) FROM pg_indexes WHERE indexname='idx_hr_employee_document_verifications_org_version';")" "1"

cat <<'SQL' | psql_db >/dev/null
INSERT INTO organisations(id) VALUES ('org-a'), ('org-b');
INSERT INTO users(id, organisation_id)
VALUES ('employee-a', 'org-a'), ('hr-a', 'org-a'), ('employee-b', 'org-b'), ('hr-b', 'org-b');

INSERT INTO hr_employee_documents(id, organisation_id)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'org-a'),
  ('22222222-2222-4222-8222-222222222222', 'org-b');

INSERT INTO hr_employee_document_versions(
  id, organisation_id, document_id, version_number, uploaded_by,
  original_filename, content_type, byte_size, storage_key
) VALUES
  ('33333333-3333-4333-8333-333333333333', 'org-a', '11111111-1111-4111-8111-111111111111', 1, 'hr-a', 'a.pdf', 'application/pdf', 1, 'org-a-key'),
  ('44444444-4444-4444-8444-444444444444', 'org-b', '22222222-2222-4222-8222-222222222222', 1, 'hr-b', 'b.pdf', 'application/pdf', 1, 'org-b-key');
SQL

cat <<'SQL' | psql_db >/dev/null
INSERT INTO hr_employee_document_acknowledgements(
  id, organisation_id, document_version_id, acknowledged_by
) VALUES (
  '55555555-5555-4555-8555-555555555555',
  'org-a',
  '33333333-3333-4333-8333-333333333333',
  'employee-a'
);

INSERT INTO hr_employee_document_verifications(
  id, organisation_id, document_version_id, verified_by, decision, comment
) VALUES (
  '66666666-6666-4666-8666-666666666666',
  'org-a',
  '33333333-3333-4333-8333-333333333333',
  'hr-a',
  'VERIFIED',
  'Initial verification'
);

INSERT INTO hr_employee_document_reminder_deliveries(
  id, organisation_id, document_version_id, recipient_user_id,
  reminder_type, scheduled_for
) VALUES (
  '77777777-7777-4777-8777-777777777777',
  'org-a',
  '33333333-3333-4333-8333-333333333333',
  'employee-a',
  'EXPIRY',
  DATE '2027-08-01'
);
SQL
record_pass "valid acknowledgement, verification, and reminder rows insert"

expect_error   "cross-tenant acknowledgement/version relation rejected"   "23503"   "hr_employee_document_acknowledgements_org_version_fkey"   "INSERT INTO hr_employee_document_acknowledgements(id,organisation_id,document_version_id,acknowledged_by) VALUES ('88888888-8888-4888-8888-888888888888','org-b','33333333-3333-4333-8333-333333333333','employee-b');"

expect_error   "cross-tenant verification/version relation rejected"   "23503"   "hr_employee_document_verifications_org_version_fkey"   "INSERT INTO hr_employee_document_verifications(id,organisation_id,document_version_id,verified_by,decision) VALUES ('99999999-9999-4999-8999-999999999999','org-b','33333333-3333-4333-8333-333333333333','hr-b','VERIFIED');"

expect_error   "cross-tenant reminder/version relation rejected"   "23503"   "hr_employee_document_reminder_deliveries_org_version_fkey"   "INSERT INTO hr_employee_document_reminder_deliveries(id,organisation_id,document_version_id,recipient_user_id,reminder_type,scheduled_for) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','org-b','33333333-3333-4333-8333-333333333333','employee-b','EXPIRY',DATE '2027-08-01');"

expect_error   "duplicate acknowledgement rejected"   "23505"   "hr_employee_document_acknowledgements_org_version_user_key"   "INSERT INTO hr_employee_document_acknowledgements(id,organisation_id,document_version_id,acknowledged_by) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','org-a','33333333-3333-4333-8333-333333333333','employee-a');"

cat <<'SQL' | psql_db >/dev/null
INSERT INTO hr_employee_document_verifications(
  id, organisation_id, document_version_id, verified_by, decision, comment
) VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'org-a',
  '33333333-3333-4333-8333-333333333333',
  'hr-a',
  'REJECTED',
  'Later re-check'
);
SQL
check "verification history remains append-only and permits repeat decisions" "$(scalar "SELECT count(*) FROM hr_employee_document_verifications WHERE organisation_id='org-a' AND document_version_id='33333333-3333-4333-8333-333333333333';")" "2"

expect_error   "invalid verification decision rejected"   "23514"   "hr_employee_document_verifications_decision_check"   "INSERT INTO hr_employee_document_verifications(id,organisation_id,document_version_id,verified_by,decision) VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','org-a','33333333-3333-4333-8333-333333333333','hr-a','PENDING');"

expect_error   "duplicate reminder delivery identity rejected"   "23505"   "hr_employee_document_reminder_deliveries_identity_key"   "INSERT INTO hr_employee_document_reminder_deliveries(id,organisation_id,document_version_id,recipient_user_id,reminder_type,scheduled_for) VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','org-a','33333333-3333-4333-8333-333333333333','employee-a','EXPIRY',DATE '2027-08-01');"

expect_error   "blank reminder type rejected"   "23514"   "hr_emp_doc_reminder_type_not_blank_check"   "INSERT INTO hr_employee_document_reminder_deliveries(id,organisation_id,document_version_id,recipient_user_id,reminder_type,scheduled_for) VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff','org-a','33333333-3333-4333-8333-333333333333','employee-a','   ',DATE '2027-08-02');"

expect_error   "SENT reminder requires claimed_at and sent_at"   "23514"   "hr_employee_document_reminder_deliveries_state_check"   "INSERT INTO hr_employee_document_reminder_deliveries(id,organisation_id,document_version_id,recipient_user_id,reminder_type,scheduled_for,delivery_status) VALUES ('12121212-1212-4212-8212-121212121212','org-a','33333333-3333-4333-8333-333333333333','employee-a','EXPIRY',DATE '2027-08-03','SENT');"

cat <<'SQL' | psql_db >/dev/null
INSERT INTO hr_employee_document_reminder_deliveries(
  id, organisation_id, document_version_id, recipient_user_id,
  reminder_type, scheduled_for, delivery_status, claimed_at, sent_at
) VALUES (
  '13131313-1313-4313-8313-131313131313',
  'org-a',
  '33333333-3333-4333-8333-333333333333',
  'employee-a',
  'EXPIRY',
  DATE '2027-08-03',
  'SENT',
  now(),
  now()
);
SQL
record_pass "coherent SENT reminder state accepted"

echo ""
echo "=== PRECONDITION FAIL-CLOSED PROOF ==="
MISSING_CONTAINER="hr7e1-missing-anchor-$$"
docker run -d --name "$MISSING_CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16 >/dev/null || exit 2
for i in $(seq 1 60); do
  if echo "SELECT 1;" | docker exec -i "$MISSING_CONTAINER" psql -X -q -t -A -U postgres -d testdb >/dev/null 2>&1; then break; fi
  sleep 1
done
cat <<'SQL' | docker exec -i "$MISSING_CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >/dev/null
CREATE TABLE organisations (id TEXT PRIMARY KEY);
CREATE TABLE users (id TEXT PRIMARY KEY);
CREATE TABLE hr_employee_document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id)
);
SQL
OUT="$(cat "$MIGRATION" | docker exec -i "$MISSING_CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 -v VERBOSITY=verbose 2>&1)"
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q 'hr_employee_document_versions_organisation_id_id_key is missing'; then
  record_pass "missing version tenant anchor fails closed"
else
  record_fail "missing version tenant anchor fails closed"
fi
LEFTOVERS="$(echo "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('hr_employee_document_acknowledgements','hr_employee_document_verifications','hr_employee_document_reminder_deliveries');" | docker exec -i "$MISSING_CONTAINER" psql -X -q -t -A -U postgres -d testdb | tr -d '\r')"
check "failed preflight leaves zero HR-7E1 tables" "$LEFTOVERS" "0"
docker rm -f "$MISSING_CONTAINER" >/dev/null 2>&1 || true

echo ""
echo "=== SUMMARY ==="
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf 'Failures:\n'
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
echo "HR-7E1 employee-document assurance migration proof passed."
