#!/usr/bin/env bash
# BrainBase Assurance A0.1G — Contractor Assurance migration: disposable PostgreSQL 17 proof.
#
# Applies the REAL migrations A0.1B..A0.1F, fingerprints the pre-existing
# schema, applies A0.1G, then proves:
#   * the pre-existing schema is byte-for-byte unchanged (current app unaffected);
#   * composite tenant FKs: foreign external organisation / requirement /
#     evidence / finding refused;
#   * assignment preconditions (active requirement, active external org,
#     IN_SCOPE record) incl. the deactivate-vs-assign race;
#   * one ACTIVE assignment per org/requirement; a cancelled one may be replaced;
#   * submission lifecycle matrix, content immutability, no DELETE anywhere;
#   * requirement snapshot taken at RECORD time and never rewritten by edits;
#   * recorder cannot accept/reject own submission;
#   * expiry-required acceptance needs expires_on;
#   * one ACCEPTED per assignment, atomic supersession, rejected replacement
#     leaves the accepted evidence current; verify-vs-supersede race;
#   * stale lock_version refused; Finding links append-only;
#   * idempotent re-apply and destructive rollback round-trip.
#
# Usage:   bash scripts/tests/verify-assurance-contractor-a01g-migration.sh
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
)
A01G="scripts/create-assurance-contractor-assurance-a01g.sql"
A01G_ROLLBACK="scripts/rollback-assurance-contractor-assurance-a01g.sql"
CONTAINER="brainbase-a01g-contractor-$$"
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

for f in "${MIGRATIONS[@]}" "$A01G" "$A01G_ROLLBACK"; do
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
# Fingerprint of every pre-existing public table/trigger/function (A0.1G objects excluded).
PRE_FP_SQL="SELECT md5(coalesce((SELECT string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''),'|' ORDER BY table_name,column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name NOT LIKE 'assurance_requirement%' AND table_name <> 'assurance_external_organisation_scopes'),'')
  || coalesce((SELECT string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid),'|' ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE connamespace='public'::regnamespace AND conrelid::regclass::text NOT LIKE 'assurance_requirement%' AND conrelid::regclass::text <> 'assurance_external_organisation_scopes'),'')
  || coalesce((SELECT string_agg(tgrelid::regclass::text||':'||tgname,'|' ORDER BY tgrelid::regclass::text,tgname) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'assurance_requirement%' AND tgrelid::regclass::text <> 'assurance_external_organisation_scopes'),'')
  || coalesce((SELECT string_agg(indexname,'|' ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename NOT LIKE 'assurance_requirement%' AND tablename <> 'assurance_external_organisation_scopes'),''));"

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

echo "Applying pre-A0.1G migrations ..."
for f in "${MIGRATIONS[@]}"; do
  psql_exec < "$f" >/dev/null || { echo "ERROR: $f failed to apply." >&2; exit 2; }
done

ORG_A="org-a01g-a"; ORG_B="org-a01g-b"
REC="usr-a01g-recorder"; DEC="usr-a01g-decider"; DEC2="usr-a01g-decider2"; B_USER="usr-a01g-b"
EO_A="44444444-4444-4444-8444-000000000001"      # active, will be in scope
EO_A_INACTIVE="44444444-4444-4444-8444-000000000002"
EO_A_NOSCOPE="44444444-4444-4444-8444-000000000003"
EO_B="44444444-4444-4444-8444-000000000009"
REQ_PL="55555555-5555-4555-8555-000000000001"    # expiry required, 30 day notice
REQ_TL="55555555-5555-4555-8555-000000000002"    # no expiry required
REQ_B="55555555-5555-4555-8555-000000000009"

cat <<SQL | psql_exec >/dev/null || { echo "ERROR: seed failed." >&2; exit 2; }
INSERT INTO organisations (id, name, slug, updated_at) VALUES ('$ORG_A','Org A','a01g-a',now()), ('$ORG_B','Org B','a01g-b',now());
INSERT INTO users (id, organisation_id, username, name, role, updated_at) VALUES
  ('$REC','$ORG_A','a01g-rec','Recorder','MANAGER',now()), ('$DEC','$ORG_A','a01g-dec','Decider','ADMIN',now()),
  ('$DEC2','$ORG_A','a01g-dec2','Decider Two','ADMIN',now()), ('$B_USER','$ORG_B','a01g-b','B User','ADMIN',now());
INSERT INTO external_organisations (id, organisation_id, reference, name, status) VALUES
  ('$EO_A','$ORG_A','EXT-A1','Acme Contracting','ACTIVE'),
  ('$EO_A_INACTIVE','$ORG_A','EXT-A2','Dormant Pty Ltd','INACTIVE'),
  ('$EO_A_NOSCOPE','$ORG_A','EXT-A3','Not In Scope Ltd','ACTIVE'),
  ('$EO_B','$ORG_B','EXT-B1','Org B Contractor','ACTIVE');
SQL

PRE_FP=$(q "$PRE_FP_SQL")

echo ""
echo "== 1. Apply A0.1G =="
psql_exec < "$A01G" >/dev/null && APPLIED=OK || APPLIED=FAILED
check "A0.1G applies" "$APPLIED" "OK"
check "pre-existing schema unchanged (currently deployed app unaffected)" "$(q "$PRE_FP_SQL")" "$PRE_FP"
check "5 tables created" "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('assurance_requirements','assurance_external_organisation_scopes','assurance_requirement_assignments','assurance_requirement_submissions','assurance_requirement_assignment_findings')")" "5"

echo ""
echo "== 2. Requirements =="
check "create requirement (expiry required, 30-day notice)" "$(sqlstate "INSERT INTO assurance_requirements (id, organisation_id, requirement_code, name, description, category, evidence_guidance, expiry_required, renewal_notice_days, created_by)
  VALUES ('$REQ_PL','$ORG_A','PL-INS','Public liability insurance','Current certificate of currency','INSURANCE','Certificate naming the policy period',true,30,'$DEC');")" "OK"
check "create requirement (no expiry)" "$(sqlstate "INSERT INTO assurance_requirements (id, organisation_id, requirement_code, name, category, created_by)
  VALUES ('$REQ_TL','$ORG_A','TRADE-LIC','Trade licence','LICENCE','$DEC');")" "OK"
check "duplicate requirement code refused" "$(sqlstate "INSERT INTO assurance_requirements (organisation_id, requirement_code, name, category) VALUES ('$ORG_A','PL-INS','Dup','OTHER');")" "23505"
check "same code allowed in another organisation" "$(sqlstate "INSERT INTO assurance_requirements (id, organisation_id, requirement_code, name, category) VALUES ('$REQ_B','$ORG_B','PL-INS','B PL','INSURANCE');")" "OK"
check "invalid code format refused" "$(sqlstate "INSERT INTO assurance_requirements (organisation_id, requirement_code, name, category) VALUES ('$ORG_A','bad code','x','OTHER');")" "23514"
check "renewal notice days out of range refused" "$(sqlstate "INSERT INTO assurance_requirements (organisation_id, requirement_code, name, category, renewal_notice_days) VALUES ('$ORG_A','X1','x','OTHER',0);")" "23514"
check "requirement code is immutable" "$(sqlstate "UPDATE assurance_requirements SET requirement_code='PL-NEW', lock_version=lock_version+1 WHERE id='$REQ_PL';")" "CA001"
check "stale requirement edit refused (lock_version not advanced)" "$(sqlstate "UPDATE assurance_requirements SET name='x' WHERE id='$REQ_PL';")" "CA003"
check "requirement DELETE refused" "$(sqlstate "DELETE FROM assurance_requirements WHERE id='$REQ_TL';")" "CA001"

echo ""
echo "== 3. Scope =="
check "scope record for org A external org" "$(sqlstate "INSERT INTO assurance_external_organisation_scopes (organisation_id, external_organisation_id, responsible_user_id, created_by, status_changed_by)
  VALUES ('$ORG_A','$EO_A','$DEC','$DEC','$DEC');")" "OK"
check "scope for foreign external organisation refused (tenant FK)" "$(sqlstate "INSERT INTO assurance_external_organisation_scopes (organisation_id, external_organisation_id) VALUES ('$ORG_A','$EO_B');")" "23503"
check "second scope record for same org refused" "$(sqlstate "INSERT INTO assurance_external_organisation_scopes (organisation_id, external_organisation_id) VALUES ('$ORG_A','$EO_A');")" "23505"
q "INSERT INTO assurance_external_organisation_scopes (organisation_id, external_organisation_id) VALUES ('$ORG_A','$EO_A_INACTIVE');" >/dev/null
q "INSERT INTO assurance_external_organisation_scopes (organisation_id, external_organisation_id, status) VALUES ('$ORG_A','$EO_A_NOSCOPE','OUT_OF_SCOPE');" >/dev/null
check "scope DELETE refused" "$(sqlstate "DELETE FROM assurance_external_organisation_scopes WHERE external_organisation_id='$EO_A';")" "CA001"

echo ""
echo "== 4. Assignments =="
A_PL=$(q "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id, created_by) VALUES ('$ORG_A','$EO_A','$REQ_PL','$REC') RETURNING id;")
check "assign PL to in-scope active org" "$( [ ${#A_PL} -eq 36 ] && echo OK || echo "$A_PL")" "OK"
A_TL=$(q "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id, created_by) VALUES ('$ORG_A','$EO_A','$REQ_TL','$REC') RETURNING id;")
check "duplicate ACTIVE assignment refused" "$(sqlstate "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id) VALUES ('$ORG_A','$EO_A','$REQ_PL');")" "23505"
check "foreign requirement refused (guard: not found in org)" "$(sqlstate "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id) VALUES ('$ORG_A','$EO_A','$REQ_B');")" "CA002"
check "foreign requirement refused by tenant FK even with the guard bypassed" "$(sqlstate "BEGIN; ALTER TABLE assurance_requirement_assignments DISABLE TRIGGER trg_assurance_req_assignments_lifecycle; INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id) VALUES ('$ORG_A','$EO_A','$REQ_B'); ROLLBACK;")" "23503"
check "foreign external organisation refused (guard)" "$(sqlstate "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id) VALUES ('$ORG_A','$EO_B','$REQ_TL');")" "CA002"
check "foreign external organisation refused by tenant FK with the guard bypassed" "$(sqlstate "BEGIN; ALTER TABLE assurance_requirement_assignments DISABLE TRIGGER trg_assurance_req_assignments_lifecycle; INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id) VALUES ('$ORG_A','$EO_B','$REQ_TL'); ROLLBACK;")" "23503"
check "inactive external organisation refused" "$(sqlstate "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id) VALUES ('$ORG_A','$EO_A_INACTIVE','$REQ_TL');")" "CA002"
check "OUT_OF_SCOPE organisation refused" "$(sqlstate "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id) VALUES ('$ORG_A','$EO_A_NOSCOPE','$REQ_TL');")" "CA002"
check "assignment created as CANCELLED refused" "$(sqlstate "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id, status, cancelled_at, cancel_reason) VALUES ('$ORG_A','$EO_A_NOSCOPE','$REQ_TL','CANCELLED',now(),'x');")" "CA001"
check "cancel needs a reason" "$(sqlstate "UPDATE assurance_requirement_assignments SET status='CANCELLED', cancelled_at=now(), lock_version=lock_version+1 WHERE id='$A_TL';")" "23514"
check "assignment identity immutable" "$(sqlstate "UPDATE assurance_requirement_assignments SET requirement_id='$REQ_PL', lock_version=lock_version+1 WHERE id='$A_TL';")" "CA001"
check "assignment DELETE refused" "$(sqlstate "DELETE FROM assurance_requirement_assignments WHERE id='$A_TL';")" "CA001"

echo ""
echo "== 5. Submissions, snapshot and independence =="
sub() { # $1 assignment, $2 ref, $3 expires_on (or NULL), $4 recorder
  q "WITH e AS (INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type, title, created_by) VALUES ('$ORG_A','$2','DOCUMENT','$2','$4') RETURNING id)
     INSERT INTO assurance_requirement_submissions (organisation_id, assignment_id, evidence_id, supplied_on, expires_on, recorded_by)
     SELECT '$ORG_A','$1',e.id,current_date,$3,'$4' FROM e RETURNING id;"
}
S1=$(sub "$A_PL" "EVD-A01G-1" "current_date + 400" "$REC")
check "record PL submission" "${#S1}" "36"
check "snapshot taken from the live requirement at record time" \
  "$(q "SELECT requirement_code_snapshot||'|'||requirement_name_snapshot||'|'||requirement_category_snapshot||'|'||expiry_required_snapshot||'|'||renewal_notice_days_snapshot||'|'||evidence_guidance_snapshot FROM assurance_requirement_submissions WHERE id='$S1'")" \
  "PL-INS|Public liability insurance|INSURANCE|true|30|Certificate naming the policy period"
check "caller-supplied snapshot is ignored (trigger owns it)" "$(q "WITH e AS (INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type) VALUES ('$ORG_A','EVD-A01G-FORGE','DOCUMENT') RETURNING id)
  INSERT INTO assurance_requirement_submissions (organisation_id, assignment_id, evidence_id, supplied_on, recorded_by, requirement_name_snapshot, requirement_code_snapshot, requirement_category_snapshot, expiry_required_snapshot)
  SELECT '$ORG_A','$A_TL',e.id,current_date,'$REC','FORGED','FORGED','OTHER',true FROM e RETURNING requirement_name_snapshot||'|'||expiry_required_snapshot;")" "Trade licence|false"
check "edit the live requirement (wording, guidance, notice days)" "$(sqlstate "UPDATE assurance_requirements SET name='Public liability insurance (\$20m)', evidence_guidance='New guidance', renewal_notice_days=60, updated_by='$DEC', lock_version=lock_version+1 WHERE id='$REQ_PL';")" "OK"
check "old submission keeps its record-time snapshot after the edit" \
  "$(q "SELECT requirement_name_snapshot||'|'||evidence_guidance_snapshot||'|'||renewal_notice_days_snapshot FROM assurance_requirement_submissions WHERE id='$S1'")" \
  "Public liability insurance|Certificate naming the policy period|30"
check "snapshot cannot be rewritten" "$(sqlstate "UPDATE assurance_requirement_submissions SET requirement_name_snapshot='x', lock_version=lock_version+1 WHERE id='$S1';")" "CA001"
check "submission content (expiry) immutable" "$(sqlstate "UPDATE assurance_requirement_submissions SET expires_on=current_date, lock_version=lock_version+1 WHERE id='$S1';")" "CA001"
check "submission recorded as ACCEPTED refused" "$(sqlstate "WITH e AS (INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type) VALUES ('$ORG_A','EVD-A01G-X','DOCUMENT') RETURNING id)
  INSERT INTO assurance_requirement_submissions (organisation_id, assignment_id, evidence_id, supplied_on, recorded_by, status, decided_by, decided_at) SELECT '$ORG_A','$A_PL',e.id,current_date,'$REC','ACCEPTED','$DEC',now() FROM e;")" "CA001"
check "foreign evidence refused (tenant FK)" "$(sqlstate "WITH e AS (INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type) VALUES ('$ORG_B','EVD-B-1','DOCUMENT') RETURNING id)
  INSERT INTO assurance_requirement_submissions (organisation_id, assignment_id, evidence_id, supplied_on, recorded_by) SELECT '$ORG_A','$A_PL',e.id,current_date,'$REC' FROM e;")" "23503"
check "recorder cannot accept own submission" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='ACCEPTED', decided_by='$REC', decided_at=now(), lock_version=lock_version+1 WHERE id='$S1';")" "23514"
check "stale decision refused" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='ACCEPTED', decided_by='$DEC', decided_at=now() WHERE id='$S1';")" "CA003"
check "reject needs a reason" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='REJECTED', decided_by='$DEC', decided_at=now(), lock_version=lock_version+1 WHERE id='$S1';")" "23514"
check "independent decider accepts" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='ACCEPTED', decided_by='$DEC', decided_at=now(), lock_version=lock_version+1 WHERE id='$S1';")" "OK"
check "ACCEPTED → REJECTED refused" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='REJECTED', decision_reason='x', lock_version=lock_version+1 WHERE id='$S1';")" "CA001"
check "ACCEPTED → SUBMITTED refused" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='SUBMITTED', decided_by=NULL, decided_at=NULL, lock_version=lock_version+1 WHERE id='$S1';")" "CA001"
check "submission DELETE refused" "$(sqlstate "DELETE FROM assurance_requirement_submissions WHERE id='$S1';")" "CA001"

echo ""
echo "== 6. Expiry-required acceptance =="
S_NOEXP=$(sub "$A_PL" "EVD-A01G-NOEXP" "NULL" "$REC")
check "accepting expiry-required evidence without expires_on refused" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='ACCEPTED', decided_by='$DEC', decided_at=now(), lock_version=lock_version+1 WHERE id='$S_NOEXP';")" "CA002"
check "…and S1 is still the current accepted evidence" "$(q "SELECT status FROM assurance_requirement_submissions WHERE id='$S1'")" "ACCEPTED"
check "withdraw the incomplete submission (recorder may withdraw)" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='WITHDRAWN', decided_by='$REC', decided_at=now(), lock_version=lock_version+1 WHERE id='$S_NOEXP';")" "OK"
check "WITHDRAWN → ACCEPTED refused" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='ACCEPTED', decided_by='$DEC', lock_version=lock_version+1 WHERE id='$S_NOEXP';")" "CA001"

echo ""
echo "== 7. Supersession =="
S2=$(sub "$A_PL" "EVD-A01G-2" "current_date + 500" "$REC")
check "rejected replacement" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='REJECTED', decided_by='$DEC', decided_at=now(), decision_reason='Wrong insured entity', lock_version=lock_version+1 WHERE id='$S2';")" "OK"
check "rejected replacement leaves previous ACCEPTED current" "$(q "SELECT status FROM assurance_requirement_submissions WHERE id='$S1'")" "ACCEPTED"
S3=$(sub "$A_PL" "EVD-A01G-3" "current_date + 600" "$REC")
check "accept replacement" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='ACCEPTED', decided_by='$DEC2', decided_at=now(), lock_version=lock_version+1 WHERE id='$S3';")" "OK"
check "previous ACCEPTED superseded atomically, linked to its replacement" \
  "$(q "SELECT status||'|'||(superseded_by_submission_id='$S3')::text||'|'||decided_by FROM assurance_requirement_submissions WHERE id='$S1'")" "SUPERSEDED|true|$DEC"
check "exactly one ACCEPTED per assignment" "$(q "SELECT count(*) FROM assurance_requirement_submissions WHERE assignment_id='$A_PL' AND status='ACCEPTED'")" "1"
check "all history kept (4 submissions on the PL assignment)" "$(q "SELECT count(*) FROM assurance_requirement_submissions WHERE assignment_id='$A_PL'")" "4"
check "SUPERSEDED → ACCEPTED refused" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='ACCEPTED', superseded_by_submission_id=NULL, superseded_at=NULL, lock_version=lock_version+1 WHERE id='$S1';")" "CA001"
check "second ACCEPTED rejected by the index (guard bypassed)" "$(sqlstate "SET session_replication_role = replica; UPDATE assurance_requirement_submissions SET status='ACCEPTED', decided_by='$DEC', decided_at=now(), decision_reason=NULL WHERE id='$S2';")" "23505"

echo ""
echo "== 8. Requirement deactivation =="
check "deactivate PL requirement" "$(sqlstate "UPDATE assurance_requirements SET status='INACTIVE', deactivated_at=now(), deactivated_by='$DEC', lock_version=lock_version+1 WHERE id='$REQ_PL';")" "OK"
check "existing ACTIVE assignment is not cancelled" "$(q "SELECT status FROM assurance_requirement_assignments WHERE id='$A_PL'")" "ACTIVE"
S4=$(sub "$A_PL" "EVD-A01G-4" "current_date + 700" "$REC")
check "existing assignment stays operational (evidence can still be recorded)" "${#S4}" "36"
q "UPDATE assurance_requirement_assignments SET status='CANCELLED', cancelled_at=now(), cancelled_by='$DEC', cancel_reason='Replaced', lock_version=lock_version+1 WHERE id='$A_PL';" >/dev/null
check "new assignment of an INACTIVE requirement refused" "$(sqlstate "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id) VALUES ('$ORG_A','$EO_A','$REQ_PL');")" "CA002"
check "decision on a cancelled assignment's pending submission refused" "$(sqlstate "UPDATE assurance_requirement_submissions SET status='ACCEPTED', decided_by='$DEC', decided_at=now(), lock_version=lock_version+1 WHERE id='$S4';")" "CA002"
check "recording on a cancelled assignment refused" "$(sqlstate "WITH e AS (INSERT INTO assurance_evidence (organisation_id, evidence_reference, evidence_type) VALUES ('$ORG_A','EVD-A01G-5','DOCUMENT') RETURNING id)
  INSERT INTO assurance_requirement_submissions (organisation_id, assignment_id, evidence_id, supplied_on, recorded_by) SELECT '$ORG_A','$A_PL',e.id,current_date,'$REC' FROM e;")" "CA002"
check "cancelled assignment cannot change" "$(sqlstate "UPDATE assurance_requirement_assignments SET status='ACTIVE', cancelled_at=NULL, cancelled_by=NULL, cancel_reason=NULL, lock_version=lock_version+1 WHERE id='$A_PL';")" "CA001"
q "UPDATE assurance_requirements SET status='ACTIVE', deactivated_at=NULL, deactivated_by=NULL, lock_version=lock_version+1 WHERE id='$REQ_PL';" >/dev/null
A_PL2=$(q "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id) VALUES ('$ORG_A','$EO_A','$REQ_PL') RETURNING id;")
check "after cancellation a replacement assignment is allowed" "${#A_PL2}" "36"
check "cancelled assignment history kept" "$(q "SELECT count(*) FROM assurance_requirement_assignments WHERE requirement_id='$REQ_PL' AND external_organisation_id='$EO_A'")" "2"

echo ""
echo "== 9. Scope changes keep history =="
check "move org out of scope" "$(sqlstate "UPDATE assurance_external_organisation_scopes SET status='OUT_OF_SCOPE', status_changed_at=now(), lock_version=lock_version+1 WHERE external_organisation_id='$EO_A';")" "OK"
check "out of scope does not cancel assignments" "$(q "SELECT count(*) FROM assurance_requirement_assignments WHERE external_organisation_id='$EO_A' AND status='ACTIVE'")" "2"
check "out of scope refuses new assignments" "$(sqlstate "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id) VALUES ('$ORG_A','$EO_A','$REQ_TL');")" "CA002"
check "back IN_SCOPE" "$(sqlstate "UPDATE assurance_external_organisation_scopes SET status='IN_SCOPE', status_changed_at=now(), lock_version=lock_version+1 WHERE external_organisation_id='$EO_A';")" "OK"

echo ""
echo "== 10. Finding links =="
F_A=$(q "INSERT INTO assurance_findings (organisation_id, finding_reference, finding_type, title, description, identified_at, responsible_external_organisation_id) VALUES ('$ORG_A','FND-A01G-1','DEFECT','Lapsed certificate','Synthetic',now(),'$EO_A') RETURNING id;")
F_B=$(q "INSERT INTO assurance_findings (organisation_id, finding_reference, finding_type, title, description, identified_at) VALUES ('$ORG_B','FND-A01G-B','DEFECT','B','B',now()) RETURNING id;")
check "explicit Finding link" "$(sqlstate "INSERT INTO assurance_requirement_assignment_findings (organisation_id, assignment_id, finding_id, created_by) VALUES ('$ORG_A','$A_PL2','$F_A','$REC');")" "OK"
check "duplicate link refused" "$(sqlstate "INSERT INTO assurance_requirement_assignment_findings (organisation_id, assignment_id, finding_id) VALUES ('$ORG_A','$A_PL2','$F_A');")" "23505"
check "foreign Finding refused (tenant FK)" "$(sqlstate "INSERT INTO assurance_requirement_assignment_findings (organisation_id, assignment_id, finding_id) VALUES ('$ORG_A','$A_PL2','$F_B');")" "23503"
check "Finding links are append-only" "$(sqlstate "DELETE FROM assurance_requirement_assignment_findings WHERE finding_id='$F_A';")" "CA001"
check "no Finding is created automatically by any of the above" "$(q "SELECT count(*) FROM assurance_findings WHERE organisation_id='$ORG_A'")" "1"

echo ""
echo "== 11. Races =="
# (a) deactivate-vs-assign: deactivation commits first; the waiting assignment re-reads and is refused.
q "UPDATE assurance_requirement_assignments SET status='CANCELLED', cancelled_at=now(), cancel_reason='race setup', lock_version=lock_version+1 WHERE id='$A_TL';" >/dev/null
( printf "BEGIN;\nUPDATE assurance_requirements SET status='INACTIVE', deactivated_at=now(), lock_version=lock_version+1 WHERE id='%s';\nSELECT pg_sleep(3);\nCOMMIT;\n" "$REQ_TL" \
  | docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >/dev/null 2>&1 ) &
BG=$!
sleep 1.5
RACE_A=$(sqlstate "INSERT INTO assurance_requirement_assignments (organisation_id, external_organisation_id, requirement_id) VALUES ('$ORG_A','$EO_A','$REQ_TL');")
wait "$BG"
check "assignment waiting on an in-flight deactivation is refused after it commits" "$RACE_A" "CA002"
q "UPDATE assurance_requirements SET status='ACTIVE', deactivated_at=NULL, deactivated_by=NULL, lock_version=lock_version+1 WHERE id='$REQ_TL';" >/dev/null
# (b) verify-vs-supersede: two pending submissions accepted concurrently on one assignment.
P1=$(sub "$A_PL2" "EVD-A01G-R1" "current_date + 100" "$REC")
P2=$(sub "$A_PL2" "EVD-A01G-R2" "current_date + 200" "$REC")
( printf "BEGIN;\nUPDATE assurance_requirement_submissions SET status='ACCEPTED', decided_by='%s', decided_at=now(), lock_version=lock_version+1 WHERE id='%s';\nSELECT pg_sleep(3);\nCOMMIT;\n" "$DEC" "$P1" \
  | docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >/dev/null 2>&1 ) &
BG=$!
sleep 1.5
RACE_B=$(sqlstate "UPDATE assurance_requirement_submissions SET status='ACCEPTED', decided_by='$DEC2', decided_at=now(), lock_version=lock_version+1 WHERE id='$P2';")
wait "$BG"
check "concurrent second acceptance: refused by the one-ACCEPTED invariant (app serialises on the assignment lock)" "$RACE_B" "23505"
check "after the race exactly one ACCEPTED, no orphan SUPERSEDED" "$(q "SELECT count(*) FILTER (WHERE status='ACCEPTED')||'|'||count(*) FILTER (WHERE status='SUPERSEDED') FROM assurance_requirement_submissions WHERE assignment_id='$A_PL2'")" "1|0"
# (c) two decisions on the same submission with the same lock_version: one wins.
P3=$(sub "$A_PL2" "EVD-A01G-R3" "current_date + 300" "$REC")
LV=$(q "SELECT lock_version FROM assurance_requirement_submissions WHERE id='$P3'")
( printf "BEGIN;\nUPDATE assurance_requirement_submissions SET status='REJECTED', decided_by='%s', decided_at=now(), decision_reason='r', lock_version=lock_version+1 WHERE id='%s' AND status='SUBMITTED' AND lock_version=%s;\nSELECT pg_sleep(3);\nCOMMIT;\n" "$DEC" "$P3" "$LV" \
  | docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >/dev/null 2>&1 ) &
BG=$!
sleep 1.5
RACE_C=$(q "WITH u AS (UPDATE assurance_requirement_submissions SET status='ACCEPTED', decided_by='$DEC2', decided_at=now(), lock_version=lock_version+1 WHERE id='$P3' AND status='SUBMITTED' AND lock_version=$LV RETURNING 1) SELECT count(*) FROM u;")
wait "$BG"
check "guarded second decision updates 0 rows" "$RACE_C" "0"
check "first decision stands" "$(q "SELECT status FROM assurance_requirement_submissions WHERE id='$P3'")" "REJECTED"

echo ""
echo "== 12. Idempotent re-apply =="
BEFORE=$(q "SELECT md5(string_agg(id::text||status||lock_version, ',' ORDER BY id)) FROM (SELECT id, status, lock_version FROM assurance_requirement_submissions UNION ALL SELECT id, status, lock_version FROM assurance_requirement_assignments UNION ALL SELECT id, status, lock_version FROM assurance_requirements) s")
psql_exec < "$A01G" >/dev/null && RE=OK || RE=FAILED
check "A0.1G re-applies cleanly" "$RE" "OK"
check "re-apply changes no data" "$(q "SELECT md5(string_agg(id::text||status||lock_version, ',' ORDER BY id)) FROM (SELECT id, status, lock_version FROM assurance_requirement_submissions UNION ALL SELECT id, status, lock_version FROM assurance_requirement_assignments UNION ALL SELECT id, status, lock_version FROM assurance_requirements) s")" "$BEFORE"
check "pre-existing schema still unchanged" "$(q "$PRE_FP_SQL")" "$PRE_FP"

echo ""
echo "== 13. Rollback round-trip (destructive) =="
EVIDENCE=$(q "SELECT count(*) FROM assurance_evidence")
FINDINGS=$(q "SELECT count(*) FROM assurance_findings")
psql_exec < "$A01G_ROLLBACK" >/dev/null 2>&1 && RB=OK || RB=FAILED
check "rollback applies" "$RB" "OK"
check "rollback dropped all 5 tables (Contractor Assurance data discarded)" "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE 'assurance_requirement%' OR table_name='assurance_external_organisation_scopes')")" "0"
check "shared evidence rows remain (context lost)" "$(q "SELECT count(*) FROM assurance_evidence")" "$EVIDENCE"
check "shared findings remain" "$(q "SELECT count(*) FROM assurance_findings")" "$FINDINGS"
check "schema back to exactly pre-A0.1G" "$(q "$PRE_FP_SQL")" "$PRE_FP"
psql_exec < "$A01G_ROLLBACK" >/dev/null 2>&1 && RB2=OK || RB2=FAILED
check "rollback is idempotent" "$RB2" "OK"
psql_exec < "$A01G" >/dev/null && RE2=OK || RE2=FAILED
check "A0.1G re-applies after rollback" "$RE2" "OK"

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
exit 0
