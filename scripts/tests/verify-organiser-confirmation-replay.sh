#!/usr/bin/env bash
# Phase D.4.6K — real disposable-Postgres proof that a Helena Organiser
# confirmation token is globally single-use (durable cross-request replay
# protection via the new organiser_action_confirmations ledger, migration
# step 44 — see app/api/admin/migrate/route.ts).
#
# WHY THIS EXISTS: the entire safety property this phase adds — "at most
# one request can both consume a token and execute the mutation" — is
# enforced by Postgres's own UNIQUE/PRIMARY KEY conflict-resolution
# behavior under `INSERT ... ON CONFLICT (jti) DO NOTHING`, inside one
# atomic writable-CTE statement (see proposeOrExecuteOrganiserComment in
# lib/organiser/helenaWrite.ts). A mocked sql client can simulate the
# RESULT of a race but cannot prove the race itself is actually race-safe —
# only real MVCC/locking semantics can. This harness follows the exact
# same disposable-container methodology as every other real-Postgres
# harness in this repo (scripts/tests/verify-organiser-item-activity-
# concurrency.sh, scripts/tests/verify-datahub-initiate-finalize-routes.sh):
# a fresh postgres:16-alpine container, created and destroyed by this
# script only, never touching Production/Neon or any already-running
# database.
#
# WHAT THIS DOES:
#   1. starts the disposable container and applies the REAL organiser
#      schema (organisations/users/organiser_boards/organiser_items/
#      organiser_item_updates/organiser_activity + the sanitiser function,
#      extracted verbatim from the same source as
#      verify-organiser-item-activity-concurrency.sh's own bootstrap) PLUS
#      the new organiser_action_confirmations table (migration step 44,
#      extracted verbatim from app/api/admin/migrate/route.ts);
#   2. proves migration idempotency by applying the exact same DDL a
#      second time (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
#      EXISTS — must not error);
#   3. proves failure-atomicity directly in SQL: a hand-mirrored copy of
#      the real atomic statement's shape, with the activity INSERT's
#      event_type deliberately broken, must reject AND leave zero ledger/
#      item_updates rows behind — proving a downstream failure rolls back
#      the ledger consume, not just the primary mutation;
#   4. runs scripts/tests/organiserConfirmationReplay.integration.test.ts
#      via `vitest --config vitest.integration.config.ts`, which imports
#      the REAL, completely unmodified proposeOrExecuteOrganiserComment and
#      exercises first-consume/replay/concurrent-replay/expiry/wrong-user/
#      wrong-org/tampered-token/item-not-found-atomicity/ledger-uniqueness/
#      metadata/non-mutating-proposal against this real container.
#
# WHAT THIS DOES NOT DO: it is not wired into CI (Docker is not part of the
# standard CI workflow in this repo, matching every prior harness of this
# kind). It never touches Production or any already-running database — it
# creates and destroys its own disposable container, and cleans up on exit
# even on failure (trap on EXIT).
#
# USAGE:
#   bash scripts/tests/verify-organiser-confirmation-replay.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER="organiser-replay-harness-$$"
HOST_PORT=$((20000 + RANDOM % 20000))
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 2
fi

echo "Starting disposable postgres:16-alpine ($CONTAINER) on host port $HOST_PORT..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb \
  -p "127.0.0.1:${HOST_PORT}:5432" \
  postgres:16-alpine >/dev/null

READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: postgres in $CONTAINER did not become ready within 30s." >&2
  exit 2
fi

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1
}
psql_query() {
  docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1
}

# ─── Real, unmodified DDL — organiser_boards/items/activity/item_updates
# extracted verbatim from the same source as
# verify-organiser-item-activity-concurrency.sh's own bootstrap; the
# organiser_action_confirmations table is migration step 44, extracted
# verbatim from app/api/admin/migrate/route.ts. ─────────────────────────
SCHEMA_SQL='
CREATE TABLE IF NOT EXISTS organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS organiser_boards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name            TEXT NOT NULL,
  color           TEXT,
  icon            TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organiser_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id        UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  group_id        UUID,
  parent_item_id  UUID REFERENCES organiser_items(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT '"'"'Not Started'"'"',
  priority        TEXT,
  owner           TEXT,
  due_date        DATE,
  notes           TEXT,
  fields          JSONB NOT NULL DEFAULT '"'"'{}'"'"',
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE organiser_items ADD COLUMN IF NOT EXISTS custom_values JSONB NOT NULL DEFAULT '"'"'{}'"'"';

CREATE TABLE IF NOT EXISTS organiser_activity (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  board_id        UUID NOT NULL,
  item_id         UUID,
  actor_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name      TEXT NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN (
                     '"'"'board.created'"'"', '"'"'board.updated'"'"', '"'"'board.deleted'"'"',
                     '"'"'group.created'"'"', '"'"'group.updated'"'"', '"'"'group.deleted'"'"',
                     '"'"'column.created'"'"', '"'"'column.updated'"'"', '"'"'column.deleted'"'"',
                     '"'"'item.created'"'"', '"'"'item.updated'"'"', '"'"'item.moved'"'"', '"'"'item.deleted'"'"',
                     '"'"'comment.created'"'"', '"'"'comment.deleted'"'"',
                     '"'"'file.added'"'"', '"'"'file.deleted'"'"',
                     '"'"'import.completed'"'"'
                   )),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('"'"'board'"'"', '"'"'group'"'"', '"'"'item'"'"', '"'"'column'"'"', '"'"'file'"'"', '"'"'comment'"'"', '"'"'import'"'"')),
  entity_id       TEXT NOT NULL,
  before_json     JSONB,
  after_json      JSONB,
  metadata_json   JSONB NOT NULL DEFAULT '"'"'{}'"'"'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organiser_item_updates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES organiser_items(id) ON DELETE CASCADE,
  board_id        UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  author_name     TEXT,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION organiser_activity_sanitise_scalar(value jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $f$
  SELECT CASE
    WHEN value IS NULL OR jsonb_typeof(value) = '"'"'null'"'"' THEN value
    WHEN jsonb_typeof(value) = '"'"'string'"'"' THEN
      to_jsonb(
        CASE WHEN length(value #>> '"'"'{}'"'"') > 200
          THEN left(value #>> '"'"'{}'"'"', 200) || '"'"'…(truncated)'"'"'
          ELSE value #>> '"'"'{}'"'"'
        END
      )
    WHEN jsonb_typeof(value) IN ('"'"'object'"'"', '"'"'array'"'"') THEN
      to_jsonb(
        CASE WHEN length(value::text) > 200
          THEN left(value::text, 200) || '"'"'…(truncated)'"'"'
          ELSE value::text
        END
      )
    ELSE value
  END
$f$;

-- Migration step 44 — extracted verbatim from app/api/admin/migrate/route.ts
CREATE TABLE IF NOT EXISTS organiser_action_confirmations (
  jti             TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  action_type     TEXT NOT NULL CHECK (action_type IN ('"'"'post_comment'"'"')),
  item_id         UUID,
  consumed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_organiser_action_confirmations_org_user ON organiser_action_confirmations(organisation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_organiser_action_confirmations_expires_at ON organiser_action_confirmations(expires_at);
'

echo ""
echo "=== 1. MIGRATION APPLIES FRESH ==="
if echo "$SCHEMA_SQL" | psql_exec >/dev/null 2>&1; then
  echo "  PASS: schema (including organiser_action_confirmations) applied cleanly"
  PASS=$((PASS + 1))
else
  echo "  FAIL: schema failed to apply"
  FAIL=$((FAIL + 1))
  FAILURES+=("schema apply")
fi

echo ""
echo "=== 2. MIGRATION IDEMPOTENCY — re-applying the exact same DDL must not error ==="
if echo "$SCHEMA_SQL" | psql_exec >/dev/null 2>&1; then
  echo "  PASS: re-applying schema is a no-op, no error"
  PASS=$((PASS + 1))
else
  echo "  FAIL: re-applying schema errored — not idempotent"
  FAIL=$((FAIL + 1))
  FAILURES+=("schema idempotency")
fi

echo "INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a');" | psql_exec >/dev/null
echo "INSERT INTO users (id, organisation_id, username, name) VALUES ('user-1', 'org-a', 'user-1', 'User One');" | psql_exec >/dev/null
# Wrapped as WITH...SELECT (not a bare INSERT...RETURNING) so psql's -t
# mode emits only the tuple value, never an "INSERT 0 1" command tag
# alongside it (which would otherwise get captured into the shell variable).
BOARD_ID="$(echo "WITH ins AS (INSERT INTO organiser_boards (organisation_id, name) VALUES ('org-a', 'WORK') RETURNING id) SELECT id FROM ins;" | psql_query | tr -d '[:space:]')"
ITEM_ID="$(echo "WITH ins AS (INSERT INTO organiser_items (board_id, organisation_id, name) VALUES ('$BOARD_ID', 'org-a', 'Atomicity Item') RETURNING id) SELECT id FROM ins;" | psql_query | tr -d '[:space:]')"

echo ""
echo "=== 3. FAILURE-ATOMICITY — a downstream (activity) insert failure must roll back the ledger consume AND the item_updates insert together ==="
# Mirrors the real atomic statement's shape but with a deliberately invalid
# event_type, so the activity CHECK constraint fails — proving the whole
# statement (ledger consume included) rolls back atomically, exactly like
# the existing "ATOMIC FAILURE" pattern in
# verify-organiser-item-activity-concurrency.sh.
FAKE_JTI="00000000-0000-4000-8000-000000000001"
BROKEN_SQL="
WITH target_item AS (
  SELECT id, board_id FROM organiser_items WHERE id = '$ITEM_ID' AND organisation_id = 'org-a'
),
consumed AS (
  INSERT INTO organiser_action_confirmations (jti, organisation_id, user_id, action_type, item_id, expires_at)
  SELECT '$FAKE_JTI', 'org-a', 'user-1', 'post_comment', '$ITEM_ID', NOW() + interval '2 minutes'
  WHERE EXISTS (SELECT 1 FROM target_item)
  ON CONFLICT (jti) DO NOTHING
  RETURNING jti
),
inserted AS (
  INSERT INTO organiser_item_updates (item_id, board_id, organisation_id, author_name, body)
  SELECT target_item.id, target_item.board_id, 'org-a', 'Tester', 'should roll back'
  FROM target_item, consumed
  RETURNING id, item_id, board_id, body, created_at
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, item_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json, metadata_json)
  SELECT 'org-a', inserted.board_id, inserted.item_id, 'user-1', 'Tester', 'comment.NOT_A_REAL_EVENT_TYPE', 'comment', inserted.id::text, NULL, '{}'::jsonb, '{}'::jsonb
  FROM inserted
  RETURNING id
)
SELECT inserted.id FROM inserted;
"
OUT="$(echo "$BROKEN_SQL" | psql_exec 2>&1)"
if [ $? -ne 0 ]; then
  echo "  PASS: forced-invalid-event-type statement correctly rejected by CHECK constraint"
  PASS=$((PASS + 1))
else
  echo "  FAIL: forced-invalid statement unexpectedly succeeded"
  FAIL=$((FAIL + 1))
  FAILURES+=("forced-invalid statement should have failed")
fi
LEDGER_COUNT="$(echo "SELECT count(*) FROM organiser_action_confirmations WHERE jti = '$FAKE_JTI';" | psql_query | tr -d '[:space:]')"
if [ "$LEDGER_COUNT" = "0" ]; then
  echo "  PASS (HARD GATE): ledger consume ROLLED BACK too — zero rows for the forced-failure jti"
  PASS=$((PASS + 1))
else
  echo "  FAIL (HARD GATE): ledger row persisted despite the downstream activity insert failing — token would be permanently burned with no mutation"
  FAIL=$((FAIL + 1))
  FAILURES+=("ledger consume did not roll back on downstream failure")
fi
UPDATES_COUNT="$(echo "SELECT count(*) FROM organiser_item_updates WHERE item_id = '$ITEM_ID';" | psql_query | tr -d '[:space:]')"
if [ "$UPDATES_COUNT" = "0" ]; then
  echo "  PASS: item_updates insert ROLLED BACK too"
  PASS=$((PASS + 1))
else
  echo "  FAIL: item_updates row persisted despite the transaction failing"
  FAIL=$((FAIL + 1))
  FAILURES+=("item_updates did not roll back on downstream failure")
fi

echo ""
echo "=== 4. REAL PROPOSE/CONFIRM/REPLAY/CONCURRENCY SUITE (vitest against this same container) ==="
export DATABASE_URL="postgresql://postgres:test@localhost:${HOST_PORT}/testdb"
echo "DATABASE_URL=$DATABASE_URL (disposable container only)"
cd "$REPO_ROOT"
npx vitest run --config vitest.integration.config.ts scripts/tests/organiserConfirmationReplay.integration.test.ts
VITEST_RESULT=$?
if [ "$VITEST_RESULT" -eq 0 ]; then
  echo "  PASS: organiserConfirmationReplay.integration.test.ts (all cases)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: organiserConfirmationReplay.integration.test.ts (exit $VITEST_RESULT)"
  FAIL=$((FAIL + 1))
  FAILURES+=("vitest integration suite")
fi

echo ""
echo "=== SUMMARY ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
if [ "$FAIL" -ne 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
echo "All checks passed."
exit 0
