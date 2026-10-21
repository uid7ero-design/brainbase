#!/usr/bin/env bash
# Scheduling Phase 2A: full disposable-Postgres proof.
#
# Starts a FRESH postgres container (never touches Production, Neon or any running database),
# rehearses the manual migration package in the documented order, then runs every real-Postgres
# suite against it, one file at a time (they share one database and reset it).
#
# Order (mirrors docs/architecture/scheduling-phase2a-migration-package.md):
#   1. preflight (001)            read-only, must run clean on an empty database
#   2. shared migration (010)     applied TWICE (idempotency)
#   3. verification (020)         read-only
#   4. BrainBase host (110)       applied TWICE, then rolled back (190) and re-applied
#   5. suites                     contract, exclusive, concurrency, schema (incl. rollback), repositories
#   6. rollback (090)             on the empty schema, then clean re-apply
#
# USAGE   bash scripts/tests/verify-scheduling-phase2a.sh [PG_MAJOR]      (default 16)
# Not wired into CI (Docker is not part of the standard CI workflow in this repo).

set -uo pipefail

PG_MAJOR="${1:-16}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_DIR="$REPO_ROOT/packages/scheduling/sql"
HOST_DIR="$REPO_ROOT/scripts/scheduling"
NAME="sched2a-proof-$$"
FAIL=0

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required." >&2; exit 2; }

step() { printf '\n== %s\n' "$*"; }
psql_c() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
check() { if [ "$1" -ne 0 ]; then echo "   FAIL: $2"; FAIL=1; else echo "   ok: $2"; fi; }

step "start postgres:${PG_MAJOR}-alpine"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=pw -p 127.0.0.1::5432 "postgres:${PG_MAJOR}-alpine" >/dev/null || exit 2
for _ in $(seq 1 40); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
PORT="$(docker port "$NAME" 5432/tcp | head -n1 | sed 's/.*://')"
URL="postgres://postgres:pw@127.0.0.1:${PORT}/postgres"
echo "   version: $(docker exec "$NAME" psql -U postgres -Atc 'select version()' | cut -c1-40)"

# A BrainBase-shaped host table (the real organisations.id is TEXT) and a sentinel that must survive everything.
psql_c -c "CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE ld_sentinel (id int primary key, note text); INSERT INTO ld_sentinel VALUES (1, 'untouched');"

step "1. preflight on an empty database (read-only)"
# The Neon-role column of step 4 does not exist on plain Postgres; run each statement and expect only that one to differ.
docker exec -i "$NAME" psql -U postgres -q -f - < <(sed "s/OR pg_has_role(current_user, 'neon_superuser', 'member')//" "$SQL_DIR/001_preflight.sql") >/dev/null
check $? "001_preflight.sql ran without error"

step "2. shared migration, applied twice"
psql_c < "$SQL_DIR/010_shared_schema.sql" >/dev/null; check $? "010 first apply"
psql_c < "$SQL_DIR/010_shared_schema.sql" >/dev/null; check $? "010 second apply (idempotent)"

step "3. verification"
OUT="$(docker exec -i "$NAME" psql -U postgres -At -F'|' < "$SQL_DIR/020_verify.sql" 2>&1)"
echo "$OUT" | grep -q "^2a.1|" ; check $? "version marker 2a.1 present"
[ "$(echo "$OUT" | grep -c '^scheduling_.*|[0-9]*$')" -eq 13 ]; check $? "13 scheduling tables listed"
echo "$OUT" | grep -q "scheduling_holds_no_overlap"; check $? "exclusion constraint present"
echo "$OUT" | grep -qE "^0$"; check $? "0 legacy dependencies"

step "4. BrainBase host migration"
psql_c < "$HOST_DIR/110_brainbase_host.sql" >/dev/null; check $? "110 first apply"
psql_c < "$HOST_DIR/110_brainbase_host.sql" >/dev/null; check $? "110 second apply (idempotent)"
psql_c < "$HOST_DIR/190_brainbase_host_rollback.sql" >/dev/null; check $? "190 rollback"
psql_c < "$HOST_DIR/110_brainbase_host.sql" >/dev/null; check $? "110 re-apply after rollback"
psql_c < "$HOST_DIR/190_brainbase_host_rollback.sql" >/dev/null; check $? "190 rollback again (suites run standalone-style)"

step "5. suites (real Postgres, one file at a time)"
cd "$REPO_ROOT" || exit 2
for f in contract exclusive concurrency schema repositories; do
  echo "   -- $f"
  SCHEDULING_TEST_DATABASE_URL="$URL" npx vitest run --config vitest.integration.config.ts "packages/scheduling-postgres/tests/$f.integration.test.ts" 2>&1 | grep -E "^ +(Tests|Test Files) |FAIL|AssertionError" | sed 's/^/      /'
  RC=${PIPESTATUS[0]}
  check "$RC" "$f suite"
done

step "6. rollback of the shared migration, then clean re-apply"
# The suites leave rows behind. First show the data guard REFUSES, then clear the test data and roll back.
psql_c < "$SQL_DIR/090_rollback.sql" >/dev/null 2>&1; [ $? -ne 0 ]; check $? "090 refuses to run while reservations exist (data guard)"
psql_c -c "TRUNCATE scheduling_resource_holds, scheduling_reservations, scheduling_series_pauses, scheduling_series, scheduling_occurrences, scheduling_availability_exceptions, scheduling_availability_rules, scheduling_offering_resources, scheduling_offerings, scheduling_resources, scheduling_schedules, scheduling_settings CASCADE" >/dev/null
psql_c < "$SQL_DIR/090_rollback.sql" >/dev/null; check $? "090 rollback"
[ "$(docker exec "$NAME" psql -U postgres -Atc "select count(*) from information_schema.tables where table_name like 'scheduling\_%'")" = "0" ]; check $? "no scheduling tables remain"
[ "$(docker exec "$NAME" psql -U postgres -Atc "select note from ld_sentinel")" = "untouched" ]; check $? "foreign sentinel table untouched"
psql_c < "$SQL_DIR/010_shared_schema.sql" >/dev/null; check $? "010 re-apply after rollback"

echo
if [ "$FAIL" -eq 0 ]; then echo "PHASE 2A DISPOSABLE-POSTGRES PROOF: PASS (postgres $PG_MAJOR)"; else echo "PHASE 2A DISPOSABLE-POSTGRES PROOF: FAIL"; fi
exit "$FAIL"
