#!/usr/bin/env bash
# BrainBase Assurance A0.1F — template lifecycle migration: disposable PostgreSQL 17 proof.
#
# Applies the REAL migrations A0.1B, A0.1C, A0.1D-1..3, A0.1E-1, seeds data
# exactly the way the pre-A0.1F application writes it, then applies A0.1F and
# proves:
#   * backfill: latest version PUBLISHED (published_at = created_at), older
#     versions RETIRED; existing records keep their version;
#   * pre-A0.1F application behaviour stays valid after the migration:
#     legacy template create, legacy "publish version N+1" insert that omits
#     every lifecycle column, legacy record create bound to the latest version,
#     legacy activate/deactivate;
#   * explicit DRAFT insert (published_at/published_by NULL); CHECK rejects an
#     inconsistent draft;
#   * draft edits need lock_version + 1 (stale write rejected);
#   * DRAFT → PUBLISHED, and publishing v2 atomically retires v1 (and rolls back
#     together when the publish fails);
#   * second DRAFT / second PUBLISHED rejected;
#   * PUBLISHED / RETIRED content immutable; backwards transitions rejected;
#     identity immutable; only drafts deletable;
#   * Inspections / Audits cannot bind to DRAFT, RETIRED or foreign-org versions;
#   * retire-vs-create race: a record cannot bind to a concurrently retired version;
#   * A0.1F re-application is idempotent;
#   * rollback discards drafts, restores the A0.1D-3/A0.1E-1 shape, and a
#     re-apply round-trips.
#
# Usage:   bash scripts/tests/verify-assurance-templates-a01f-migration.sh
# Exit:    0 = pass, 1 = assertion failure, 2 = harness/setup failure.
# Requires Docker. Always destroys its own container.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

MIGRATIONS=(
  scripts/create-shared-foundations-a01b.sql
  scripts/create-assurance-core-a01c.sql
  scripts/create-assurance-incidents-a01d1.sql
  scripts/create-assurance-investigations-a01d2.sql
  scripts/create-assurance-inspections-a01d3.sql
  scripts/create-assurance-audits-a01e1.sql
)
A01F="scripts/create-assurance-template-lifecycle-a01f.sql"
A01F_ROLLBACK="scripts/rollback-assurance-template-lifecycle-a01f.sql"
CONTAINER="brainbase-a01f-templates-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

check() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label — expected '$expected', got '$actual'"
    FAIL=$((FAIL + 1))
    FAILURES+=("$label — expected '$expected', got '$actual'")
  fi
}

for f in "${MIGRATIONS[@]}" "$A01F" "$A01F_ROLLBACK"; do
  [ -f "$f" ] || { echo "ERROR: $f not found." >&2; exit 2; }
done

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required." >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon is not reachable." >&2; exit 2; }

docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:17 >/dev/null \
  || { echo "ERROR: could not start postgres:17." >&2; exit 2; }

READY=0
for _ in $(seq 1 60); do
  if echo "SELECT 1;" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
[ "$READY" -eq 1 ] || { echo "ERROR: postgres did not become ready." >&2; exit 2; }

psql_exec() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1; }
# q "<sql>" → trimmed scalar output (tuples only, unaligned).
q() { echo "$1" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 2>&1 | tr -d '\r'; }
# sqlstate "<sql>" → "OK" when it succeeds, else the SQLSTATE it failed with.
sqlstate() {
  local out
  out=$(printf '\\set VERBOSITY sqlstate\n%s\n' "$1" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 2>&1 | tr -d '\r')
  if [ $? -eq 0 ] && ! echo "$out" | grep -q '^ERROR:'; then echo "OK"; else echo "$out" | grep -o 'ERROR:  [0-9A-Z]\{5\}' | head -1 | sed 's/ERROR:  //'; fi
}

cat <<'SQL' | psql_exec >/dev/null || { echo "ERROR: base schema failed." >&2; exit 2; }
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Stand-ins for pre-existing platform tables, shaped like the real ones
-- (prisma @updatedAt columns have NO database default, exactly as in
-- Production; organiser tables mirror verify-organiser-confirmation-replay.sh).
CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT,
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

echo "Applying pre-A0.1F migrations ..."
for f in "${MIGRATIONS[@]}"; do
  psql_exec < "$f" >/dev/null || { echo "ERROR: $f failed to apply." >&2; exit 2; }
done

# ----------------------------------------------------------------------------
# Seed exactly as the pre-A0.1F application writes (no lifecycle columns).
# ----------------------------------------------------------------------------
ORG_A="org-a01f-a"; ORG_B="org-a01f-b"; ADMIN_A="usr-a01f-admin-a"; ADMIN_B="usr-a01f-admin-b"
IT1="11111111-1111-4111-8111-000000000001"   # inspection template, 2 legacy versions
IT1V1="11111111-1111-4111-8111-000000000011"
IT1V2="11111111-1111-4111-8111-000000000012"
IT2="11111111-1111-4111-8111-000000000002"   # inactive inspection template, 1 version
IT2V1="11111111-1111-4111-8111-000000000021"
AT1="22222222-2222-4222-8222-000000000001"   # audit template, 2 legacy versions
AT1V1="22222222-2222-4222-8222-000000000011"
AT1V2="22222222-2222-4222-8222-000000000012"
BT1="33333333-3333-4333-8333-000000000001"   # org B inspection template
BT1V1="33333333-3333-4333-8333-000000000011"
BAT1="33333333-3333-4333-8333-000000000002"  # org B audit template
BAT1V1="33333333-3333-4333-8333-000000000021"

cat <<SQL | psql_exec >/dev/null || { echo "ERROR: seed failed." >&2; exit 2; }
INSERT INTO organisations (id, name, slug, updated_at) VALUES
  ('$ORG_A', 'Org A', 'org-a01f-a', now()), ('$ORG_B', 'Org B', 'org-a01f-b', now());
INSERT INTO users (id, organisation_id, username, name, role, updated_at) VALUES
  ('$ADMIN_A', '$ORG_A', 'a01f-admin-a', 'Admin A', 'ADMIN', now()),
  ('$ADMIN_B', '$ORG_B', 'a01f-admin-b', 'Admin B', 'ADMIN', now());

INSERT INTO assurance_inspection_templates (id, organisation_id, template_reference, name, inspection_type, created_by)
VALUES ('$IT1', '$ORG_A', 'TPL-0001', 'Site walk', 'SITE', '$ADMIN_A'),
       ('$IT2', '$ORG_A', 'TPL-0002', 'Old vehicle check', 'VEHICLE', '$ADMIN_A'),
       ('$BT1', '$ORG_B', 'TPL-0001', 'Org B site walk', 'SITE', '$ADMIN_B');
INSERT INTO assurance_inspection_template_versions (id, organisation_id, template_id, version_number, title, checklist, effective_from, created_by, created_at)
VALUES ('$IT1V1', '$ORG_A', '$IT1', 1, 'Site walk', '[{"key":"gate","label":"Gate locked","responseType":"PASS_FAIL"}]', now(), '$ADMIN_A', now() - interval '2 days'),
       ('$IT1V2', '$ORG_A', '$IT1', 2, 'Site walk v2', '[{"key":"gate","label":"Gate locked and tagged","responseType":"PASS_FAIL"}]', now(), '$ADMIN_A', now() - interval '1 day'),
       ('$IT2V1', '$ORG_A', '$IT2', 1, 'Old vehicle check', '[]', now(), NULL, now() - interval '3 days'),
       ('$BT1V1', '$ORG_B', '$BT1', 1, 'Org B site walk', '[]', now(), '$ADMIN_B', now());
UPDATE assurance_inspection_templates SET is_active = false WHERE id = '$IT2';

INSERT INTO assurance_audit_templates (id, organisation_id, template_reference, name, audit_type, created_by)
VALUES ('$AT1', '$ORG_A', 'ATP-0001', 'Contractor audit', 'CONTRACTOR', '$ADMIN_A'),
       ('$BAT1', '$ORG_B', 'ATP-0001', 'Org B audit', 'INTERNAL', '$ADMIN_B');
INSERT INTO assurance_audit_template_versions (id, organisation_id, template_id, version_number, title, criteria, effective_from, created_by, created_at)
VALUES ('$AT1V1', '$ORG_A', '$AT1', 1, 'Contractor audit', '[{"key":"insured","label":"Insurance current","responseType":"BOOLEAN"}]', now(), '$ADMIN_A', now() - interval '2 days'),
       ('$AT1V2', '$ORG_A', '$AT1', 2, 'Contractor audit v2', '[{"key":"insured","label":"Insurance current and sighted","responseType":"BOOLEAN"}]', now(), '$ADMIN_A', now() - interval '1 day'),
       ('$BAT1V1', '$ORG_B', '$BAT1', 1, 'Org B audit', '[]', now(), '$ADMIN_B', now());

-- Records bound pre-migration to BOTH versions (v1 bound while it was current).
INSERT INTO assurance_inspections (organisation_id, inspection_reference, template_version_id, inspection_type, title, created_by)
VALUES ('$ORG_A', 'INS-0001', '$IT1V1', 'SITE', 'Walk on v1', '$ADMIN_A'),
       ('$ORG_A', 'INS-0002', '$IT1V2', 'SITE', 'Walk on v2', '$ADMIN_A');
INSERT INTO assurance_audits (organisation_id, audit_reference, template_version_id, audit_type, title, scope, created_by)
VALUES ('$ORG_A', 'AUD-0001', '$AT1V1', 'CONTRACTOR', 'Audit on v1', 'Scope', '$ADMIN_A');
SQL

echo ""
echo "== 1. Apply A0.1F + backfill =="
psql_exec < "$A01F" >/dev/null || { echo "ERROR: A0.1F failed to apply." >&2; exit 2; }
check "inspection v1 backfilled RETIRED" "$(q "SELECT status FROM assurance_inspection_template_versions WHERE id='$IT1V1'")" "RETIRED"
check "inspection v2 backfilled PUBLISHED" "$(q "SELECT status FROM assurance_inspection_template_versions WHERE id='$IT1V2'")" "PUBLISHED"
check "v2 published_at = created_at, published_by = created_by" \
  "$(q "SELECT published_at = created_at AND published_by = created_by FROM assurance_inspection_template_versions WHERE id='$IT1V2'")" "t"
check "v1 retired_at = v2 created_at, retired_by NULL" \
  "$(q "SELECT v1.retired_at = v2.created_at AND v1.retired_by IS NULL FROM assurance_inspection_template_versions v1, assurance_inspection_template_versions v2 WHERE v1.id='$IT1V1' AND v2.id='$IT1V2'")" "t"
check "unknown creator backfills published_by NULL (allowed)" \
  "$(q "SELECT status || ':' || (published_by IS NULL)::text FROM assurance_inspection_template_versions WHERE id='$IT2V1'")" "PUBLISHED:true"
check "audit v1 RETIRED / v2 PUBLISHED" \
  "$(q "SELECT string_agg(status, ',' ORDER BY version_number) FROM assurance_audit_template_versions WHERE template_id='$AT1'")" "RETIRED,PUBLISHED"
check "no drafts created by backfill" \
  "$(q "SELECT (SELECT count(*) FROM assurance_inspection_template_versions WHERE status='DRAFT') + (SELECT count(*) FROM assurance_audit_template_versions WHERE status='DRAFT')")" "0"
check "existing records keep their exact versions" \
  "$(q "SELECT string_agg(inspection_reference || '=' || template_version_id, ',' ORDER BY inspection_reference) FROM assurance_inspections")" \
  "INS-0001=$IT1V1,INS-0002=$IT1V2"
check "old always-immutable triggers removed" \
  "$(q "SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%template_versions_immutable'")" "0"

echo ""
echo "== 2. Pre-A0.1F application behaviour after migration =="
# Legacy createTemplate: identity + v1 insert omitting every lifecycle column.
IT3="11111111-1111-4111-8111-000000000003"; IT3V1="11111111-1111-4111-8111-000000000031"
check "legacy template create (v1 insert omits lifecycle columns)" "$(sqlstate "BEGIN;
INSERT INTO assurance_inspection_templates (id, organisation_id, template_reference, name, inspection_type, description, created_by)
VALUES ('$IT3', '$ORG_A', 'TPL-0003', 'Legacy new', 'SAFETY', NULL, '$ADMIN_A');
INSERT INTO assurance_inspection_template_versions (id, organisation_id, template_id, version_number, title, instructions, checklist, effective_from, created_by)
VALUES ('$IT3V1', '$ORG_A', '$IT3', 1, 'Legacy new', NULL, '[]'::jsonb, now(), '$ADMIN_A');
COMMIT;")" "OK"
check "legacy v1 is a valid PUBLISHED version (published_at defaulted)" \
  "$(q "SELECT status || ':' || (published_at IS NOT NULL)::text || ':' || lock_version FROM assurance_inspection_template_versions WHERE id='$IT3V1'")" "PUBLISHED:true:1"
# Legacy createTemplateVersion: INSERT ... SELECT max+1, no lifecycle columns.
check "legacy 'publish version N+1' insert succeeds" "$(sqlstate "
INSERT INTO assurance_inspection_template_versions (id, organisation_id, template_id, version_number, title, instructions, checklist, effective_from, created_by)
SELECT gen_random_uuid(), t.organisation_id, t.id,
       COALESCE((SELECT max(v.version_number) FROM assurance_inspection_template_versions v WHERE v.organisation_id = t.organisation_id AND v.template_id = t.id), 0) + 1,
       'Site walk v3', NULL, '[]'::jsonb, now(), '$ADMIN_A'
FROM assurance_inspection_templates t WHERE t.organisation_id = '$ORG_A' AND t.id = '$IT1';")" "OK"
check "legacy v3 PUBLISHED and v2 superseded to RETIRED in the same statement" \
  "$(q "SELECT string_agg(version_number || '=' || status, ',' ORDER BY version_number) FROM assurance_inspection_template_versions WHERE template_id='$IT1'")" \
  "1=RETIRED,2=RETIRED,3=PUBLISHED"
check "superseded v2 records who/when (retired_by = publisher)" \
  "$(q "SELECT (retired_at IS NOT NULL)::text || ':' || retired_by || ':' || lock_version FROM assurance_inspection_template_versions WHERE id='$IT1V2'")" "true:$ADMIN_A:2"
IT1V3=$(q "SELECT id FROM assurance_inspection_template_versions WHERE template_id='$IT1' AND version_number=3")
check "legacy inspection create bound to the latest version" "$(sqlstate "
INSERT INTO assurance_inspections (organisation_id, inspection_reference, template_version_id, inspection_type, title, created_by)
VALUES ('$ORG_A', 'INS-0003', '$IT1V3', 'SITE', 'Walk on v3', '$ADMIN_A');")" "OK"
check "legacy audit 'publish N+1' + audit create" "$(sqlstate "BEGIN;
INSERT INTO assurance_audit_template_versions (id, organisation_id, template_id, version_number, title, standard_reference, instructions, criteria, effective_from, created_by)
VALUES ('22222222-2222-4222-8222-000000000013', '$ORG_A', '$AT1', 3, 'Contractor audit v3', NULL, NULL, '[]'::jsonb, now(), '$ADMIN_A');
INSERT INTO assurance_audits (organisation_id, audit_reference, template_version_id, audit_type, title, scope, created_by)
VALUES ('$ORG_A', 'AUD-0002', '22222222-2222-4222-8222-000000000013', 'CONTRACTOR', 'Audit on v3', 'Scope', '$ADMIN_A');
COMMIT;")" "OK"
check "legacy deactivate/reactivate template still works" "$(sqlstate "
UPDATE assurance_inspection_templates SET is_active = false, updated_at = now() WHERE id = '$IT3';
UPDATE assurance_inspection_templates SET is_active = true, updated_at = now() WHERE id = '$IT3';")" "OK"
check "legacy response insert on an inspection still works" "$(sqlstate "
INSERT INTO assurance_inspection_responses (organisation_id, inspection_id, item_key, item_label, response_type, response_value, outcome, responded_by)
SELECT organisation_id, id, 'gate', 'Gate locked', 'PASS_FAIL', '\"PASS\"'::jsonb, 'PASS', '$ADMIN_A' FROM assurance_inspections WHERE inspection_reference = 'INS-0001';")" "OK"

echo ""
echo "== 3. Drafts =="
D4="11111111-1111-4111-8111-000000000014"
check "explicit DRAFT insert with published_at/published_by NULL" "$(sqlstate "
INSERT INTO assurance_inspection_template_versions (id, organisation_id, template_id, version_number, title, checklist, status, published_at, published_by, created_by)
VALUES ('$D4', '$ORG_A', '$IT1', 4, 'Site walk v4 draft', '[]'::jsonb, 'DRAFT', NULL, NULL, '$ADMIN_A');")" "OK"
check "draft insert did not retire the published version" \
  "$(q "SELECT status FROM assurance_inspection_template_versions WHERE id='$IT1V3'")" "PUBLISHED"
check "DRAFT that omits published_at (defaulted) violates lifecycle CHECK" "$(sqlstate "
INSERT INTO assurance_inspection_template_versions (organisation_id, template_id, version_number, title, status, created_by)
VALUES ('$ORG_A', '$IT3', 2, 'Bad draft', 'DRAFT', '$ADMIN_A');")" "23514"
check "second DRAFT for the same template rejected" "$(sqlstate "
INSERT INTO assurance_inspection_template_versions (organisation_id, template_id, version_number, title, status, published_at, created_by)
VALUES ('$ORG_A', '$IT1', 5, 'Second draft', 'DRAFT', NULL, '$ADMIN_A');")" "23505"
check "insert as RETIRED rejected" "$(sqlstate "
INSERT INTO assurance_inspection_template_versions (organisation_id, template_id, version_number, title, status, retired_at, created_by)
VALUES ('$ORG_A', '$IT3', 2, 'Born retired', 'RETIRED', now(), '$ADMIN_A');")" "AT001"
check "draft content edit with lock_version + 1" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET title = 'Site walk v4', checklist = '[{\"key\":\"gate\",\"label\":\"Gate\",\"responseType\":\"PASS_FAIL\"}]'::jsonb,
       updated_by = '$ADMIN_A', lock_version = lock_version + 1 WHERE id = '$D4';")" "OK"
check "stale draft write (lock_version not advanced) rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET title = 'Lost update' WHERE id = '$D4';")" "AT003"
check "stale draft write (lock_version jumped) rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET title = 'Lost update', lock_version = lock_version + 2 WHERE id = '$D4';")" "AT003"
check "version_number change rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET version_number = 9, lock_version = lock_version + 1 WHERE id = '$D4';")" "AT001"
check "organisation change rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET organisation_id = '$ORG_B', lock_version = lock_version + 1 WHERE id = '$D4';")" "AT001"
check "DRAFT → RETIRED rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET status = 'RETIRED', published_at = now(), retired_at = now(), lock_version = lock_version + 1 WHERE id = '$D4';")" "AT001"
check "publish with simultaneous content change rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET status = 'PUBLISHED', published_at = now(), published_by = '$ADMIN_A', title = 'Sneaky', lock_version = lock_version + 1 WHERE id = '$D4';")" "AT001"

echo ""
echo "== 4. Publish v4 atomically retires v3 =="
check "invalid publish (no published_at) fails" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET status = 'PUBLISHED', lock_version = lock_version + 1 WHERE id = '$D4';")" "23514"
check "failed publish rolled back the supersede too (v3 still PUBLISHED, v4 DRAFT)" \
  "$(q "SELECT string_agg(version_number || '=' || status, ',' ORDER BY version_number) FROM assurance_inspection_template_versions WHERE template_id='$IT1' AND version_number >= 3")" \
  "3=PUBLISHED,4=DRAFT"
check "DRAFT → PUBLISHED" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET status = 'PUBLISHED', published_at = now(), published_by = '$ADMIN_A', updated_by = '$ADMIN_A', lock_version = lock_version + 1 WHERE id = '$D4';")" "OK"
check "v3 RETIRED by the same statement; exactly one PUBLISHED" \
  "$(q "SELECT string_agg(version_number || '=' || status, ',' ORDER BY version_number) FROM assurance_inspection_template_versions WHERE template_id='$IT1'")" \
  "1=RETIRED,2=RETIRED,3=RETIRED,4=PUBLISHED"
check "INS-0003 still bound to retired v3" \
  "$(q "SELECT template_version_id FROM assurance_inspections WHERE inspection_reference='INS-0003'")" "$IT1V3"
check "second PUBLISHED rejected by the index (lifecycle trigger bypassed)" "$(sqlstate "
SET session_replication_role = replica;
INSERT INTO assurance_inspection_template_versions (organisation_id, template_id, version_number, title, created_by)
VALUES ('$ORG_A', '$IT1', 7, 'Rogue', '$ADMIN_A');")" "23505"

echo ""
echo "== 5. Published / retired immutability =="
check "PUBLISHED content mutation rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET title = 'Rewrite', lock_version = lock_version + 1 WHERE id = '$D4';")" "AT001"
check "PUBLISHED tamper without a lock_version bump reports immutability (not staleness)" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET title = 'Rewrite' WHERE id = '$D4';")" "AT001"
check "PUBLISHED checklist mutation rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET checklist = '[]'::jsonb, lock_version = lock_version + 1 WHERE id = '$D4';")" "AT001"
check "PUBLISHED → DRAFT rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET status = 'DRAFT', published_at = NULL, published_by = NULL, lock_version = lock_version + 1 WHERE id = '$D4';")" "AT001"
check "retire that rewrites content rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET status = 'RETIRED', retired_at = now(), title = 'x', lock_version = lock_version + 1 WHERE id = '$D4';")" "AT001"
check "PUBLISHED → RETIRED" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET status = 'RETIRED', retired_at = now(), retired_by = '$ADMIN_A', lock_version = lock_version + 1 WHERE id = '$D4';")" "OK"
check "RETIRED content mutation rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET title = 'Rewrite', lock_version = lock_version + 1 WHERE id = '$D4';")" "AT001"
check "RETIRED → PUBLISHED rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET status = 'PUBLISHED', retired_at = NULL, retired_by = NULL, lock_version = lock_version + 1 WHERE id = '$D4';")" "AT001"
check "RETIRED → DRAFT rejected" "$(sqlstate "
UPDATE assurance_inspection_template_versions SET status = 'DRAFT', published_at = NULL, published_by = NULL, retired_at = NULL, retired_by = NULL, lock_version = lock_version + 1 WHERE id = '$D4';")" "AT001"
check "DELETE of a RETIRED version rejected" "$(sqlstate "DELETE FROM assurance_inspection_template_versions WHERE id = '$IT1V1';")" "AT001"
check "DELETE of a PUBLISHED version rejected" "$(sqlstate "DELETE FROM assurance_inspection_template_versions WHERE id = '$IT3V1';")" "AT001"
check "audit table: PUBLISHED content mutation rejected" "$(sqlstate "
UPDATE assurance_audit_template_versions SET criteria = '[]'::jsonb, lock_version = lock_version + 1 WHERE id = '22222222-2222-4222-8222-000000000013';")" "AT001"
AD4="22222222-2222-4222-8222-000000000014"
check "audit table: draft insert + edit + delete (only drafts deletable)" "$(sqlstate "BEGIN;
INSERT INTO assurance_audit_template_versions (id, organisation_id, template_id, version_number, title, criteria, status, published_at, published_by, created_by)
VALUES ('$AD4', '$ORG_A', '$AT1', 4, 'Audit v4 draft', '[]'::jsonb, 'DRAFT', NULL, NULL, '$ADMIN_A');
UPDATE assurance_audit_template_versions SET standard_reference = 'ISO 45001', lock_version = lock_version + 1 WHERE id = '$AD4';
DELETE FROM assurance_audit_template_versions WHERE id = '$AD4';
COMMIT;")" "OK"

echo ""
echo "== 6. Operational binding =="
D5="11111111-1111-4111-8111-000000000015"
q "INSERT INTO assurance_inspection_template_versions (id, organisation_id, template_id, version_number, title, status, published_at, created_by)
   VALUES ('$D5', '$ORG_A', '$IT3', 2, 'Legacy new v2 draft', 'DRAFT', NULL, '$ADMIN_A');" >/dev/null
AD5="22222222-2222-4222-8222-000000000015"
q "INSERT INTO assurance_audit_template_versions (id, organisation_id, template_id, version_number, title, criteria, status, published_at, created_by)
   VALUES ('$AD5', '$ORG_A', '$AT1', 5, 'Audit v5 draft', '[]'::jsonb, 'DRAFT', NULL, '$ADMIN_A');" >/dev/null
check "inspection cannot bind to a DRAFT version" "$(sqlstate "
INSERT INTO assurance_inspections (organisation_id, inspection_reference, template_version_id, inspection_type, title)
VALUES ('$ORG_A', 'INS-0901', '$D5', 'SAFETY', 'x');")" "AT002"
check "inspection cannot bind to a RETIRED version" "$(sqlstate "
INSERT INTO assurance_inspections (organisation_id, inspection_reference, template_version_id, inspection_type, title)
VALUES ('$ORG_A', 'INS-0902', '$IT1V1', 'SITE', 'x');")" "AT002"
check "inspection cannot bind to another organisation's version" "$(sqlstate "
INSERT INTO assurance_inspections (organisation_id, inspection_reference, template_version_id, inspection_type, title)
VALUES ('$ORG_A', 'INS-0903', '$BT1V1', 'SITE', 'x');")" "AT002"
check "inspection cannot be re-pointed to a RETIRED version" "$(sqlstate "
UPDATE assurance_inspections SET template_version_id = '$IT1V2' WHERE inspection_reference = 'INS-0003';")" "AT002"
check "ad hoc inspection (no template) still allowed" "$(sqlstate "
INSERT INTO assurance_inspections (organisation_id, inspection_reference, inspection_type, title)
VALUES ('$ORG_A', 'INS-0904', 'SITE', 'Ad hoc');")" "OK"
check "unrelated update of a record bound to a RETIRED version still allowed" "$(sqlstate "
UPDATE assurance_inspections SET status = 'IN_PROGRESS', started_at = now() WHERE inspection_reference = 'INS-0001';")" "OK"
check "audit cannot bind to a DRAFT version" "$(sqlstate "
INSERT INTO assurance_audits (organisation_id, audit_reference, template_version_id, audit_type, title, scope)
VALUES ('$ORG_A', 'AUD-0901', '$AD5', 'CONTRACTOR', 'x', 'Scope');")" "AT002"
check "audit cannot bind to a RETIRED version" "$(sqlstate "
INSERT INTO assurance_audits (organisation_id, audit_reference, template_version_id, audit_type, title, scope)
VALUES ('$ORG_A', 'AUD-0902', '$AT1V1', 'CONTRACTOR', 'x', 'Scope');")" "AT002"
check "audit cannot bind to another organisation's version" "$(sqlstate "
INSERT INTO assurance_audits (organisation_id, audit_reference, template_version_id, audit_type, title, scope)
VALUES ('$ORG_A', 'AUD-0903', '$BAT1V1', 'CONTRACTOR', 'x', 'Scope');")" "AT002"

echo ""
echo "== 7. Retire-vs-create race =="
# (a) Retire commits first: the waiting create re-reads the version and fails.
( printf "BEGIN;\nUPDATE assurance_inspection_template_versions SET status='RETIRED', retired_at=now(), retired_by='%s', lock_version=lock_version+1 WHERE id='%s';\nSELECT pg_sleep(3);\nCOMMIT;\n" "$ADMIN_A" "$IT3V1" \
  | docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >/dev/null 2>&1 ) &
RETIRE_PID=$!
sleep 1.5
RACE_A=$(sqlstate "INSERT INTO assurance_inspections (organisation_id, inspection_reference, template_version_id, inspection_type, title)
VALUES ('$ORG_A', 'INS-0911', '$IT3V1', 'SAFETY', 'Race A');")
wait "$RETIRE_PID"
check "create waiting on an in-flight retire is rejected after it commits" "$RACE_A" "AT002"
check "no record bound in race (a)" "$(q "SELECT count(*) FROM assurance_inspections WHERE inspection_reference='INS-0911'")" "0"
# (b) Create holds its FOR SHARE first: the retire waits, then succeeds; the
#     record keeps the version it bound while that version was PUBLISHED.
q "UPDATE assurance_audit_template_versions SET status='PUBLISHED', published_at=now(), published_by='$ADMIN_A', lock_version=lock_version+1 WHERE id='$AD5';" >/dev/null
( printf "BEGIN;\nINSERT INTO assurance_audits (organisation_id, audit_reference, template_version_id, audit_type, title, scope) VALUES ('%s','AUD-0912','%s','CONTRACTOR','Race B','Scope');\nSELECT pg_sleep(3);\nCOMMIT;\n" "$ORG_A" "$AD5" \
  | docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >/dev/null 2>&1 ) &
CREATE_PID=$!
sleep 1.5
T0=$(date +%s)
RACE_B=$(sqlstate "UPDATE assurance_audit_template_versions SET status='RETIRED', retired_at=now(), retired_by='$ADMIN_A', lock_version=lock_version+1 WHERE id='$AD5';")
T1=$(date +%s)
wait "$CREATE_PID"
check "retire waits for the in-flight create, then succeeds" "$RACE_B" "OK"
check "retire was blocked by the create's FOR SHARE lock" "$([ $((T1 - T0)) -ge 1 ] && echo blocked || echo not-blocked)" "blocked"
check "record from race (b) committed and bound" "$(q "SELECT count(*) FROM assurance_audits WHERE audit_reference='AUD-0912' AND template_version_id='$AD5'")" "1"

echo ""
echo "== 8. Idempotent re-application =="
BEFORE=$(q "SELECT string_agg(id || ':' || status || ':' || lock_version || ':' || coalesce(published_at::text,'-') || ':' || coalesce(retired_at::text,'-'), ',' ORDER BY id) FROM (SELECT id, status, lock_version, published_at, retired_at FROM assurance_inspection_template_versions UNION ALL SELECT id, status, lock_version, published_at, retired_at FROM assurance_audit_template_versions) s")
psql_exec < "$A01F" >/dev/null && REAPPLY=OK || REAPPLY=FAILED
check "A0.1F re-applies cleanly" "$REAPPLY" "OK"
AFTER=$(q "SELECT string_agg(id || ':' || status || ':' || lock_version || ':' || coalesce(published_at::text,'-') || ':' || coalesce(retired_at::text,'-'), ',' ORDER BY id) FROM (SELECT id, status, lock_version, published_at, retired_at FROM assurance_inspection_template_versions UNION ALL SELECT id, status, lock_version, published_at, retired_at FROM assurance_audit_template_versions) s")
check "re-application changes no version row (drafts preserved)" "$([ "$BEFORE" = "$AFTER" ] && echo same || echo changed)" "same"
check "re-application keeps exactly 4 lifecycle/binding triggers" \
  "$(q "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND (tgname LIKE '%_lifecycle' OR tgname LIKE '%_published_template')")" "4"

echo ""
echo "== 9. Rollback round-trip =="
DRAFTS=$(q "SELECT (SELECT count(*) FROM assurance_inspection_template_versions WHERE status='DRAFT') + (SELECT count(*) FROM assurance_audit_template_versions WHERE status='DRAFT')")
NONDRAFT=$(q "SELECT (SELECT count(*) FROM assurance_inspection_template_versions WHERE status<>'DRAFT') + (SELECT count(*) FROM assurance_audit_template_versions WHERE status<>'DRAFT')")
RECORDS=$(q "SELECT (SELECT count(*) FROM assurance_inspections) + (SELECT count(*) FROM assurance_audits)")
check "rollback precondition: there is a draft to discard" "$DRAFTS" "1"
psql_exec < "$A01F_ROLLBACK" >/dev/null 2>&1 && RB=OK || RB=FAILED
check "rollback applies" "$RB" "OK"
check "rollback discarded the DRAFT and kept every published/retired version" \
  "$(q "SELECT (SELECT count(*) FROM assurance_inspection_template_versions) + (SELECT count(*) FROM assurance_audit_template_versions)")" "$NONDRAFT"
check "rollback kept every Inspection/Audit" "$(q "SELECT (SELECT count(*) FROM assurance_inspections) + (SELECT count(*) FROM assurance_audits)")" "$RECORDS"
check "rollback removed every lifecycle column" \
  "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name IN ('assurance_inspection_template_versions','assurance_audit_template_versions') AND column_name IN ('status','published_at','published_by','retired_at','retired_by','updated_at','updated_by','lock_version')")" "0"
check "rollback restored always-immutable versions (UPDATE rejected)" "$(sqlstate "UPDATE assurance_inspection_template_versions SET title = 'x' WHERE id = '$IT1V1';")" "P0001"
check "after rollback: binding to an old version is unrestricted again (pre-A0.1F shape)" "$(sqlstate "
INSERT INTO assurance_inspections (organisation_id, inspection_reference, template_version_id, inspection_type, title)
VALUES ('$ORG_A', 'INS-0921', '$IT1V1', 'SITE', 'Post-rollback');")" "OK"
psql_exec < "$A01F_ROLLBACK" >/dev/null 2>&1 && RB2=OK || RB2=FAILED
check "rollback is idempotent" "$RB2" "OK"
psql_exec < "$A01F" >/dev/null && RE=OK || RE=FAILED
check "A0.1F re-applies after rollback" "$RE" "OK"
check "round-trip: exactly one PUBLISHED (latest) per template, rest RETIRED" \
  "$(q "SELECT count(*) FROM (SELECT template_id FROM assurance_inspection_template_versions GROUP BY template_id
          HAVING count(*) FILTER (WHERE status='PUBLISHED') <> 1
              OR max(version_number) <> max(version_number) FILTER (WHERE status='PUBLISHED')) bad")" "0"
check "round-trip: lifecycle constraints validated on all rows" \
  "$(q "SELECT count(*) FROM pg_constraint WHERE conname LIKE '%template_versions_lifecycle_state_check' AND convalidated")" "2"

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
exit 0
