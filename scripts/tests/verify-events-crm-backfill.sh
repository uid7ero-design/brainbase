#!/usr/bin/env bash
# lib/crm/eventBackfill.ts's match/create SQL — real-Postgres proof.
#
# WHY THIS EXISTS: executeEventContactBackfill's core operation is a
# single CTE statement — lock, count every matching crm_contacts row
# (not just fetch one), and conditionally insert only when zero matches
# exist — that both reuses lib/crm/eventSync.ts's own advisory-lock
# concurrency mechanism AND adds ambiguity detection (count > 1) that
# eventSync.ts's own live-sync path doesn't need. Whether that count-
# then-branch logic is genuinely correct under real matching data,
# genuinely tenant-isolated, and genuinely race-free under concurrent
# load can only be proven against a real Postgres instance — a mock
# can't express row-count-driven CTE branching or lock contention.
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with a crm_contacts stand-in matching this repo's real schema (see
# scripts/crm-migrate.mjs), runs the EXACT SQL SHAPE
# lib/crm/eventBackfill.ts's executeEventContactBackfill embeds (same
# CTE structure, same lock key derivation) via psql, and proves:
#   - an existing SAME-email contact is reused, never duplicated
#   - an existing SAME-phone contact is reused, never duplicated
#   - no match -> a new contact is created
#   - the same email in a DIFFERENT organisation never matches and gets
#     its own separate contact
#   - two-or-more matching contacts (ambiguous) are detected via
#     match_count > 1 and NOT resolved by creating or silently picking
#     one — no insert occurs
#   - re-running the exact same match against its own just-created
#     contact is idempotent (second run reuses it, doesn't duplicate)
#   - reusing an existing contact never rewrites that contact's own
#     name/email/phone columns (no UPDATE exists in this statement at
#     all)
#   - 10 concurrent runs for the SAME organisation+identity with zero
#     pre-existing contacts produce exactly ONE contact, not ten
#
# WHAT THIS DOES NOT DO: does not invoke the actual TypeScript function
# (the Neon HTTP driver it uses is not driveable from a bash harness) —
# it proves the underlying SQL PATTERN that function embeds is
# genuinely correct and concurrency-safe, the same separation-of-
# concerns already established by every other verify-*.sh harness in
# this repository (e.g. scripts/tests/verify-events-crm-sync-
# concurrency.sh proves eventSync.ts's own sibling pattern the same
# way). Not wired into CI. Requires only Docker. Creates and destroys
# its own disposable container; never touches Production, DEV, or any
# already-running database.
#
# USAGE:
#   bash scripts/tests/verify-events-crm-backfill.sh

set -uo pipefail

CONTAINER="events-crm-backfill-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 2
fi

echo "Starting disposable postgres:16-alpine ($CONTAINER)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine >/dev/null

READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: postgres did not become ready within 30s." >&2
  exit 2
fi

DIAG_OUT="/tmp/events_crm_backfill_harness_out.$$.txt"

psql_exec() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1; }
psql_query() { docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1; }

expect_eq() {
  local desc="$1" sql="$2" want="$3"
  local got
  got="$(echo "$sql" | psql_query | tr -d '[:space:]')"
  if [ "$got" = "$want" ]; then
    echo "  PASS: $desc (got $got)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (want $want, got $got)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

echo ""
echo "=== BOOTSTRAP ==="
cat <<'SQL' | psql_exec
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT, phone TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a'), ('org-b', 'Org B', 'org-b');
SQL
echo "  organisations + crm_contacts created"

# match_and_create ORG MARKER IDENTITY EMAIL PHONE FIRST LAST
# Mirrors lib/crm/eventBackfill.ts's executeEventContactBackfill CTE
# exactly (lock_cte -> matches -> match_count -> ins), parameterised via
# psql variables. NORMEMAIL/NORMPHONE follow the same "email OR phone,
# never both" shape the real code uses.
match_and_create() {
  local org="$1" marker="$2" identity="$3" email="$4" phone="$5" first="$6" last="$7"
  local norm_email_clause norm_phone_clause
  if [ "$marker" = "email" ]; then
    norm_email_clause="'$identity'"
    norm_phone_clause="NULL"
  else
    norm_email_clause="NULL"
    norm_phone_clause="'$identity'"
  fi
  cat <<SQL | psql_query
WITH lock_cte AS (
  SELECT pg_advisory_xact_lock(hashtext('$org'), hashtext('$marker:$identity')) AS locked
),
matches AS (
  SELECT c.id, c.created_at
  FROM crm_contacts c, lock_cte
  WHERE c.organisation_id = '$org'
    AND (
      ($norm_email_clause::text IS NOT NULL AND lower(trim(c.email)) = $norm_email_clause)
      OR (
        $norm_email_clause::text IS NULL AND $norm_phone_clause::text IS NOT NULL
        AND regexp_replace(trim(c.phone), '[^0-9+]', '', 'g') = $norm_phone_clause
      )
    )
),
match_count AS (
  SELECT COUNT(*)::int AS cnt FROM matches
),
ins AS (
  INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, phone, notes)
  SELECT '$org', '$first', '$last', NULLIF('$email',''), NULLIF('$phone',''), 'Events / Historical Backfill'
  FROM match_count WHERE cnt = 0
  RETURNING id
)
SELECT (SELECT cnt FROM match_count) || '|' ||
       COALESCE((SELECT id::text FROM matches ORDER BY created_at ASC LIMIT 1), '') || '|' ||
       COALESCE((SELECT id::text FROM ins), '')
SQL
}

echo ""
echo "=== EXISTING EMAIL MATCH REUSED ==="
cat <<'SQL' | psql_exec
INSERT INTO crm_contacts (id, organisation_id, first_name, last_name, email, phone)
  VALUES ('11111111-1111-1111-1111-111111111111', 'org-a', 'Alice', 'Existing', 'alice@example.invalid', NULL);
SQL
RESULT="$(match_and_create org-a email 'alice@example.invalid' 'alice@example.invalid' '' 'Alice' 'FromOrder')"
MATCH_COUNT="$(echo "$RESULT" | cut -d'|' -f1)"
EXISTING_ID="$(echo "$RESULT" | cut -d'|' -f2)"
CREATED_ID="$(echo "$RESULT" | cut -d'|' -f3)"
if [ "$MATCH_COUNT" = "1" ] && [ "$EXISTING_ID" = "11111111-1111-1111-1111-111111111111" ] && [ -z "$CREATED_ID" ]; then
  echo "  PASS: 1. existing email match reused (match_count=1, existing_id correct, no new row inserted)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 1. existing email match reused (got match_count=$MATCH_COUNT existing_id=$EXISTING_ID created_id=$CREATED_ID)"
  FAIL=$((FAIL + 1)); FAILURES+=("existing email match reused")
fi
expect_eq "2. still exactly one contact in org-a after the email-match run (no duplicate)" \
  "SELECT COUNT(*) FROM crm_contacts WHERE organisation_id = 'org-a';" "1"
expect_eq "3. the existing contact's own name was NOT rewritten by the match (no UPDATE in this statement)" \
  "SELECT first_name FROM crm_contacts WHERE id = '11111111-1111-1111-1111-111111111111';" "Alice"

echo ""
echo "=== EXISTING PHONE MATCH REUSED ==="
cat <<'SQL' | psql_exec
INSERT INTO crm_contacts (id, organisation_id, first_name, last_name, email, phone)
  VALUES ('22222222-2222-2222-2222-222222222222', 'org-a', 'Bob', 'Existing', NULL, '+61412345678');
SQL
RESULT="$(match_and_create org-a phone '+61412345678' '' '+61412345678' 'Bob' 'FromOrder')"
MATCH_COUNT="$(echo "$RESULT" | cut -d'|' -f1)"
EXISTING_ID="$(echo "$RESULT" | cut -d'|' -f2)"
if [ "$MATCH_COUNT" = "1" ] && [ "$EXISTING_ID" = "22222222-2222-2222-2222-222222222222" ]; then
  echo "  PASS: 4. existing phone match reused (match_count=1, existing_id correct)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 4. existing phone match reused (got match_count=$MATCH_COUNT existing_id=$EXISTING_ID)"
  FAIL=$((FAIL + 1)); FAILURES+=("existing phone match reused")
fi

echo ""
echo "=== NEW CONTACT CREATED (no match) ==="
RESULT="$(match_and_create org-a email 'carol@example.invalid' 'carol@example.invalid' '' 'Carol' 'NewOrder')"
MATCH_COUNT="$(echo "$RESULT" | cut -d'|' -f1)"
CREATED_ID="$(echo "$RESULT" | cut -d'|' -f3)"
if [ "$MATCH_COUNT" = "0" ] && [ -n "$CREATED_ID" ]; then
  echo "  PASS: 5. no match -> new contact created (match_count=0, created_id present)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 5. no match -> new contact created (got match_count=$MATCH_COUNT created_id=$CREATED_ID)"
  FAIL=$((FAIL + 1)); FAILURES+=("new contact created")
fi
expect_eq "6. crm_contacts in org-a is now 3 (Alice, Bob, Carol)" \
  "SELECT COUNT(*) FROM crm_contacts WHERE organisation_id = 'org-a';" "3"

echo ""
echo "=== SAME EMAIL, DIFFERENT ORGANISATION -> SEPARATE CONTACT ==="
RESULT="$(match_and_create org-b email 'alice@example.invalid' 'alice@example.invalid' '' 'Alice' 'InOrgB')"
MATCH_COUNT="$(echo "$RESULT" | cut -d'|' -f1)"
CREATED_ID="$(echo "$RESULT" | cut -d'|' -f3)"
if [ "$MATCH_COUNT" = "0" ] && [ -n "$CREATED_ID" ]; then
  echo "  PASS: 7. org-a's alice@example.invalid does NOT match in org-b — separate contact created"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 7. cross-tenant separation (got match_count=$MATCH_COUNT created_id=$CREATED_ID)"
  FAIL=$((FAIL + 1)); FAILURES+=("cross-tenant separation")
fi
expect_eq "8. org-a's Alice contact count is still exactly 1 (unaffected by org-b's own contact)" \
  "SELECT COUNT(*) FROM crm_contacts WHERE organisation_id = 'org-a' AND email = 'alice@example.invalid';" "1"
expect_eq "9. org-b now has exactly 1 contact, tenant-isolated from org-a's 3" \
  "SELECT COUNT(*) FROM crm_contacts WHERE organisation_id = 'org-b';" "1"

echo ""
echo "=== AMBIGUOUS MATCH (2+ existing contacts with the same email) ==="
cat <<'SQL' | psql_exec
INSERT INTO crm_contacts (organisation_id, first_name, last_name, email)
  VALUES ('org-a', 'Dana', 'One', 'dana@example.invalid'), ('org-a', 'Dana', 'Two', 'dana@example.invalid');
SQL
BEFORE_COUNT="$(echo "SELECT COUNT(*) FROM crm_contacts WHERE organisation_id = 'org-a';" | psql_query | tr -d '[:space:]')"
RESULT="$(match_and_create org-a email 'dana@example.invalid' 'dana@example.invalid' '' 'Dana' 'FromOrder')"
MATCH_COUNT="$(echo "$RESULT" | cut -d'|' -f1)"
CREATED_ID="$(echo "$RESULT" | cut -d'|' -f3)"
AFTER_COUNT="$(echo "SELECT COUNT(*) FROM crm_contacts WHERE organisation_id = 'org-a';" | psql_query | tr -d '[:space:]')"
if [ "$MATCH_COUNT" = "2" ] && [ -z "$CREATED_ID" ] && [ "$BEFORE_COUNT" = "$AFTER_COUNT" ]; then
  echo "  PASS: 10. ambiguous match detected (match_count=2), NOT resolved by inserting or silently picking one (row count unchanged: $BEFORE_COUNT)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 10. ambiguous match handling (match_count=$MATCH_COUNT created_id=$CREATED_ID before=$BEFORE_COUNT after=$AFTER_COUNT)"
  FAIL=$((FAIL + 1)); FAILURES+=("ambiguous match handling")
fi

echo ""
echo "=== IDEMPOTENCY (re-running the same identity's match against its own just-created contact) ==="
RESULT="$(match_and_create org-a email 'erin@example.invalid' 'erin@example.invalid' '' 'Erin' 'First')"
FIRST_CREATED="$(echo "$RESULT" | cut -d'|' -f3)"
RESULT2="$(match_and_create org-a email 'erin@example.invalid' 'erin@example.invalid' '' 'Erin' 'Second')"
SECOND_MATCH_COUNT="$(echo "$RESULT2" | cut -d'|' -f1)"
SECOND_EXISTING="$(echo "$RESULT2" | cut -d'|' -f2)"
if [ -n "$FIRST_CREATED" ] && [ "$SECOND_MATCH_COUNT" = "1" ] && [ "$SECOND_EXISTING" = "$FIRST_CREATED" ]; then
  echo "  PASS: 11. re-running the match is idempotent — second run reuses the first run's own new contact, doesn't duplicate"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 11. idempotency (first_created=$FIRST_CREATED second_match_count=$SECOND_MATCH_COUNT second_existing=$SECOND_EXISTING)"
  FAIL=$((FAIL + 1)); FAILURES+=("idempotency")
fi
expect_eq "12. exactly one erin@example.invalid contact exists after both runs" \
  "SELECT COUNT(*) FROM crm_contacts WHERE organisation_id = 'org-a' AND email = 'erin@example.invalid';" "1"

echo ""
echo "=== CONCURRENCY (10 concurrent runs, same org+identity, zero pre-existing contacts) ==="
OUT_DIR="$(mktemp -d)"
CONCURRENT_PIDS=()
for i in $(seq 1 10); do
  (match_and_create org-a email 'frank@example.invalid' 'frank@example.invalid' '' 'Frank' "Attempt$i" > "$OUT_DIR/r$i.txt" 2>&1) &
  CONCURRENT_PIDS+=($!)
done
for pid in "${CONCURRENT_PIDS[@]}"; do wait "$pid"; done
FRANK_COUNT="$(echo "SELECT COUNT(*) FROM crm_contacts WHERE organisation_id = 'org-a' AND email = 'frank@example.invalid';" | psql_query | tr -d '[:space:]')"
if [ "$FRANK_COUNT" = "1" ]; then
  echo "  PASS: 13. 10 concurrent match/create runs for the same identity produced exactly 1 contact (advisory lock serialized them correctly)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 13. concurrency (expected 1 contact, got $FRANK_COUNT)"
  FAIL=$((FAIL + 1)); FAILURES+=("concurrency")
fi
rm -rf "$OUT_DIR"

echo ""
echo "=== SUMMARY ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
exit 0
