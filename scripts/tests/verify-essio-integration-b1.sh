#!/usr/bin/env bash
# Essio integration B1 — real disposable-Postgres proof for:
#   * scripts/create-organiser-items-org-id-key-a01a.sql (A0.1A reconciliation)
#   * scripts/create-essio-integration-b1.sql (credentials + external links)
#   * scripts/seed-essio-integration-capability.sql
# and the service/DB suite scripts/tests/essioIntegrationB1.integration.test.ts.
#
# Same methodology as every other real-Postgres harness in this repo: a fresh
# postgres:17-alpine container (Production is 17) created and destroyed by
# this script only. Never touches Production/Neon or any running database.
#
# Scenarios (one database each):
#   A  repo_style   A0.1A absent        -> A0.1A adds it; B1 + seed apply; reruns are no-ops
#   B  prod_like    A0.1A present, with assurance_action_tasks FK relying on it
#                                       -> A0.1A no-op (same constraint OID, FK intact); B1 + seed apply
#   C  equivalent   unique index (id, organisation_id) under another name
#                                       -> A0.1A no-op (no duplicate); B1 applies
#   D  name_clash   non-equivalent index already named organiser_items_organisation_id_id_key
#                                       -> A0.1A fails clearly, nothing added
#   E  duplicates   organiser_items without PK holding a duplicate (organisation_id, id)
#                                       -> A0.1A fails clearly, data untouched
#   F  no_a01a      B1 without A0.1A    -> B1 preflight fails clearly, nothing created
# Then the vitest integration suite runs against scenario A's database.

set -uo pipefail
cd "$(dirname "$0")/../.."

CONTAINER="essio-b1-harness-$$"
HOST_PORT=$((20000 + RANDOM % 20000))
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 1
fi

echo "Starting disposable postgres:17-alpine ($CONTAINER) on 127.0.0.1:$HOST_PORT..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=postgres \
  -p "127.0.0.1:${HOST_PORT}:5432" postgres:17-alpine >/dev/null
READY=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 0.5
done
[ "$READY" = 1 ] || { echo "ERROR: postgres did not become ready" >&2; exit 1; }
sleep 1

createdb_() { docker exec "$CONTAINER" createdb -U postgres "$1"; }
# Run a SQL file (stdin) in one database; ON_ERROR_STOP.
apply_file() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d "$1" -v ON_ERROR_STOP=1 < "$2"; }
apply_sql() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d "$1" -v ON_ERROR_STOP=1; }
query() { docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d "$1" -v ON_ERROR_STOP=1 -c "$2"; }

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILURES+=("$1"); }
expect_eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }

A01A=scripts/create-organiser-items-org-id-key-a01a.sql
B1=scripts/create-essio-integration-b1.sql
SEED=scripts/seed-essio-integration-capability.sql

# ─── Base schema: the real organiser/platform tables these migrations touch,
# as created by app/api/admin/migrate/route.ts, scripts/create-modules.sql,
# scripts/create-organisation-modules.sql and the Prisma AuditLog model —
# WITHOUT A0.1A (the repo never creates it). ───────────────────────────────
BASE_SQL=$(cat <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (
  id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE'
);
CREATE TABLE organiser_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL, color TEXT, icon TEXT, position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE organiser_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id), name TEXT NOT NULL, color TEXT,
  position INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE organiser_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  group_id UUID REFERENCES organiser_groups(id) ON DELETE SET NULL,
  parent_item_id UUID REFERENCES organiser_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Not Started', priority TEXT, owner TEXT,
  due_date DATE, notes TEXT, fields JSONB NOT NULL DEFAULT '{}', position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE organiser_items ADD COLUMN IF NOT EXISTS custom_values JSONB NOT NULL DEFAULT '{}';
ALTER TABLE organiser_items ADD COLUMN IF NOT EXISTS assignee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_organiser_items_org ON organiser_items(organisation_id);
CREATE TABLE organiser_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  board_id UUID NOT NULL, item_id UUID,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'board.created','board.updated','board.deleted','group.created','group.updated','group.deleted',
    'column.created','column.updated','column.deleted','item.created','item.updated','item.moved','item.deleted',
    'comment.created','comment.deleted','file.added','file.deleted','import.completed')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('board','group','item','column','file','comment','import')),
  entity_id TEXT NOT NULL, before_json JSONB, after_json JSONB,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE modules (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE organisation_modules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL, module_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false, config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organisation_modules_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE RESTRICT,
  CONSTRAINT organisation_modules_module_key_fkey FOREIGN KEY (module_key) REFERENCES modules(key) ON DELETE RESTRICT,
  CONSTRAINT organisation_modules_organisation_id_module_key_key UNIQUE (organisation_id, module_key)
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id), action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT,
  before_state JSONB, after_state JSONB, ip_address TEXT, user_agent TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO organisations VALUES ('org-a', 'Org A', 'org-a'), ('org-b', 'Org B', 'org-b');
INSERT INTO users (id, organisation_id, username, name) VALUES ('user-a', 'org-a', 'ua', 'User A'), ('user-b', 'org-b', 'ub', 'User B');
INSERT INTO organiser_boards (id, organisation_id, name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'org-a', 'Board A'),
  ('22222222-2222-4222-8222-222222222222', 'org-b', 'Board B');
INSERT INTO organiser_items (board_id, organisation_id, name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'org-a', 'Seed item A'),
  ('22222222-2222-4222-8222-222222222222', 'org-b', 'Seed item B');
SQL
)

SCHEMA_FP="SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL SELECT 'con:' || conrelid::regclass || ':' || conname || ':' || pg_get_constraintdef(oid)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL SELECT 'idx:' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'trg:' || tgrelid::regclass || ':' || tgname FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'fn:' || p.proname || ':' || md5(p.prosrc) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
) s"
CORE_DATA_FP="SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
  SELECT 'o:' || o::text AS t FROM organisations o UNION ALL SELECT 'u:' || u::text FROM users u
  UNION ALL SELECT 'b:' || b::text FROM organiser_boards b UNION ALL SELECT 'i:' || i::text FROM organiser_items i
) s"
B1_OBJECTS_FP="SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('integration_credentials', 'organiser_item_external_links')
  UNION ALL SELECT 'con:' || conrelid::regclass || ':' || conname || ':' || pg_get_constraintdef(oid)
    FROM pg_constraint WHERE conrelid IN ('integration_credentials'::regclass, 'organiser_item_external_links'::regclass)
  UNION ALL SELECT 'idx:' || indexdef FROM pg_indexes WHERE tablename IN ('integration_credentials', 'organiser_item_external_links')
  UNION ALL SELECT 'trg:' || tgrelid::regclass || ':' || tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('integration_credentials'::regclass, 'organiser_item_external_links'::regclass)
) s"
UNIQUE_ORG_ID_COUNT="SELECT count(*) FROM pg_index ix WHERE ix.indrelid = 'organiser_items'::regclass AND ix.indisunique
  AND ix.indnkeyatts = 2 AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
    FROM unnest(ix.indkey::int2[]) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
    WHERE k.ord <= ix.indnkeyatts) = ARRAY['id','organisation_id']"

echo; echo "=== Scenario A: repo-style schema (A0.1A absent) ==="
createdb_ repo_style
echo "$BASE_SQL" | apply_sql repo_style >/dev/null
expect_eq "A: A0.1A absent before" "$(query repo_style "$UNIQUE_ORG_ID_COUNT")" "0"
if apply_file repo_style "$A01A" 2>&1 | grep -q "added organiser_items_organisation_id_id_key"; then pass "A: A0.1A added the constraint"; else fail "A: A0.1A did not report adding"; fi
expect_eq "A: constraint definition" \
  "$(query repo_style "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='organiser_items_organisation_id_id_key'")" \
  "UNIQUE (organisation_id, id)"
OID_A=$(query repo_style "SELECT oid FROM pg_constraint WHERE conname='organiser_items_organisation_id_id_key'")
if apply_file repo_style "$A01A" 2>&1 | grep -q "already exists (organiser_items_organisation_id_id_key)"; then pass "A: A0.1A rerun is a no-op"; else fail "A: A0.1A rerun not a no-op"; fi
expect_eq "A: same constraint after rerun" "$(query repo_style "SELECT oid FROM pg_constraint WHERE conname='organiser_items_organisation_id_id_key'")" "$OID_A"
expect_eq "A: exactly one equivalent uniqueness" "$(query repo_style "$UNIQUE_ORG_ID_COUNT")" "1"
DATA_A0=$(query repo_style "$CORE_DATA_FP")
apply_file repo_style "$B1" >/dev/null 2>&1 && pass "A: B1 applied" || fail "A: B1 failed"
apply_file repo_style "$SEED" >/dev/null 2>&1 && pass "A: seed applied" || fail "A: seed failed"
SCHEMA_A1=$(query repo_style "$SCHEMA_FP")
for f in "$A01A" "$B1" "$SEED"; do apply_file repo_style "$f" >/dev/null 2>&1 || fail "A: rerun of $f failed"; done
expect_eq "A: schema unchanged by rerunning all three files" "$(query repo_style "$SCHEMA_FP")" "$SCHEMA_A1"
expect_eq "A: seed registered essio_integration (active)" "$(query repo_style "SELECT key || ':' || active FROM modules WHERE key='essio_integration'")" "essio_integration:true"
expect_eq "A: seed granted nothing" "$(query repo_style "SELECT count(*) FROM organisation_modules")" "0"
expect_eq "A: existing data unchanged by A0.1A/B1/seed and reruns" "$(query repo_style "$CORE_DATA_FP")" "$DATA_A0"
B1_FP_A=$(query repo_style "$B1_OBJECTS_FP")
expect_eq "A: new tables empty" "$(query repo_style "SELECT (SELECT count(*) FROM integration_credentials) + (SELECT count(*) FROM organiser_item_external_links)")" "0"

echo; echo "=== Scenario B: production-like schema (A0.1A present and in use) ==="
createdb_ prod_like
echo "$BASE_SQL" | apply_sql prod_like >/dev/null
apply_sql prod_like >/dev/null <<'SQL'
ALTER TABLE organiser_items ADD CONSTRAINT organiser_items_organisation_id_id_key UNIQUE (organisation_id, id);
CREATE TABLE assurance_action_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL, action_id UUID NOT NULL,
  organiser_item_id UUID NOT NULL,
  CONSTRAINT assurance_action_tasks_organiser_item_org_fkey
    FOREIGN KEY (organisation_id, organiser_item_id) REFERENCES organiser_items(organisation_id, id)
);
INSERT INTO assurance_action_tasks (organisation_id, action_id, organiser_item_id)
  SELECT organisation_id, gen_random_uuid(), id FROM organiser_items WHERE organisation_id = 'org-a';
SQL
OID_B=$(query prod_like "SELECT oid FROM pg_constraint WHERE conname='organiser_items_organisation_id_id_key'")
FK_B=$(query prod_like "SELECT pg_get_constraintdef(oid) || ':' || convalidated || ':' || conindid::regclass FROM pg_constraint WHERE conname='assurance_action_tasks_organiser_item_org_fkey'")
DATA_B0=$(query prod_like "$CORE_DATA_FP")
TASKS_B0=$(query prod_like "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM assurance_action_tasks t")
if apply_file prod_like "$A01A" 2>&1 | grep -q "already exists (organiser_items_organisation_id_id_key)"; then pass "B: A0.1A is a no-op"; else fail "B: A0.1A was not a no-op"; fi
expect_eq "B: production constraint not dropped/recreated (same OID)" "$(query prod_like "SELECT oid FROM pg_constraint WHERE conname='organiser_items_organisation_id_id_key'")" "$OID_B"
expect_eq "B: no duplicate equivalent constraint" "$(query prod_like "$UNIQUE_ORG_ID_COUNT")" "1"
expect_eq "B: assurance FK unchanged and still uses the constraint" "$(query prod_like "SELECT pg_get_constraintdef(oid) || ':' || convalidated || ':' || conindid::regclass FROM pg_constraint WHERE conname='assurance_action_tasks_organiser_item_org_fkey'")" "$FK_B"
apply_file prod_like "$B1" >/dev/null 2>&1 && pass "B: B1 applied" || fail "B: B1 failed"
apply_file prod_like "$SEED" >/dev/null 2>&1 && pass "B: seed applied" || fail "B: seed failed"
SCHEMA_B1=$(query prod_like "$SCHEMA_FP")
for f in "$A01A" "$B1" "$SEED"; do apply_file prod_like "$f" >/dev/null 2>&1 || fail "B: rerun of $f failed"; done
expect_eq "B: schema unchanged by reruns" "$(query prod_like "$SCHEMA_FP")" "$SCHEMA_B1"
expect_eq "B: existing data unchanged" "$(query prod_like "$CORE_DATA_FP")" "$DATA_B0"
expect_eq "B: assurance links unchanged" "$(query prod_like "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM assurance_action_tasks t")" "$TASKS_B0"
expect_eq "B: B1 objects identical to the repo-style result" "$(query prod_like "$B1_OBJECTS_FP")" "$B1_FP_A"

echo; echo "=== Scenario C: equivalent uniqueness under another name ==="
createdb_ equivalent
echo "$BASE_SQL" | apply_sql equivalent >/dev/null
query equivalent "CREATE UNIQUE INDEX organiser_items_alt_uidx ON organiser_items (id, organisation_id)" >/dev/null
if apply_file equivalent "$A01A" 2>&1 | grep -q "already exists (organiser_items_alt_uidx)"; then pass "C: A0.1A recognised the equivalent index"; else fail "C: A0.1A did not recognise equivalent"; fi
expect_eq "C: no duplicate constraint created" "$(query equivalent "$UNIQUE_ORG_ID_COUNT")" "1"
expect_eq "C: production name not added" "$(query equivalent "SELECT count(*) FROM pg_constraint WHERE conname='organiser_items_organisation_id_id_key'")" "0"
apply_file equivalent "$B1" >/dev/null 2>&1 && pass "C: B1 applies against the equivalent index" || fail "C: B1 failed"

echo; echo "=== Scenario D: name taken by a non-equivalent object ==="
createdb_ name_clash
echo "$BASE_SQL" | apply_sql name_clash >/dev/null
query name_clash "CREATE INDEX organiser_items_organisation_id_id_key ON organiser_items (organisation_id)" >/dev/null
OUT_D=$(apply_file name_clash "$A01A" 2>&1); RC_D=$?
if [ $RC_D -ne 0 ] && echo "$OUT_D" | grep -q "already used by an object that is not an equivalent"; then pass "D: A0.1A fails clearly"; else fail "D: expected clear failure (rc=$RC_D)"; fi
expect_eq "D: nothing added" "$(query name_clash "$UNIQUE_ORG_ID_COUNT")" "0"

echo; echo "=== Scenario E: data that prevents the constraint ==="
createdb_ duplicates
apply_sql duplicates >/dev/null <<'SQL'
CREATE TABLE organiser_items (id UUID NOT NULL, organisation_id TEXT NOT NULL, name TEXT NOT NULL);
INSERT INTO organiser_items VALUES
  ('33333333-3333-4333-8333-333333333333', 'org-a', 'one'),
  ('33333333-3333-4333-8333-333333333333', 'org-a', 'duplicate'),
  ('44444444-4444-4444-8444-444444444444', 'org-a', 'fine');
SQL
DATA_E0=$(query duplicates "SELECT md5(string_agg(i::text, '|' ORDER BY i::text)) FROM organiser_items i")
OUT_E=$(apply_file duplicates "$A01A" 2>&1); RC_E=$?
if [ $RC_E -ne 0 ] && echo "$OUT_E" | grep -q "1 duplicate (organisation_id, id) pair(s)"; then pass "E: A0.1A fails clearly on duplicate data"; else fail "E: expected clear duplicate failure (rc=$RC_E)"; fi
expect_eq "E: data untouched" "$(query duplicates "SELECT md5(string_agg(i::text, '|' ORDER BY i::text)) FROM organiser_items i")" "$DATA_E0"
expect_eq "E: no constraint added" "$(query duplicates "SELECT count(*) FROM pg_constraint WHERE conrelid='organiser_items'::regclass")" "0"

echo; echo "=== Scenario F: B1 without A0.1A ==="
createdb_ no_a01a
echo "$BASE_SQL" | apply_sql no_a01a >/dev/null
OUT_F=$(apply_file no_a01a "$B1" 2>&1); RC_F=$?
if [ $RC_F -ne 0 ] && echo "$OUT_F" | grep -q "apply scripts/create-organiser-items-org-id-key-a01a.sql first"; then pass "F: B1 preflight fails clearly"; else fail "F: expected B1 preflight failure (rc=$RC_F)"; fi
expect_eq "F: nothing created" "$(query no_a01a "SELECT count(*) FROM pg_class WHERE relname IN ('integration_credentials','organiser_item_external_links')")" "0"

echo; echo "=== Service + database suite (vitest, scenario A database) ==="
export DATABASE_URL="postgresql://postgres:test@localhost:${HOST_PORT}/repo_style"
if npx vitest run --config vitest.integration.config.ts scripts/tests/essioIntegrationB1.integration.test.ts; then
  pass "vitest integration suite"
else
  fail "vitest integration suite"
fi

echo
if [ ${#FAILURES[@]} -eq 0 ]; then
  echo "ALL ESSIO B1 CHECKS PASSED"
  exit 0
fi
echo "FAILED (${#FAILURES[@]}):"
printf '  - %s\n' "${FAILURES[@]}"
exit 1
