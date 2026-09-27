#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

A01B="scripts/create-shared-foundations-a01b.sql"
A01C="scripts/create-assurance-core-a01c.sql"
CONTAINER="brainbase-a01c-singlefile-$$"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for f in "$A01B" "$A01C"; do
  [ -f "$f" ] || { echo "ERROR: $f not found" >&2; exit 2; }
done

docker info >/dev/null 2>&1 || { echo "ERROR: Docker unavailable" >&2; exit 2; }
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:17 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d testdb >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres -d testdb >/dev/null 2>&1 || {
  echo "ERROR: PostgreSQL not ready" >&2; exit 2;
}

psql_file() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1
}
q() {
  printf '%s\n' "$1" | docker exec -i "$CONTAINER" psql -X -q -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 | tr -d '\r[:space:]'
}

cat <<'SQL' | psql_file
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
  name TEXT NOT NULL,
  CONSTRAINT hr_people_organisation_id_id_key UNIQUE (organisation_id, id)
);

INSERT INTO organisations(id,name) VALUES ('org-a','Org A'),('org-b','Org B');
INSERT INTO users(id,organisation_id,name) VALUES
  ('user-a','org-a','User A'),
  ('user-b','org-b','User B');

ALTER TABLE organiser_items
  ADD CONSTRAINT organiser_items_organisation_id_id_key
  UNIQUE (organisation_id, id);
SQL

echo "=== APPLY A0.1B REAL FILE ==="
psql_file < "$A01B" >/dev/null

echo "=== APPLY A0.1C EXACT FILE ==="
psql_file < "$A01C" >/dev/null

table_count="$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_risk_levels','assurance_cases','assurance_case_people','assurance_findings','assurance_actions','assurance_action_findings','assurance_action_tasks','assurance_evidence','assurance_evidence_cases','assurance_evidence_findings','assurance_evidence_actions','assurance_evidence_verifications','assurance_verifications','assurance_timeframes','assurance_timeframe_extensions','assurance_escalations');")"
[ "$table_count" = "16" ] || { echo "FAIL: expected 16 A0.1C tables, got $table_count"; exit 1; }

fk_counts="$(q "SELECT count(*)::text || ':' || count(*) FILTER (WHERE confdeltype='a')::text FROM pg_constraint WHERE contype='f' AND conrelid::regclass::text IN ('assurance_risk_levels','assurance_cases','assurance_case_people','assurance_findings','assurance_actions','assurance_action_findings','assurance_action_tasks','assurance_evidence','assurance_evidence_cases','assurance_evidence_findings','assurance_evidence_actions','assurance_evidence_verifications','assurance_verifications','assurance_timeframes','assurance_timeframe_extensions','assurance_escalations');")"
[ "$fk_counts" = "80:80" ] || { echo "FAIL: expected 80:80 FK/NO ACTION count, got $fk_counts"; exit 1; }

trigger_counts="$(q "SELECT (SELECT count(*) FROM pg_trigger WHERE tgrelid='assurance_verifications'::regclass AND tgname='trg_assurance_verifications_append_only' AND NOT tgisinternal AND tgenabled <> 'D')::text || ':' || (SELECT count(*) FROM pg_trigger WHERE tgrelid='assurance_timeframes'::regclass AND tgname='trg_assurance_timeframes_original_due_at_immutable' AND NOT tgisinternal AND tgenabled <> 'D')::text;")"
[ "$trigger_counts" = "1:1" ] || { echo "FAIL: expected trigger count 1:1, got $trigger_counts"; exit 1; }

a01d_count="$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_incidents','assurance_investigations','assurance_inspections','assurance_audits','assurance_evaluations','assurance_insurance_claims','assurance_contractor_engagements','assurance_contractor_non_conformances');")"
[ "$a01d_count" = "0" ] || { echo "FAIL: A0.1D leakage: $a01d_count tables"; exit 1; }

fingerprint="$(q "WITH names AS (SELECT unnest(ARRAY['assurance_risk_levels','assurance_cases','assurance_case_people','assurance_findings','assurance_actions','assurance_action_findings','assurance_action_tasks','assurance_evidence','assurance_evidence_cases','assurance_evidence_findings','assurance_evidence_actions','assurance_evidence_verifications','assurance_verifications','assurance_timeframes','assurance_timeframe_extensions','assurance_escalations']) AS table_name), objs AS (SELECT table_name || ':COLUMN:' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,'-') AS d FROM information_schema.columns WHERE table_schema='public' AND table_name IN (SELECT table_name FROM names) UNION ALL SELECT c.conrelid::regclass::text || ':CONSTRAINT:' || c.conname || ':' || pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid::regclass::text IN (SELECT table_name FROM names) UNION ALL SELECT tablename || ':INDEX:' || indexname || ':' || indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN (SELECT table_name FROM names) UNION ALL SELECT event_object_table || ':TRIGGER:' || trigger_name || ':' || action_timing || ':' || event_manipulation || ':' || action_statement FROM information_schema.triggers WHERE trigger_schema='public' AND event_object_table IN (SELECT table_name FROM names)) SELECT md5(string_agg(d,E'\\n' ORDER BY d)) FROM objs;")"

echo "=== REAPPLY A0.1C EXACT FILE ==="
psql_file < "$A01C" >/dev/null

table_count_2="$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'assurance_%';")"
[ "$table_count_2" = "16" ] || { echo "FAIL: reapply table count $table_count_2"; exit 1; }

echo "PASS: exact A0.1C file executes through psql -f semantics"
echo "PASS: 16 frozen A0.1C tables"
echo "PASS: 80/80 FKs use ON DELETE NO ACTION"
echo "PASS: both immutability triggers enabled"
echo "PASS: zero A0.1D tables"
echo "PASS: reapply succeeds"
echo "SCHEMA_FINGERPRINT=$fingerprint"
