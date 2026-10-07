#!/usr/bin/env bash
# BrainBase Assurance A0.1I — Finding provenance, closure reason and reopen
# history: disposable PostgreSQL 17 proof.
#
# Applies the REAL migrations A0.1B..A0.1H, seeds LEGACY data under pre-A0.1I
# semantics (terminal Findings without a reason, source links without item
# context), fingerprints the schema, applies A0.1I, then proves:
#   * everything outside the altered tables is byte-for-byte unchanged and
#     every pre-existing column / constraint / index on them is preserved;
#   * legacy CLOSED / CANCELLED rows survive with NULL closure_reason and no
#     reason is fabricated (nor can one be backfilled in place);
#   * structured item / criterion provenance: same source, same org,
#     non-blank, NULL tolerated, never retargeted (all four source tables);
#   * closure reason mandatory on every NEW close / cancel; frozen afterwards;
#   * reopen: CLOSED -> UNDER_REVIEW only with an immutable history row that
#     preserves the previous closure record; numbering; concurrency (one
#     winner); reclose needs a new reason; history is append-only;
#   * non-propagation: Actions, verifications, evidence, sources, risk,
#     timeframes, extensions and escalations are untouched by close/reopen;
#   * idempotent re-apply and destructive rollback round-trip.
#
# Usage:   bash scripts/tests/verify-assurance-findings-reopen-a01i-migration.sh
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
  scripts/create-assurance-template-lifecycle-a01f.sql
  scripts/create-assurance-contractor-assurance-a01g.sql
  scripts/create-assurance-evidence-verification-a01h.sql
)
A01I="scripts/create-assurance-findings-reopen-a01i.sql"
A01I_ROLLBACK="scripts/rollback-assurance-findings-reopen-a01i.sql"
CONTAINER="brainbase-a01i-findings-$$"
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

for f in "${MIGRATIONS[@]}" "$A01I" "$A01I_ROLLBACK"; do
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
  if ! echo "$out" | grep -q '^ERROR:'; then echo "OK"; else echo "$out" | grep -o 'ERROR:  [0-9A-Z]\{5\}' | head -1 | sed 's/ERROR:  //'; fi
}
# bg "<sql>" → run in a background transaction (caller sets BG=$!).
bg() { ( printf '%s\n' "$1" | docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >/dev/null 2>&1 ) & }

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

ALTERED="('assurance_findings','assurance_inspection_findings','assurance_audit_findings','assurance_incident_findings','assurance_investigation_findings','assurance_finding_reopenings')"
NEW_FUNCS="('assurance_finding_lifecycle_guard','assurance_finding_reopening_insert_guard','assurance_finding_reopening_append_only')"
OTHER_FP_SQL="SELECT md5(coalesce((SELECT string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''),'|' ORDER BY table_name,column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name NOT IN $ALTERED),'')
  || coalesce((SELECT string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid),'|' ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE connamespace='public'::regnamespace AND conrelid::regclass::text NOT IN $ALTERED),'')
  || coalesce((SELECT string_agg(tgrelid::regclass::text||':'||tgname||':'||pg_get_triggerdef(oid),'|' ORDER BY tgrelid::regclass::text,tgname) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT IN $ALTERED),'')
  || coalesce((SELECT string_agg(proname||':'||md5(prosrc),'|' ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname NOT IN $NEW_FUNCS),'')
  || coalesce((SELECT string_agg(indexname||':'||indexdef,'|' ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename NOT IN $ALTERED),''));"
FULL_FP_SQL="SELECT md5(coalesce((SELECT string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''),'|' ORDER BY table_name,column_name) FROM information_schema.columns WHERE table_schema='public'),'')
  || coalesce((SELECT string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid),'|' ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE connamespace='public'::regnamespace),'')
  || coalesce((SELECT string_agg(tgrelid::regclass::text||':'||tgname||':'||pg_get_triggerdef(oid),'|' ORDER BY tgrelid::regclass::text,tgname) FROM pg_trigger WHERE NOT tgisinternal),'')
  || coalesce((SELECT string_agg(proname||':'||md5(prosrc),'|' ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace),'')
  || coalesce((SELECT string_agg(indexname||':'||indexdef,'|' ORDER BY indexname) FROM pg_indexes WHERE schemaname='public'),''));"

echo "Applying pre-A0.1I migrations (A0.1B..A0.1H) ..."
for f in "${MIGRATIONS[@]}"; do
  psql_exec < "$f" >/dev/null || { echo "ERROR: $f failed to apply." >&2; exit 2; }
done

ORG_A="org-a01i-a"; ORG_B="org-a01i-b"
REC="usr-a01i-recorder"; CLS="usr-a01i-closer"; RO="usr-a01i-reopener"; OWN="usr-a01i-owner"; VER="usr-a01i-verifier"; B_USER="usr-a01i-b"
F1="22222222-2222-4222-8222-000000000001"   # operational finding with an Action, evidence, verification, deadline
F2="22222222-2222-4222-8222-000000000002"   # reopen cycles
F3="22222222-2222-4222-8222-000000000003"   # cancel
F_LC="22222222-2222-4222-8222-000000000011" # legacy CLOSED
F_LX="22222222-2222-4222-8222-000000000012" # legacy CANCELLED
F_B="22222222-2222-4222-8222-000000000019"  # org B
ACT="11111111-1111-4111-8111-000000000001"
INC="11111111-1111-4111-8111-000000000002"
INS="11111111-1111-4111-8111-000000000003"; INS2="11111111-1111-4111-8111-000000000005"; INS_B="11111111-1111-4111-8111-000000000009"
AUD="11111111-1111-4111-8111-000000000004"; AUD2="11111111-1111-4111-8111-000000000006"
INV="11111111-1111-4111-8111-000000000007"
RL="33333333-3333-4333-8333-000000000001"

cat <<SQL | psql_exec >/dev/null || { echo "ERROR: legacy seed failed." >&2; exit 2; }
INSERT INTO organisations (id, name, slug, updated_at) VALUES ('$ORG_A','Org A','a01i-a',now()), ('$ORG_B','Org B','a01i-b',now());
INSERT INTO users (id, organisation_id, username, name, role, updated_at) VALUES
  ('$REC','$ORG_A','a01i-rec','Recorder','MANAGER',now()), ('$CLS','$ORG_A','a01i-cls','Closer','ADMIN',now()),
  ('$RO','$ORG_A','a01i-ro','Reopener','ADMIN',now()), ('$OWN','$ORG_A','a01i-own','Owner','MANAGER',now()),
  ('$VER','$ORG_A','a01i-ver','Verifier','ADMIN',now()), ('$B_USER','$ORG_B','a01i-b','B User','ADMIN',now());
INSERT INTO assurance_risk_levels (id, organisation_id, code, name, rank) VALUES ('$RL','$ORG_A','HIGH','High',3);
INSERT INTO assurance_incidents (id, organisation_id, incident_reference, category, title, description, occurred_at)
  VALUES ('$INC','$ORG_A','INC-1','INJURY_SAFETY','Fall from ladder','Worker slipped',now() - interval '20 days');
INSERT INTO assurance_inspections (id, organisation_id, inspection_reference, inspection_type, title) VALUES
  ('$INS','$ORG_A','INS-1','SITE','Site walk'), ('$INS2','$ORG_A','INS-2','SITE','Second walk'), ('$INS_B','$ORG_B','INS-B1','SITE','B walk');
INSERT INTO assurance_inspection_responses (organisation_id, inspection_id, item_key, item_label, response_type) VALUES
  ('$ORG_A','$INS','fire-exits','Fire exits clear','PASS_FAIL'), ('$ORG_A','$INS','guard-rails','Guard rails secure','PASS_FAIL'),
  ('$ORG_A','$INS2','ladders','Ladders tagged','PASS_FAIL'), ('$ORG_B','$INS_B','fire-exits','Fire exits clear','PASS_FAIL');
INSERT INTO assurance_audits (id, organisation_id, audit_reference, audit_type, title, scope, standard_reference) VALUES
  ('$AUD','$ORG_A','AUD-1','INTERNAL','Safety audit','Site','ISO 45001 cl.9'), ('$AUD2','$ORG_A','AUD-2','INTERNAL','Second audit','Site','ISO 45001 cl.10');
INSERT INTO assurance_audit_responses (organisation_id, audit_id, criterion_key, criterion_label, response_type) VALUES
  ('$ORG_A','$AUD','c-1','Criterion one','BOOLEAN'), ('$ORG_A','$AUD2','c-2','Criterion two','BOOLEAN');
INSERT INTO assurance_investigations (id, organisation_id, investigation_reference, title, scope)
  VALUES ('$INV','$ORG_A','INV-1','Ladder fall investigation','Ladder use');

-- Pre-A0.1I semantics: terminal rows have no closure reason (the column does not exist yet).
INSERT INTO assurance_findings (id, organisation_id, finding_reference, finding_type, title, description, identified_at, status, risk_level_id, created_by) VALUES
  ('$F1','$ORG_A','FND-1','HAZARD','Unsecured ladder','Ladder not tied off',now() - interval '20 days','ACTION_REQUIRED','$RL','$REC'),
  ('$F2','$ORG_A','FND-2','DEFECT','Loose guard rail','Rail moves under load',now() - interval '10 days','OPEN',NULL,'$REC'),
  ('$F3','$ORG_A','FND-3','OBSERVATION','Duplicate report','Same as FND-2',now() - interval '5 days','OPEN',NULL,'$REC'),
  ('$F_B','$ORG_B','FND-B1','HAZARD','B hazard','Org B',now(),'OPEN',NULL,'$B_USER');
INSERT INTO assurance_findings (id, organisation_id, finding_reference, finding_type, title, description, identified_at, status, closed_at, closed_by, created_by) VALUES
  ('$F_LC','$ORG_A','FND-L1','DEFECT','Legacy closed','Closed before A0.1I',now() - interval '60 days','CLOSED',now() - interval '30 days','$CLS','$REC');
INSERT INTO assurance_findings (id, organisation_id, finding_reference, finding_type, title, description, identified_at, status, created_by) VALUES
  ('$F_LX','$ORG_A','FND-L2','OBSERVATION','Legacy cancelled','Cancelled before A0.1I',now() - interval '60 days','CANCELLED','$REC');

-- Legacy source links (no item / criterion context).
INSERT INTO assurance_incident_findings (organisation_id, incident_id, finding_id, created_by) VALUES ('$ORG_A','$INC','$F1','$REC');
INSERT INTO assurance_investigation_findings (organisation_id, investigation_id, finding_id, created_by) VALUES ('$ORG_A','$INV','$F1','$REC');
INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, created_by) VALUES ('$ORG_A','$INS','$F1','$REC');
INSERT INTO assurance_audit_findings (organisation_id, audit_id, finding_id, created_by) VALUES ('$ORG_A','$AUD','$F1','$REC');

-- F1's closed corrective Action, its evidence, verification and the Finding's CLOSURE deadline (past due).
INSERT INTO assurance_actions (id, organisation_id, action_reference, action_type, title, priority, owner_user_id, status,
                               evidence_required, verification_required, work_completed_at, work_completed_by, closed_at, closed_by)
  VALUES ('$ACT','$ORG_A','ACT-1','CORRECTIVE','Tie off ladders','HIGH','$OWN','CLOSED',true,true,now() - interval '3 days','$OWN',now() - interval '1 day','$CLS');
INSERT INTO assurance_action_findings (organisation_id, action_id, finding_id, created_by) VALUES ('$ORG_A','$ACT','$F1','$REC');
INSERT INTO assurance_verifications (organisation_id, action_id, attempt_number, result, verified_by, verified_at)
  VALUES ('$ORG_A','$ACT',1,'ACCEPTED','$VER',now() - interval '2 days');
INSERT INTO assurance_timeframes (organisation_id, timeframe_type, finding_id, original_due_at, current_due_at)
  VALUES ('$ORG_A','CLOSURE','$F1',now() - interval '5 days',now() - interval '5 days');
SQL
EV=$(q "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, title, created_by) VALUES ('$ORG_A','EVD-1','PHOTO','Ladder tied','$OWN') RETURNING id;")
q "INSERT INTO assurance_evidence_actions (organisation_id, evidence_id, action_id, created_by) VALUES ('$ORG_A','$EV','$ACT','$OWN');" >/dev/null
q "UPDATE assurance_evidence SET verification_status='AWAITING_VERIFICATION', verification_requested_by='$OWN', verification_requested_at=now(), lock_version=lock_version+1 WHERE id='$EV';" >/dev/null
q "UPDATE assurance_evidence SET verification_status='ACCEPTED', decided_by='$VER', decided_at=now(), lock_version=lock_version+1 WHERE id='$EV';" >/dev/null

FULL_PRE=$(q "$FULL_FP_SQL")
OTHER_PRE=$(q "$OTHER_FP_SQL")
OLDCOLS=$(q "SELECT string_agg(table_name||'.'||column_name, ',') FROM information_schema.columns WHERE table_schema='public' AND table_name IN $ALTERED")
OLDCONS=$(q "SELECT string_agg(conname, ',') FROM pg_constraint WHERE connamespace='public'::regnamespace AND conrelid::regclass::text IN $ALTERED")
OLDIDX=$(q "SELECT string_agg(indexname, ',') FROM pg_indexes WHERE schemaname='public' AND tablename IN $ALTERED")
altered_old_fp() {
  q "SELECT md5(coalesce((SELECT string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''),'|' ORDER BY table_name,column_name) FROM information_schema.columns WHERE table_schema='public' AND (table_name||'.'||column_name) = ANY(string_to_array('$OLDCOLS', ','))),'')
    || coalesce((SELECT string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid),'|' ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname = ANY(string_to_array('$OLDCONS', ','))),'')
    || coalesce((SELECT string_agg(indexname||':'||indexdef,'|' ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND indexname = ANY(string_to_array('$OLDIDX', ','))),''));"
}
ALTERED_PRE=$(altered_old_fp)
LEGACY_PRE=$(q "SELECT string_agg(id||':'||status||':'||coalesce(closed_at::text,'-')||':'||coalesce(closed_by,'-'), ',' ORDER BY id) FROM assurance_findings WHERE id IN ('$F_LC','$F_LX')")
LINKS_PRE=$(q "SELECT (SELECT count(*) FROM assurance_incident_findings)||'|'||(SELECT count(*) FROM assurance_investigation_findings)||'|'||(SELECT count(*) FROM assurance_inspection_findings)||'|'||(SELECT count(*) FROM assurance_audit_findings)")

echo ""
echo "== 1. Apply A0.1I over legacy data =="
psql_exec < "$A01I" >/dev/null && APPLIED=OK || APPLIED=FAILED
check "A0.1I applies over legacy terminal rows and legacy links" "$APPLIED" "OK"
[ "$APPLIED" = "OK" ] || { echo "Results: $PASS passed, $((FAIL)) failed"; exit 1; }
check "everything outside the altered tables is unchanged" "$(q "$OTHER_FP_SQL")" "$OTHER_PRE"
check "every pre-existing column / constraint / index on the altered tables is unchanged" "$(altered_old_fp)" "$ALTERED_PRE"
check "legacy CLOSED Finding survives with NULL closure_reason" "$(q "SELECT status||':'||coalesce(closure_reason,'NULL') FROM assurance_findings WHERE id='$F_LC'")" "CLOSED:NULL"
check "legacy CANCELLED Finding survives with NULL closure_reason" "$(q "SELECT status||':'||coalesce(closure_reason,'NULL') FROM assurance_findings WHERE id='$F_LX'")" "CANCELLED:NULL"
check "legacy terminal rows otherwise unchanged" "$(q "SELECT string_agg(id||':'||status||':'||coalesce(closed_at::text,'-')||':'||coalesce(closed_by,'-'), ',' ORDER BY id) FROM assurance_findings WHERE id IN ('$F_LC','$F_LX')")" "$LEGACY_PRE"
check "no closure reason fabricated anywhere" "$(q "SELECT count(*) FROM assurance_findings WHERE closure_reason IS NOT NULL")" "0"
check "legacy source links survive with NULL item / criterion context" "$(q "SELECT (SELECT count(*) FROM assurance_inspection_findings WHERE item_key IS NULL)||'|'||(SELECT count(*) FROM assurance_audit_findings WHERE criterion_key IS NULL)")" "1|1"
check "source link counts unchanged" "$(q "SELECT (SELECT count(*) FROM assurance_incident_findings)||'|'||(SELECT count(*) FROM assurance_investigation_findings)||'|'||(SELECT count(*) FROM assurance_inspection_findings)||'|'||(SELECT count(*) FROM assurance_audit_findings)")" "$LINKS_PRE"
check "reopening history starts empty" "$(q "SELECT count(*) FROM assurance_finding_reopenings")" "0"
check "7 enabled A0.1I guard triggers" "$(q "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND tgname IN ('trg_assurance_findings_lifecycle','trg_assurance_finding_reopenings_insert','trg_assurance_finding_reopenings_append_only','trg_assurance_incident_findings_identity','trg_assurance_investigation_findings_identity','trg_assurance_inspection_findings_identity','trg_assurance_audit_findings_identity')")" "7"

echo ""
echo "== 2. Currently deployed app writes still work =="
check "create an OPEN Finding (no closure reason)" "$(sqlstate "INSERT INTO assurance_findings (organisation_id, finding_reference, finding_type, title, description, identified_at, created_by) VALUES ('$ORG_A','FND-APP','HAZARD','App create','x',now(),'$REC');")" "OK"
check "non-terminal transition OPEN -> UNDER_REVIEW" "$(sqlstate "UPDATE assurance_findings SET status='UNDER_REVIEW', updated_at=now() WHERE finding_reference='FND-APP';")" "OK"
check "link to an inspection without item context" "$(sqlstate "INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, created_by) VALUES ('$ORG_A','$INS2','$F2','$REC');")" "OK"

echo ""
echo "== 3. Structured provenance =="
check "valid inspection item provenance" "$(sqlstate "INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, item_key, created_by) VALUES ('$ORG_A','$INS','$F2','guard-rails','$REC');")" "OK"
check "valid audit criterion provenance" "$(sqlstate "INSERT INTO assurance_audit_findings (organisation_id, audit_id, finding_id, criterion_key, created_by) VALUES ('$ORG_A','$AUD','$F2','c-1','$REC');")" "OK"
check "item of another inspection refused" "$(sqlstate "INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, item_key) VALUES ('$ORG_A','$INS','$F3','ladders');")" "23503"
check "unknown inspection item refused" "$(sqlstate "INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, item_key) VALUES ('$ORG_A','$INS','$F3','nope');")" "23503"
check "criterion of another audit refused" "$(sqlstate "INSERT INTO assurance_audit_findings (organisation_id, audit_id, finding_id, criterion_key) VALUES ('$ORG_A','$AUD','$F3','c-2');")" "23503"
check "cross-org inspection response refused" "$(sqlstate "INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, item_key) VALUES ('$ORG_A','$INS_B','$F3','fire-exits');")" "23503"
check "cross-org finding refused" "$(sqlstate "INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, item_key) VALUES ('$ORG_A','$INS','$F_B','fire-exits');")" "23503"
check "blank item key refused" "$(sqlstate "INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, item_key) VALUES ('$ORG_A','$INS','$F3','   ');")" "23514"
check "blank criterion key refused" "$(sqlstate "INSERT INTO assurance_audit_findings (organisation_id, audit_id, finding_id, criterion_key) VALUES ('$ORG_A','$AUD2','$F3','');")" "23514"
check "NULL context accepted" "$(sqlstate "INSERT INTO assurance_audit_findings (organisation_id, audit_id, finding_id, criterion_key) VALUES ('$ORG_A','$AUD2','$F3',NULL);")" "OK"
check "item context cannot be retargeted" "$(sqlstate "UPDATE assurance_inspection_findings SET item_key='fire-exits' WHERE finding_id='$F2' AND inspection_id='$INS';")" "CE001"
check "item context cannot be added to a legacy link" "$(sqlstate "UPDATE assurance_inspection_findings SET item_key='fire-exits' WHERE finding_id='$F1';")" "CE001"
check "criterion context cannot be cleared" "$(sqlstate "UPDATE assurance_audit_findings SET criterion_key=NULL WHERE finding_id='$F2';")" "CE001"
check "inspection link cannot be moved to another inspection" "$(sqlstate "UPDATE assurance_inspection_findings SET inspection_id='$INS2' WHERE finding_id='$F1';")" "CE001"
check "audit link cannot be moved to another audit" "$(sqlstate "UPDATE assurance_audit_findings SET audit_id='$AUD2' WHERE finding_id='$F1';")" "CE001"
check "incident link cannot be moved to another finding" "$(sqlstate "UPDATE assurance_incident_findings SET finding_id='$F2' WHERE finding_id='$F1';")" "CE001"
check "investigation link cannot be moved to another finding" "$(sqlstate "UPDATE assurance_investigation_findings SET finding_id='$F2' WHERE finding_id='$F1';")" "CE001"
check "link organisation cannot change" "$(sqlstate "UPDATE assurance_incident_findings SET organisation_id='$ORG_B' WHERE finding_id='$F1';")" "CE001"
check "link author cannot change" "$(sqlstate "UPDATE assurance_inspection_findings SET created_by='$CLS' WHERE finding_id='$F1';")" "CE001"

echo ""
echo "== 4. Closure reason =="
close_sql() { echo "UPDATE assurance_findings SET status='CLOSED', closed_at=now(), closed_by='$CLS', closure_reason=$2, updated_at=now() WHERE id='$1';"; }
cancel_sql() { echo "UPDATE assurance_findings SET status='CANCELLED', closure_reason=$2, updated_at=now() WHERE id='$1';"; }
q "UPDATE assurance_findings SET status='UNDER_REVIEW' WHERE id='$F2';" >/dev/null
check "new CLOSED without reason refused" "$(sqlstate "$(close_sql "$F2" NULL)")" "CF002"
check "new CLOSED with whitespace reason refused" "$(sqlstate "$(close_sql "$F2" "'   '")")" "CF002"
check "new CANCELLED without reason refused" "$(sqlstate "$(cancel_sql "$F3" NULL)")" "CF002"
check "new CANCELLED with blank reason refused" "$(sqlstate "$(cancel_sql "$F3" "''")")" "CF002"
check "insert as CLOSED without reason refused" "$(sqlstate "INSERT INTO assurance_findings (organisation_id, finding_reference, finding_type, title, description, identified_at, status, closed_at, closed_by) VALUES ('$ORG_A','FND-X','HAZARD','x','x',now(),'CLOSED',now(),'$CLS');")" "CF002"
check "closure reason on a non-terminal Finding refused" "$(sqlstate "UPDATE assurance_findings SET closure_reason='early' WHERE id='$F1';")" "23514"
check "valid close succeeds" "$(sqlstate "$(close_sql "$F2" "'Rail re-bolted and load tested'")")" "OK"
check "valid cancel succeeds" "$(sqlstate "$(cancel_sql "$F3" "'Duplicate of FND-2'")")" "OK"
check "recorded closure reason cannot be rewritten" "$(sqlstate "UPDATE assurance_findings SET closure_reason='Changed my mind' WHERE id='$F2';")" "CF001"
check "recorded closed_at cannot be rewritten" "$(sqlstate "UPDATE assurance_findings SET closed_at=now() - interval '1 day' WHERE id='$F2';")" "CF001"
check "recorded cancel reason cannot be rewritten" "$(sqlstate "UPDATE assurance_findings SET closure_reason='other' WHERE id='$F3';")" "CF001"
check "legacy CLOSED reason cannot be backfilled in place" "$(sqlstate "UPDATE assurance_findings SET closure_reason='Legacy closure' WHERE id='$F_LC';")" "CF001"
check "legacy CANCELLED reason cannot be backfilled in place" "$(sqlstate "UPDATE assurance_findings SET closure_reason='Legacy closure' WHERE id='$F_LX';")" "CF001"
check "CANCELLED is terminal (-> OPEN refused)" "$(sqlstate "UPDATE assurance_findings SET status='OPEN', closure_reason=NULL WHERE id='$F3';")" "CF001"
check "legacy CANCELLED is terminal (-> UNDER_REVIEW refused)" "$(sqlstate "UPDATE assurance_findings SET status='UNDER_REVIEW' WHERE id='$F_LX';")" "CF001"
check "CLOSED -> OPEN refused" "$(sqlstate "UPDATE assurance_findings SET status='OPEN', closed_at=NULL, closed_by=NULL, closure_reason=NULL WHERE id='$F2';")" "CF001"
check "CLOSED -> UNDER_REVIEW without a reopening record refused" "$(sqlstate "UPDATE assurance_findings SET status='UNDER_REVIEW', closed_at=NULL, closed_by=NULL, closure_reason=NULL WHERE id='$F2';")" "CF002"
check "non-terminal updates (no status change) still work" "$(sqlstate "UPDATE assurance_findings SET updated_at=now() WHERE id='$F2';")" "OK"

echo ""
echo "== 5. Reopen =="
# reopen_sql <finding> <reason literal> [extra sql between insert and update]
reopen_sql() {
  printf "BEGIN;
INSERT INTO assurance_finding_reopenings (organisation_id, finding_id, reopen_number, previous_status, previous_closed_at, previous_closed_by, previous_closure_reason, reason, reopened_by)
  SELECT f.organisation_id, f.id, (SELECT coalesce(max(r.reopen_number),0)+1 FROM assurance_finding_reopenings r WHERE r.organisation_id=f.organisation_id AND r.finding_id=f.id),
         f.status, f.closed_at, f.closed_by, f.closure_reason, %s, '$RO'
  FROM assurance_findings f WHERE f.id='%s';
%s
UPDATE assurance_findings SET status='UNDER_REVIEW', closed_at=NULL, closed_by=NULL, closure_reason=NULL, updated_at=now() WHERE id='%s' AND status='CLOSED';
COMMIT;" "$2" "$1" "${3:-}" "$1"
}
PREV=$(q "SELECT status||'|'||closed_at::text||'|'||closed_by||'|'||closure_reason FROM assurance_findings WHERE id='$F2'")
check "reopening a non-CLOSED Finding refused" "$(sqlstate "$(reopen_sql "$F1" "'x'")")" "CF002"
check "reopening a CANCELLED Finding refused" "$(sqlstate "$(reopen_sql "$F3" "'x'")")" "CF002"
check "blank reopen reason refused" "$(sqlstate "$(reopen_sql "$F2" "'  '")")" "23514"
check "reopening record with a falsified previous reason refused" "$(sqlstate "INSERT INTO assurance_finding_reopenings (organisation_id, finding_id, reopen_number, previous_status, previous_closed_at, previous_closed_by, previous_closure_reason, reason, reopened_by) SELECT organisation_id, id, 1, status, closed_at, closed_by, 'something else', 'r', '$RO' FROM assurance_findings WHERE id='$F2';")" "CF002"
check "reopening record with a skipped number refused" "$(sqlstate "INSERT INTO assurance_finding_reopenings (organisation_id, finding_id, reopen_number, previous_status, previous_closed_at, previous_closed_by, previous_closure_reason, reason, reopened_by) SELECT organisation_id, id, 3, status, closed_at, closed_by, closure_reason, 'r', '$RO' FROM assurance_findings WHERE id='$F2';")" "CF002"
check "reopening record for another organisation's Finding refused" "$(sqlstate "INSERT INTO assurance_finding_reopenings (organisation_id, finding_id, reopen_number, previous_status, previous_closed_at, previous_closed_by, previous_closure_reason, reason, reopened_by) SELECT '$ORG_B', id, 1, status, closed_at, closed_by, closure_reason, 'r', '$B_USER' FROM assurance_findings WHERE id='$F2';")" "CF002"
check "reopening record alone (without clearing the Finding) cannot commit a half reopen" "$(sqlstate "BEGIN; INSERT INTO assurance_finding_reopenings (organisation_id, finding_id, reopen_number, previous_status, previous_closed_at, previous_closed_by, previous_closure_reason, reason, reopened_by) SELECT organisation_id, id, 1, status, closed_at, closed_by, closure_reason, 'r', '$RO' FROM assurance_findings WHERE id='$F2'; UPDATE assurance_findings SET status='UNDER_REVIEW', closed_at=NULL WHERE id='$F2'; COMMIT;")" "CF001"
check "nothing persisted by the refused attempts" "$(q "SELECT count(*) FROM assurance_finding_reopenings")" "0"
check "CLOSED -> UNDER_REVIEW with reason succeeds" "$(sqlstate "$(reopen_sql "$F2" "'Rail loose again after storm'")")" "OK"
check "history preserves previous status / closed_at / closed_by / closure reason" "$(q "SELECT previous_status||'|'||previous_closed_at::text||'|'||previous_closed_by||'|'||previous_closure_reason FROM assurance_finding_reopenings WHERE finding_id='$F2' AND reopen_number=1")" "$PREV"
check "history records reason, reopener and number 1" "$(q "SELECT reason||'|'||reopened_by||'|'||reopen_number FROM assurance_finding_reopenings WHERE finding_id='$F2'")" "Rail loose again after storm|$RO|1"
check "current terminal fields cleared, status UNDER_REVIEW" "$(q "SELECT status||'|'||coalesce(closed_at::text,'NULL')||'|'||coalesce(closed_by,'NULL')||'|'||coalesce(closure_reason,'NULL') FROM assurance_findings WHERE id='$F2'")" "UNDER_REVIEW|NULL|NULL|NULL"
check "history UPDATE refused" "$(sqlstate "UPDATE assurance_finding_reopenings SET reason='edited' WHERE finding_id='$F2';")" "CF001"
check "history DELETE refused" "$(sqlstate "DELETE FROM assurance_finding_reopenings WHERE finding_id='$F2';")" "CF001"
check "reclose after reopen without a NEW reason refused" "$(sqlstate "$(close_sql "$F2" NULL)")" "CF002"
check "reclose with a new reason succeeds" "$(sqlstate "$(close_sql "$F2" "'Rail replaced with welded section'")")" "OK"

# Concurrent reopen: tx1 holds the Finding lock between insert and update; tx2 starts meanwhile.
bg "$(reopen_sql "$F2" "'Race reopen one'" "SELECT pg_sleep(2);")"; BG1=$!
sleep 0.5
R2=$(sqlstate "$(reopen_sql "$F2" "'Race reopen two'")")
wait $BG1
check "second concurrent reopen loses" "$R2" "CF002"
check "exactly one history row added by the race (numbers 1,2)" "$(q "SELECT string_agg(reopen_number::text, ',' ORDER BY reopen_number) FROM assurance_finding_reopenings WHERE finding_id='$F2'")" "1,2"
check "race winner is the first transaction" "$(q "SELECT reason FROM assurance_finding_reopenings WHERE finding_id='$F2' AND reopen_number=2")" "Race reopen one"
check "second cycle preserved the second closure reason" "$(q "SELECT previous_closure_reason FROM assurance_finding_reopenings WHERE finding_id='$F2' AND reopen_number=2")" "Rail replaced with welded section"
check "Finding is UNDER_REVIEW after the race" "$(q "SELECT status FROM assurance_findings WHERE id='$F2'")" "UNDER_REVIEW"
q "$(close_sql "$F2" "'Third closure'")" >/dev/null
check "reopen again creates reopen_number + 1" "$(sqlstate "$(reopen_sql "$F2" "'Third reopen'")")" "OK"
check "reopen numbers 1,2,3" "$(q "SELECT string_agg(reopen_number::text, ',' ORDER BY reopen_number) FROM assurance_finding_reopenings WHERE finding_id='$F2'")" "1,2,3"
check "legacy CLOSED Finding can be reopened (NULL previous reason preserved, not fabricated)" "$(sqlstate "$(reopen_sql "$F_LC" "'Legacy item recurred'")")" "OK"
check "legacy reopen history keeps NULL previous closure reason" "$(q "SELECT coalesce(previous_closure_reason,'NULL')||'|'||previous_closed_by FROM assurance_finding_reopenings WHERE finding_id='$F_LC'")" "NULL|$CLS"

echo ""
echo "== 6. Non-propagation (close + reopen of F1) =="
snap() {
  q "SELECT md5(
     (SELECT row_to_json(a)::text FROM assurance_actions a WHERE id='$ACT')
  || (SELECT string_agg(row_to_json(v)::text, ',' ORDER BY v.id) FROM assurance_verifications v)
  || (SELECT string_agg(row_to_json(e)::text, ',' ORDER BY e.id) FROM assurance_evidence e)
  || (SELECT string_agg(row_to_json(l)::text, ',' ORDER BY l.id) FROM assurance_evidence_actions l)
  || (SELECT row_to_json(i)::text FROM assurance_incidents i WHERE id='$INC')
  || (SELECT row_to_json(i)::text FROM assurance_investigations i WHERE id='$INV')
  || (SELECT row_to_json(i)::text FROM assurance_inspections i WHERE id='$INS')
  || (SELECT row_to_json(i)::text FROM assurance_audits i WHERE id='$AUD')
  || (SELECT string_agg(row_to_json(t)::text, ',' ORDER BY t.id) FROM assurance_timeframes t)
  || (SELECT count(*) FROM assurance_timeframe_extensions)::text || (SELECT count(*) FROM assurance_escalations)::text
  || (SELECT count(*) FROM assurance_actions)::text || (SELECT count(*) FROM assurance_action_findings)::text
  || (SELECT count(*) FROM audit_logs)::text)"
}
BEFORE=$(snap)
RISK_BEFORE=$(q "SELECT risk_level_id FROM assurance_findings WHERE id='$F1'")
TF_BEFORE=$(q "SELECT count(*)||'|'||min(current_due_at)::text FROM assurance_timeframes WHERE finding_id='$F1'")
q "UPDATE assurance_findings SET status='UNDER_REVIEW' WHERE id='$F1';" >/dev/null
check "close F1 with reason" "$(sqlstate "$(close_sql "$F1" "'Ladders tied off; verified'")")" "OK"
check "reopen F1 with reason" "$(sqlstate "$(reopen_sql "$F1" "'Untied ladder found again'")")" "OK"
check "Actions, verifications, evidence, sources, timeframes, extensions, escalations and audit rows unchanged" "$(snap)" "$BEFORE"
check "closed Action stays CLOSED" "$(q "SELECT status FROM assurance_actions WHERE id='$ACT'")" "CLOSED"
check "risk unchanged" "$(q "SELECT risk_level_id FROM assurance_findings WHERE id='$F1'")" "$RISK_BEFORE"
check "no new timeframe and the existing (past due) deadline is untouched" "$(q "SELECT count(*)||'|'||min(current_due_at)::text FROM assurance_timeframes WHERE finding_id='$F1'")" "$TF_BEFORE"
check "deadline still past due after reopen (factual overdue)" "$(q "SELECT (current_due_at < now())::text FROM assurance_timeframes WHERE finding_id='$F1'")" "true"
check "other organisation untouched" "$(q "SELECT status FROM assurance_findings WHERE id='$F_B'")" "OPEN"

echo ""
echo "== 7. Idempotent re-apply =="
DATA=$(q "SELECT md5((SELECT string_agg(id::text||status||coalesce(closure_reason,'')||coalesce(closed_at::text,''), ',' ORDER BY id) FROM assurance_findings) || (SELECT string_agg(id::text||reopen_number||reason, ',' ORDER BY id) FROM assurance_finding_reopenings))")
SCHEMA=$(q "$FULL_FP_SQL")
psql_exec < "$A01I" >/dev/null && RE=OK || RE=FAILED
check "A0.1I re-applies cleanly" "$RE" "OK"
check "re-apply changes no data" "$(q "SELECT md5((SELECT string_agg(id::text||status||coalesce(closure_reason,'')||coalesce(closed_at::text,''), ',' ORDER BY id) FROM assurance_findings) || (SELECT string_agg(id::text||reopen_number||reason, ',' ORDER BY id) FROM assurance_finding_reopenings))")" "$DATA"
check "re-apply changes no schema" "$(q "$FULL_FP_SQL")" "$SCHEMA"
check "everything outside the altered tables still unchanged" "$(q "$OTHER_FP_SQL")" "$OTHER_PRE"
A01I_FP="$SCHEMA"

echo ""
echo "== 8. Rollback round-trip (destructive) =="
FINDINGS=$(q "SELECT count(*) FROM assurance_findings")
LINKS=$(q "SELECT (SELECT count(*) FROM assurance_incident_findings)+(SELECT count(*) FROM assurance_investigation_findings)+(SELECT count(*) FROM assurance_inspection_findings)+(SELECT count(*) FROM assurance_audit_findings)")
psql_exec < "$A01I_ROLLBACK" >/dev/null 2>&1 && RB=OK || RB=FAILED
check "rollback applies" "$RB" "OK"
check "schema back to exactly pre-A0.1I" "$(q "$FULL_FP_SQL")" "$FULL_PRE"
check "Findings remain (closure reasons discarded)" "$(q "SELECT count(*) FROM assurance_findings")" "$FINDINGS"
check "source links remain (item / criterion context discarded)" "$(q "SELECT (SELECT count(*) FROM assurance_incident_findings)+(SELECT count(*) FROM assurance_investigation_findings)+(SELECT count(*) FROM assurance_inspection_findings)+(SELECT count(*) FROM assurance_audit_findings)")" "$LINKS"
check "reopening history is gone" "$(q "SELECT to_regclass('public.assurance_finding_reopenings') IS NULL")" "t"
check "A0.1H link identity guard left in place" "$(q "SELECT to_regprocedure('public.assurance_evidence_link_identity_guard()') IS NOT NULL")" "t"
psql_exec < "$A01I_ROLLBACK" >/dev/null 2>&1 && RB2=OK || RB2=FAILED
check "rollback is idempotent" "$RB2" "OK"
psql_exec < "$A01I" >/dev/null && RE2=OK || RE2=FAILED
check "A0.1I re-applies after rollback" "$RE2" "OK"
check "schema after re-apply equals the first A0.1I apply" "$(q "$FULL_FP_SQL")" "$A01I_FP"
check "after re-apply every terminal Finding is legacy (NULL reason)" "$(q "SELECT count(*) FROM assurance_findings WHERE closure_reason IS NOT NULL")" "0"

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
exit 0
