#!/usr/bin/env bash
# lib/crm/eventSync.ts's contact-dedupe SQL — real-concurrency proof.
#
# WHY THIS EXISTS: crm_contacts has no UNIQUE constraint on email or
# phone (see scripts/crm-migrate.mjs), so a naive "SELECT then INSERT if
# not found" from lib/crm/eventSync.ts's syncEventOrderContact() would
# be a classic check-then-act race under real concurrent requests for
# the same purchaser — two simultaneous bookings could both see "no
# existing contact" and both insert, creating a duplicate. The fix used
# in that file is a real Postgres advisory transaction lock
# (pg_advisory_xact_lock), keyed by (organisation_id, normalized
# identity), acquired inside the SAME statement as the dedupe
# check + insert via a CTE. This can only be proven against a real
# Postgres instance under genuine concurrent load — a mock can't express
# lock contention. This harness fires 10 concurrent psql processes
# running the EXACT SAME SQL SHAPE lib/crm/eventSync.ts uses (same lock
# key derivation, same CTE structure) at the same organisation+email,
# and proves exactly one contact results — plus a cross-tenant control
# proving the SAME email in a DIFFERENT organisation is unaffected by
# the other organisation's lock (different lock key -> no contention,
# and its own independent contact).
#
# WHAT THIS DOES NOT DO: does not invoke the actual TypeScript function
# (lib/crm/eventSync.ts uses the Neon HTTP driver, which is not driveable
# from a bash harness) — it proves the underlying SQL PATTERN that
# function embeds is genuinely concurrency-safe, the same
# separation-of-concerns already established by every other verify-*.sh
# harness in this repository (e.g.
# scripts/tests/verify-events-phase2-concurrency.sh proves the
# capacity-gated INSERT pattern the free-registration route embeds, not
# the route's own HTTP handler). Not wired into CI. Requires only
# Docker. Creates and destroys its own disposable container.
#
# USAGE:
#   bash scripts/tests/verify-events-crm-sync-concurrency.sh

set -uo pipefail

CONTAINER="crm-sync-concurrency-harness-$$"
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

psql_exec() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1; }
psql_query() { docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1; }

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

# The exact SQL shape lib/crm/eventSync.ts's syncEventOrderContact()
# runs for the "usable identity" branch (email present), with the same
# lock-key derivation: hashtext(organisation_id), hashtext('email:' || normalizedEmail).
dedupe_sql() {
  local org="$1" email="$2" firstname="$3"
  cat <<SQL
WITH lock_cte AS (
  SELECT pg_advisory_xact_lock(hashtext('$org'), hashtext('email:$email')) AS locked
),
existing AS (
  SELECT c.id FROM crm_contacts c, lock_cte
  WHERE c.organisation_id = '$org' AND lower(trim(c.email)) = '$email'
  ORDER BY c.created_at ASC LIMIT 1
),
ins AS (
  INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, notes)
  SELECT '$org', '$firstname', 'Concurrency', '$email', 'Events / Event Booking'
  FROM lock_cte
  WHERE NOT EXISTS (SELECT 1 FROM existing)
  RETURNING id
)
SELECT id FROM existing
UNION ALL
SELECT id FROM ins;
SQL
}

echo ""
echo "=== CONCURRENT DEDUPE: 10 simultaneous attempts, same organisation + same email ==="
PIDS=()
for i in $(seq 1 10); do
  ( dedupe_sql "org-a" "concurrent@example.invalid" "Attempt$i" | psql_exec >/dev/null 2>&1 ) &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do wait "$pid"; done
echo "  all 10 concurrent attempts completed"

CONTACT_COUNT="$(echo "SELECT COUNT(*) FROM crm_contacts WHERE organisation_id='org-a' AND lower(trim(email))='concurrent@example.invalid';" | psql_query | tr -d '[:space:]')"
if [ "$CONTACT_COUNT" = "1" ]; then
  echo "  PASS: exactly 1 contact exists after 10 concurrent same-identity attempts (got $CONTACT_COUNT)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected exactly 1 contact after 10 concurrent attempts, got $CONTACT_COUNT"
  FAIL=$((FAIL + 1))
  FAILURES+=("concurrent same-org/same-email dedupe produced $CONTACT_COUNT contacts, want 1")
fi

echo ""
echo "=== CROSS-TENANT CONTROL: same email, DIFFERENT organisation, must get its OWN separate contact ==="
dedupe_sql "org-b" "concurrent@example.invalid" "OrgBAttempt" | psql_exec >/dev/null 2>&1
ORG_B_COUNT="$(echo "SELECT COUNT(*) FROM crm_contacts WHERE organisation_id='org-b' AND lower(trim(email))='concurrent@example.invalid';" | psql_query | tr -d '[:space:]')"
TOTAL_COUNT="$(echo "SELECT COUNT(*) FROM crm_contacts WHERE lower(trim(email))='concurrent@example.invalid';" | psql_query | tr -d '[:space:]')"
if [ "$ORG_B_COUNT" = "1" ] && [ "$TOTAL_COUNT" = "2" ]; then
  echo "  PASS: org-b got its own separate contact (org-a's lock/dedupe did not affect org-b); total across both orgs = 2"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected org-b count=1 and total=2, got org-b=$ORG_B_COUNT total=$TOTAL_COUNT"
  FAIL=$((FAIL + 1))
  FAILURES+=("cross-tenant control: org-b=$ORG_B_COUNT total=$TOTAL_COUNT")
fi

echo ""
echo "=== REPEAT (SEQUENTIAL) SYNC REUSES THE SAME CONTACT (non-concurrency dedupe correctness) ==="
FIRST_ID="$(echo "SELECT id::text FROM crm_contacts WHERE organisation_id='org-a' AND lower(trim(email))='concurrent@example.invalid';" | psql_query | tr -d '[:space:]')"
dedupe_sql "org-a" "concurrent@example.invalid" "LaterAttempt" | psql_exec >/dev/null 2>&1
SECOND_ID="$(echo "SELECT id::text FROM crm_contacts WHERE organisation_id='org-a' AND lower(trim(email))='concurrent@example.invalid';" | psql_query | tr -d '[:space:]')"
if [ "$FIRST_ID" = "$SECOND_ID" ] && [ -n "$FIRST_ID" ]; then
  echo "  PASS: a later, sequential sync for the same identity reuses the same contact id ($FIRST_ID)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected the same contact id to be reused, got first=$FIRST_ID second=$SECOND_ID"
  FAIL=$((FAIL + 1))
  FAILURES+=("sequential reuse: first=$FIRST_ID second=$SECOND_ID")
fi

echo ""
echo "=== SUMMARY ==="
echo "  $PASS passed, $FAIL failed"
echo ""
echo "  KNOWN, DOCUMENTED LIMITATION (not tested here, reported honestly in"
echo "  the Phase 5 final report): two concurrent bookings for the same real"
echo "  person where one supplies an email and the other supplies only a"
echo "  phone number use DIFFERENT lock keys and are NOT serialized against"
echo "  each other — this harness only proves the SAME-identity case, which"
echo "  is what the lock design actually targets."
if [ "$FAIL" -gt 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
exit 0
