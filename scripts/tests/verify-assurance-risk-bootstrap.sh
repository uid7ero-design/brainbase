#!/usr/bin/env bash
# BrainBase Assurance — Brainbase risk-level bootstrap seed proof.
#
# Starts a throwaway postgres:17 container, creates minimal stand-ins for
# the pre-existing platform tables, applies the REAL Assurance migrations
# (A0.1B, A0.1C, A0.1D-1..3, A0.1E-1, A0.1F), then drives
# scripts/seed-assurance-risk-levels-brainbase.sql through every guard and
# CASE A / B / C, proving that every refusal changes nothing. Finally runs
# the application regression suite
# (scripts/tests/assuranceRiskBootstrap.integration.test.ts) against the
# seeded scale.
#
# Never touches Neon Preview/Production: the container is bound to
# 127.0.0.1 and the spec refuses any non-localhost DATABASE_URL.
#
# Usage:   bash scripts/tests/verify-assurance-risk-bootstrap.sh
# Exit:    0 = pass, 1 = test failure, 2 = harness/setup failure.
# Always destroys its own container.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

SEED=scripts/seed-assurance-risk-levels-brainbase.sql
BB=1732569e-6350-495e-aa6a-7218ce7bf749
MIGRATIONS="scripts/create-shared-foundations-a01b.sql scripts/create-assurance-core-a01c.sql
  scripts/create-assurance-incidents-a01d1.sql scripts/create-assurance-investigations-a01d2.sql
  scripts/create-assurance-inspections-a01d3.sql scripts/create-assurance-audits-a01e1.sql \
  scripts/create-assurance-template-lifecycle-a01f.sql"

CONTAINER="brainbase-assurance-risk-$$"
HOST_PORT=$((20000 + RANDOM % 20000))

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for f in $SEED $MIGRATIONS; do
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
psql_q() { docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1; }
q() { echo "$1" | psql_q | tr -d '[:space:]'; }

cat <<'SQL' | psql_exec >/dev/null || { echo "ERROR: base schema failed." >&2; exit 2; }
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Stand-ins for pre-existing platform tables, shaped like the real ones
-- (same as scripts/tests/verify-assurance-ui-services.sh).
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
for f in $MIGRATIONS; do
  psql_exec < "$f" >/dev/null || { echo "ERROR: $f failed to apply." >&2; exit 2; }
done

# Production-shaped starting state: Brainbase registered + entitled; a second
# organisation with its own (different) scale that must never be touched.
cat <<SQL | psql_exec >/dev/null || { echo "ERROR: fixture state failed." >&2; exit 2; }
INSERT INTO organisations (id, name, slug, updated_at) VALUES
  ('$BB', 'Brainbase', 'brainbase', now()),
  ('risk-other-org', 'Other Org', 'risk-other-org', now());
INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
  ('bb-admin', '$BB', 'bb-admin', 'Bea Admin', 'ADMIN', 'ACTIVE', now()),
  ('bb-mgr', '$BB', 'bb-mgr', 'Ben Manager', 'MANAGER', 'ACTIVE', now());
INSERT INTO modules (key, name, description, active) VALUES
  ('assurance', 'Assurance', 'Incidents, investigations, inspections, findings, corrective actions, evidence and verification.', true);
INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES
  ('$BB', 'assurance', true), ('risk-other-org', 'assurance', true);
INSERT INTO assurance_risk_levels (organisation_id, code, name, rank, is_active, requires_verification) VALUES
  ('risk-other-org', 'LOW', 'Other low', 1, true, false),
  ('risk-other-org', 'HIGH', 'Other high', 2, true, true);
SQL

FAILS=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1" >&2; FAILS=$((FAILS + 1)); }

# Fingerprint of every row the seed could conceivably affect.
snapshot() {
  q "SELECT md5(coalesce((SELECT string_agg(row(r.*)::text, '|' ORDER BY r.id) FROM assurance_risk_levels r), '')
     || coalesce((SELECT string_agg(row(o.*)::text, '|' ORDER BY o.id) FROM organisation_modules o), '')
     || coalesce((SELECT string_agg(row(mm.*)::text, '|' ORDER BY mm.key) FROM modules mm), '')
     || coalesce((SELECT string_agg(row(g.id, g.name)::text, '|' ORDER BY g.id) FROM organisations g), ''));"
}
bb_rows() { q "SELECT count(*) FROM assurance_risk_levels WHERE organisation_id = '$BB';"; }

SEED_OUT=""
run_seed() { SEED_OUT="$(psql_exec < "$SEED" 2>&1)"; }

# expect_refused <label> <message-regex>: seed must fail, match the message,
# and leave the fingerprint unchanged.
expect_refused() {
  local label="$1" pattern="$2" before after
  before="$(snapshot)"
  if run_seed; then fail "$label: seed unexpectedly succeeded"; return; fi
  after="$(snapshot)"
  if ! echo "$SEED_OUT" | grep -Eq "$pattern"; then fail "$label: wrong error: $(echo "$SEED_OUT" | grep -m1 ERROR)"; return; fi
  if [ "$before" != "$after" ]; then fail "$label: state changed"; return; fi
  pass "$label (refused, nothing changed)"
}
reset_bb_levels() { echo "DELETE FROM assurance_risk_levels WHERE organisation_id = '$BB';" | psql_exec >/dev/null; }
EXPECTED="EXTREME|Extreme|40|t|t|Severe risk requiring immediate attention and action.
HIGH|High|30|t|t|Significant risk requiring prompt management attention.
MEDIUM|Medium|20|t|f|Moderate risk requiring a planned and monitored response.
LOW|Low|10|t|f|Minor risk that can be managed through routine controls."
bb_matrix() {
  echo "SELECT code, name, rank, is_active, requires_verification, description FROM assurance_risk_levels WHERE organisation_id = '$BB' ORDER BY rank DESC;" | psql_q
}

echo "Seed scenarios ..."

# 1 + 11 + 12 + 13: CASE A
OTHER_BEFORE="$(q "SELECT md5(string_agg(row(r.*)::text, '|' ORDER BY r.id)) FROM assurance_risk_levels r WHERE organisation_id = 'risk-other-org';")"
if run_seed && [ "$(bb_rows)" = "4" ]; then pass "1  zero rows -> inserts exactly 4"; else fail "1  zero rows -> insert: $SEED_OUT"; fi
if [ "$(bb_matrix)" = "$EXPECTED" ]; then
  pass "11 codes/ranks LOW 10, MEDIUM 20, HIGH 30, EXTREME 40 (+ names, descriptions)"
  pass "12 is_active = true for all four"
  pass "13 requires_verification LOW f, MEDIUM f, HIGH t, EXTREME t"
else
  fail "11-13 matrix mismatch:"; bb_matrix >&2
fi
[ "$(q "SELECT count(*) FROM assurance_risk_levels WHERE organisation_id = '$BB' AND created_by IS NULL;")" = "4" ] \
  && pass "   created_by is NULL (bootstrap, not attributed to a user)" || fail "   created_by not NULL"
[ "$(q "SELECT md5(string_agg(row(r.*)::text, '|' ORDER BY r.id)) FROM assurance_risk_levels r WHERE organisation_id = 'risk-other-org';")" = "$OTHER_BEFORE" ] \
  && pass "   other organisation's risk levels untouched" || fail "   other organisation's risk levels changed"

# 2: CASE B
BEFORE="$(snapshot)"
if run_seed && [ "$(snapshot)" = "$BEFORE" ] && [ "$(bb_rows)" = "4" ] && echo "$SEED_OUT" | grep -q "match the reviewed set"; then
  pass "2  exact re-run -> no-op, still 4, ids unchanged"
else fail "2  exact re-run: $SEED_OUT"; fi

# 3: partial set
echo "DELETE FROM assurance_risk_levels WHERE organisation_id = '$BB' AND code = 'EXTREME';" | psql_exec >/dev/null
expect_refused "3  partial existing set (3 of 4)" "different risk-level configuration \(3 rows, 3 matching"

# 4: conflicting code
reset_bb_levels
echo "INSERT INTO assurance_risk_levels (organisation_id, code, name, rank) VALUES ('$BB', 'LOW', 'Negligible', 5);" | psql_exec >/dev/null
expect_refused "4  conflicting code (LOW with other name/rank)" "different risk-level configuration"

# 5: conflicting rank
reset_bb_levels
echo "INSERT INTO assurance_risk_levels (organisation_id, code, name, rank) VALUES ('$BB', 'MINOR', 'Minor', 10);" | psql_exec >/dev/null
expect_refused "5  conflicting rank (MINOR at rank 10)" "different risk-level configuration"

# Extra CASE C variants on an otherwise exact set.
reset_bb_levels; run_seed >/dev/null
echo "INSERT INTO assurance_risk_levels (organisation_id, code, name, rank) VALUES ('$BB', 'CATASTROPHIC', 'Catastrophic', 50);" | psql_exec >/dev/null
expect_refused "C  exact four plus an extra level" "\(5 rows, 4 matching"
reset_bb_levels; run_seed >/dev/null
echo "UPDATE assurance_risk_levels SET is_active = false WHERE organisation_id = '$BB' AND code = 'LOW';" | psql_exec >/dev/null
expect_refused "C  exact four but LOW inactive (never reactivated)" "\(4 rows, 3 matching"
reset_bb_levels; run_seed >/dev/null
echo "UPDATE assurance_risk_levels SET description = 'Edited.' WHERE organisation_id = '$BB' AND code = 'HIGH';" | psql_exec >/dev/null
expect_refused "C  exact four but HIGH description edited (never overwritten)" "\(4 rows, 3 matching"
reset_bb_levels; run_seed >/dev/null
echo "UPDATE assurance_risk_levels SET requires_verification = false WHERE organisation_id = '$BB' AND code = 'EXTREME';" | psql_exec >/dev/null
expect_refused "C  exact four but EXTREME requires_verification flipped" "\(4 rows, 3 matching"
reset_bb_levels

# 6: wrong organisation name
echo "UPDATE organisations SET name = 'Brainbase Staging' WHERE id = '$BB';" | psql_exec >/dev/null
expect_refused "6  wrong organisation name" "is named Brainbase Staging, expected Brainbase"
echo "UPDATE organisations SET name = 'Brainbase' WHERE id = '$BB';" | psql_exec >/dev/null

# 7: module missing (entitlement rows must go first: FK ON DELETE RESTRICT)
echo "BEGIN; DELETE FROM organisation_modules WHERE module_key = 'assurance'; DELETE FROM modules WHERE key = 'assurance'; COMMIT;" | psql_exec >/dev/null
expect_refused "7  assurance module missing" "assurance module is not registered"
cat <<SQL | psql_exec >/dev/null
INSERT INTO modules (key, name, description, active) VALUES
  ('assurance', 'Assurance', 'Incidents, investigations, inspections, findings, corrective actions, evidence and verification.', true);
INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('$BB', 'assurance', true), ('risk-other-org', 'assurance', true);
SQL

# 8: module inactive
echo "UPDATE modules SET active = false WHERE key = 'assurance';" | psql_exec >/dev/null
expect_refused "8  assurance module inactive" "assurance module is not active"
echo "UPDATE modules SET active = true WHERE key = 'assurance';" | psql_exec >/dev/null

# 9: entitlement absent
echo "DELETE FROM organisation_modules WHERE organisation_id = '$BB' AND module_key = 'assurance';" | psql_exec >/dev/null
expect_refused "9  Brainbase entitlement absent" "Brainbase has no assurance entitlement"

# 10: entitlement disabled
echo "INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('$BB', 'assurance', false);" | psql_exec >/dev/null
expect_refused "10 Brainbase entitlement disabled" "assurance entitlement is disabled"
echo "UPDATE organisation_modules SET enabled = true WHERE organisation_id = '$BB' AND module_key = 'assurance';" | psql_exec >/dev/null

# Extra guard: organisation missing entirely (on a scratch copy of the ids).
echo "BEGIN; DELETE FROM users WHERE organisation_id = '$BB'; DELETE FROM organisation_modules WHERE organisation_id = '$BB'; DELETE FROM organisations WHERE id = '$BB'; COMMIT;" | psql_exec >/dev/null
expect_refused "G  organisation does not exist" "organisation $BB does not exist"
cat <<SQL | psql_exec >/dev/null
INSERT INTO organisations (id, name, slug, updated_at) VALUES ('$BB', 'Brainbase', 'brainbase', now());
INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
  ('bb-admin', '$BB', 'bb-admin', 'Bea Admin', 'ADMIN', 'ACTIVE', now()),
  ('bb-mgr', '$BB', 'bb-mgr', 'Ben Manager', 'MANAGER', 'ACTIVE', now());
INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('$BB', 'assurance', true);
SQL

# Final seeded state for 14/15 and the application suite.
if run_seed && [ "$(bb_matrix)" = "$EXPECTED" ]; then pass "   restored state seeds cleanly"; else fail "   final seed: $SEED_OUT"; fi

# 14: no operational Assurance record, no audit row (seed only touches risk levels).
OPS="$(q "SELECT sum((xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text::int)
          FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'assurance%' AND table_name <> 'assurance_risk_levels';")"
AUD="$(q "SELECT count(*) FROM audit_logs;")"
[ "$OPS" = "0" ] && [ "$AUD" = "0" ] && pass "14 no operational Assurance record and no audit_logs row created" \
  || fail "14 operational rows=$OPS audit_logs=$AUD"

# 15: no demo fixture ids/data.
DEMO="$(q "SELECT count(*) FROM assurance_risk_levels WHERE id::text LIKE 'a55de000-%' OR organisation_id = 'assurance-demo-org';")"
if [ "$DEMO" = "0" ] && ! grep -Eq "a55de000|assurance-demo" "$SEED"; then pass "15 no demo fixture ids/data (generated ids; seed never references the fixture)"
else fail "15 demo ids/data present"; fi

if [ "$FAILS" -ne 0 ]; then echo "Seed proof FAILED ($FAILS)."; exit 1; fi

export DATABASE_URL="postgresql://postgres:test@127.0.0.1:${HOST_PORT}/testdb"
echo "Running application regression suite on the seeded scale ..."
npx vitest run --config vitest.integration.config.ts scripts/tests/assuranceRiskBootstrap.integration.test.ts || { echo "Application regression FAILED."; exit 1; }

echo "Assurance risk bootstrap proof passed."
exit 0
