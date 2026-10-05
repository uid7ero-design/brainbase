#!/usr/bin/env bash
# BrainBase Assurance A0.1H — Evidence verification migration: disposable PostgreSQL 17 proof.
#
# Applies the REAL migrations A0.1B..A0.1G, fingerprints the schema, applies
# A0.1H, then proves:
#   * everything outside the three altered evidence tables (and the one new
#     trigger on contractor submissions) is byte-for-byte unchanged, and every
#     pre-existing column / constraint on the altered tables is preserved;
#   * the currently deployed app's writes still work (legacy evidence insert,
#     legacy link insert + soft unlink, contractor evidence + submission);
#   * lifecycle matrix, stale lock_version, independence, no DELETE;
#   * correction only before a decision; identity immutable;
#   * replacement: only ACCEPTED / REJECTED chain heads, atomic supersession,
#     rejected replacement never touches its predecessor, no forks, same-org,
#     concurrent replacements and decisions have exactly one winner;
#   * contractor authority: contractor evidence never enters the generic
#     lifecycle, and submissions only take untouched evidence;
#   * item / criterion context: structured FK, same inspection/audit, same org,
#     fixed once linked, soft unlink still works;
#   * nothing outside assurance_evidence is changed by an evidence decision;
#   * idempotent re-apply and destructive rollback round-trip.
#
# Usage:   bash scripts/tests/verify-assurance-evidence-verification-a01h-migration.sh
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
)
A01H="scripts/create-assurance-evidence-verification-a01h.sql"
A01H_ROLLBACK="scripts/rollback-assurance-evidence-verification-a01h.sql"
CONTAINER="brainbase-a01h-evidence-$$"
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

for f in "${MIGRATIONS[@]}" "$A01H" "$A01H_ROLLBACK"; do
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

ALTERED="('assurance_evidence','assurance_evidence_inspections','assurance_evidence_audits')"
# Fingerprint of everything EXCEPT the three altered tables and the
# contractor-submission triggers (A0.1H adds one there).
OTHER_FP_SQL="SELECT md5(coalesce((SELECT string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''),'|' ORDER BY table_name,column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name NOT IN $ALTERED),'')
  || coalesce((SELECT string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid),'|' ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE connamespace='public'::regnamespace AND conrelid::regclass::text NOT IN $ALTERED),'')
  || coalesce((SELECT string_agg(tgrelid::regclass::text||':'||tgname||':'||pg_get_triggerdef(oid),'|' ORDER BY tgrelid::regclass::text,tgname) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT IN $ALTERED AND tgname <> 'trg_assurance_req_submissions_evidence_authority'),'')
  || coalesce((SELECT string_agg(proname||':'||md5(prosrc),'|' ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname NOT IN ('assurance_evidence_lifecycle_guard','assurance_evidence_no_delete','assurance_evidence_link_identity_guard','assurance_submission_evidence_authority_guard')),'')
  || coalesce((SELECT string_agg(indexname||':'||indexdef,'|' ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename NOT IN $ALTERED),''));"
FULL_FP_SQL="SELECT md5(coalesce((SELECT string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''),'|' ORDER BY table_name,column_name) FROM information_schema.columns WHERE table_schema='public'),'')
  || coalesce((SELECT string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid),'|' ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE connamespace='public'::regnamespace),'')
  || coalesce((SELECT string_agg(tgrelid::regclass::text||':'||tgname||':'||pg_get_triggerdef(oid),'|' ORDER BY tgrelid::regclass::text,tgname) FROM pg_trigger WHERE NOT tgisinternal),'')
  || coalesce((SELECT string_agg(proname||':'||md5(prosrc),'|' ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace),'')
  || coalesce((SELECT string_agg(indexname||':'||indexdef,'|' ORDER BY indexname) FROM pg_indexes WHERE schemaname='public'),''));"

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


echo "Applying pre-A0.1H migrations (A0.1B..A0.1G) ..."
for f in "${MIGRATIONS[@]}"; do
  psql_exec < "$f" >/dev/null || { echo "ERROR: $f failed to apply." >&2; exit 2; }
done

ORG_A="org-a01h-a"; ORG_B="org-a01h-b"
REC="usr-a01h-recorder"; CAP="usr-a01h-capturer"; DEC="usr-a01h-decider"; DEC2="usr-a01h-decider2"; OWN="usr-a01h-owner"; B_USER="usr-a01h-b"
ACT="11111111-1111-4111-8111-000000000001"
INS="11111111-1111-4111-8111-000000000003"; INS2="11111111-1111-4111-8111-000000000005"
AUD="11111111-1111-4111-8111-000000000004"
INS_B="11111111-1111-4111-8111-000000000009"
EO_A="44444444-4444-4444-8444-000000000001"; EO_B="44444444-4444-4444-8444-000000000009"
REQ="55555555-5555-4555-8555-000000000001"

cat <<SQL | psql_exec >/dev/null || { echo "ERROR: seed failed." >&2; exit 2; }
INSERT INTO organisations (id, name, slug, updated_at) VALUES ('$ORG_A','Org A','a01h-a',now()), ('$ORG_B','Org B','a01h-b',now());
INSERT INTO users (id, organisation_id, username, name, role, updated_at) VALUES
  ('$REC','$ORG_A','a01h-rec','Recorder','MANAGER',now()), ('$CAP','$ORG_A','a01h-cap','Capturer','MANAGER',now()),
  ('$DEC','$ORG_A','a01h-dec','Decider','ADMIN',now()), ('$DEC2','$ORG_A','a01h-dec2','Decider Two','ADMIN',now()),
  ('$OWN','$ORG_A','a01h-own','Owner','MANAGER',now()), ('$B_USER','$ORG_B','a01h-b','B User','ADMIN',now());
INSERT INTO external_organisations (id, organisation_id, reference, name, status) VALUES
  ('$EO_A','$ORG_A','EXT-A1','Acme Contracting','ACTIVE'), ('$EO_B','$ORG_B','EXT-B1','Org B Contractor','ACTIVE');
INSERT INTO assurance_actions (id, organisation_id, action_reference, action_type, title, priority, owner_user_id, status)
  VALUES ('$ACT','$ORG_A','ACT-1','CORRECTIVE','Fix guard rail','MEDIUM','$OWN','IN_PROGRESS');
INSERT INTO assurance_inspections (id, organisation_id, inspection_reference, inspection_type, title) VALUES
  ('$INS','$ORG_A','INS-1','SITE','Site walk'), ('$INS2','$ORG_A','INS-2','SITE','Second walk'), ('$INS_B','$ORG_B','INS-B1','SITE','B walk');
INSERT INTO assurance_inspection_responses (organisation_id, inspection_id, item_key, item_label, response_type) VALUES
  ('$ORG_A','$INS','fire-exits','Fire exits clear','PASS_FAIL'), ('$ORG_A','$INS','guard-rails','Guard rails secure','PASS_FAIL'),
  ('$ORG_A','$INS2','ladders','Ladders tagged','PASS_FAIL'), ('$ORG_B','$INS_B','fire-exits','Fire exits clear','PASS_FAIL');
INSERT INTO assurance_audits (id, organisation_id, audit_reference, audit_type, title, scope, standard_reference)
  VALUES ('$AUD','$ORG_A','AUD-1','INTERNAL','Safety audit','Site','ISO 45001 cl.9');
INSERT INTO assurance_audit_responses (organisation_id, audit_id, criterion_key, criterion_label, response_type)
  VALUES ('$ORG_A','$AUD','c-1','Criterion one','BOOLEAN');
INSERT INTO assurance_requirements (id, organisation_id, requirement_code, name, category, created_by) VALUES ('$REQ','$ORG_A','PL-INS','Public liability','INSURANCE','$DEC');
INSERT INTO assurance_external_organisation_scopes (organisation_id, external_organisation_id) VALUES ('$ORG_A','$EO_A');
SQL
A_REQ=$(q "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id, created_by) VALUES ('$ORG_A','$EO_A','$REQ','$REC') RETURNING id;")

# ev <ref> [extra column list] [extra values] → evidence id (recorded by REC, captured by CAP).
ev() { q "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, title, captured_by, created_by${2:+, $2})
          VALUES ('$ORG_A','$1','DOCUMENT','$1','$CAP','$REC'${3:+, $3}) RETURNING id;"; }
submit() { q "UPDATE assurance_evidence SET verification_status='AWAITING_VERIFICATION', verification_requested_by='$REC', verification_requested_at=now(), lock_version=lock_version+1 WHERE id='$1' RETURNING verification_status;"; }
accept_sql() { echo "UPDATE assurance_evidence SET verification_status='ACCEPTED', decided_by='$2', decided_at=now(), lock_version=lock_version+1 WHERE id='$1';"; }
reject_sql() { echo "UPDATE assurance_evidence SET verification_status='REJECTED', decided_by='$2', decided_at=now(), decision_reason='Illegible copy', lock_version=lock_version+1 WHERE id='$1';"; }
st() { q "SELECT verification_status FROM assurance_evidence WHERE id='$1'"; }

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

echo ""
echo "== 1. Apply A0.1H =="
psql_exec < "$A01H" >/dev/null && APPLIED=OK || APPLIED=FAILED
check "A0.1H applies" "$APPLIED" "OK"
check "everything outside the altered evidence tables is unchanged" "$(q "$OTHER_FP_SQL")" "$OTHER_PRE"
check "every pre-existing column / constraint / index on the altered tables is preserved" "$(altered_old_fp)" "$ALTERED_PRE"
check "11 evidence columns + 2 context columns added" "$(q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND ((table_name='assurance_evidence' AND column_name IN ('verification_status','verification_requested_by','verification_requested_at','decided_by','decided_at','decision_reason','replaces_evidence_id','superseded_by_evidence_id','superseded_at','supplied_by_external_organisation_id','lock_version')) OR (table_name='assurance_evidence_inspections' AND column_name='item_key') OR (table_name='assurance_evidence_audits' AND column_name='criterion_key'))")" "13"
check "5 guard triggers enabled" "$(q "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND tgname IN ('trg_assurance_evidence_lifecycle','trg_assurance_evidence_no_delete','trg_assurance_evidence_inspections_identity','trg_assurance_evidence_audits_identity','trg_assurance_req_submissions_evidence_authority')")" "5"

echo ""
echo "== 2. Currently deployed app still works =="
LEG=$(q "INSERT INTO assurance_evidence (id, organisation_id, evidence_reference, evidence_type, title, description, captured_by, captured_at, location_id, metadata, created_by)
         SELECT gen_random_uuid(), '$ORG_A', 'EVD-LEGACY', 'PHOTO', 'Legacy insert', NULL, '$REC', now(), NULL, '{\"source\":\"manual_entry\"}'::jsonb, '$REC' RETURNING id;")
check "legacy evidence insert (pre-A0.1H column list)" "${#LEG}" "36"
check "legacy evidence defaults to UNVERIFIED, lock_version 1" "$(q "SELECT verification_status||'|'||lock_version FROM assurance_evidence WHERE id='$LEG'")" "UNVERIFIED|1"
check "legacy action link insert" "$(sqlstate "INSERT INTO assurance_evidence_actions (organisation_id, evidence_id, action_id, purpose, created_by) VALUES ('$ORG_A','$LEG','$ACT','Photo of fix','$REC');")" "OK"
check "legacy inspection link insert (no item context)" "$(sqlstate "INSERT INTO assurance_evidence_inspections (organisation_id, evidence_id, inspection_id, created_by) VALUES ('$ORG_A','$LEG','$INS','$REC');")" "OK"
check "legacy soft unlink" "$(sqlstate "UPDATE assurance_evidence_inspections SET removed_at=now(), removed_by='$REC', removal_reason='Wrong record' WHERE evidence_id='$LEG' AND inspection_id='$INS';")" "OK"
CE=$(ev EVD-CONTRACTOR-1)
check "contractor evidence + submission insert (A0.1G path)" "$(sqlstate "INSERT INTO assurance_requirement_submissions (organisation_id, assignment_id, evidence_id, supplied_on, expires_on, recorded_by) VALUES ('$ORG_A','$A_REQ','$CE',current_date,current_date+365,'$REC');")" "OK"

echo ""
echo "== 3. Lifecycle =="
check "evidence cannot be inserted already decided" "$(sqlstate "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, verification_status, decided_by, decided_at) VALUES ('$ORG_A','EVD-X1','DOCUMENT','ACCEPTED','$DEC',now());")" "CE001"
check "evidence cannot be inserted at lock_version 2" "$(sqlstate "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, lock_version) VALUES ('$ORG_A','EVD-X2','DOCUMENT',2);")" "CE001"
check "evidence may be recorded straight into the queue" "$(sqlstate "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, verification_status, verification_requested_by, verification_requested_at, created_by) VALUES ('$ORG_A','EVD-Q0','DOCUMENT','AWAITING_VERIFICATION','$REC',now(),'$REC');")" "OK"
E1=$(ev EVD-1)
check "UNVERIFIED -> ACCEPTED directly refused" "$(sqlstate "$(accept_sql "$E1" "$DEC")")" "CE001"
check "AWAITING without requester refused" "$(sqlstate "UPDATE assurance_evidence SET verification_status='AWAITING_VERIFICATION', lock_version=lock_version+1 WHERE id='$E1';")" "23514"
check "submit for verification" "$(submit "$E1")" "AWAITING_VERIFICATION"
check "withdraw request (AWAITING -> UNVERIFIED)" "$(sqlstate "UPDATE assurance_evidence SET verification_status='UNVERIFIED', verification_requested_by=NULL, verification_requested_at=NULL, lock_version=lock_version+1 WHERE id='$E1';")" "OK"
submit "$E1" >/dev/null
check "stale write (lock_version not advanced) refused" "$(sqlstate "UPDATE assurance_evidence SET verification_status='ACCEPTED', decided_by='$DEC', decided_at=now() WHERE id='$E1';")" "CE003"
check "recorder cannot decide (independence)" "$(sqlstate "$(accept_sql "$E1" "$REC")")" "23514"
check "capturer cannot decide (independence)" "$(sqlstate "$(accept_sql "$E1" "$CAP")")" "23514"
check "independent decider accepts" "$(sqlstate "$(accept_sql "$E1" "$DEC")")" "OK"
check "ACCEPTED -> REJECTED refused" "$(sqlstate "$(reject_sql "$E1" "$DEC2")")" "CE001"
check "ACCEPTED -> AWAITING refused" "$(sqlstate "UPDATE assurance_evidence SET verification_status='AWAITING_VERIFICATION', decided_by=NULL, decided_at=NULL, verification_requested_by='$REC', verification_requested_at=now(), lock_version=lock_version+1 WHERE id='$E1';")" "CE001"
check "a decided record cannot be re-decided by another person" "$(sqlstate "UPDATE assurance_evidence SET decided_by='$DEC2', lock_version=lock_version+1 WHERE id='$E1';")" "CE001"
check "manual ACCEPTED -> SUPERSEDED refused" "$(sqlstate "UPDATE assurance_evidence SET verification_status='SUPERSEDED', superseded_by_evidence_id='$LEG', superseded_at=now(), lock_version=lock_version+1 WHERE id='$E1';")" "CE001"
E2=$(ev EVD-2); submit "$E2" >/dev/null
check "reject without a reason refused" "$(sqlstate "UPDATE assurance_evidence SET verification_status='REJECTED', decided_by='$DEC', decided_at=now(), lock_version=lock_version+1 WHERE id='$E2';")" "23514"
check "reject with a reason" "$(sqlstate "$(reject_sql "$E2" "$DEC")")" "OK"
check "REJECTED is terminal" "$(sqlstate "$(accept_sql "$E2" "$DEC2")")" "CE001"
check "evidence DELETE refused" "$(sqlstate "DELETE FROM assurance_evidence WHERE id='$E2';")" "CE001"

echo ""
echo "== 4. Correction =="
E3=$(ev EVD-3)
check "correct while UNVERIFIED" "$(sqlstate "UPDATE assurance_evidence SET title='EVD-3 corrected', lock_version=lock_version+1 WHERE id='$E3';")" "OK"
submit "$E3" >/dev/null
check "correct while AWAITING" "$(sqlstate "UPDATE assurance_evidence SET description='Held in site file', lock_version=lock_version+1 WHERE id='$E3';")" "OK"
check "correction combined with a decision refused" "$(sqlstate "UPDATE assurance_evidence SET title='sneaky', verification_status='ACCEPTED', decided_by='$DEC', decided_at=now(), lock_version=lock_version+1 WHERE id='$E3';")" "CE001"
check "correct after ACCEPTED refused" "$(sqlstate "UPDATE assurance_evidence SET title='changed', lock_version=lock_version+1 WHERE id='$E1';")" "CE001"
check "correct after REJECTED refused" "$(sqlstate "UPDATE assurance_evidence SET title='changed', lock_version=lock_version+1 WHERE id='$E2';")" "CE001"
check "evidence reference is immutable" "$(sqlstate "UPDATE assurance_evidence SET evidence_reference='EVD-NEW', lock_version=lock_version+1 WHERE id='$E3';")" "CE001"
check "created_by is immutable" "$(sqlstate "UPDATE assurance_evidence SET created_by='$DEC', lock_version=lock_version+1 WHERE id='$E3';")" "CE001"
check "supplier must be a same-org external organisation" "$(sqlstate "UPDATE assurance_evidence SET supplied_by_external_organisation_id='$EO_B', lock_version=lock_version+1 WHERE id='$E3';")" "23503"
check "supplier recorded during correction" "$(sqlstate "UPDATE assurance_evidence SET supplied_by_external_organisation_id='$EO_A', lock_version=lock_version+1 WHERE id='$E3';")" "OK"

echo ""
echo "== 5. Replacement =="
E4=$(ev EVD-4)
check "replace UNVERIFIED refused" "$(sqlstate "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, created_by, replaces_evidence_id) VALUES ('$ORG_A','EVD-R1','DOCUMENT','$REC','$E4');")" "CE002"
check "replace AWAITING refused" "$(sqlstate "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, created_by, replaces_evidence_id) VALUES ('$ORG_A','EVD-R2','DOCUMENT','$REC','$E3');")" "CE002"
check "replacement must be same-org (guard)" "$(sqlstate "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, created_by, replaces_evidence_id) VALUES ('$ORG_B','EVD-R3','DOCUMENT','$B_USER','$E1');")" "CE002"
check "replacement must be same-org (tenant FK, guard bypassed)" "$(sqlstate "BEGIN; ALTER TABLE assurance_evidence DISABLE TRIGGER trg_assurance_evidence_lifecycle; INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, created_by, replaces_evidence_id) VALUES ('$ORG_B','EVD-R3','DOCUMENT','$B_USER','$E1'); ROLLBACK;")" "23503"
# Chain 1: E1 (ACCEPTED) <- R1 (rejected) ; <- R2 (accepted, supersedes E1)
R1=$(ev EVD-R1 "replaces_evidence_id" "'$E1'")
check "replace ACCEPTED allowed" "${#R1}" "36"
check "a second live replacement of the same evidence refused (chain head)" "$(sqlstate "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, created_by, replaces_evidence_id) VALUES ('$ORG_A','EVD-R1B','DOCUMENT','$REC','$E1');")" "CE002"
check "one-live-successor unique index (guard bypassed)" "$(sqlstate "BEGIN; ALTER TABLE assurance_evidence DISABLE TRIGGER trg_assurance_evidence_lifecycle; INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, created_by, replaces_evidence_id) VALUES ('$ORG_A','EVD-R1B','DOCUMENT','$REC','$E1'); ROLLBACK;")" "23505"
submit "$R1" >/dev/null
check "replacement rejected" "$(sqlstate "$(reject_sql "$R1" "$DEC")")" "OK"
check "rejected replacement leaves the accepted predecessor unchanged" "$(q "SELECT verification_status||'|'||coalesce(superseded_by_evidence_id::text,'-')||'|'||lock_version FROM assurance_evidence WHERE id='$E1'")" "ACCEPTED|-|5"
check "replacing the rejected replacement refused (would fork the chain; replace the current evidence)" "$(sqlstate "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, created_by, replaces_evidence_id) VALUES ('$ORG_A','EVD-FORK','DOCUMENT','$REC','$R1');")" "CE002"
R2=$(ev EVD-R2 "replaces_evidence_id" "'$E1'")
check "second replacement of the current accepted evidence allowed" "${#R2}" "36"
submit "$R2" >/dev/null
check "replacement accepted" "$(sqlstate "$(accept_sql "$R2" "$DEC")")" "OK"
check "accepted replacement atomically supersedes the accepted predecessor" "$(q "SELECT verification_status||'|'||(superseded_by_evidence_id='$R2')::text||'|'||(superseded_at IS NOT NULL)::text||'|'||decided_by FROM assurance_evidence WHERE id='$E1'")" "SUPERSEDED|true|true|$DEC"
check "replace SUPERSEDED refused" "$(sqlstate "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, created_by, replaces_evidence_id) VALUES ('$ORG_A','EVD-R4','DOCUMENT','$REC','$E1');")" "CE002"
check "replacing the old rejected branch is still refused after supersession" "$(sqlstate "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, created_by, replaces_evidence_id) VALUES ('$ORG_A','EVD-FORK2','DOCUMENT','$REC','$R1');")" "CE002"
check "chain has exactly one current (ACCEPTED) row" "$(q "WITH RECURSIVE t AS (SELECT id, verification_status FROM assurance_evidence WHERE id='$E1' UNION ALL SELECT c.id, c.verification_status FROM assurance_evidence c JOIN t ON c.replaces_evidence_id=t.id) SELECT count(*) FILTER (WHERE verification_status='ACCEPTED')||'|'||count(*) FROM t")" "1|3"
# Chain 2: E2 (REJECTED) <- R5 (accepted): predecessor stays REJECTED.
R5=$(ev EVD-R5 "replaces_evidence_id" "'$E2'")
check "replace REJECTED allowed" "${#R5}" "36"
submit "$R5" >/dev/null; q "$(accept_sql "$R5" "$DEC")" >/dev/null
check "accepted replacement of a rejected predecessor leaves it REJECTED" "$(q "SELECT verification_status||'|'||coalesce(superseded_by_evidence_id::text,'-') FROM assurance_evidence WHERE id='$E2'")" "REJECTED|-"
check "replacement history is preserved" "$(q "SELECT (replaces_evidence_id='$E2')::text FROM assurance_evidence WHERE id='$R5'")" "true"
check "replaces_evidence_id is immutable" "$(sqlstate "UPDATE assurance_evidence SET replaces_evidence_id=NULL, lock_version=lock_version+1 WHERE id='$R5';")" "CE001"

echo ""
echo "== 6. Concurrency =="
# (a) two concurrent replacements of the same accepted evidence: one winner.
bg "BEGIN; INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, created_by, replaces_evidence_id) VALUES ('$ORG_A','EVD-RACE-1','DOCUMENT','$REC','$R2'); SELECT pg_sleep(3); COMMIT;"
BG=$!
sleep 1.5
RACE_A=$(sqlstate "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, created_by, replaces_evidence_id) VALUES ('$ORG_A','EVD-RACE-2','DOCUMENT','$REC','$R2');")
wait "$BG"
check "concurrent second replacement waits on the chain lock and is refused" "$RACE_A" "CE002"
check "exactly one viable live successor" "$(q "SELECT count(*) FROM assurance_evidence WHERE replaces_evidence_id='$R2' AND verification_status <> 'REJECTED'")" "1"
# (b) two concurrent decisions with the same lock_version: guarded second write updates nothing.
E6=$(ev EVD-6); submit "$E6" >/dev/null
LV=$(q "SELECT lock_version FROM assurance_evidence WHERE id='$E6'")
bg "BEGIN; UPDATE assurance_evidence SET verification_status='REJECTED', decided_by='$DEC', decided_at=now(), decision_reason='r', lock_version=lock_version+1 WHERE id='$E6' AND verification_status='AWAITING_VERIFICATION' AND lock_version=$LV; SELECT pg_sleep(3); COMMIT;"
BG=$!
sleep 1.5
RACE_B=$(q "WITH u AS (UPDATE assurance_evidence SET verification_status='ACCEPTED', decided_by='$DEC2', decided_at=now(), lock_version=lock_version+1 WHERE id='$E6' AND verification_status='AWAITING_VERIFICATION' AND lock_version=$LV RETURNING 1) SELECT count(*) FROM u;")
wait "$BG"
check "guarded second decision updates 0 rows" "$RACE_B" "0"
check "first decision stands" "$(st "$E6")" "REJECTED"
# (c) unguarded second decision after the first committed: refused by the lifecycle.
check "unguarded re-decision of a decided row refused" "$(sqlstate "$(accept_sql "$E6" "$DEC2")")" "CE001"
# (d) accept a replacement while its predecessor is being replaced concurrently is impossible: only one live successor exists.

echo ""
echo "== 7. Contractor authority =="
check "contractor evidence cannot enter the generic queue" "$(sqlstate "UPDATE assurance_evidence SET verification_status='AWAITING_VERIFICATION', verification_requested_by='$REC', verification_requested_at=now(), lock_version=lock_version+1 WHERE id='$CE';")" "CE002"
check "contractor evidence cannot be generically decided" "$(sqlstate "UPDATE assurance_evidence SET verification_status='ACCEPTED', decided_by='$DEC', decided_at=now(), lock_version=lock_version+1 WHERE id='$CE';")" "CE002"
check "contractor evidence cannot be generically corrected" "$(sqlstate "UPDATE assurance_evidence SET title='edited', lock_version=lock_version+1 WHERE id='$CE';")" "CE002"
SUB=$(q "SELECT id FROM assurance_requirement_submissions WHERE evidence_id='$CE'")
q "UPDATE assurance_requirement_submissions SET status='ACCEPTED', decided_by='$DEC', decided_at=now(), lock_version=lock_version+1 WHERE id='$SUB';" >/dev/null
check "contractor decision is made on the submission" "$(q "SELECT status FROM assurance_requirement_submissions WHERE id='$SUB'")" "ACCEPTED"
check "contractor evidence row stays untouched (no duplicated decision)" "$(q "SELECT verification_status||'|'||lock_version FROM assurance_evidence WHERE id='$CE'")" "UNVERIFIED|1"
check "contractor evidence cannot be generically replaced" "$(sqlstate "INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, created_by, replaces_evidence_id) VALUES ('$ORG_A','EVD-CR','DOCUMENT','$REC','$CE');")" "CE002"
EQ=$(ev EVD-Q1); submit "$EQ" >/dev/null
check "a submission cannot take evidence already in the generic queue" "$(sqlstate "INSERT INTO assurance_requirement_submissions (organisation_id, assignment_id, evidence_id, supplied_on, recorded_by) VALUES ('$ORG_A','$A_REQ','$EQ',current_date,'$REC');")" "CE002"
check "a submission cannot take generically accepted evidence" "$(sqlstate "INSERT INTO assurance_requirement_submissions (organisation_id, assignment_id, evidence_id, supplied_on, recorded_by) VALUES ('$ORG_A','$A_REQ','$R2',current_date,'$REC');")" "CE002"
check "a submission cannot take a replacement row" "$(sqlstate "INSERT INTO assurance_requirement_submissions (organisation_id, assignment_id, evidence_id, supplied_on, recorded_by) VALUES ('$ORG_A','$A_REQ','$R1',current_date,'$REC');")" "CE002"

echo ""
echo "== 8. Inspection / audit item context =="
EI=$(ev EVD-ITEM)
check "valid inspection item link" "$(sqlstate "INSERT INTO assurance_evidence_inspections (organisation_id, evidence_id, inspection_id, item_key, created_by) VALUES ('$ORG_A','$EI','$INS','fire-exits','$REC');")" "OK"
check "valid audit criterion link" "$(sqlstate "INSERT INTO assurance_evidence_audits (organisation_id, evidence_id, audit_id, criterion_key, created_by) VALUES ('$ORG_A','$EI','$AUD','c-1','$REC');")" "OK"
EI2=$(ev EVD-ITEM2)
check "item from a different inspection refused" "$(sqlstate "INSERT INTO assurance_evidence_inspections (organisation_id, evidence_id, inspection_id, item_key) VALUES ('$ORG_A','$EI2','$INS','ladders');")" "23503"
check "unknown item refused" "$(sqlstate "INSERT INTO assurance_evidence_inspections (organisation_id, evidence_id, inspection_id, item_key) VALUES ('$ORG_A','$EI2','$INS','no-such-item');")" "23503"
check "unknown audit criterion refused" "$(sqlstate "INSERT INTO assurance_evidence_audits (organisation_id, evidence_id, audit_id, criterion_key) VALUES ('$ORG_A','$EI2','$AUD','c-9');")" "23503"
check "cross-org response refused" "$(sqlstate "INSERT INTO assurance_evidence_inspections (organisation_id, evidence_id, inspection_id, item_key) VALUES ('$ORG_A','$EI2','$INS_B','fire-exits');")" "23503"
check "item context cannot be retargeted" "$(sqlstate "UPDATE assurance_evidence_inspections SET item_key='guard-rails' WHERE evidence_id='$EI' AND inspection_id='$INS';")" "CE001"
check "criterion context cannot be retargeted" "$(sqlstate "UPDATE assurance_evidence_audits SET criterion_key=NULL WHERE evidence_id='$EI';")" "CE001"
check "link cannot be moved to another inspection" "$(sqlstate "UPDATE assurance_evidence_inspections SET inspection_id='$INS2' WHERE evidence_id='$EI';")" "CE001"
check "link cannot be moved to other evidence" "$(sqlstate "UPDATE assurance_evidence_inspections SET evidence_id='$EI2' WHERE evidence_id='$EI';")" "CE001"
check "context link soft unlink still works" "$(sqlstate "UPDATE assurance_evidence_inspections SET removed_at=now(), removed_by='$REC', removal_reason='Linked to wrong item' WHERE evidence_id='$EI' AND inspection_id='$INS';")" "OK"
check "re-link to the right item as a new row" "$(sqlstate "INSERT INTO assurance_evidence_inspections (organisation_id, evidence_id, inspection_id, item_key, created_by) VALUES ('$ORG_A','$EI','$INS','guard-rails','$REC');")" "OK"
check "historical context preserved on the removed row" "$(q "SELECT item_key FROM assurance_evidence_inspections WHERE evidence_id='$EI' AND removed_at IS NOT NULL")" "fire-exits"

echo ""
echo "== 9. Non-propagation =="
INS_AUD_BEFORE=$(q "SELECT (SELECT status||updated_at FROM assurance_inspections WHERE id='$INS')||'|'||(SELECT status||updated_at FROM assurance_audits WHERE id='$AUD')")
submit "$EI" >/dev/null; q "$(accept_sql "$EI" "$DEC")" >/dev/null
EA=$(ev EVD-ACT)
q "INSERT INTO assurance_evidence_actions (organisation_id, evidence_id, action_id, created_by) VALUES ('$ORG_A','$EA','$ACT','$REC');" >/dev/null
ACT_BEFORE=$(q "SELECT status||'|'||updated_at FROM assurance_actions WHERE id='$ACT'")
AUDIT_BEFORE=$(q "SELECT count(*) FROM audit_logs")
submit "$EA" >/dev/null; q "$(accept_sql "$EA" "$DEC")" >/dev/null
check "accepting linked evidence leaves the Action untouched" "$(q "SELECT status||'|'||updated_at FROM assurance_actions WHERE id='$ACT'")" "$ACT_BEFORE"
check "no verification row is created by an evidence decision" "$(q "SELECT count(*) FROM assurance_verifications")" "0"
check "the database writes no audit rows of its own (the app writes them atomically)" "$(q "SELECT count(*) FROM audit_logs")" "$AUDIT_BEFORE"
check "inspection and audit untouched by item-linked evidence decisions" "$(q "SELECT (SELECT status||updated_at FROM assurance_inspections WHERE id='$INS')||'|'||(SELECT status||updated_at FROM assurance_audits WHERE id='$AUD')")" "$INS_AUD_BEFORE"

echo ""
echo "== 10. Idempotent re-apply =="
BEFORE=$(q "SELECT md5(string_agg(id::text||verification_status||lock_version||coalesce(superseded_by_evidence_id::text,''), ',' ORDER BY id)) FROM assurance_evidence")
psql_exec < "$A01H" >/dev/null && RE=OK || RE=FAILED
check "A0.1H re-applies cleanly" "$RE" "OK"
check "re-apply changes no data" "$(q "SELECT md5(string_agg(id::text||verification_status||lock_version||coalesce(superseded_by_evidence_id::text,''), ',' ORDER BY id)) FROM assurance_evidence")" "$BEFORE"
check "everything outside the altered tables still unchanged" "$(q "$OTHER_FP_SQL")" "$OTHER_PRE"

echo ""
echo "== 11. Rollback round-trip (destructive) =="
EVIDENCE=$(q "SELECT count(*) FROM assurance_evidence")
LINKS=$(q "SELECT (SELECT count(*) FROM assurance_evidence_inspections)+(SELECT count(*) FROM assurance_evidence_audits)+(SELECT count(*) FROM assurance_evidence_actions)")
psql_exec < "$A01H_ROLLBACK" >/dev/null 2>&1 && RB=OK || RB=FAILED
check "rollback applies" "$RB" "OK"
check "schema back to exactly pre-A0.1H" "$(q "$FULL_FP_SQL")" "$FULL_PRE"
check "evidence rows remain (decisions discarded)" "$(q "SELECT count(*) FROM assurance_evidence")" "$EVIDENCE"
check "evidence links remain (item context discarded)" "$(q "SELECT (SELECT count(*) FROM assurance_evidence_inspections)+(SELECT count(*) FROM assurance_evidence_audits)+(SELECT count(*) FROM assurance_evidence_actions)")" "$LINKS"
psql_exec < "$A01H_ROLLBACK" >/dev/null 2>&1 && RB2=OK || RB2=FAILED
check "rollback is idempotent" "$RB2" "OK"
psql_exec < "$A01H" >/dev/null && RE2=OK || RE2=FAILED
check "A0.1H re-applies after rollback (existing evidence becomes UNVERIFIED)" "$RE2" "OK"
check "after re-apply all evidence starts UNVERIFIED" "$(q "SELECT count(*) FILTER (WHERE verification_status='UNVERIFIED')||'|'||count(*) FROM assurance_evidence")" "$EVIDENCE|$EVIDENCE"

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
exit 0
