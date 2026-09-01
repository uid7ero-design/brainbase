#!/usr/bin/env bash
# scripts/add-events-order-notes.sql — repeatable behavioral validation.
#
# WHY THIS EXISTS: this migration's core safety property — "a note's
# order_id, event_id, and organisation_id can never be mutually
# inconsistent, and can never cross a tenant boundary" — is a composite
# FOREIGN KEY behavior that only a real Postgres instance can prove.
# This harness specifically proves the gap identified during design (a
# naive two-separate-FKs schema would let a note reference a real order
# and a real event that don't actually belong to each other) is closed
# by the single three-column composite FK this migration actually uses.
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with minimal organisations/users/events/event_orders stand-ins matching
# this repo's real schema (see scripts/create-events.sql,
# scripts/create-events-phase2.sql), applies the ACTUAL, unmodified
# scripts/add-events-order-notes.sql, then verifies:
#   - a valid same-tenant, same-order-event note succeeds
#   - a cross-tenant order reference is rejected
#   - a note naming a real order but a MISMATCHED real event (same org,
#     wrong event) is rejected — the specific gap this design closes
#   - deleting the author user SET NULLs author_user_id but leaves
#     author_name_snapshot and the note body untouched
#   - deleting the order CASCADEs its notes
#   - soft deletion (deleted_at) leaves the row intact, not removed
#   - 10 concurrent inserts against the same order land as 10 distinct,
#     uncorrupted rows (plain multi-row inserts have no capacity-style
#     contention to race on, but this proves it empirically rather than
#     asserting it from the schema alone)
#   - the migration is idempotent (safe to apply twice)
#   - every constraint/index lands exactly as declared
#
# WHAT THIS DOES NOT DO: not wired into CI (Docker is not part of the
# standard CI workflow here, matching every other disposable-Postgres
# harness's own precedent). Requires only Docker. Creates and destroys
# its own disposable container; never touches Production, DEV, or any
# already-running database.
#
# USAGE:
#   bash scripts/tests/verify-events-order-notes.sh
#
# Exits 0 if every check passes, non-zero and prints a summary of what
# failed otherwise. Always removes the disposable container (trap on EXIT).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION="$REPO_ROOT/scripts/add-events-order-notes.sql"
CONTAINER="events-order-notes-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -f "$MIGRATION" ]; then
  echo "ERROR: migration file not found: $MIGRATION" >&2
  exit 2
fi

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
  echo "ERROR: postgres in $CONTAINER did not become ready within 30s." >&2
  exit 2
fi

DIAG_OUT="/tmp/events_order_notes_harness_out.$$.txt"

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1
}
psql_query() {
  docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1
}

expect_success() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL (expected success, got error): $desc"
    sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

expect_failure() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then
    echo "  FAIL (expected an error, got success): $desc"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  else
    echo "  PASS: $desc (correctly rejected)"
    PASS=$((PASS + 1))
  fi
}

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

bootstrap_base() {
  cat <<'SQL' | psql_exec
CREATE TABLE organisations (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL REFERENCES organisations(id), email TEXT NOT NULL, role TEXT NOT NULL);

CREATE TABLE events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CANCELLED')),
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, timezone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT events_id_organisation_id_key UNIQUE (id, organisation_id),
  CONSTRAINT events_organisation_id_slug_key UNIQUE (organisation_id, slug),
  CONSTRAINT events_time_order_check CHECK (ends_at > starts_at)
);
CREATE TABLE event_orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL, event_id TEXT NOT NULL,
  purchaser_name TEXT NOT NULL, purchaser_email TEXT NOT NULL, purchaser_phone TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','CANCELLED')),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_orders_id_organisation_id_key UNIQUE (id, organisation_id),
  CONSTRAINT event_orders_event_org_fkey FOREIGN KEY (event_id, organisation_id) REFERENCES events (id, organisation_id) ON DELETE CASCADE
);

INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a'), ('org-b', 'Org B', 'org-b');
INSERT INTO users (id, organisation_id, email, role) VALUES ('user-a-1', 'org-a', 'staff@org-a.invalid', 'manager');
SQL
}

echo ""
echo "=== BOOTSTRAP ==="
bootstrap_base
echo "  organisations/users/events/event_orders stand-ins created"

echo ""
echo "=== APPLY MIGRATION (first run) ==="
if cat "$MIGRATION" | psql_exec; then
  echo "  PASS: 1. scripts/add-events-order-notes.sql applies cleanly against a fresh database"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 1. migration failed to apply"
  sed 's/^/    /' "$DIAG_OUT"
  FAIL=$((FAIL + 1))
  FAILURES+=("migration failed to apply on first run")
fi

echo ""
echo "=== CONSTRAINT/INDEX SHAPE ==="
expect_eq "2. event_orders_id_event_org_key exists (unique, 3 columns)" \
  "SELECT COUNT(*) FROM pg_constraint WHERE conrelid = 'event_orders'::regclass AND conname = 'event_orders_id_event_org_key' AND contype = 'u';" "1"
expect_eq "3. event_orders_id_organisation_id_key (pre-existing 2-column unique) is untouched" \
  "SELECT COUNT(*) FROM pg_constraint WHERE conrelid = 'event_orders'::regclass AND conname = 'event_orders_id_organisation_id_key' AND contype = 'u';" "1"
expect_eq "4. event_order_notes_order_event_org_fkey exists, references event_orders(id, event_id, organisation_id), ON DELETE CASCADE" \
  "SELECT pg_get_constraintdef(oid) LIKE '%REFERENCES event_orders(id, event_id, organisation_id)%ON DELETE CASCADE%' FROM pg_constraint WHERE conname = 'event_order_notes_order_event_org_fkey';" "t"
expect_eq "5. idx_event_order_notes_order exists" \
  "SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'event_order_notes' AND indexname = 'idx_event_order_notes_order';" "1"
expect_eq "6. idx_event_order_notes_event exists" \
  "SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'event_order_notes' AND indexname = 'idx_event_order_notes_event';" "1"
expect_eq "7. author_user_id is nullable" \
  "SELECT is_nullable FROM information_schema.columns WHERE table_name='event_order_notes' AND column_name='author_user_id';" "YES"
expect_eq "8. author_name_snapshot is NOT NULL" \
  "SELECT is_nullable FROM information_schema.columns WHERE table_name='event_order_notes' AND column_name='author_name_snapshot';" "NO"

echo ""
echo "=== SEED TEST DATA (org A: two events + one order each; org B: one event + order) ==="
cat <<'SQL' | psql_exec
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
  VALUES
    ('event-a1', 'org-a', 'Org A Event 1', 'a1', 'PUBLISHED', now()+interval '1 day', now()+interval '2 day', 'Australia/Adelaide'),
    ('event-a2', 'org-a', 'Org A Event 2', 'a2', 'PUBLISHED', now()+interval '3 day', now()+interval '4 day', 'Australia/Adelaide'),
    ('event-b1', 'org-b', 'Org B Event 1', 'b1', 'PUBLISHED', now()+interval '1 day', now()+interval '2 day', 'Australia/Adelaide');

INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents)
  VALUES
    ('order-a1-1', 'org-a', 'event-a1', 'Buyer A1', 'buyer-a1@example.invalid', 'CONFIRMED', 0),
    ('order-b1-1', 'org-b', 'event-b1', 'Buyer B1', 'buyer-b1@example.invalid', 'CONFIRMED', 0);
SQL
echo "  seed complete"

echo ""
echo "=== VALID NOTE ==="
expect_success "9. a note naming order-a1-1 + its OWN real event (event-a1) + org-a succeeds" \
  "INSERT INTO event_order_notes (id, organisation_id, event_id, order_id, body, author_user_id, author_name_snapshot) VALUES ('note-1', 'org-a', 'event-a1', 'order-a1-1', 'Attendee confirmed dietary requirements.', 'user-a-1', 'Staff One');"
expect_eq "10. the note reads back with its body intact" \
  "SELECT body FROM event_order_notes WHERE id = 'note-1';" "Attendeeconfirmeddietaryrequirements."

echo ""
echo "=== TENANT ISOLATION ==="
expect_failure "11. a note claiming order-b1-1 (a DIFFERENT tenant's order) under org-a is rejected" \
  "INSERT INTO event_order_notes (id, organisation_id, event_id, order_id, body, author_name_snapshot) VALUES ('note-cross-tenant', 'org-a', 'event-b1', 'order-b1-1', 'should not exist', 'Nobody');"

echo ""
echo "=== MISMATCHED EVENT/ORDER (the specific gap this design closes) ==="
expect_failure "12. a note naming a REAL same-tenant order (order-a1-1, whose real event is event-a1) but a DIFFERENT real same-tenant event (event-a2) is rejected" \
  "INSERT INTO event_order_notes (id, organisation_id, event_id, order_id, body, author_name_snapshot) VALUES ('note-mismatch', 'org-a', 'event-a2', 'order-a1-1', 'should not exist', 'Nobody');"
expect_eq "13. the rejected mismatched insert did not partially apply" \
  "SELECT COUNT(*) FROM event_order_notes WHERE id = 'note-mismatch';" "0"

echo ""
echo "=== AUTHOR DELETE BEHAVIOR ==="
expect_success "14. deleting the author user succeeds (does not error, does not cascade-delete the note)" \
  "DELETE FROM users WHERE id = 'user-a-1';"
expect_eq "15. the note row still exists after the author was deleted" \
  "SELECT COUNT(*) FROM event_order_notes WHERE id = 'note-1';" "1"
expect_eq "16. author_user_id was set to NULL by the delete" \
  "SELECT author_user_id IS NULL FROM event_order_notes WHERE id = 'note-1';" "t"
expect_eq "17. author_name_snapshot survived the delete untouched" \
  "SELECT author_name_snapshot FROM event_order_notes WHERE id = 'note-1';" "StaffOne"
expect_eq "18. the note body survived the delete untouched" \
  "SELECT body FROM event_order_notes WHERE id = 'note-1';" "Attendeeconfirmeddietaryrequirements."

echo ""
echo "=== SOFT DELETE ==="
expect_success "19. soft-deleting the note (setting deleted_at) succeeds" \
  "UPDATE event_order_notes SET deleted_at = now() WHERE id = 'note-1';"
expect_eq "20. the row still physically exists after a soft delete" \
  "SELECT COUNT(*) FROM event_order_notes WHERE id = 'note-1';" "1"
expect_eq "21. deleted_at is set" \
  "SELECT deleted_at IS NOT NULL FROM event_order_notes WHERE id = 'note-1';" "t"
expect_eq "22. the note body is still intact after soft delete (not scrubbed)" \
  "SELECT body FROM event_order_notes WHERE id = 'note-1';" "Attendeeconfirmeddietaryrequirements."

echo ""
echo "=== ORDER DELETE CASCADES ITS NOTES ==="
cat <<'SQL' | psql_exec
INSERT INTO event_order_notes (id, organisation_id, event_id, order_id, body, author_name_snapshot)
  VALUES ('note-cascade', 'org-a', 'event-a1', 'order-a1-1', 'will be cascaded away', 'Staff Two');
SQL
expect_success "23. deleting the order succeeds" \
  "DELETE FROM event_orders WHERE id = 'order-a1-1';"
expect_eq "24. every note on that order (note-1 and note-cascade) is gone after the order is deleted" \
  "SELECT COUNT(*) FROM event_order_notes WHERE order_id = 'order-a1-1';" "0"

echo ""
echo "=== CONCURRENT NOTE CREATION ==="
cat <<'SQL' | psql_exec
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents)
  VALUES ('order-a2-1', 'org-a', 'event-a2', 'Buyer A2', 'buyer-a2@example.invalid', 'CONFIRMED', 0);
SQL
CONCURRENT_PIDS=()
for i in 1 2 3 4 5 6 7 8 9 10; do
  (echo "INSERT INTO event_order_notes (organisation_id, event_id, order_id, body, author_name_snapshot) VALUES ('org-a', 'event-a2', 'order-a2-1', 'concurrent note $i', 'Staff $i');" | psql_exec >/dev/null 2>&1) &
  CONCURRENT_PIDS+=($!)
done
for pid in "${CONCURRENT_PIDS[@]}"; do wait "$pid"; done
expect_eq "25. all 10 concurrent note inserts on the same order landed as 10 distinct rows — no lost writes, no corruption, no unexpected contention" \
  "SELECT COUNT(*) FROM event_order_notes WHERE order_id = 'order-a2-1';" "10"
expect_eq "26. every one of those 10 rows has a distinct id (no accidental id collision/overwrite under concurrent load)" \
  "SELECT COUNT(DISTINCT id) FROM event_order_notes WHERE order_id = 'order-a2-1';" "10"

echo ""
echo "=== IDEMPOTENCY ==="
expect_success "27. re-applying the migration a second time is a no-op (no error)" \
  "$(cat "$MIGRATION")"
expect_eq "28. still exactly one event_orders_id_event_org_key constraint after the second apply" \
  "SELECT COUNT(*) FROM pg_constraint WHERE conrelid = 'event_orders'::regclass AND conname = 'event_orders_id_event_org_key';" "1"
expect_eq "29. event_order_notes rows from the concurrency test above survived the second migration apply untouched" \
  "SELECT COUNT(*) FROM event_order_notes WHERE order_id = 'order-a2-1';" "10"

echo ""
echo "=== SUMMARY ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
exit 0
