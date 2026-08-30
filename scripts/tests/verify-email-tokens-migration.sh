#!/usr/bin/env bash
# scripts/add-email-tokens.sql — repeatable behavioral validation.
#
# WHY THIS EXISTS: this migration's whole reason to exist is that the
# existing app/api/admin/migrate/route.ts definition of email_tokens
# declares `user_id UUID NOT NULL REFERENCES users(id)` against a
# users.id that is actually TEXT in the real, Production-confirmed
# schema — a UUID-vs-TEXT type mismatch that a plain "does this file
# parse" check would never catch, since it's a schema-vs-schema
# contradiction, not a syntax error. Only a real Postgres instance can
# prove the FK, CHECK, and UNIQUE constraints this table depends on
# (lib/tokens.ts's createToken()/consumeToken()) actually behave as
# intended — matching the same real-Postgres discipline already
# established by every other scripts/tests/verify-*.sh harness in this
# repository (mocked SQL cannot express real constraint/FK semantics).
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with a minimal organisations/users stand-in (TEXT ids, matching this
# repo's real convention), applies the ACTUAL, unmodified
# scripts/add-email-tokens.sql, then verifies column types, the primary
# key, the user_id FK (including ON DELETE CASCADE), the type CHECK
# constraint, the token UNIQUE constraint, both indexes, and finally
# re-applies the same script a second time to prove idempotency.
#
# WHAT THIS DOES NOT DO: not wired into CI (Docker is not part of the
# standard CI workflow here, matching every other disposable-Postgres
# harness's own precedent). Requires only Docker — no Neon/Production
# access, no local psql install. Creates and destroys its own disposable
# container; never touches Production, DEV, or any already-running
# database.
#
# USAGE:
#   bash scripts/tests/verify-email-tokens-migration.sh
#
# Exits 0 if every check passes, non-zero and prints a summary of what
# failed otherwise. Always removes the disposable container (trap on EXIT).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION="$REPO_ROOT/scripts/add-email-tokens.sql"
CONTAINER="email-tokens-harness-$$"
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

DIAG_OUT="/tmp/email_tokens_harness_out.$$.txt"

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
  # Minimal organisations/users stand-ins matching this repo's real
  # convention (TEXT ids) — everything email_tokens actually needs to
  # exist to be FK-testable, no more.
  cat <<'SQL' | psql_exec
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a');
INSERT INTO users (id, organisation_id, username, name) VALUES ('user-1', 'org-a', 'user1', 'User One'), ('user-2', 'org-a', 'user2', 'User Two');
SQL
}

echo ""
echo "=== BOOTSTRAP ==="
bootstrap_base
echo "  organisations/users stand-ins created"

echo ""
echo "=== APPLY MIGRATION (first run) ==="
if cat "$MIGRATION" | psql_exec; then
  echo "  PASS: 1. scripts/add-email-tokens.sql applies cleanly against a fresh database"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 1. migration failed to apply"
  sed 's/^/    /' "$DIAG_OUT"
  FAIL=$((FAIL + 1))
  FAILURES+=("migration failed to apply on first run")
fi

echo ""
echo "=== COLUMN TYPES ==="
expect_eq "2. id is TEXT" \
  "SELECT data_type FROM information_schema.columns WHERE table_name='email_tokens' AND column_name='id';" "text"
expect_eq "3. user_id is TEXT" \
  "SELECT data_type FROM information_schema.columns WHERE table_name='email_tokens' AND column_name='user_id';" "text"
expect_eq "4. token is TEXT" \
  "SELECT data_type FROM information_schema.columns WHERE table_name='email_tokens' AND column_name='token';" "text"
expect_eq "5. expires_at is timestamptz" \
  "SELECT data_type FROM information_schema.columns WHERE table_name='email_tokens' AND column_name='expires_at';" "timestampwithtimezone"

echo ""
echo "=== PRIMARY KEY + FOREIGN KEY ==="
expect_eq "6. id is the primary key" \
  "SELECT COUNT(*) FROM pg_constraint WHERE conrelid = 'email_tokens'::regclass AND contype = 'p';" "1"
expect_eq "7. user_id has a foreign key to users(id)" \
  "SELECT pg_get_constraintdef(oid) LIKE '%REFERENCES users(id)%' FROM pg_constraint WHERE conrelid = 'email_tokens'::regclass AND contype = 'f';" "t"
expect_eq "7b. the foreign key is ON DELETE CASCADE" \
  "SELECT confdeltype FROM pg_constraint WHERE conrelid = 'email_tokens'::regclass AND contype = 'f';" "c"

expect_failure "8. inserting a token for a non-existent user_id is rejected (FK enforced)" \
  "INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ('does-not-exist', 'tok-orphan', 'verify', now() + interval '1 day');"

expect_success "9. inserting a valid verify token for an existing user succeeds" \
  "INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ('user-1', 'tok-cascade', 'verify', now() + interval '1 day');"

expect_success "10. deleting the referenced user cascades to delete their token" \
  "DELETE FROM users WHERE id = 'user-1';"
expect_eq "10b. the cascaded token row is actually gone" \
  "SELECT COUNT(*) FROM email_tokens WHERE token = 'tok-cascade';" "0"
expect_eq "10c. the cascade did not remove an unrelated user's own token (scoped correctly)" \
  "SELECT COUNT(*) FROM users WHERE id = 'user-2';" "1"

echo ""
echo "=== type CHECK CONSTRAINT ==="
expect_success "11. type = 'verify' is accepted" \
  "INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ('user-2', 'tok-verify-1', 'verify', now() + interval '1 day');"
expect_success "12. type = 'reset' is accepted" \
  "INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ('user-2', 'tok-reset-1', 'reset', now() + interval '1 hour');"
expect_failure "13. an arbitrary type value is rejected (CHECK enforced)" \
  "INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ('user-2', 'tok-bogus-1', 'bogus', now() + interval '1 day');"

echo ""
echo "=== token UNIQUE CONSTRAINT ==="
expect_failure "14. inserting a duplicate token value is rejected (UNIQUE enforced)" \
  "INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ('user-2', 'tok-verify-1', 'reset', now() + interval '1 hour');"

echo ""
echo "=== NOT NULL / nullable shape ==="
expect_failure "15. expires_at is required — omitting it is rejected" \
  "INSERT INTO email_tokens (user_id, token, type) VALUES ('user-2', 'tok-no-expiry', 'verify');"
expect_success "16. used_at is genuinely optional — a freshly issued token has no used_at" \
  "INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ('user-2', 'tok-unused', 'verify', now() + interval '1 day');"
expect_eq "16b. used_at is NULL for that unused token" \
  "SELECT (used_at IS NULL) FROM email_tokens WHERE token = 'tok-unused';" "t"

echo ""
echo "=== INDEXES ==="
expect_eq "17. idx_email_tokens_token exists" \
  "SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'email_tokens' AND indexname = 'idx_email_tokens_token';" "1"
expect_eq "18. idx_email_tokens_user exists" \
  "SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'email_tokens' AND indexname = 'idx_email_tokens_user';" "1"

echo ""
echo "=== IDEMPOTENCY — re-apply the exact same migration a second time ==="
ROWS_BEFORE="$(echo "SELECT COUNT(*) FROM email_tokens;" | psql_query | tr -d '[:space:]')"
if cat "$MIGRATION" | psql_exec; then
  echo "  PASS: 19. re-running scripts/add-email-tokens.sql a second time succeeds without error"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 19. second run of the migration errored"
  sed 's/^/    /' "$DIAG_OUT"
  FAIL=$((FAIL + 1))
  FAILURES+=("migration is not idempotent — second run errored")
fi
ROWS_AFTER="$(echo "SELECT COUNT(*) FROM email_tokens;" | psql_query | tr -d '[:space:]')"
expect_eq "20. re-running the migration inserts no rows and drops none — existing data is untouched" \
  "SELECT ('$ROWS_BEFORE' = '$ROWS_AFTER');" "t"
expect_eq "21. exactly one email_tokens table exists after re-applying (no duplicate/renamed object)" \
  "SELECT COUNT(*) FROM pg_tables WHERE tablename = 'email_tokens';" "1"

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
